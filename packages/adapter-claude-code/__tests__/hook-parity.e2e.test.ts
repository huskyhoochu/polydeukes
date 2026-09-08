import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// One payload, two paths, one verdict. The old path is the umbrella's in-process session
// entry point `runClaudeCodeHook`; the new path is this package's `runHook`, which builds
// the IR and spawns the BUILT `pdks covenant check --enforce block` in the fixture
// repository. Exit codes must agree and the row sets must agree as `[event, subject]` —
// labels are not compared, because the unrouted pass row and the fail-closed row carry
// each path's own label.
//
// Each path gets its own fresh repository built the same way, so the baseline comparison
// starts from the same absent state on both sides. The new path's repository carries a
// `node_modules` symlink to this checkout's install graph, which is how `runHook` locates
// `polydeukes` from the fixture rather than from this test's own location. The new path's
// rows land where the fixture config's `telemetry.logPath` points; the runner reads no
// environment variable for it.
import { runClaudeCodeHook } from '../../polydeukes/src/claude-code-hook.ts';
import { runHook } from '../src/hook.ts';

const checkoutRoot = resolve(import.meta.dirname, '../../..');
/** The built umbrella bin `runHook` will find through the fixture's `node_modules` link. */
const UMBRELLA_BIN = resolve(import.meta.dirname, '../../polydeukes/dist/bin.js');

/** Injected fixture values — protected entry, discipline targets, witness. */
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
const ORDINARY_FILE = 'notes/ordinary.txt';
const SCOPED_TARGET = 'lib/a.ts';
const PRE_STATE = 'locked: yes\n';
const WITNESS_TOKEN = 'agreed-token';
const TTL_MINUTES = 10;
const SOFT_ID = 'no-todo-softly';
const PRECEDENT_ID = 'lib-needs-fetch';
const PRECEDENT_TOOL = 'WebFetch';
const SESSION_SOURCE = 'session';
const SIDECAR_ID = 'lib-needs-writer-spawn';
const WRITER_AGENT = 'tdd-test-writer';
const SESSION_ID = 's-1';

const softEntry = {
  id: SOFT_ID,
  declare: {
    mechanism: 'added-only',
    scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: '(TODO)' }],
      after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: '(TODO)' }],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
    relate: [
      { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
    ],
  },
  enforce: 'advise',
};

const precedentEntry = {
  id: PRECEDENT_ID,
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
    sources: { [SESSION_SOURCE]: { transcript: true } },
    supply: { [SESSION_SOURCE]: 'pass' },
    extract: {
      fetched: [
        { op: 'source', of: SESSION_SOURCE },
        { op: 'toolUses', names: [PRECEDENT_TOOL] },
        { op: 'filter', when: [{ field: 'succeeded', eq: true }] },
      ],
    },
    relate: [
      {
        id: 'fetched-first',
        relation: { op: 'nonEmpty', of: 'fetched' },
        message: 'no successful fetch precedes this edit',
      },
    ],
  },
};

const sidecarEntry = {
  id: SIDECAR_ID,
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
    sources: { spawns: { sidecar: true } },
    supply: { spawns: 'pass' },
    extract: {
      writers: [
        { op: 'source', of: 'spawns' },
        { op: 'matches', re: WRITER_AGENT },
      ],
    },
    relate: [
      { id: 'writer', relation: { op: 'nonEmpty', of: 'writers' }, message: 'no writer spawn' },
    ],
  },
};

/** The evidence files (transcript, sidecar) and both telemetry logs live here, outside every repo. */
let outside: string;
const repoRoots: string[] = [];

beforeAll(() => {
  // `runHook` spawns the built umbrella bin; turbo caching makes repeat runs cheap.
  execSync('pnpm turbo run build', { cwd: checkoutRoot, stdio: 'pipe' });
  if (!existsSync(UMBRELLA_BIN)) throw new Error(`built bin missing at ${UMBRELLA_BIN}`);
}, 120_000);

