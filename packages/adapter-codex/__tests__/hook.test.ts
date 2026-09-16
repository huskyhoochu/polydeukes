import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type FileChange, parseInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunHookSpec } from '../src/hook.ts';
import { runHook } from '../src/hook.ts';

// `runHook` is the adapter's whole session entry point: one Codex PreToolUse payload in, one
// `pdks covenant check` spawn out, the child's status back as the exit code. It judges
// nothing and writes no row. Every case injects the `spawn` seam and reads what the seam was
// handed — command, args, cwd, stdin, and the stdio wiring — because those five values are
// the entire contract between this package and the judge process.
//
// Payload shape: the official generated schema `pre-tool-use.command.input.schema.json`
// (2026-09-16) — snake_case keys only, `tool_name` always the canonical `apply_patch` or
// `Bash`, and `tool_input.command` the raw patch text for `apply_patch`.

/** Injected fixture values — Codex-native tool names, target files, pre-state. */
const APPLY_PATCH = 'apply_patch';
const BASH = 'Bash';
const COMMAND_ARG = 'command';
const TARGET_FILE = 'gate/inner.txt';
const OTHER_FILE = 'notes/other.txt';
const PRE_STATE = 'locked: yes\n';
const STUB_BIN_REL = './dist/bin.js';
/** What the child must be asked to run, after the bin path. */
const CHECK_ARGS = ['covenant', 'check', '--enforce', 'block'];
/** The stdin line a pre-spawn failure travels in — the judge fails closed on it as non-JSON. */
const FAILURE_PREFIX = 'adapter-codex failed before spawn:';
/** The stderr line the not-installed case leaves — the one outcome that has no row anywhere. */
const NOT_INSTALLED_PREFIX = 'covenant hook failed closed:';
/** The keys the official schema marks required, every one of which the adapter demands. */
const REQUIRED_KEYS = [
  'cwd',
  'hook_event_name',
  'model',
  'permission_mode',
  'session_id',
  'tool_input',
  'tool_name',
  'tool_use_id',
  'transcript_path',
  'turn_id',
] as const;

type SpawnCall = {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  stdio: readonly [string, string, string];
};

let repoRoot: string;
let stderr: string[];
let stdoutWrites: number;

beforeEach(() => {
  // Realpath'd: macOS hands out `/var/...` for a tmpdir whose real location is
  // `/private/var/...`, and the bin path resolution and the payload paths must agree.
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-codex-hook-repo-')));
  stderr = [];
  stdoutWrites = 0;
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  vi.spyOn(process.stdout, 'write').mockImplementation((() => {
    stdoutWrites += 1;
    return true;
  }) as typeof process.stdout.write);
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

function writeFixture(relative: string, content = PRE_STATE): string {
  const absolute = join(repoRoot, relative);
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
    spawn: (spec: SpawnCall) => {
      calls.push({ ...spec, args: [...spec.args] });
      return { status };
    },
  };
}

/** One full schema-valid envelope; `overrides` replaces top-level keys. */
function envelope(
  toolName: string,
  toolInput: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    cwd: repoRoot,
    hook_event_name: 'PreToolUse',
    model: 'gpt-5.3-codex',
    permission_mode: 'default',
    session_id: 'sess-1',
    tool_input: toolInput,
    tool_name: toolName,
    tool_use_id: 'call-1',
    transcript_path: join(repoRoot, 'transcript.jsonl'),
    turn_id: 'turn-1',
    ...overrides,
  };
}

function patchText(...hunks: string[][]): string {
  return ['*** Begin Patch', ...hunks.flat(), '*** End Patch', ''].join('\n');
}

function addHunk(path: string, ...lines: string[]): string[] {
  return [`*** Add File: ${path}`, ...lines.map((line) => `+${line}`)];
}

function patchPayload(patch: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(envelope(APPLY_PATCH, { command: patch }, overrides));
}

