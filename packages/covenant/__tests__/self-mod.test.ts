import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import { envEscapeHatch } from '../src/escape-hatch.ts';
import { judgeSelfModification } from '../src/self-mod.ts';
import { readTelemetryLines } from './helpers.js';

// ---------------------------------------------------------------------------
// PRD §5.1 — pure judge. Tool-name strings and protected-path strings below
// are injected fixture values, never source literals (PRD §4.1/§7).
// ---------------------------------------------------------------------------

const MUTATING_TOOLS = ['Edit', 'Write', 'MultiEdit'];
const PROTECTED = 'sub/protected/file.txt';

/** Build a minimal CovenantInput with a single toolCalls[0]. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name, args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

describe('judgeSelfModification — pure judge (PRD §5.1)', () => {
  it('a mutating tool call mentioning the protected path in a top-level arg breaks, with reason containing the tool name and path', () => {
    // Mutation caught: break condition inverted (uphold instead of break), or the
    // reason string not carrying the diagnostic tool name/path (silent, unhelpful break).
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('Edit');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a mutating tool call mentioning the protected path nested inside a MultiEdit-style edits array breaks', () => {
    // Mutation caught: a shallow scan that only inspects top-level arg values, missing
    // the MultiEdit shape args.edits[].file_path entirely (04d co-existence requires depth).
    const input = inputWithToolCall('MultiEdit', {
      edits: [{ file_path: PROTECTED, old_string: 'a', new_string: 'b' }],
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({
      upheld: false,
      reason: expect.stringContaining(PROTECTED),
    });
  });

  it('a non-mutating tool call mentioning the protected path is upheld (tool-path covenant judges only its own axis)', () => {
    // P0 co-existence invariant (PRD §3/§7): a Bash-shaped call is not in
    // mutatingToolNames, so this covenant must not break on it — that axis belongs to
    // the Bash meta-covenant (04b-04d). Mutation caught: judging by mention alone,
    // ignoring the tool-name axis, which would pre-empt the Bash covenant's allowlist.
    const input = inputWithToolCall('Bash', { command: `cat ${PROTECTED}` });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('a mutating tool call mentioning only non-protected paths is upheld', () => {
    // Mutation caught: break condition dropping the path-mention half of the predicate,
    // breaking on tool name alone regardless of what the args mention.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('an empty toolCalls array is upheld', () => {
    // Mutation caught: a default/fallback branch that breaks when no tool calls exist,
    // instead of vacuously upholding.
    const input: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('tool-name matching is exact: an injected "Edit" entry does not match a call named "MultiEdit"', () => {
    // P0 boundary from PRD §4.1: "not substring — 'Edit' must not falsely match
    // 'MultiEdit'". Mutation caught: exact-equality check replaced with a substring/
    // includes() check on the tool name.
    const input = inputWithToolCall('MultiEdit', { file_path: PROTECTED });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: ['Edit'],
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('an empty-string entry in protectedPaths is ignored (no match-everything)', () => {
    // Mutation caught: an unguarded '' entry vacuously substring-matches every arg
    // value, turning this covenant into a break-on-every-mutating-call rule.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [''],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('an empty-string entry in mutatingToolNames is ignored (no match-every-tool)', () => {
    // Mutation caught: an unguarded '' entry in mutatingToolNames matching every tool
    // name via a non-exact comparison, turning every tool call into a mutating one.
    const input = inputWithToolCall('Bash', { command: `cat ${PROTECTED}` });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: [''],
    });

    expect(verdict).toEqual({ upheld: true });
  });
});

// ---------------------------------------------------------------------------
// envEscapeHatch (PRD §4.3)
// ---------------------------------------------------------------------------

describe('envEscapeHatch — env-var predicate (PRD §4.3)', () => {
  const TEST_VAR = 'PDKS_TEST_SELF_MOD_ESCAPE_HATCH_VAR';
  const dummyInput: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };

  afterEach(() => {
    delete process.env[TEST_VAR];
  });

  it('returns true when the named env var is set to a non-empty string', () => {
    // Mutation caught: predicate always returning false, or checking the wrong var name.
    process.env[TEST_VAR] = 'anything';

    expect(envEscapeHatch(TEST_VAR)(dummyInput)).toBe(true);
  });

  it('returns false when the named env var is unset', () => {
    // Mutation caught: predicate defaulting to true (fail-open) when the var is absent.
    delete process.env[TEST_VAR];

    expect(envEscapeHatch(TEST_VAR)(dummyInput)).toBe(false);
  });

  it('returns false when the named env var is set to the empty string', () => {
    // Boundary case: an empty string is "set" in the shell sense but must not count as
    // a truthy hatch. Mutation caught: a `!== undefined` check instead of a non-empty
    // string check.
    process.env[TEST_VAR] = '';

    expect(envEscapeHatch(TEST_VAR)(dummyInput)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PRD §5.2 (body CLI) + §5.3 (dispatcher E2E) — real compiled artifact.
// ---------------------------------------------------------------------------

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const bodyPath = fileURLToPath(new URL('../dist/self-mod-body.js', import.meta.url));

beforeAll(() => {
  execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@polydeukes/covenant'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}, 120_000);

describe('self-mod-body CLI (PRD §5.2)', () => {
  it('a break input yields exit 1 with the mentioned path on stderr', () => {
    // Mutation caught: verdictToExitCode wired backwards (break -> 0), or the break
    // reason not surfaced on stderr at all.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit'],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toContain(PROTECTED);
  });

  it('an uphold input yields exit 0', () => {
    // Mutation caught: exit 0/1 mapping reversed, or the body always exiting non-zero.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit'],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(0);
  });

  it('invalid JSON on stdin yields exit 2 (CORE-01 fail-closed)', () => {
    // Mutation caught: the CLI not calling core parseInput's fail-closed path, e.g.
    // crashing with an uncaught exception (undefined/null exit code) instead of exit 2.
    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit'],
      { input: 'not valid json at all {{{', encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });

  it('zero --protected-path flags yields exit 2 (config fail-closed)', () => {
    // P0: PRD §4.2 "quietly leaking into universal uphold is itself a bypass vector".
    // Mutation caught: an empty protectedPaths list silently treated as vacuous-uphold
    // (exit 0) instead of a fail-closed config error.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(process.execPath, [bodyPath, '--mutating-tool', 'Edit'], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
  });

  it('zero --mutating-tool flags yields exit 2 (config fail-closed)', () => {
    // Same fail-closed boundary as above, other axis of the spec.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(process.execPath, [bodyPath, '--protected-path', PROTECTED], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
  });

  it('only empty-string values for both flags yields exit 2 (config fail-closed)', () => {
    // Mutation caught: raw flag *count* treated as "valid config" without filtering
    // empty-string entries, letting a misconfigured assembly slip through as exit 0/1
    // instead of failing closed.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', '', '--mutating-tool', ''],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });

  it('a flag token in a value position yields exit 2 (config fail-closed)', () => {
    // Review finding (COVENANT-03): a dropped value shifts the pair grid so the next
    // flag token is silently consumed as a value ('--mutating-tool' stored as a
    // protected path), passing the non-empty config gate while judging garbage —
    // a silent universal-uphold. Mutation caught: parseArgv accepting a '--'-prefixed
    // token as a flag value instead of failing closed.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', '--mutating-tool', '--mutating-tool', 'Edit'],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });

  it('a structurally malformed toolCalls element yields exit 2, never a crash exit code (fail-closed)', () => {
    // Review finding (COVENANT-03): `toolCalls: [null]` passes core parseInput (element
    // shapes are an intended CORE-01 boundary) and would crash the judge with a
    // TypeError — Node exits 1, which the protocol reads as a *non-blocking* break.
    // Mutation caught: the CLI shell not translating a judge throw into the blocking 2.
    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit'],
      {
        input: '{"toolCalls":[null],"subagentSpawns":[],"userMessages":[]}',
        encoding: 'utf-8',
      },
    );

    expect(result.status).toBe(2);
  });

  it('an unknown flag yields exit 2 (config fail-closed)', () => {
    // Mutation caught: unrecognized argv silently ignored instead of failing closed —
    // a typo'd flag in assembly must not silently degrade into a differently-configured
    // (or unconfigured) meta-covenant.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit', '--unknown-flag', 'x'],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });
});

describe('self-mod E2E through dispatchCovenants (PRD §5.3)', () => {
  let dir: string;
  let telemetryPath: string;
  const TEST_VAR = 'PDKS_TEST_SELF_MOD_E2E_HATCH_VAR';

  function selfModRegistration(
    label: string,
    escapeHatch?: (input: CovenantInput) => boolean,
  ): CovenantRegistration {
    return {
      label,
      protectedPaths: [PROTECTED],
      body: {
        command: process.execPath,
        args: [
          bodyPath,
          '--protected-path',
          PROTECTED,
          '--mutating-tool',
          'Edit',
          '--mutating-tool',
          'Write',
          '--mutating-tool',
          'MultiEdit',
        ],
      },
      ...(escapeHatch ? { escapeHatch } : {}),
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-selfmod-'));
    telemetryPath = join(dir, 'roi.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[TEST_VAR];
  });

  it('an Edit-shaped input mentioning the protected path blocks with one blocked telemetry record', async () => {
    // Mutation caught: the real compiled body not being spawned by the dispatcher, or
    // the break verdict not translated to the dispatcher's blocking exit code 2.
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    const reg = selfModRegistration('self-mod');

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('blocked');
    expect(record?.subject).toBe(PROTECTED);
  });

  it('a MultiEdit-shaped input with a nested edits[].file_path mentioning the protected path blocks', async () => {
    // Proves the nested-mention traversal survives the full CLI + dispatcher round trip,
    // not just the pure judge in isolation.
    const input = inputWithToolCall('MultiEdit', {
      edits: [{ file_path: PROTECTED, old_string: 'a', new_string: 'b' }],
    });
    const reg = selfModRegistration('self-mod');

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });

  it('an input mentioning only a non-protected path yields exitCode 0 and zero telemetry lines', async () => {
    // Mutation caught: dispatcher matching (protectedPaths) and judge break condition
    // disagreeing, or the covenant firing on unrelated content.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });
    const reg = selfModRegistration('self-mod');

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(telemetryPath)).toBe(false);
  });

  it('escapeHatch with the env var set bypasses the body: exitCode 0, one bypassed record, subject=protected path', async () => {
    // P0 (PRD §4.3 new dispatch table row): hatch skips the spawn entirely and must be
    // measured, not silently passed. Mutation caught: hatch not wired into the
    // dispatcher at all, or bypass logged as 'passed' instead of the distinct 'bypassed'
    // event, losing the "controlled, not measured" distinction the PRD requires.
    process.env[TEST_VAR] = 'set';
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    const reg = selfModRegistration('self-mod', envEscapeHatch(TEST_VAR));

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('bypassed');
    expect(record?.label).toBe('self-mod');
    expect(record?.subject).toBe(PROTECTED);
  });

  it('escapeHatch with the env var unset blocks exactly as without a hatch', async () => {
    // Mutation caught: hatch predicate wired to default true regardless of env state
    // (fail-open), which would silently defeat the covenant.
    delete process.env[TEST_VAR];
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    const reg = selfModRegistration('self-mod', envEscapeHatch(TEST_VAR));

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });
});