beforeEach(() => {
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-hook-parity-outside-')));
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  // rmSync removes the node_modules symlink itself, never what it points at.
  for (const root of repoRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Every telemetry row at `telemetryPath` as `[event, label, subject]`. */
function telemetryRows(telemetryPath: string): [string, string, string][] {
  return readRecords(telemetryPath).records.map((record) => [
    record.event,
    record.label,
    record.subject,
  ]);
}

/**
 * A fresh repository carrying the minimal valid config plus `extra`, the protected file, and
 * a scoped target on disk. Realpath'd: the spawned child's `process.cwd()` is the real
 * location, and the subjects it records must re-root against the same string the payload
 * paths were built from.
 */
function makeRepo(extra: Record<string, unknown>, telemetryPath: string): string {
  const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-hook-parity-')));
  repoRoots.push(repoRoot);
  const config = {
    languages: { typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' } },
    telemetry: { logPath: telemetryPath },
    ...extra,
  };
  writeFileSync(join(repoRoot, 'polydeukes.config.json'), JSON.stringify(config, null, 2));
  for (const [rel, content] of [
    [PROTECTED_FILE, PRE_STATE],
    [SCOPED_TARGET, 'export const y = 1;\n'],
  ] as const) {
    const absolute = join(repoRoot, rel);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return repoRoot;
}

type Payload = {
  tool_name: string;
  tool_input: Record<string, unknown>;
  transcript_path?: string;
};

/** A payload built against the repository each path receives — targets are absolute under it. */
type PayloadFor = (repoRoot: string) => Payload;

function rawPayloadFor(repoRoot: string, payloadFor: PayloadFor): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: repoRoot,
    ...payloadFor(repoRoot),
  });
}

function editPayload(relTarget: string, newString = 'locked: no'): PayloadFor {
  return (repoRoot) => ({
    tool_name: 'Edit',
    tool_input: {
      file_path: join(repoRoot, relTarget),
      old_string: relTarget === PROTECTED_FILE ? 'locked: yes' : 'export const y = 1;',
      new_string: newString,
    },
  });
}

/** A Write of `relTarget` under the repository, or of an absolute path outside it. */
function writePayload(target: string, content = 'nothing special\n'): PayloadFor {
  return (repoRoot) => ({
    tool_name: 'Write',
    tool_input: { file_path: target.startsWith('/') ? target : join(repoRoot, target), content },
  });
}

function bashPayload(command: string): PayloadFor {
  return () => ({ tool_name: 'Bash', tool_input: { command } });
}

function withTranscript(payloadFor: PayloadFor, transcript_path: string): PayloadFor {
  return (repoRoot) => ({ ...payloadFor(repoRoot), transcript_path });
}

/** A human-typed transcript line: origin.kind === 'human', string content, ISO timestamp. */
function humanLine(content: string, timestampMs?: number): string {
  return JSON.stringify({
    origin: { kind: 'human' },
    promptSource: 'typed',
    type: 'user',
    message: { role: 'user', content },
    ...(timestampMs === undefined ? {} : { timestamp: new Date(timestampMs).toISOString() }),
    uuid: 'u-human',
  });
}

/** A successful precedent-tool call: tool_use followed by a clean tool_result. */
function precedentLines(): string[] {
  return [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: PRECEDENT_TOOL, input: { url: 'https://x' } },
        ],
      },
      uuid: 'a-1',
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
      },
      uuid: 'u-1',
    }),
  ];
}

