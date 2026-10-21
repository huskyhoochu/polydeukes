import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkChangeSet } from '../src/check-change-set.ts';
import { checkCovenant } from '../src/check-covenant.ts';
import { memoryIngest } from '../src/memory-ingest.ts';
import { memorySearch } from '../src/memory-search.ts';
import type { Spawn, SpawnOutcome, SpawnSpec } from '../src/process.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/sdk/contract.json', import.meta.url), 'utf8'),
);
const bytes = (text: string) => new TextEncoder().encode(text);
const empty = bytes('{"ingestedAt":"fixture-time","results":[]}');
const query = 'two words; $(touch unwanted)';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdks-standalone-ts-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function recording(outcome: SpawnOutcome = { status: 0, stdout: empty, stderr: bytes('') }) {
  const calls: SpawnSpec[] = [];
  const spawn: Spawn = async (spec) => {
    calls.push(spec);
    return outcome;
  };
  return { spawn, calls };
}

async function everyVerb(executable: string | undefined, spawn: Spawn, timeoutMs?: number) {
  const shared = { executable, spawn, timeoutMs };
  return Promise.all([
    checkCovenant({
      ...shared,
      repoRoot: root,
      input: fixture.input,
      enforce: 'advise',
      configLayer: 'host layer.json',
      telemetryPath: 'rows.log',
    }),
    checkChangeSet({ ...shared, repoRoot: root, diff: fixture.diff }),
    memoryIngest({ ...shared, root }),
    memorySearch({ ...shared, root, query, limit: 7 }),
  ]);
}

