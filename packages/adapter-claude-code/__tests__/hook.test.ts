import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunHookSpec } from '../src/hook.ts';
import { runHook } from '../src/hook.ts';
// `runHook` is the adapter's whole session entry point: one payload in, one `pdks covenant
// check` spawn out, the child's status back as the exit code. It judges nothing and writes
// no row. Every case here injects the `spawn` seam and reads what the seam was handed —
// the command, the args, the cwd, and the stdin text — because those four values are the
// entire contract between this package and the judge process.
//
// `polydeukes` is located from the fixture tree: a stub package under the fixture's own
// `node_modules` carrying `bin.pdks` is what resolution finds, and a tree without it is
// the not-installed case. The runner's cwd never enters the lookup.
import { COMMAND_ARGS, MUTATING_TOOLS, SHELL_TOOLS } from '../src/session-vocabulary.ts';

/** Injected fixture values — target files, pre-state, the session id a sidecar hangs off. */
const TARGET_FILE = 'gate/inner.txt';
const PRE_STATE = 'locked: yes\n';
const SESSION_ID = 's-1';
const STUB_BIN_REL = './dist/bin.js';
/** What the child must be asked to run, after the bin path. */
const CHECK_ARGS = ['covenant', 'check', '--enforce', 'block'];
/** The stdin line a pre-spawn failure travels in — the judge fails closed on it as non-JSON. */
const FAILURE_PREFIX = 'adapter-claude-code failed before spawn:';
/** The stderr line the not-installed case leaves — the one outcome that has no row anywhere. */
const NOT_INSTALLED_PREFIX = 'covenant hook failed closed:';

type SpawnCall = { command: string; args: string[]; cwd: string; stdin: string };

let repoRoot: string;
let outside: string;
let stderr: string[];

beforeEach(() => {
  // Realpath both roots: macOS hands out `/var/...` for a tmpdir whose real location is
  // `/private/var/...`, and the bin path resolution and the payload paths must agree.
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-hook-repo-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-hook-outside-')));
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A stub `polydeukes` install under the fixture root; returns the absolute bin path. */
function installStubPolydeukes(
  manifest: Record<string, unknown> = { bin: { pdks: STUB_BIN_REL } },
) {
  const pkgDir = join(repoRoot, 'node_modules', 'polydeukes');
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(join(repoRoot, 'package.json'), '{"name":"probe","private":true}\n');
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'polydeukes', ...manifest }));
  writeFileSync(join(pkgDir, 'dist', 'bin.js'), '');
  return join(pkgDir, 'dist', 'bin.js');
}

function writeTarget(content = PRE_STATE): string {
  const absolute = join(repoRoot, TARGET_FILE);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

/** A recording seam answering `status` for every spawn. */
function recordingSpawn(status: number | null): {
  calls: SpawnCall[];
  spawn: RunHookSpec['spawn'];
} {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawn: (spec) => {
      calls.push({ ...spec, args: [...spec.args] });
      return { status };
    },
  };
}

function editPayload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: repoRoot,
    tool_name: 'Edit',
    tool_input: {
      file_path: join(repoRoot, TARGET_FILE),
      old_string: 'locked: yes',
      new_string: 'locked: no',
    },
    ...extra,
  });
}

/** A human-typed transcript line beside which a sidecar directory can sit. */
function writeTranscript(): string {
  const path = join(outside, `${SESSION_ID}.jsonl`);
  writeFileSync(
    path,
    `${JSON.stringify({
      origin: { kind: 'human' },
      promptSource: 'typed',
      type: 'user',
      message: { role: 'user', content: 'carry on' },
      timestamp: new Date().toISOString(),
      uuid: 'u-human',
    })}\n`,
  );
  return path;
}

type ParsedIr = {
  toolCalls: { name: string; fileChange?: unknown }[];
  tools?: unknown;
  session?: { evidencePath: string; userMessages: { text: string }[] };
};

function parsedStdin(call: SpawnCall): ParsedIr {
  return JSON.parse(call.stdin) as ParsedIr;
}

