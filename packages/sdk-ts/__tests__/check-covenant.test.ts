import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckCovenantSpawnSpec } from '../src/check-covenant.ts';
import { checkCovenant } from '../src/check-covenant.ts';

// `checkCovenant` is the whole package: one IR in, one `pdks covenant check` spawn, the
// child's status and stderr back as a verdict value. It judges nothing, writes no row, and
// neither adds to nor removes from the IR. Every case injects the `spawn` seam and reads
// what the seam was handed — command, args, cwd, stdin — because those four values are the
// contract between this package and the judge process, and the status → verdict table.
//
// `polydeukes` is located from the caller's repoRoot: a stub package under the fixture's
// own `node_modules` carrying `bin.pdks` is what resolution finds, and a tree without it is
// the not-installed case. The runner's cwd never enters the lookup.

/** Injected fixture values — the consumer's own tool roster and a target it writes. */
const WRITE_FILE = 'writeFile';
const RM = 'rm';
const EXEC = 'exec';
const COMMAND_ARG = 'command';
const TARGET = 'src/answer.ts';
const CONTENT = 'export const answer = 42;\n';
const STUB_BIN_REL = './dist/bin.js';
/** What the child must be asked to run, after the bin path, under each posture. */
const BLOCK_ARGS = ['covenant', 'check', '--enforce', 'block'];
const ADVISE_ARGS = ['covenant', 'check', '--enforce', 'advise'];
/** The row file the child would write under a default config — this package never does. */
const TELEMETRY_REL = '.polydeukes/roi.log';

type SpawnResult = { status: number | null; stderr: string };

let repoRoot: string;

beforeEach(() => {
  // Realpath'd: macOS hands out `/var/...` for a tmpdir whose real location is
  // `/private/var/...`, and the bin path resolution and the cwd assertion must agree.
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sdk-ts-')));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

/** A stub `polydeukes` install under the fixture root; returns the absolute bin path. */
function installStubPolydeukes(
  manifest: Record<string, unknown> = { bin: { pdks: STUB_BIN_REL } },
): string {
  const pkgDir = join(repoRoot, 'node_modules', 'polydeukes');
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), '{"name":"consumer","private":true}\n');
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'polydeukes', ...manifest }));
  writeFileSync(join(pkgDir, 'dist', 'bin.js'), '');
  return join(pkgDir, 'dist', 'bin.js');
}

/** A recording seam answering `result` for every spawn. */
function recordingSpawn(result: SpawnResult) {
  const calls: CheckCovenantSpawnSpec[] = [];
  return {
    calls,
    spawn: async (spec: CheckCovenantSpawnSpec): Promise<SpawnResult> => {
      calls.push({ ...spec, args: [...spec.args] });
      return result;
    },
  };
}

/** The consumer-built IR: one write under the consumer's own roster, no `session`, no `actor`. */
function writeInput(): CovenantInput {
  return {
    toolCalls: [
      {
        name: WRITE_FILE,
        args: { path: TARGET, content: CONTENT },
        fileChange: { kind: 'create', path: TARGET, post: CONTENT },
      },
    ],
    subagentSpawns: [],
    userMessages: [],
    tools: { mutating: [WRITE_FILE, RM], shell: [EXEC], commandArgs: [COMMAND_ARG] },
  };
}

describe('checkCovenant — what the seam is handed', () => {
  it('spawns the resolved bin with `covenant check --enforce block` by default, cwd = repoRoot, stdin = the IR verbatim', async () => {
    // Four values, each its own defect: another bin is another project's judge; `advise`
    // by default turns every break into exit 0 with no one reading stderr; a cwd off the
    // repoRoot reads another config; a re-serialised IR is an IR this package edited.
    const bin = installStubPolydeukes();
    const input = writeInput();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input, spawn });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([bin, ...BLOCK_ARGS]);
    expect(calls[0]?.cwd).toBe(repoRoot);
    expect(calls[0]?.stdin).toBe(JSON.stringify(input));
  });

  it("`enforce: 'advise'` swaps only the level", async () => {
    const bin = installStubPolydeukes();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input: writeInput(), enforce: 'advise', spawn });

    expect(calls[0]?.args).toEqual([bin, ...ADVISE_ARGS]);
  });

  it('runs the bin under the current node executable', async () => {
    // `node` from PATH is whatever the consumer's shell resolves; the executable this
    // process runs under is the one the install graph was built for.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(calls[0]?.command).toBe(process.execPath);
  });

  it('forwards an IR with no `session`, `actor`, or `tools` key without adding one', async () => {
    // The host proves session evidence; this package is not a host. An SDK that fills in
    // `session: { userMessages: [], toolCalls: [] }` or an `actor` makes the judge read a
    // proof nobody gave.
    installStubPolydeukes();
    const input: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input, spawn });

    expect(JSON.parse(calls[0]?.stdin ?? 'null')).toEqual(input);
  });
});