function script(name: string, body: string) {
  const path = join(root, name);
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = --warmup ]; then exit 0; fi\n${body}\n`);
  chmodSync(path, 0o755);
  execFileSync(path, ['--warmup']);
  return path;
}

describe('standalone process contract', () => {
  it('uses one byte seam for four literal commands and preserves evidence, diff and flags', async () => {
    // A second transport path tends to lose memory deadlines or add covenant flags to memory.
    const { spawn, calls } = recording();
    await everyVerb('./tools/pdks', spawn, 123);
    expect(calls.map(({ command, cwd, timeoutMs }) => ({ command, cwd, timeoutMs }))).toEqual(
      Array.from({ length: 4 }, () => ({
        command: resolve('tools/pdks'),
        cwd: root,
        timeoutMs: 123,
      })),
    );
    expect(calls.map((call) => call.args)).toEqual([
      [
        'covenant',
        'check',
        '--enforce',
        'advise',
        '--config-layer',
        'host layer.json',
        '--telemetry-path',
        'rows.log',
      ],
      ['covenant', 'check', '--diff', '--enforce', 'block'],
      ['memory', 'ingest'],
      ['memory', 'search', query, '--json', '--limit', '7'],
    ]);
    expect(calls.map((call) => Array.from(call.stdin))).toEqual(
      [bytes(JSON.stringify(fixture.input)), bytes(fixture.diff), bytes(''), bytes('')].map(
        (value) => Array.from(value),
      ),
    );
  });

  it('preserves executable symlink spelling and resolves relative root from caller cwd', async () => {
    // Canonicalization changes the command a caller explicitly selected.
    const target = script('target', 'exit 0');
    const link = join(root, 'named-pdks');
    symlinkSync(target, link);
    const { spawn, calls } = recording();
    await checkCovenant({
      repoRoot: relative(process.cwd(), root),
      executable: link,
      input: fixture.input,
      spawn,
    });
    expect(calls[0]?.command).toBe(link);
    expect(calls[0]?.cwd).toBe(resolve(root));
  });

  it('selects the first executable absolute PATH file despite a nearest npm install', async () => {
    // Empty, relative, non-executable and directory candidates must not select another judge.
    const dirs = ['noexec', 'directory', 'first', 'second'].map((name) => join(root, name));
    for (const dir of dirs) mkdirSync(dir);
    writeFileSync(join(dirs[0], 'pdks'), '');
    mkdirSync(join(dirs[1], 'pdks'));
    for (const dir of dirs.slice(2)) {
      writeFileSync(join(dir, 'pdks'), '');
      chmodSync(join(dir, 'pdks'), 0o755);
    }
    const npm = join(root, 'node_modules/polydeukes');
    mkdirSync(npm, { recursive: true });
    writeFileSync(join(npm, 'package.json'), '{"bin":{"pdks":"wrong.js"}}');
    vi.stubEnv('PATH', ['', '.', 'relative-bin', ...dirs].join(':'));
    const { spawn, calls } = recording();
    await everyVerb(undefined, spawn);
    expect(calls.map((call) => call.command)).toEqual(Array(4).fill(join(dirs[2], 'pdks')));
  });

  it.each([undefined, '', '.:relative-bin'])(
    'fails without an absolute PATH candidate (%s)',
    async (path) => {
      // A missing executable cannot become an upheld covenant or an empty search.
      vi.stubEnv('PATH', path);
      const { spawn, calls } = recording();
      const outcomes = await everyVerb(undefined, spawn);
      expect(calls).toHaveLength(0);
      expect(outcomes.map((value) => ('verdict' in value ? value.verdict : value.outcome))).toEqual(
        ['unjudged', 'unjudged', 'unavailable', 'unavailable'],
      );
    },
  );

  it('does not retry another selected executable after a spawn failure', async () => {
    // Retrying would silently run a different installed pdks.
    const calls: SpawnSpec[] = [];
    const spawn: Spawn = async (spec) => {
      calls.push(spec);
      throw new Error('EACCES selected file');
    };
    const outcomes = await everyVerb('/selected/pdks', spawn);
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.command === '/selected/pdks')).toBe(true);
    expect(outcomes.map((value) => ('verdict' in value ? value.verdict : value.outcome))).toEqual([
      'unjudged',
      'unjudged',
      'unavailable',
      'unavailable',
    ]);
  });

  it('does not retry a later PATH executable after the selected pdks exits unsuccessfully', async () => {
    // A fallback would conceal the selected CLI failure and execute the marker-producing candidate.
    const first = join(root, 'first-bin');
    const second = join(root, 'second-bin');
    mkdirSync(first);
    mkdirSync(second);
    const marker = join(root, 'fallback-ran');
    writeFileSync(join(first, 'pdks'), '#!/bin/sh\nexit 1\n');
    writeFileSync(join(second, 'pdks'), `#!/bin/sh\nprintf ran > '${marker}'\nexit 0\n`);
    chmodSync(join(first, 'pdks'), 0o755);
    chmodSync(join(second, 'pdks'), 0o755);
    vi.stubEnv('PATH', `${first}:${second}`);
    expect(await memoryIngest({ root })).toMatchObject({ outcome: 'unavailable' });
    expect(existsSync(marker)).toBe(false);
  });

  it.each([0, 2, 1, null])(
    'maps byte responses at status %s for all four verbs',
    async (status) => {
      // stdout is ignored for covenant and ingest, while valid stderr whitespace survives.
      const { spawn } = recording({
        status,
        stdout: empty,
        stderr: bytes(' reason \uD55C\uAE00\n'),
      });
      const results = await everyVerb('/chosen/pdks', spawn);
      if (status === 0) {
        expect(results).toEqual([
          { verdict: 'upheld', advisories: ' reason \uD55C\uAE00\n' },
          { verdict: 'upheld', advisories: ' reason \uD55C\uAE00\n' },
          { outcome: 'ingested' },
          { outcome: 'empty' },
        ]);
      } else {
        const verdict = status === 2 ? 'blocked' : 'unjudged';
        expect(results[0]).toMatchObject({ verdict });
        expect(results[1]).toMatchObject({ verdict });
        if (status !== null) {
          expect(results[0]).toHaveProperty('reason', ' reason \uD55C\uAE00\n');
          expect(results[1]).toHaveProperty('reason', ' reason \uD55C\uAE00\n');
        }
        expect(results[2]).toMatchObject({ outcome: 'unavailable' });
        expect(results[3]).toMatchObject({ outcome: 'unavailable' });
      }
    },
  );

  it.each([-1, NaN, Infinity])(
    'rejects invalid timeout %s before any verb spawns',
    async (timeoutMs) => {
      // Invalid deadlines must not be coerced into no deadline or immediate success.
      const { spawn, calls } = recording();
      const outcomes = await everyVerb('/chosen/pdks', spawn, timeoutMs);
      expect(calls).toHaveLength(0);
      expect(outcomes.map((value) => ('verdict' in value ? value.verdict : value.outcome))).toEqual(
        ['unjudged', 'unjudged', 'unavailable', 'unavailable'],
      );
    },
  );

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'rejects invalid search limit %s before spawning',
    async (limit) => {
      // A lossy limit changes the caller's requested search.
      const { spawn, calls } = recording();
      expect(await memorySearch({ root, query, limit, executable: '/pdks', spawn })).toMatchObject({
        outcome: 'unavailable',
      });
      expect(calls).toHaveLength(0);
    },
  );

  it.each(['cycle', 'bigint', 'nan', 'infinity'])(
    'refuses non-JSON IR values: %s',
    async (kind) => {
      // JSON.stringify silently turns non-finite numbers into null.
      const args: Record<string, unknown> = {
        value: kind === 'bigint' ? 1n : kind === 'nan' ? NaN : Infinity,
      };
      if (kind === 'cycle') args.value = args;
      const input = { ...fixture.input, toolCalls: [{ name: 'fixture-tool', args }] };
      const { spawn, calls } = recording();
      expect(
        await checkCovenant({ repoRoot: root, input, executable: '/pdks', spawn }),
      ).toMatchObject({ verdict: 'unjudged' });
      expect(calls).toHaveLength(0);
    },
  );

  it('maps an injected TimeoutError as deadline failure for every verb', async () => {
    // Injected and OS process failures have the same closed result branches.
    const spawn: Spawn = async () => {
      throw Object.assign(new Error('deadline fixture'), { name: 'TimeoutError' });
    };
    const outcomes = await everyVerb('/pdks', spawn, 200);
    for (const result of outcomes)
      expect(result).toHaveProperty(
        'reason',
        expect.stringMatching(/timeout|timed|within|deadline/i),
      );
    expect(outcomes.map((value) => ('verdict' in value ? value.verdict : value.outcome))).toEqual([
      'unjudged',
      'unjudged',
      'unavailable',
      'unavailable',
    ]);
  });
});