function bashPayload(command: string): string {
  return JSON.stringify(envelope(BASH, { command }));
}

type ParsedIr = {
  toolCalls: { name: string; args?: Record<string, unknown>; fileChange?: FileChange }[];
  tools?: { mutating: string[]; shell: string[]; commandArgs: string[] };
  session?: unknown;
  actor?: unknown;
};

function parsedStdin(call: SpawnCall | undefined): ParsedIr {
  return JSON.parse(call?.stdin ?? 'null') as ParsedIr;
}

function expectCodexRoster(ir: ParsedIr) {
  expect(ir.tools).toEqual({
    mutating: [APPLY_PATCH],
    shell: [BASH],
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
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(OTHER_FILE, 'hello'))),
      spawn,
    });

    expect(outcome).toEqual({ exitCode: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toEqual([bin, ...CHECK_ARGS]);
    expect(calls[0]?.cwd).toBe(repoRoot);
  });

  it('pipes stdin, discards the child’s stdout, and inherits only its stderr', () => {
    // Codex reads the hook's stdout as JSON and, on any field it does not accept, marks the
    // hook failed and lets the tool call proceed. A child spawned with stdout inherited
    // forwards whatever the judge prints straight into that channel — an `inherit` in the
    // second slot is a fail-open wire even when this package itself writes nothing. stderr
    // stays inherited because the break reason reaches the operator through it.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: patchPayload(patchText(addHunk(OTHER_FILE, 'x'))), spawn });

    expect(calls[0]?.stdio).toEqual(['pipe', 'ignore', 'inherit']);
  });

  it('hands the child a protocol-valid IR with the Codex roster, the apply_patch name, and no session or actor', () => {
    // Without `tools` the child judges on its own default roster and `apply_patch` is not a
    // mutating tool. `transcript_path` is in the payload but the transcript is not a stable
    // interface, so no `session` key — one would register history declarations over
    // nothing. `Edit` and `Write` never arrive as `tool_name`, so a roster naming them
    // matches no call.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: patchPayload(patchText(addHunk(OTHER_FILE, 'x'))), spawn });

    expect(parseInput(calls[0]?.stdin ?? '').ok).toBe(true);
    const ir = parsedStdin(calls[0]);
    expectCodexRoster(ir);
    expect(ir.toolCalls).toHaveLength(1);
    expect(ir.toolCalls[0]?.name).toBe(APPLY_PATCH);
  });
});

