import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCovenant } from '../src/check-covenant.ts';
import type { CovenantInput } from '../src/ir.ts';
import type { SpawnSpec } from '../src/process.ts';

// `checkCovenant` forwards one IR in, one `pdks covenant check` spawn, the
// child's status and stderr back as a verdict value. It judges nothing, writes no row, and
// neither adds to nor removes from the IR. Every case injects the `spawn` seam and reads
// what the seam was handed — command, args, cwd, stdin — because those four values are the
// contract between this package and the judge process, and the status → verdict table.
//
// PATH is fixture-owned so a machine-wide pdks cannot make an unavailable case pass.

/** Injected fixture values — the consumer's own tool roster and a target it writes. */
const WRITE_FILE = 'writeFile';
const RM = 'rm';
const EXEC = 'exec';
const COMMAND_ARG = 'command';
const TARGET = 'src/answer.ts';
const CONTENT = 'export const answer = 42;\n';
const STUB_BIN_REL = './dist/bin.js';
/** What the child must be asked to run, under each posture. */
const BLOCK_ARGS = ['covenant', 'check', '--enforce', 'block'];
const ADVISE_ARGS = ['covenant', 'check', '--enforce', 'advise'];
/** The row file the child would write under a default config — this package never does. */
const TELEMETRY_REL = '.polydeukes/roi.log';

type SpawnResult = { status: number | null; stderr: string };

let repoRoot: string;

beforeEach(() => {
  // Realpath'd: macOS hands out `/var/...` for a tmpdir whose real location is
  // `/private/var/...`, and the bin path resolution and the cwd assertion must agree.
  vi.stubEnv('PATH', '');
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-sdk-ts-')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(repoRoot, { recursive: true, force: true });
});

/** A PATH executable beside npm metadata that must not affect executable selection. */
function installExecutableAndNpmFixture(
  manifest: Record<string, unknown> = { bin: { pdks: STUB_BIN_REL } },
): string {
  const pkgDir = join(repoRoot, 'node_modules', 'polydeukes');
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), '{"name":"consumer","private":true}\n');
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'polydeukes', ...manifest }));
  writeFileSync(join(pkgDir, 'dist', 'bin.js'), '#!/bin/sh\nexit 0\n');
  const bin = join(pkgDir, 'dist', 'bin.js');
  chmodSync(bin, 0o755);
  const pathBin = join(repoRoot, 'pdks');
  writeFileSync(pathBin, '#!/bin/sh\nexit 0\n');
  chmodSync(pathBin, 0o755);
  vi.stubEnv('PATH', repoRoot);
  return pathBin;
}

/** A recording seam answering `result` for every spawn. */
function recordingSpawn(result: SpawnResult) {
  const calls: SpawnSpec[] = [];
  return {
    calls,
    spawn: async (spec: SpawnSpec) => {
      calls.push({ ...spec, args: [...spec.args] });
      return {
        status: result.status,
        stdout: new Uint8Array(),
        stderr: new TextEncoder().encode(result.stderr),
      };
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
  it('spawns the selected executable with `covenant check --enforce block` by default, cwd = repoRoot, stdin = the IR verbatim', async () => {
    // Four values, each its own defect: another bin is another project's judge; `advise`
    // by default turns every break into exit 0 with no one reading stderr; a cwd off the
    // repoRoot reads another config; a re-serialised IR is an IR this package edited.
    installExecutableAndNpmFixture();
    const input = writeInput();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input, spawn });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([...BLOCK_ARGS]);
    expect(calls[0]?.cwd).toBe(repoRoot);
    expect(new TextDecoder().decode(calls[0]?.stdin)).toBe(JSON.stringify(input));
  });

  it("`enforce: 'advise'` swaps only the level", async () => {
    installExecutableAndNpmFixture();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input: writeInput(), enforce: 'advise', spawn });

    expect(calls[0]?.args).toEqual([...ADVISE_ARGS]);
  });

  it('runs the selected executable directly', async () => {
    // Spawning Node here would add an unwanted executable argument before the verb.
    installExecutableAndNpmFixture();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(calls[0]?.command).toBe(join(repoRoot, 'pdks'));
  });

  it('forwards an IR with no `session`, `actor`, or `tools` key without adding one', async () => {
    // The host proves session evidence; this package is not a host. An SDK that fills in
    // `session: { userMessages: [], toolCalls: [] }` or an `actor` makes the judge read a
    // proof nobody gave.
    installExecutableAndNpmFixture();
    const input: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input, spawn });

    expect(JSON.parse(new TextDecoder().decode(calls[0]?.stdin))).toEqual(input);
  });
});