describe('strict search decoding', () => {
  const hit = fixture.hit;
  const valid = { ingestedAt: 'fixture-time', results: [hit, { ...hit, id: 'second#hit' }] };
  const invalid: [string, Uint8Array][] = [
    [
      'invalid UTF-8 inside a JSON string',
      new Uint8Array([...bytes('{"ingestedAt":"'), 255, ...bytes('","results":[]}')]),
    ],
    ['malformed JSON', bytes('{')],
    ['non-JSON numeric notation', bytes('{"ingestedAt":"t","results":[],"extra":NaN}')],
    ['null root', bytes('null')],
    ['array root', bytes('[]')],
    ['non-string ingestedAt', bytes('{"ingestedAt":7,"results":[]}')],
    ['non-array results', bytes('{"ingestedAt":"t","results":{}}')],
    ['non-object hit', bytes('{"ingestedAt":"t","results":[null]}')],
    ...['ingestedAt', 'results'].map((field): [string, Uint8Array] => {
      const value = { ...valid } as Record<string, unknown>;
      delete value[field];
      return [`missing ${field}`, bytes(JSON.stringify(value))];
    }),
    ...Object.keys(hit).map((field): [string, Uint8Array] => {
      const value = { ...hit };
      delete value[field];
      return [`missing hit ${field}`, bytes(JSON.stringify({ ...valid, results: [value] }))];
    }),
    ...Object.keys(hit).map((field): [string, Uint8Array] => [
      `wrong hit ${field} type`,
      bytes(JSON.stringify({ ...valid, results: [{ ...hit, [field]: 9 }] })),
    ]),
    ['unknown trust', bytes(JSON.stringify({ ...valid, results: [{ ...hit, trust: 'unknown' }] }))],
    [
      'unknown matchPath',
      bytes(JSON.stringify({ ...valid, results: [{ ...hit, matchPath: 'unknown' }] })),
    ],
    [
      'non-string supersededBy member',
      bytes(JSON.stringify({ ...valid, results: [{ ...hit, supersededBy: [false] }] })),
    ],
  ];
  it.each(invalid)('returns unavailable for %s', async (_title, stdout) => {
    // Malformed success payloads must not be reported as empty or as trusted hits.
    const { spawn } = recording({ status: 0, stdout, stderr: bytes('') });
    expect(await memorySearch({ root, query, executable: '/pdks', spawn })).toMatchObject({
      outcome: 'unavailable',
    });
  });
  it('accepts open objects and preserves ranking order', async () => {
    // Schema objects allow forward-compatible fields; sorting hits destroys CLI ranking.
    const { spawn } = recording({
      status: 0,
      stdout: bytes(
        JSON.stringify({
          ...valid,
          future: true,
          results: valid.results.map((value) => ({ ...value, future: true })),
        }),
      ),
      stderr: bytes(''),
    });
    const result = await memorySearch({ root, query, executable: '/pdks', spawn });
    expect(result.outcome).toBe('found');
    if (result.outcome === 'found')
      expect(result.hits.map((value) => value.id)).toEqual([hit.id, 'second#hit']);
  });
});