describe('runHook — apply_patch evidence, one element per file', () => {
  // Two path bases meet here. A patch path is relative to the call's `cwd`; the judge reads
  // `fileChange.path` relative to `repoRoot` (an absolute path it relativizes, a relative
  // one it takes as already repo-relative). So the adapter resolves against `cwd` to READ
  // the pre-state, and carries the repoRoot-relative form in the evidence.

  it('carries the repoRoot-relative path when the cwd is a subdirectory, and reads the pre-state at the cwd-resolved absolute path', () => {
    // `cwd = repoRoot/gate` and `*** Update File: inner.txt` names `repoRoot/gate/inner.txt`.
    // Carried verbatim, the judge compares `inner.txt` against the protected list and the
    // gate file passes; carried absolute, it happens to relativize right, but a reader
    // handed the verbatim path reads from the runner's cwd — ENOENT, a creation, every
    // pre-existing line forgiven. The `pre` here proves the read happened at the resolved
    // absolute path; the `path` proves the evidence was relativized to repoRoot.
    installStubPolydeukes();
    writeFixture(TARGET_FILE);
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: patchPayload(
        patchText(['*** Update File: inner.txt', '@@', '-locked: yes', '+locked: no']),
        { cwd: join(repoRoot, 'gate') },
      ),
      spawn,
    });

    expect(parsedStdin(calls[0]).toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: TARGET_FILE,
      pre: PRE_STATE,
      post: 'locked: no\n',
    });
  });

  it('relativizes an absolute patch path to repoRoot as well', () => {
    // The judge relativizes absolute paths itself, so this case passes on a naive adapter
    // too — until a config or a discipline reads `fileChange.path` before the judge does.
    // One form on the wire, whatever the patch spelled.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(join(repoRoot, OTHER_FILE), 'x')), {
        cwd: join(repoRoot, 'gate'),
      }),
      spawn,
    });

    expect(parsedStdin(calls[0]).toolCalls[0]?.fileChange).toEqual({
      kind: 'create',
      path: OTHER_FILE,
      post: 'x\n',
    });
  });

  it('lands N files as N toolCalls elements in one IR, in patch order, each with its own evidence, on ONE spawn', () => {
    // The judge sees every file only if every file rides the IR. One element for the first
    // hunk lets the protected second file pass; one spawn per file exposes the set to
    // config and disk changes between processes and writes N rows for one call twice over.
    installStubPolydeukes();
    writeFixture(TARGET_FILE);
    const { calls, spawn } = recordingSpawn(2);

    const outcome = runHook({
      repoRoot,
      rawPayload: patchPayload(
        patchText(addHunk(OTHER_FILE, 'harmless'), [`*** Delete File: ${TARGET_FILE}`]),
      ),
      spawn,
    });

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toHaveLength(1);
    const ir = parsedStdin(calls[0]);
    expect(parseInput(calls[0]?.stdin ?? '').ok).toBe(true);
    expectCodexRoster(ir);
    expect(ir.toolCalls.map((call) => call.name)).toEqual([APPLY_PATCH, APPLY_PATCH]);
    expect(ir.toolCalls.map((call) => call.fileChange)).toEqual([
      { kind: 'create', path: OTHER_FILE, post: 'harmless\n' },
      { kind: 'delete', path: TARGET_FILE, pre: PRE_STATE },
    ]);
  });

  it('lands a `Move to` as two elements — the source’s delete and the destination’s create', () => {
    // A rename judged on one path only lets a file be carried out of, or into, a protected
    // directory unseen. Both must be present, both under the mutating name, both
    // repoRoot-relative. No hunk follows the move, so the destination carries the source
    // text unchanged.
    installStubPolydeukes();
    writeFixture(TARGET_FILE);
    const { calls, spawn } = recordingSpawn(0);

    runHook({
      repoRoot,
      rawPayload: patchPayload(
        patchText([`*** Update File: ${TARGET_FILE}`, `*** Move to: ${OTHER_FILE}`]),
      ),
      spawn,
    });

    expect(calls).toHaveLength(1);
    const ir = parsedStdin(calls[0]);
    expect(ir.toolCalls.map((call) => call.name)).toEqual([APPLY_PATCH, APPLY_PATCH]);
    expect(ir.toolCalls.map((call) => call.fileChange)).toEqual([
      { kind: 'delete', path: TARGET_FILE, pre: PRE_STATE },
      { kind: 'create', path: OTHER_FILE, post: PRE_STATE },
    ]);
  });
});