describe('runHook — the spawn it makes', () => {
  it('spawns node on the installed bin with `covenant check --enforce block`, once, in repoRoot', () => {
    // The judge is reached only through this spawn. A missing `--enforce block` lands every
    // break as advised at exit 0; a cwd anywhere but repoRoot makes the child discover the
    // wrong config or none; a bin located from the runner's own module instead of the
    // fixture tree would name this repository's install.
    const bin = installStubPolydeukes();
    writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({ repoRoot, rawPayload: editPayload(), spawn });

    expect(outcome).toEqual({ exitCode: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toEqual([bin, ...CHECK_ARGS]);
    expect(calls[0]?.cwd).toBe(repoRoot);
  });

  it('hands the child an IR carrying the host roster and the Edit’s file-change evidence', () => {
    // Without `tools` the child judges on its own default roster and the shell axis and the
    // mutating list stop being this host's; without `fileChange` a protected-path Edit is
    // judged by argument mention alone and a discipline sees no pre-state.
    installStubPolydeukes();
    const target = writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: editPayload(), spawn });

    const ir = parsedStdin(calls[0] as SpawnCall);
    expect(ir.tools).toEqual({
      mutating: MUTATING_TOOLS,
      shell: SHELL_TOOLS,
      commandArgs: COMMAND_ARGS,
    });
    expect(ir.toolCalls[0]?.name).toBe('Edit');
    expect(ir.toolCalls[0]?.fileChange).toMatchObject({ path: target, pre: PRE_STATE });
  });

  it('leaves fileChange absent, not null, when the Edit has no computable evidence', () => {
    // The evidence collector answers null for an Edit whose target is not on disk. Writing
    // that null into the IR gives the child a `fileChange: null` the protocol refuses, and
    // an evidence-free call the judge should fall back on fails closed instead.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: editPayload(), spawn });

    const ir = parsedStdin(calls[0] as SpawnCall);
    expect(ir.toolCalls).toHaveLength(1);
    expect('fileChange' in (ir.toolCalls[0] as object)).toBe(false);
  });

  it('carries the session evidence under `session` when the payload names a transcript', () => {
    // `session.evidencePath` is what the child registers transcript-mod over and the witness
    // reads utterances from; a builder that drops the key leaves a forged write unjudged and
    // the valve shut.
    installStubPolydeukes();
    writeTarget();
    const transcript = writeTranscript();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: editPayload({ transcript_path: transcript }), spawn });

    const ir = parsedStdin(calls[0] as SpawnCall);
    expect(ir.session?.evidencePath).toBe(transcript);
    expect(ir.session?.userMessages.map((message) => message.text)).toEqual(['carry on']);
  });

  it('omits the `session` key entirely when the payload names no transcript', () => {
    // No transcript is no session. A `session: undefined` serialises away, but an empty
    // session object would register transcript-mod over nothing and run a baseline
    // comparison the payload never earned.
    installStubPolydeukes();
    writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: editPayload(), spawn });

    expect('session' in parsedStdin(calls[0] as SpawnCall)).toBe(false);
  });

  it('carries an empty session with the evidencePath when the named transcript does not exist', () => {
    // A path the host named but the reader cannot open is a supplier fault, not an absent
    // session: `evidencePath` stays so the child still registers transcript-mod over the
    // file, and the empty lists keep the witness and every history declaration shut. A
    // builder that narrows this to no session leaves a forged write at that path unjudged;
    // one that fails closed here blocks every call whose transcript is momentarily missing.
    installStubPolydeukes();
    writeTarget();
    const missing = join(outside, `${SESSION_ID}.jsonl`);
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({
      repoRoot,
      rawPayload: editPayload({ transcript_path: missing }),
      spawn,
    });

    expect(outcome).toEqual({ exitCode: 0 });
    const ir = parsedStdin(calls[0] as SpawnCall);
    expect(ir.session).toEqual({ evidencePath: missing, userMessages: [], toolCalls: [] });
  });
});

describe('runHook — the child’s status is the exit code', () => {
  it.each([
    [0, 0],
    [2, 2],
    [null, 2],
    [1, 2],
  ] as const)('child status %s → exit %s', (status, exitCode) => {
    // Only 0 passes through as 0. A crashed child (1) or a signalled one (null) is not a
    // verdict, and forwarding either as-is lets the host read a non-2 as "not blocked".
    installStubPolydeukes();
    writeTarget();
    const { spawn } = recordingSpawn(status);

    expect(runHook({ repoRoot, rawPayload: editPayload(), spawn })).toEqual({ exitCode });
  });
});

