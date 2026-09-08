import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type FileChange, parseInput } from '@polydeukes/core';
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

/** Injected fixture values — Grok-native tool names, target files, pre-state. */
const WRITE = 'write';
const SEARCH_REPLACE = 'search_replace';
const RUN = 'run_terminal_command';
const COMMAND_ARG = 'command';
const TARGET_FILE = 'gate/inner.txt';
const PRE_STATE = 'locked: yes\n';
const WRITE_CONTENT = 'unlocked: now\n';
const STUB_BIN_REL = './dist/bin.js';
/** What the child must be asked to run, after the bin path. */
const CHECK_ARGS = ['covenant', 'check', '--enforce', 'block'];
/** The stdin line a pre-spawn failure travels in — the judge fails closed on it as non-JSON. */
const FAILURE_PREFIX = 'adapter-grok failed before spawn:';
/** The stderr line the not-installed case leaves — the one outcome that has no row anywhere. */
const NOT_INSTALLED_PREFIX = 'covenant hook failed closed:';

type SpawnCall = { command: string; args: string[]; cwd: string; stdin: string };

let repoRoot: string;
let stderr: string[];

beforeEach(() => {
  // Realpath both roots: macOS hands out `/var/...` for a tmpdir whose real location is
  // `/private/var/...`, and the bin path resolution and the payload paths must agree.
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-grok-hook-repo-')));
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
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

function writePayload(filePath: string, content: string): string {
  return JSON.stringify({
    hookEventName: 'pre_tool_use',
    toolName: WRITE,
    toolInput: { file_path: filePath, content },
  });
}

function dualKeyWritePayload(filePath: string, content: string): string {
  // Live host envelopes carry both spellings together, with the same Grok name in each.
  return JSON.stringify({
    hookEventName: 'pre_tool_use',
    toolName: WRITE,
    tool_name: WRITE,
    toolInput: { file_path: filePath, content },
    tool_input: { file_path: filePath, content },
  });
}

function searchReplacePayload(
  filePath: string,
  oldString: string,
  newString: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    hookEventName: 'pre_tool_use',
    toolName: SEARCH_REPLACE,
    toolInput: { file_path: filePath, old_string: oldString, new_string: newString, ...extra },
  });
}

function shellPayload(command: string): string {
  return JSON.stringify({
    hookEventName: 'pre_tool_use',
    toolName: RUN,
    toolInput: { command },
  });
}

type ParsedIr = {
  toolCalls: { name: string; args?: Record<string, unknown>; fileChange?: FileChange }[];
  tools?: { mutating: string[]; shell: string[]; commandArgs: string[] };
  session?: unknown;
  actor?: unknown;
};

function parsedStdin(call: SpawnCall): ParsedIr {
  return JSON.parse(call.stdin) as ParsedIr;
}

function expectGrokRoster(ir: ParsedIr) {
  expect(ir.tools).toEqual({
    mutating: [WRITE, SEARCH_REPLACE],
    shell: [RUN],
    commandArgs: [COMMAND_ARG],
  });
  expect('session' in ir).toBe(false);
  expect('actor' in ir).toBe(false);
}