describe('runHook — Bash rides the shell axis', () => {
  it('carries the command in args, no fileChange, and the Bash name on the shell roster', () => {
    // A fileChange on a shell call invents a mutation the command line never proved;
    // dropping `Bash` from `tools.shell` sends the command to the mutating axis, which
    // does not read it, and a protected-path mention passes unjudged.
    installStubPolydeukes();
    const { calls, spawn } = recordingSpawn(0);

    runHook({ repoRoot, rawPayload: bashPayload(`rm ${TARGET_FILE}`), spawn });

    const ir = parsedStdin(calls[0]);
    expectCodexRoster(ir);
    expect(ir.toolCalls).toHaveLength(1);
    expect(ir.toolCalls[0]?.name).toBe(BASH);
    expect(ir.toolCalls[0]?.args).toEqual({ command: `rm ${TARGET_FILE}` });
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
    const { spawn } = recordingSpawn(status);

    expect(
      runHook({ repoRoot, rawPayload: patchPayload(patchText(addHunk(OTHER_FILE, 'x'))), spawn }),
    ).toEqual({ exitCode });
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

  it('a camelCase envelope — this host has one spelling and the other is refused', () => {
    // The Grok host sends both spellings; Codex sends snake_case only. An adapter reading
    // `toolName`/`toolInput` as a fallback accepts a payload no Codex build produces, and
    // a fixture written in that spelling passes a suite whose live host never reaches it.
    installStubPolydeukes();
    const camel = {
      cwd: repoRoot,
      hookEventName: 'PreToolUse',
      model: 'gpt-5.3-codex',
      permissionMode: 'default',
      sessionId: 'sess-1',
      toolInput: { command: patchText(addHunk(OTHER_FILE, 'x')) },
      toolName: APPLY_PATCH,
      toolUseId: 'call-1',
      transcriptPath: join(repoRoot, 'transcript.jsonl'),
      turnId: 'turn-1',
    };

    expectFailureSpawn(JSON.stringify(camel));
  });

  it('an event other than PreToolUse', () => {
    // A PostToolUse payload carries the same keys; judging it blocks a call that has already
    // run and records a verdict about nothing.
    installStubPolydeukes();
    expectFailureSpawn(
      patchPayload(patchText(addHunk(OTHER_FILE, 'x')), { hook_event_name: 'PostToolUse' }),
    );
  });

  it.each(REQUIRED_KEYS)('the required key `%s` absent', (key) => {
    // The official schema marks every one of these required. An adapter checking only the
    // keys it reads accepts an envelope from a host build that is not the one this package
    // was written against, and judges what it guesses the rest means.
    installStubPolydeukes();
    const payload = envelope(APPLY_PATCH, { command: patchText(addHunk(OTHER_FILE, 'x')) });
    delete payload[key];

    expectFailureSpawn(JSON.stringify(payload));
  });

  it('a patch the grammar refuses — the reason names the patch, not the envelope', () => {
    // The envelope is valid; only the patch text is not. An adapter that attaches no
    // evidence and spawns the call anyway hands the judge an `apply_patch` call with no
    // path, and an argument-mention fallback over raw patch text is not a judgment.
    installStubPolydeukes();

    const reason = expectFailureSpawn(patchPayload('*** Begin Patch\n*** End Patch\n'));

    expect(reason).toMatch(/patch/i);
  });

  it.skipIf(process.getuid?.() === 0)('a pre-state read refused by permissions', () => {
    // An unreadable delete target is not a missing one: reading it as absent marks the
    // deletion pre-less and a discipline over the deleted text sees nothing. Skipped as
    // root, which no mode can refuse.
    installStubPolydeukes();
    const target = writeFixture(TARGET_FILE);
    chmodSync(target, 0o000);
    try {
      expectFailureSpawn(patchPayload(patchText([`*** Delete File: ${TARGET_FILE}`])));
    } finally {
      chmodSync(target, 0o600);
    }
  });

  it.each([
    ['a relative path climbing out of the root', () => '../outside.txt'],
    ['an absolute path beside the root', () => `${repoRoot}-sibling/outside.txt`],
  ])('a patch path resolving outside repoRoot — %s', (_title, outside) => {
    // The judge's scope matching answers `null` for a path outside its root, so an element
    // carried through lands as no world at all — an apply_patch call judged over nothing
    // and passed. An adapter that carries such a path, or drops the element and spawns
    // the rest, both let the write out of observation. Both spellings must fail: the
    // relative one is caught by normalisation, the absolute one by relativisation, and an
    // adapter checking only one of them has a hole the other walks through.
    installStubPolydeukes();
    expectFailureSpawn(patchPayload(patchText(addHunk(outside(), 'x'))));
  });

  it('a `Delete File` whose target the reader does not find', () => {
    // The tool refuses to delete what is not there. A delete emitted without its `pre`
    // lets a discipline over the deleted text read an absent source and pass on it.
    installStubPolydeukes();
    expectFailureSpawn(patchPayload(patchText([`*** Delete File: ${TARGET_FILE}`])));
  });

  it.each([
    ['tool_input a string', () => ({ tool_input: '*** Begin Patch\n*** End Patch\n' })],
    ['tool_name a number', () => ({ tool_name: 7 })],
    ['cwd an array', () => ({ cwd: [repoRoot] })],
    ['hook_event_name null', () => ({ hook_event_name: null })],
    ['tool_input.command a number', () => ({ tool_input: { command: 42 } })],
  ])('a required value of the wrong type — %s', (_title, overrides) => {
    // A validator that checks key presence only reaches `.command` on a string and
    // `.split` on a number, and the throw leaves the hook at node's exit 1 — which the host
    // reads as NOT blocked. Exit 2 through the failure spawn, never a crash.
    installStubPolydeukes();
    expectFailureSpawn(patchPayload(patchText(addHunk(OTHER_FILE, 'x')), overrides()));
  });

  it('names each failure with its own non-empty reason', () => {
    // The reason is the only trace of WHICH step failed once the child has turned the line
    // into a fail-closed row; a constant or empty reason passes every case above and tells
    // the operator nothing.
    installStubPolydeukes();
    const reasons = [
      expectFailureSpawn('{'),
      expectFailureSpawn('{}'),
      expectFailureSpawn(patchPayload('*** Begin Patch\n*** End Patch\n')),
    ];

    for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
    expect(new Set(reasons).size).toBe(3);
  });
});

describe('runHook — a tool name outside the roster is refused before the spawn', () => {
  // Codex normalises every file edit that reaches the hook into `apply_patch`, so a name
  // outside `apply_patch` · `Bash` is not "a mutating tool not yet listed" — it is an
  // envelope from a host build this package was not written against. A Code Mode `exec`
  // carries JavaScript whose nested `tools.apply_patch` rewrites a protected file; an
  // adapter that builds a `toolCalls` element under that name hands the judge a call no
  // discipline is assigned to, and the runner's backstop records it `passed`.

  /** Injected fixture names — none of them is on this adapter's roster. */
  const EXEC = 'exec';
  const CODE_MODE_EXEC = 'code_mode_exec';
  const ARBITRARY = 'web_search';
  /** The roster is matched exactly: a case variant of a roster name is outside it. */
  const NEAR_MISS = 'bash';

  /** JavaScript text as Code Mode ships it: a nested apply_patch over the fixture file. */
  function codeModeScript(): string {
    const patch = patchText([
      `*** Update File: ${TARGET_FILE}`,
      '@@',
      '-locked: yes',
      '+locked: no',
    ]);
    return `await tools.apply_patch(${JSON.stringify(patch)});`;
  }

  function unknownNamePayload(toolName: string): string {
    return JSON.stringify(envelope(toolName, { command: codeModeScript() }));
  }

  it.each([EXEC, CODE_MODE_EXEC, ARBITRARY, NEAR_MISS])(
    'tool_name `%s` — one spawn, a failure line naming the received name and the roster, exit 2',
    (toolName) => {
      // Exactly one spawn, so the judge writes the fail-closed row; the received name in
      // quotes, so the operator reads WHICH name arrived; both roster words, so a message
      // that names only one of them (or the roster of another adapter) is caught. An
      // adapter that returns 2 without spawning leaves no row; one that spawns an IR lands
      // a `passed` row under the runner's label.
      installStubPolydeukes();
      writeFixture(TARGET_FILE);
      const { calls, spawn } = recordingSpawn(2);

      const outcome = runHook({ repoRoot, rawPayload: unknownNamePayload(toolName), spawn });

      expect(outcome).toEqual({ exitCode: 2 });
      expect(calls).toHaveLength(1);
      const stdin = calls[0]?.stdin ?? '';
      expect(stdin.startsWith(FAILURE_PREFIX)).toBe(true);
      // The whole sentence: the received name, the roster in vocabulary order, and the one
      // pointer to the README's declared-limits section. The message says only what the
      // adapter knows — which name arrived and which it translates — and leaves the cause
      // (Code Mode, a hosted tool, a widened matcher) to the README, per name.
      expect(stdin).toContain(
        `this adapter does not translate tool '${toolName}'; the roster is ${APPLY_PATCH}, ${BASH} — see the package README, What this surface does not observe`,
      );
      expect(calls[0]?.args).toEqual([expect.stringMatching(/bin\.js$/), ...CHECK_ARGS]);
      expect(calls[0]?.cwd).toBe(repoRoot);
      expect(stderr.join('')).toContain(stdin);
      expect(stdoutWrites).toBe(0);
    },
  );

  it('hands the judge no IR at all for such a name — the stdin is not JSON', () => {
    // The fail-closed path works because the judge cannot parse the line. An adapter that
    // prefixes a valid IR with the failure text, or that spawns an IR whose single element
    // carries the unknown name on no axis, gives the judge something to route — and a call
    // routed to no discipline is recorded `passed`, not `blocked`.
    installStubPolydeukes();
    writeFixture(TARGET_FILE);
    const { calls, spawn } = recordingSpawn(2);

    runHook({ repoRoot, rawPayload: unknownNamePayload(EXEC), spawn });

    expect(calls).toHaveLength(1);
    expect(() => JSON.parse(calls[0]?.stdin ?? '')).toThrow();
    expect(parseInput(calls[0]?.stdin ?? '').ok).toBe(false);
  });
});

describe('runHook — nothing reaches stdout', () => {
  it('writes zero bytes to stdout across a pass, a block, and a pre-spawn failure', () => {
    // Codex parses the hook's stdout as a JSON decision. Any byte here — a verdict echo, a
    // `hookSpecificOutput` document, a stray log line — is read by the host, and an
    // unrecognised field marks the hook failed and lets the tool call proceed.
    installStubPolydeukes();
    const passing = recordingSpawn(0);
    const blocking = recordingSpawn(2);

    runHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(OTHER_FILE, 'x'))),
      spawn: passing.spawn,
    });
    runHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(TARGET_FILE, 'x'))),
      spawn: blocking.spawn,
    });
    runHook({ repoRoot, rawPayload: '{', spawn: blocking.spawn });

    expect(passing.calls.length + blocking.calls.length).toBe(3);
    expect(stdoutWrites).toBe(0);
  });
});

describe('runHook — polydeukes is not installed under repoRoot', () => {
  it('spawns nothing, exits 2, and says so on stderr', () => {
    // With no bin there is nothing to spawn and no writer for a row. Exit 0 here is the
    // cheapest bypass in the package — an uninstalled judge passing every call — and a
    // silent 2 leaves the operator with nothing that names the missing package.
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(OTHER_FILE, 'x'))),
      spawn,
    });

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toEqual([]);
    expect(stderr.join('')).toMatch(new RegExp(`^${NOT_INSTALLED_PREFIX}.*polydeukes`, 'm'));
  });

  it('treats an installed manifest with no `bin.pdks` as not installed', () => {
    // A manifest found but carrying no bin would otherwise be spawned as `node undefined`,
    // a crash the status mapping turns into 2 with a stack trace and no row.
    installStubPolydeukes({ version: '0.0.0' });
    const { calls, spawn } = recordingSpawn(0);

    const outcome = runHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(OTHER_FILE, 'x'))),
      spawn,
    });

    expect(outcome).toEqual({ exitCode: 2 });
    expect(calls).toEqual([]);
  });
});