/** Injected fixture values — a host layer and a row file, both outside the judged tree. */
const LAYER_PATH = '/host/policy/discipline-layer.json';
const TELEMETRY_PATH = '/host/logs/roi.log';

/** The flag-value pairs after the fixed argv, keyed by flag, so the order between pairs is free. */
function flagPairs(args: readonly string[], fixedLength: number): Record<string, string> {
  const tail = args.slice(fixedLength);
  const pairs: Record<string, string> = {};
  for (let i = 0; i < tail.length; i += 2) pairs[tail[i] as string] = tail[i + 1] as string;
  return pairs;
}

describe('checkCovenant — configLayer and telemetryPath travel as flags', () => {
  it('`configLayer` appends `--config-layer <path>` after the fixed argv, verbatim', async () => {
    // The path is the host's, resolved by the umbrella against repoRoot; an SDK that
    // resolves it here, or drops it, hands the child another file or none.
    installExecutableAndNpmFixture();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input: writeInput(), configLayer: LAYER_PATH, spawn });

    expect(calls[0]?.args).toEqual([...BLOCK_ARGS, '--config-layer', LAYER_PATH]);
  });

  it('`telemetryPath` appends `--telemetry-path <path>` after the fixed argv, verbatim', async () => {
    installExecutableAndNpmFixture();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({ repoRoot, input: writeInput(), telemetryPath: TELEMETRY_PATH, spawn });

    expect(calls[0]?.args).toEqual([...BLOCK_ARGS, '--telemetry-path', TELEMETRY_PATH]);
  });

  it('both fields together send both pairs, each flag beside its own value', async () => {
    // One field overwriting the other's slot, or the two values swapped under the wrong
    // flag, sends the row file as the layer and fails every call closed.
    installExecutableAndNpmFixture();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({
      repoRoot,
      input: writeInput(),
      enforce: 'advise',
      configLayer: LAYER_PATH,
      telemetryPath: TELEMETRY_PATH,
      spawn,
    });

    const args = calls[0]?.args ?? [];
    expect(args.slice(0, ADVISE_ARGS.length)).toEqual([...ADVISE_ARGS]);
    expect(flagPairs(args, ADVISE_ARGS.length)).toEqual({
      '--config-layer': LAYER_PATH,
      '--telemetry-path': TELEMETRY_PATH,
    });
  });

  it('fields present with the value undefined add nothing — the argv is the one without them', async () => {
    // A presence check (`'configLayer' in spec`) pushes the flag with `undefined` as its
    // value, which the bin's argv table reads as a missing value and refuses as usage.
    installExecutableAndNpmFixture();
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    await checkCovenant({
      repoRoot,
      input: writeInput(),
      configLayer: undefined,
      telemetryPath: undefined,
      spawn,
    });

    expect(calls[0]?.args).toEqual([...BLOCK_ARGS]);
  });
});