describe('runHook — the spawn it makes', () => {
  it('spawns node on the installed bin with `covenant check --enforce block`, once, in repoRoot', () => {
    // The judge is reached only through this spawn. A missing `--enforce block` lands every
    // break as advised at exit 0; a cwd anywhere but repoRoot makes the child discover the
    // wrong config or none; a bin located from the runner's own module instead of the
    // fixture tree would name this repository's install.
    const bin = installStubPolydeukes();
    const target = writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({ repoRoot, rawPayload: writePayload(target, WRITE_CONTENT), spawn });

    expect(outcome).toEqual({ exitCode: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toEqual([bin, ...CHECK_ARGS]);
    expect(calls[0]?.cwd).toBe(repoRoot);
  });

  it('hands the child a protocol-valid IR with the Grok roster, the write name, and no session or actor', () => {
    // Without `tools` the child judges on its own default roster and `write` is not a
    // mutating tool; a `session` or `actor` key this host cannot prove would register
    // history and actor declarations over nothing.
    installStubPolydeukes();
    const target = writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: writePayload(target, WRITE_CONTENT), spawn });

    const stdin = (calls[0] as SpawnCall).stdin;
    expect(parseInput(stdin).ok).toBe(true);
    const ir = parsedStdin(calls[0] as SpawnCall);
    expectGrokRoster(ir);
    expect(ir.toolCalls[0]?.name).toBe(WRITE);
    expect(ir.toolCalls[0]?.args).toMatchObject({ file_path: target, content: WRITE_CONTENT });
  });

  it('builds the same name and roster from a dual-key envelope as from camelCase-only', () => {
    // The live host sends both spellings together. Reading only camelCase still works
    // for the document envelope; reading only snake_case drops the document envelope.
    // This fixture carries the same Grok name in both name fields, so either spelling
    // of the name would pass — the camelCase-only case above is what refuses snake-only.
    installStubPolydeukes();
    const target = writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: dualKeyWritePayload(target, WRITE_CONTENT), spawn });

    const ir = parsedStdin(calls[0] as SpawnCall);
    expectGrokRoster(ir);
    expect(ir.toolCalls[0]?.name).toBe(WRITE);
  });

  it('prefers camelCase toolInput when a dual-key envelope carries both input objects', () => {
    // Same name in both name fields, different paths in the two input objects. A reader
    // that prefers snake_case attaches evidence for the snake path and the judge watches
    // the wrong file.
    installStubPolydeukes();
    const camelPath = writeTarget();
    const snakePath = join(repoRoot, 'gate/snake.txt');
    mkdirSync(dirname(snakePath), { recursive: true });
    writeFileSync(snakePath, 'snake-pre\n');
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: JSON.stringify({
        hookEventName: 'pre_tool_use',
        toolName: WRITE,
        tool_name: WRITE,
        toolInput: { file_path: camelPath, content: WRITE_CONTENT },
        tool_input: { file_path: snakePath, content: 'snake-content-must-not-win' },
      }),
      spawn,
    });

    const ir = parsedStdin(calls[0] as SpawnCall);
    expect(ir.toolCalls[0]?.name).toBe(WRITE);
    expect(ir.toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: camelPath,
      pre: PRE_STATE,
      post: WRITE_CONTENT,
    });
  });
});