describe('real process deadlines', () => {
  it('drains both large output pipes while sending a large stdin', async () => {
    // Sequential stdin writing deadlocks against a child that fills its output pipes first.
    const executable = script(
      'duplex-pdks',
      '/bin/dd if=/dev/zero bs=65536 count=32 2>/dev/null\n/bin/dd if=/dev/zero bs=65536 count=32 1>&2\n/bin/cat >/dev/null\nexit 0',
    );
    const result = await checkChangeSet({
      repoRoot: root,
      diff: 'x'.repeat(1024 * 1024),
      executable,
      timeoutMs: 3000,
    });
    expect(result).toMatchObject({ verdict: 'upheld' });
    if (result.verdict === 'upheld')
      expect(result.advisories.length).toBeGreaterThanOrEqual(2 * 1024 * 1024);
  }, 6000);

  it.each([
    'sleeping child',
    'unread 1MiB stdin',
    'live parent with descendant pipes',
    'exited parent with descendant pipes',
  ])(
    'returns within five seconds for %s',
    async (shape) => {
      // A child exit is not communication completion while a descendant retains its pipes.
      const pid = join(root, 'parent.pid');
      const descendant = join(root, 'descendant.pid');
      const body = shape.includes('descendant')
        ? `echo $$ > '${pid}'\n/bin/sleep 2 &\necho $! > '${descendant}'\n${shape.startsWith('exited') ? 'exit 0' : 'wait'}`
        : `echo $$ > '${pid}'\nwhile :; do :; done`;
      const executable = script('deadline-pdks', body);
      const start = Date.now();
      try {
        const result = await checkChangeSet({
          repoRoot: root,
          diff: shape.includes('stdin') ? 'x'.repeat(1024 * 1024) : fixture.diff,
          executable,
          timeoutMs: 200,
        });
        expect(Date.now() - start).toBeLessThan(5000);
        expect(result).toMatchObject({
          verdict: 'unjudged',
          reason: expect.stringMatching(/timeout|timed|within|deadline/i),
        });
        const child = Number(readFileSync(pid, 'utf8').trim());
        expect(() => process.kill(child, 0)).toThrow();
      } finally {
        for (const file of [pid, descendant]) {
          try {
            process.kill(Number(readFileSync(file, 'utf8').trim()), 'SIGKILL');
          } catch {}
        }
      }
    },
    6000,
  );

  it('accepts a completed response before the deadline and expires a zero deadline', async () => {
    // Treating zero as absent leaves a sleeping process running indefinitely.
    const fast = script('fast-pdks', 'exit 0');
    expect(await memoryIngest({ root, executable: fast, timeoutMs: 2000 })).toEqual({
      outcome: 'ingested',
    });
    const slow = script('slow-pdks', 'while :; do :; done');
    expect(await memoryIngest({ root, executable: slow, timeoutMs: 0 })).toMatchObject({
      outcome: 'unavailable',
      reason: expect.stringMatching(/timeout|timed|within|deadline/i),
    });
  }, 6000);
});