describe('runHook — a failure before the spawn still spawns', () => {
  // Each case pins three facts: exactly one spawn happened, its stdin is the failure line
  // rather than an IR, and the exit code is the child's. An adapter that returns 2 without
  // spawning leaves no row anywhere; one that swallows the failure and spawns an IR built
  // from nothing lands a pass.

  /** Runs one failing payload through the seam and returns the reason text after the prefix. */
  function expectFailureSpawn(rawPayload: string): string {
    const { calls, spawn } = recordingSpawn(2);

    const outcome = runHook({ repoRoot, rawPayload, spawn });

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toHaveLength(1);
    const stdin = calls[0]?.stdin ?? '';
    expect(stdin.startsWith(FAILURE_PREFIX)).toBe(true);
    expect(calls[0]?.args).toEqual([expect.stringMatching(/bin\.js$/), ...CHECK_ARGS]);
    expect(calls[0]?.cwd).toBe(repoRoot);
    return stdin.slice(FAILURE_PREFIX.length).trim();
  }

  /** A transcript with a sidecar directory beside it that no mode can read. */
  function writeRefusedSidecar(): { transcript: string; subagents: string } {
    const transcript = writeTranscript();
    const subagents = join(outside, SESSION_ID, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, 'agent-001.meta.json'), '{"agentType":"x","toolUseId":"t"}');
    chmodSync(subagents, 0o000);
    return { transcript, subagents };
  }

  it('an unparseable payload', () => {
    installStubPolydeukes();
    expectFailureSpawn('{');
  });

  it('an envelope the translator does not recognise', () => {
    installStubPolydeukes();
    expectFailureSpawn('{}');
  });

  it.skipIf(process.getuid?.() === 0)('a pre-state read refused by permissions', () => {
    // An unreadable target is not a missing one: reading it as absent would mark the Edit a
    // creation and forgive every pre-existing line. Skipped as root, which no mode can
    // refuse.
    installStubPolydeukes();
    const target = writeTarget();
    chmodSync(target, 0o000);
    try {
      expectFailureSpawn(editPayload());
    } finally {
      chmodSync(target, 0o600);
    }
  });

  it.skipIf(process.getuid?.() === 0)('a sidecar directory refused by permissions', () => {
    // The channel reader throws on a refused sidecar directory rather than reporting a
    // session that never spawned; the throw has to land inside the adapter's catch, or the
    // hook crashes at exit 1 and the host reads that as not blocked.
    installStubPolydeukes();
    writeTarget();
    const { transcript, subagents } = writeRefusedSidecar();
    try {
      expectFailureSpawn(editPayload({ transcript_path: transcript }));
    } finally {
      chmodSync(subagents, 0o700);
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'names each of the four failures with its own non-empty reason',
    () => {
      // The reason is the only trace of WHICH step failed once the child has turned the
      // line into a fail-closed row; a constant or empty reason passes every case above and
      // tells the operator nothing. The four are run in one tree so the texts can be
      // compared: the parse failure and the envelope failure need no disk, the pre-state
      // failure needs an unreadable target, the sidecar failure an unreadable directory.
      installStubPolydeukes();
      const reasons: string[] = [];

      reasons.push(expectFailureSpawn('{'));
      reasons.push(expectFailureSpawn('{}'));

      const target = writeTarget();
      chmodSync(target, 0o000);
      try {
        reasons.push(expectFailureSpawn(editPayload()));
      } finally {
        chmodSync(target, 0o600);
      }

      const { transcript, subagents } = writeRefusedSidecar();
      try {
        reasons.push(expectFailureSpawn(editPayload({ transcript_path: transcript })));
      } finally {
        chmodSync(subagents, 0o700);
      }

      expect(reasons).toHaveLength(4);
      for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
      expect(new Set(reasons).size).toBe(4);
    },
  );
});

describe('runHook — polydeukes is not installed under repoRoot', () => {
  it('spawns nothing, exits 2, and says so on stderr', () => {
    // With no bin there is nothing to spawn and no writer for a row. Exit 0 here is the
    // cheapest bypass in the package — an uninstalled judge passing every call — and a
    // silent 2 leaves the operator with nothing that names the missing package.
    writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({ repoRoot, rawPayload: editPayload(), spawn });

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toEqual([]);
    expect(stderr.join('')).toMatch(new RegExp(`^${NOT_INSTALLED_PREFIX}.*polydeukes`, 'm'));
  });

  it('treats an installed manifest with no `bin.pdks` as not installed', () => {
    // A manifest found but carrying no bin would otherwise be spawned as `node undefined`,
    // a crash the status mapping turns into 2 with a stack trace and no row — the same
    // outcome as not installed, reached without saying so.
    installStubPolydeukes({ version: '0.0.0' });
    writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({ repoRoot, rawPayload: editPayload(), spawn });

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toEqual([]);
  });
});