describe('checkCovenant — the child status is the verdict', () => {
  it("status 0 → { verdict: 'upheld', advisories: <stderr> }", async () => {
    // Advisory lines travel on stderr at exit 0; a consumer with no TTY decides whether
    // the model sees them, so they must come back as the value, not be swallowed.
    installExecutableAndNpmFixture();
    const { spawn } = recordingSpawn({ status: 0, stderr: 'advised: no-todo adds TODO\n' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toEqual({ verdict: 'upheld', advisories: 'advised: no-todo adds TODO\n' });
  });

  it("status 2 → { verdict: 'blocked', reason: <stderr> }", async () => {
    // The reason is the valve's replacement on an unattended surface: the consumer writes
    // it where a human later reads and stops. A `blocked` with no reason is a stop nobody
    // can act on.
    installExecutableAndNpmFixture();
    const { spawn } = recordingSpawn({ status: 2, stderr: 'self-mod: .grok/hooks\n' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toEqual({ verdict: 'blocked', reason: 'self-mod: .grok/hooks\n' });
  });

  it("status 1 → { verdict: 'unjudged' } with the crash's stderr as the reason", async () => {
    // A crashed child is not a verdict. Mapping 1 onto `blocked` invents a break; mapping
    // it onto `upheld` is the fail-open hole an uninstalled dist would fall through.
    installExecutableAndNpmFixture();
    const { spawn } = recordingSpawn({
      status: 1,
      stderr: 'TypeError: covenant.x is not a function',
    });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(verdict).toHaveProperty('reason', 'TypeError: covenant.x is not a function');
    expect(verdict).not.toHaveProperty('advisories');
  });

  it("status 3 with stderr → { verdict: 'unjudged', reason: <that stderr> }", async () => {
    // 3 is the judge saying it could not read the IR, and its stderr names which key. A
    // mapping that keeps the status line as the reason hands the consumer "status 3" and
    // drops the one sentence that says what to fix; one that reads 3 as `blocked` invents a
    // covenant break for an input nobody judged.
    installExecutableAndNpmFixture();
    const stderr = 'covenant check failed closed: input carries no subagentSpawns array\n';
    const { spawn } = recordingSpawn({ status: 3, stderr });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toEqual({ verdict: 'unjudged', reason: stderr });
  });

  it("status 3 with empty stderr → { verdict: 'unjudged' } with the status line as the reason", async () => {
    // Nothing on stderr leaves only the status to report. A mapping that forwards stderr
    // unconditionally returns `reason: ''`, an unjudged verdict with nothing to act on.
    installExecutableAndNpmFixture();
    const { spawn } = recordingSpawn({ status: 3, stderr: '' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toEqual({
      verdict: 'unjudged',
      reason: 'the judge exited with status 3 instead of a verdict',
    });
  });

  it("status null (signalled) → { verdict: 'unjudged' } with a reason naming the signal", async () => {
    installExecutableAndNpmFixture();
    const { spawn } = recordingSpawn({ status: null, stderr: '' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/null|signal/i));
  });

  it('writes no row of its own: the fixture tree has no telemetry file after a blocked verdict', async () => {
    // The child writes the row; a second writer here would double every break and make
    // the ledger count two judgments for one call.
    installExecutableAndNpmFixture();
    const { spawn } = recordingSpawn({ status: 2, stderr: 'blocked\n' });

    await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(existsSync(join(repoRoot, TELEMETRY_REL))).toBe(false);
  });
});

describe('checkCovenant — executable availability', () => {
  it('spawns nothing when PATH has no executable and returns unjudged', async () => {
    // With no bin there is nothing to spawn and no writer for a row. `upheld` here is the
    // cheapest bypass in the package — an absent judge passing every call.
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(calls).toEqual([]);
    expect(verdict).toMatchObject({ verdict: 'unjudged' });
    expect(verdict).toHaveProperty('reason', expect.stringContaining('pdks'));
  });

  it('ignores a manifest without bin.pdks when PATH provides an executable', async () => {
    // npm metadata must not conceal a separately installed executable.
    installExecutableAndNpmFixture({ version: '0.0.0' });
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    const verdict = await checkCovenant({ repoRoot, input: writeInput(), spawn });

    expect(calls).toHaveLength(1);
    expect(verdict).toMatchObject({ verdict: 'upheld' });
  });
});

describe('the spawn itself failing is a verdict value, never a throw', () => {
  it('a seam that rejects resolves to unjudged carrying the failure', async () => {
    installExecutableAndNpmFixture();
    const verdict = await checkCovenant({
      repoRoot,
      input: writeInput(),
      spawn: () => Promise.reject(new Error('spawn EACCES')),
    });
    expect(verdict.verdict).toBe('unjudged');
    expect((verdict as { reason: string }).reason).toContain('spawn EACCES');
  });

  it('an input that cannot be serialized resolves to unjudged, and remains unjudged without an executable', async () => {
    // `args` is `Record<string, unknown>`, so a BigInt typechecks. Serializing before the
    // umbrella resolves, or outside the spawn's failure branch, rejects the promise instead.
    const unserializable = {
      ...writeInput(),
      toolCalls: [{ name: WRITE_FILE, args: { size: 10n } }],
    } as CovenantInput;
    const { calls, spawn } = recordingSpawn({ status: 0, stderr: '' });

    const absent = await checkCovenant({ repoRoot, input: unserializable, spawn });
    installExecutableAndNpmFixture();
    const installed = await checkCovenant({ repoRoot, input: unserializable, spawn });

    expect(absent).toMatchObject({ verdict: 'unjudged' });
    expect(absent).toHaveProperty('reason', expect.any(String));
    expect(installed).toMatchObject({ verdict: 'unjudged' });
    expect(installed).toHaveProperty('reason', expect.stringContaining('BigInt'));
    expect(calls).toEqual([]);
  });

  it('the default spawn returns the child status when the child exits before reading a large stdin', async () => {
    // A child that fails fast leaves the parent's in-flight stdin write to raise EPIPE on
    // the stream; unhandled, that is an uncaughtException in the caller's process.
    installExecutableAndNpmFixture();
    writeFileSync(
      join(repoRoot, 'pdks'),
      `#!${process.execPath}\nprocess.stderr.write('fast fail\\n'); process.exit(2);\n`,
    );
    const large = { ...writeInput(), userMessages: [{ text: 'x'.repeat(4 * 1024 * 1024) }] };

    const verdict = await checkCovenant({ repoRoot, input: large });

    expect(verdict).toEqual({ verdict: 'blocked', reason: 'fast fail\n' });
  });
});