describe('checkCovenant — the child status is the verdict', () => {
  it("status 0 → { verdict: 'upheld', advisories: <stderr> }", async () => {
    // Advisory lines travel on stderr at exit 0; a consumer with no TTY decides whether
    // the model sees them, so they must come back as the value, not be swallowed.
    installStubPolydeukes();
    const { spawn } = recordingSpawn({ status: 0, stderr: 'advised: no-todo adds TODO\n' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toEqual({ verdict: 'upheld', advisories: 'advised: no-todo adds TODO\n' });
  });

  it("status 2 → { verdict: 'blocked', reason: <stderr> }", async () => {
    // The reason is the valve's replacement on an unattended surface: the consumer writes
    // it where a human later reads and stops. A `blocked` with no reason is a stop nobody
    // can act on.
    installStubPolydeukes();
    const { spawn } = recordingSpawn({ status: 2, stderr: 'self-mod: .grok/hooks\n' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toEqual({ verdict: 'blocked', reason: 'self-mod: .grok/hooks\n' });
  });

  it("status 1 → { verdict: 'unjudged' } with a reason naming the status", async () => {
    // A crashed child is not a verdict. Mapping 1 onto `blocked` invents a break; mapping
    // it onto `upheld` is the fail-open hole an uninstalled dist would fall through.
    installStubPolydeukes();
    const { spawn } = recordingSpawn({
      status: 1,
      stderr: 'TypeError: covenant.x is not a function',
    });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/\b1\b/));
    expect(verdict).not.toHaveProperty('advisories');
  });

  it("status null (signalled) → { verdict: 'unjudged' } with a reason naming the signal", async () => {
    installStubPolydeukes();
    const { spawn } = recordingSpawn({ status: null, stderr: '' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/null|signal/i));
  });

  it('writes no row of its own: the fixture tree has no telemetry file after a blocked verdict', async () => {
    // The child writes the row; a second writer here would double every break and make
    // the ledger count two judgments for one call.
    installStubPolydeukes();
    const { spawn } = recordingSpawn({ status: 2, stderr: 'blocked\n' });

    await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(existsSync(join(repoRoot, TELEMETRY_REL))).toBe(false);
  });
});

describe('checkCovenant — polydeukes is not installed under repoRoot', () => {
  it('spawns nothing and returns unjudged with a reason naming the package', async () => {
    // With no bin there is nothing to spawn and no writer for a row. `upheld` here is the
    // cheapest bypass in the package — an absent judge passing every call.
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(calls).toEqual([]);
    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(verdict).toHaveProperty('reason', expect.stringContaining('polydeukes'));
  });

  it('treats an installed manifest with no `bin.pdks` as not installed', async () => {
    // A manifest found but carrying no bin would otherwise be spawned as `node undefined`,
    // a crash the status table turns into `unjudged` without saying why.
    installStubPolydeukes({ version: '0.0.0' });
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(calls).toEqual([]);
    expect(verdict).toMatchObject({ verdict: 'unjudged' });
  });
});

describe('the spawn itself failing is a verdict value, never a throw', () => {
  it('a seam that rejects resolves to unjudged carrying the failure', async () => {
    installStubPolydeukes();
    const verdict = await checkCovenant({
      repoRoot,
      input: writeInput(),
      spawn: () => Promise.reject(new Error('spawn EACCES')),
    });
    expect(verdict.verdict).toBe('unjudged');
    expect((verdict as { reason: string }).reason).toContain('spawn EACCES');
  });

  it('the default spawn returns the child status when the child exits before reading a large stdin', async () => {
    // A child that fails fast leaves the parent's in-flight stdin write to raise EPIPE on
    // the stream; unhandled, that is an uncaughtException in the caller's process.
    const bin = installStubPolydeukes();
    writeFileSync(bin, "process.stderr.write('fast fail\\n'); process.exit(2);\n");
    const large = { ...writeInput(), userMessages: [{ text: 'x'.repeat(4 * 1024 * 1024) }] };

    const verdict = await checkCovenant({ repoRoot, input: large });

    expect(verdict).toEqual({ verdict: 'blocked', reason: 'fast fail\n' });
  });
});