/** Write a transcript under `outside` as `<SESSION_ID>.jsonl` so a sidecar can sit beside it. */
function writeTranscript(lines: string[]): string {
  const path = join(outside, `${SESSION_ID}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function writeSidecar(transcriptPath: string): void {
  const subagents = join(dirname(transcriptPath), SESSION_ID, 'subagents');
  mkdirSync(subagents, { recursive: true });
  writeFileSync(
    join(subagents, 'agent-001.meta.json'),
    JSON.stringify({ agentType: WRITER_AGENT, toolUseId: 't1' }),
  );
}

/** The labels a call no registration routed passes under — the adapter funnel on the old path, the runner on the new. */
const UNROUTED_LABELS = new Set(['adapter-claude-code', 'covenant-check']);

/**
 * `[event, subject]` per row, absolute subjects re-rooted, sorted for set comparison.
 *
 * Three rows are projected narrower than the rest: an unrouted pass carries a different
 * subject on each path (`-` from the funnel, the path from the runner), so it compares on
 * the event alone; baseline rows are left out entirely — the old path compares on every
 * call, the new one only under a session, and the sessionless case pins that directly; and
 * a fail-closed row is compared on the event alone by the pre-spawn failure case below,
 * because the old path writes it as `['blocked', 'hook', '-']` while the new path's comes
 * from the runner under its own label and subject.
 */
function projected(telemetryPath: string, repoRoot: string): [string, string][] {
  return telemetryRows(telemetryPath)
    .filter(([event]) => event !== 'unattributed')
    .map(([event, label, subject]): [string, string] => [
      event,
      UNROUTED_LABELS.has(label) && event === 'passed'
        ? '-'
        : subject.startsWith(repoRoot)
          ? `<root>${subject.slice(repoRoot.length)}`
          : subject,
    ])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

/** Baseline rows only — the sessionless case reads them unprojected. */
function baselineRows(telemetryPath: string): [string, string, string][] {
  return telemetryRows(telemetryPath).filter(([event]) => event === 'unattributed');
}

type ParityOutcome = { exitCode: number; rows: [string, string][]; telemetryPath: string };

async function oldPath(
  config: Record<string, unknown>,
  payload: PayloadFor,
): Promise<ParityOutcome> {
  const telemetryPath = join(outside, 'old.log');
  const repoRoot = makeRepo(config, join(outside, 'unused.log'));
  const result = await runClaudeCodeHook({
    repoRoot,
    rawPayload: rawPayloadFor(repoRoot, payload),
    telemetryPath,
  });
  return { exitCode: result.exitCode, rows: projected(telemetryPath, repoRoot), telemetryPath };
}

function newPath(config: Record<string, unknown>, payload: PayloadFor): ParityOutcome {
  const telemetryPath = join(outside, 'new.log');
  const repoRoot = makeRepo(config, telemetryPath);
  symlinkSync(join(checkoutRoot, 'node_modules'), join(repoRoot, 'node_modules'), 'dir');
  const result = runHook({ repoRoot, rawPayload: rawPayloadFor(repoRoot, payload) });
  return { exitCode: result.exitCode, rows: projected(telemetryPath, repoRoot), telemetryPath };
}

/** The old path on a raw string the payload builders never produce — the events it recorded. */
async function oldPathRaw(rawPayload: string): Promise<{ exitCode: number; events: string[] }> {
  const telemetryPath = join(outside, 'old.log');
  const repoRoot = makeRepo(BASE_CONFIG, join(outside, 'unused.log'));
  const result = await runClaudeCodeHook({ repoRoot, rawPayload, telemetryPath });
  return { exitCode: result.exitCode, events: projected(telemetryPath, repoRoot).map(([e]) => e) };
}

/** The new path on the same raw string. */
function newPathRaw(rawPayload: string): { exitCode: number; events: string[] } {
  const telemetryPath = join(outside, 'new.log');
  const repoRoot = makeRepo(BASE_CONFIG, telemetryPath);
  symlinkSync(join(checkoutRoot, 'node_modules'), join(repoRoot, 'node_modules'), 'dir');
  const result = runHook({ repoRoot, rawPayload });
  return { exitCode: result.exitCode, events: projected(telemetryPath, repoRoot).map(([e]) => e) };
}

/** Run both paths on one payload and pin them equal, plus the exit the case expects. */
async function expectParity(
  config: Record<string, unknown>,
  payload: PayloadFor,
  exitCode: 0 | 2,
): Promise<ParityOutcome> {
  const old = await oldPath(config, payload);
  const fresh = newPath(config, payload);
  expect(fresh.exitCode).toBe(old.exitCode);
  expect(fresh.rows).toEqual(old.rows);
  expect(old.exitCode).toBe(exitCode);
  return old;
}

const BASE_CONFIG = { protectedPaths: [PROTECTED_ENTRY] };
const WITNESS_CONFIG = {
  ...BASE_CONFIG,
  witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
};

describe('hook parity — meta-covenants', () => {
  it('a protected-path Edit blocks on both paths', async () => {
    // The roster must reach the child: a new path whose IR carries no `tools` judges
    // self-mod on the runner's default names and exits 0 where the old one exits 2.
    const outcome = await expectParity(BASE_CONFIG, editPayload(PROTECTED_FILE), 2);
    expect(outcome.rows).toContainEqual(['blocked', PROTECTED_ENTRY]);
  });

  it('an unprotected Write passes on both paths', async () => {
    // The over-blocking end of the same axis, and the proof that the spawn itself is not
    // what exits 2: a bin the fixture cannot resolve, or a cwd off the fixture, fails
    // closed here.
    await expectParity(BASE_CONFIG, writePayload(ORDINARY_FILE), 0);
  });

  it('a Bash line mutating a protected path blocks on both paths', async () => {
    // The shell axis exists on the new path only through `tools.shell` and
    // `tools.commandArgs`; a new path that leaves shell-mod unregistered passes this.
    const outcome = await expectParity(BASE_CONFIG, bashPayload(`echo x >> ${PROTECTED_FILE}`), 2);
    expect(outcome.rows).toContainEqual(['blocked', PROTECTED_ENTRY]);
  });

  it('a Bash line with a read-only head over a protected path passes on both paths', async () => {
    await expectParity(BASE_CONFIG, bashPayload(`cat ${PROTECTED_FILE}`), 0);
  });
});

describe('hook parity — the witness valve', () => {
  it('a fresh token utterance on the transcript witnesses the protected Edit on both paths — exit 0', async () => {
    // The new path reads freshness from `session.userMessages[].timestampMs`; a builder
    // that drops the timestamp blocks where the old path witnesses.
    const transcript = writeTranscript([
      humanLine(`${WITNESS_TOKEN}\nproceed`, Date.now() - 1_000),
    ]);
    const outcome = await expectParity(
      WITNESS_CONFIG,
      withTranscript(editPayload(PROTECTED_FILE), transcript),
      0,
    );
    expect(outcome.rows).toContainEqual(['witnessed', PROTECTED_ENTRY]);
  });

  it('an expired token utterance blocks the protected Edit on both paths — exit 2', async () => {
    const transcript = writeTranscript([
      humanLine(`${WITNESS_TOKEN}\nproceed`, Date.now() - (TTL_MINUTES + 1) * 60_000),
    ]);
    const outcome = await expectParity(
      WITNESS_CONFIG,
      withTranscript(editPayload(PROTECTED_FILE), transcript),
      2,
    );
    expect(outcome.rows).toContainEqual(['blocked', PROTECTED_ENTRY]);
  });

  it('a Write targeting the transcript path itself blocks on both paths — transcript-mod', async () => {
    // `session.evidencePath` is what the new path registers transcript-mod over; without
    // it a forged utterance appended by Write passes and then witnesses itself.
    const transcript = writeTranscript([humanLine('hello', Date.now() - 1_000)]);
    await expectParity(
      BASE_CONFIG,
      withTranscript(writePayload(transcript, humanLine(WITNESS_TOKEN, Date.now())), transcript),
      2,
    );
  });
});

describe('hook parity — disciplines', () => {
  it('an advise entry broken by a scoped Edit lands advised on both paths — exit 0', async () => {
    // The disk pre-state and the entry's own level both have to reach the child: an
    // unobserved reader fails closed, and a dropped entry level blocks.
    const outcome = await expectParity(
      { ...BASE_CONFIG, disciplines: [softEntry] },
      editPayload(SCOPED_TARGET, 'export const y = 1;\n// TODO later'),
      0,
    );
    expect(outcome.rows).toContainEqual(['advised', SCOPED_TARGET]);
  });

  it('a precedent declaration is satisfied by a successful call on the transcript, on both paths', async () => {
    // `session.toolCalls[].succeeded` is the evidence; a new path binding the judged IR
    // instead of the session reports no precedent.
    const transcript = writeTranscript(precedentLines());
    const outcome = await expectParity(
      { ...BASE_CONFIG, disciplines: [precedentEntry] },
      withTranscript(editPayload(SCOPED_TARGET, 'export const y = 2;'), transcript),
      0,
    );
    expect(outcome.rows).toContainEqual(['passed', SCOPED_TARGET]);
  });

  it('a sidecar declaration is satisfied by the spawn records beside the transcript, on both paths', async () => {
    // `session.channels.sidecar` must reach the dispatched world's channels; a new path
    // that never lifts it there skips where the old path passes.
    const transcript = writeTranscript([humanLine('carry on', Date.now() - 1_000)]);
    writeSidecar(transcript);
    const outcome = await expectParity(
      { ...BASE_CONFIG, disciplines: [sidecarEntry] },
      withTranscript(editPayload(SCOPED_TARGET, 'export const y = 2;'), transcript),
      0,
    );
    expect(outcome.rows).toContainEqual(['passed', SCOPED_TARGET]);
  });
});

describe('hook parity — a payload without a transcript', () => {
  it('a protected-path Edit with no transcript_path blocks on both paths with the same judgment rows', async () => {
    // `sessionEvidenceFromPayload` answers undefined, so the new path has no session and
    // runs no baseline comparison, while the old path always runs it: the two row sets are
    // compared without the baseline rows, and the new path's log must carry none.
    const config = BASE_CONFIG;
    const payload = editPayload(PROTECTED_FILE);
    const old = await oldPath(config, payload);
    const fresh = newPath(config, payload);

    expect(fresh.exitCode).toBe(old.exitCode);
    expect(old.exitCode).toBe(2);
    expect(fresh.rows).toEqual(old.rows);
    expect(fresh.rows).toContainEqual(['blocked', PROTECTED_ENTRY]);
    expect(baselineRows(fresh.telemetryPath)).toEqual([]);
  });
});

describe('hook parity — a failure before the judgment', () => {
  it('an unparseable raw payload exits 2 on both paths with exactly one blocked row each', async () => {
    // The new path reaches this verdict by spawning with the failure line on stdin, so the
    // row is the runner's fail-closed row rather than the adapter's. A new path that returns
    // 2 without spawning leaves no row; one that spawns an IR built from nothing lands a
    // pass. Both paths' rows compare on the event alone here (the third projection above).
    const old = await oldPathRaw('not json');
    const fresh = newPathRaw('not json');

    expect(old.exitCode).toBe(2);
    expect(fresh.exitCode).toBe(2);
    expect(old.events).toEqual(['blocked']);
    expect(fresh.events).toEqual(['blocked']);
  });
});