describe('runHook — write, search_replace, and shell evidence', () => {
  it('attaches create evidence for a write whose target is absent', () => {
    // ENOENT is a creation, not a spawn failure and not a modify with an empty pre.
    installStubPolydeukes();
    const target = join(repoRoot, TARGET_FILE);
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: writePayload(target, WRITE_CONTENT), spawn });

    const ir = parsedStdin(calls[0] as SpawnCall);
    expect(ir.toolCalls[0]?.fileChange).toEqual({
      kind: 'create',
      path: target,
      post: WRITE_CONTENT,
    });
    expect(calls[0]?.stdin.startsWith(FAILURE_PREFIX)).toBe(false);
  });

  it('attaches substituted modify evidence for a search_replace with one match', () => {
    // Without fileChange a protected-path search_replace is judged by argument mention
    // alone, and a discipline sees no pre-state.
    installStubPolydeukes();
    const target = writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'locked: yes', 'locked: no'),
      spawn,
    });

    const ir = parsedStdin(calls[0] as SpawnCall);
    expectGrokRoster(ir);
    expect(ir.toolCalls[0]?.name).toBe(SEARCH_REPLACE);
    expect(ir.toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: target,
      pre: PRE_STATE,
      post: 'locked: no\n',
    });
  });

  it('omits fileChange when search_replace old_string occurs zero times', () => {
    // The host tool refuses a substitution that matches nothing. Fabricating a post
    // from a miss would let the call be judged as a proven mutation of a file that
    // the tool will not touch.
    installStubPolydeukes();
    const target = writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'absent-token', 'locked: no'),
      spawn,
    });

    const call = parsedStdin(calls[0] as SpawnCall).toolCalls[0] as object;
    expect('fileChange' in call).toBe(false);
  });

  it('omits fileChange when search_replace old_string occurs twice and replace_all is absent', () => {
    // Two matches without replace_all is the other host refusal. Applying the first
    // only, or all of them, both invent a post the tool will not produce.
    installStubPolydeukes();
    const target = writeTarget('alpha and alpha\n');
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'alpha', 'beta'),
      spawn,
    });

    const call = parsedStdin(calls[0] as SpawnCall).toolCalls[0] as object;
    expect('fileChange' in call).toBe(false);
  });

  it('replaces every occurrence when search_replace carries replace_all true', () => {
    // A single replace leaves the second occurrence and the judge sees the wrong post.
    installStubPolydeukes();
    const target = writeTarget('alpha and alpha\n');
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'alpha', 'beta', { replace_all: true }),
      spawn,
    });

    expect(parsedStdin(calls[0] as SpawnCall).toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: target,
      pre: 'alpha and alpha\n',
      post: 'beta and beta\n',
    });
  });

  it('inserts new_string literally — $-replacement patterns are never expanded', () => {
    // String.prototype.replace interprets $& in the replacement; the host tool
    // substitutes literally. Expanding here hands the judge a post the tool will not
    // write, in both the false-pass and false-block directions.
    installStubPolydeukes();
    const target = writeTarget('foo\n');
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'foo', '$&bar'),
      spawn,
    });

    expect(parsedStdin(calls[0] as SpawnCall).toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: target,
      pre: 'foo\n',
      post: '$&bar\n',
    });
  });

  it('omits fileChange for run_terminal_command and puts that name on the shell roster', () => {
    // A fileChange on a shell call invents a mutation the command line never proved;
    // dropping the name from `tools.shell` sends the command to the mutating axis,
    // which does not read it.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: shellPayload('echo hi'), spawn });

    const ir = parsedStdin(calls[0] as SpawnCall);
    expectGrokRoster(ir);
    expect(ir.toolCalls[0]?.name).toBe(RUN);
    expect(ir.toolCalls[0]?.args).toEqual({ command: 'echo hi' });
    expect('fileChange' in (ir.toolCalls[0] as object)).toBe(false);
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
    const target = writeTarget();
    const { spawn } = recordingSpawn(status);

    expect(runHook({ repoRoot, rawPayload: writePayload(target, WRITE_CONTENT), spawn })).toEqual({
      exitCode,
    });
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
    // The child's stderr names only its parse failure, so the reason must also leave here.
    expect(stderr.join('')).toContain(stdin);
    return stdin.slice(FAILURE_PREFIX.length).trim();
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
    // An unreadable target is not a missing one: reading it as absent would mark the write
    // a creation and forgive every pre-existing line. Skipped as root, which no mode can
    // refuse.
    installStubPolydeukes();
    const target = writeTarget();
    chmodSync(target, 0o000);
    try {
      expectFailureSpawn(writePayload(target, WRITE_CONTENT));
    } finally {
      chmodSync(target, 0o600);
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'names each of the three failures with its own non-empty reason',
    () => {
      // The reason is the only trace of WHICH step failed once the child has turned the
      // line into a fail-closed row; a constant or empty reason passes every case above
      // and tells the operator nothing.
      installStubPolydeukes();
      const reasons: string[] = [];

      reasons.push(expectFailureSpawn('{'));
      reasons.push(expectFailureSpawn('{}'));

      const target = writeTarget();
      chmodSync(target, 0o000);
      try {
        reasons.push(expectFailureSpawn(writePayload(target, WRITE_CONTENT)));
      } finally {
        chmodSync(target, 0o600);
      }

      expect(reasons).toHaveLength(3);
      for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
      expect(new Set(reasons).size).toBe(3);
    },
  );
});

describe('runHook — polydeukes is not installed under repoRoot', () => {
  it('spawns nothing, exits 2, and says so on stderr', () => {
    // With no bin there is nothing to spawn and no writer for a row. Exit 0 here is the
    // cheapest bypass in the package — an uninstalled judge passing every call — and a
    // silent 2 leaves the operator with nothing that names the missing package.
    const target = writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({ repoRoot, rawPayload: writePayload(target, WRITE_CONTENT), spawn });

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toEqual([]);
    expect(stderr.join('')).toMatch(new RegExp(`^${NOT_INSTALLED_PREFIX}.*polydeukes`, 'm'));
  });

  it('treats an installed manifest with no `bin.pdks` as not installed', () => {
    // A manifest found but carrying no bin would otherwise be spawned as `node undefined`,
    // a crash the status mapping turns into 2 with a stack trace and no row — the same
    // outcome as not installed, reached without saying so.
    installStubPolydeukes({ version: '0.0.0' });
    const target = writeTarget();
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({ repoRoot, rawPayload: writePayload(target, WRITE_CONTENT), spawn });

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toEqual([]);
  });
});
