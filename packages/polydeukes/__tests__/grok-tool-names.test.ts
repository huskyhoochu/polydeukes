import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Name mapping on the session surface: Grok's mutating+shell roster is rewritten onto
// Claude vocabulary after JSON.parse and before the adapter runs. The adapter package
// must not gain Grok names — these cases drive `runClaudeCodeHook` with live dual-key
// envelopes and assert WHO answered, because an exit code alone cannot tell a mapped
// judgment from a fail-closed crash.
import { runClaudeCodeHook } from '../src/claude-code-hook.ts';
import { BASELINE_FIRST_RUN_ROW, telemetryRows, writeConfigAt } from './helpers';

/** Injected fixture values — this runtime's Grok roster, one Claude name, one table-outside name. */
const GROK_WRITE = 'write';
const GROK_SEARCH_REPLACE = 'search_replace';
const GROK_RUN = 'run_terminal_command';
const CLAUDE_WRITE = 'Write';
const UNKNOWN_TOOL = 'server__tool';
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
const UNPROTECTED_FILE = 'notes/ordinary.txt';
/** The label runAdapterPath records under — the funnel supplement and payload faults. */
const ADAPTER_LABEL = 'adapter-claude-code';
const PRE_STATE = 'locked: yes\n';
const OLD_STRING = 'locked: yes';
const NEW_STRING = 'locked: no';

let repoRoot: string;
let telemetryPath: string;

/** Minimal valid config (languages is required) plus the caller's extra keys. */
function writeConfig(extra: Record<string, unknown>): void {
  writeConfigAt(repoRoot, telemetryPath, extra);
}

/** Every telemetry row as [event, label, subject]. */
const rows = () => telemetryRows(telemetryPath);

/**
 * Live Grok PreToolUse envelope: camelCase AND snake_case keys together, the same
 * Grok tool name in both name fields. Source: live grok -p, 2026-08-29.
 */
function grokPayload(grokName: string, toolInput: Record<string, unknown>): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: repoRoot,
    tool_name: grokName,
    toolName: grokName,
    tool_input: toolInput,
    toolInput,
  });
}

/** A Claude Write envelope: snake_case keys only, no Grok name and no camelCase twin. */
function claudeWritePayload(absoluteTarget: string, content = 'nothing special\n'): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: repoRoot,
    tool_name: CLAUDE_WRITE,
    tool_input: { file_path: absoluteTarget, content },
  });
}

function plantProtectedFile(): string {
  const target = join(repoRoot, PROTECTED_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, PRE_STATE);
  return target;
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-grok-names-'));
  telemetryPath = join(repoRoot, 'roi.log');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('Grok tool names reach the same axes as their Claude counterparts', () => {
  it('a Grok write targeting no protected path still exits 0 with one adapter passed row', async () => {
    // The over-blocking half: mapping write onto Write must not turn an ordinary file
    // into a witness trip. The row is the funnel supplement — a pass with NO row is the
    // defect class, and an unmapped write would also funnel-pass, so this pin is the
    // mapped implementation's "ordinary work still goes through" end.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: grokPayload(GROK_WRITE, {
        file_path: join(repoRoot, UNPROTECTED_FILE),
        content: 'nothing special\n',
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  });

  it('a Grok write targeting a protected file self-mod-blocks, subject = matched entry', async () => {
    // Without the map, `write` is not a mutating tool, so the adapter funnels a passed
    // row and the call sails through a protected path. After mapping, file-change
    // evidence must reach path judgment: the same blocked self-mod then passed
    // shell-mod shape the Claude Write case already pins. Exit 2 under the fail-closed
    // label would mean the mapper crashed rather than judged.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    const target = plantProtectedFile();

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: grokPayload(GROK_WRITE, { file_path: target, content: 'nothing special\n' }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });

  it('a Grok search_replace targeting a protected file with matching old_string self-mod-blocks', async () => {
    // search_replace is this runtime's Edit. Mapping it to Write would demand a `content`
    // field the live envelope does not carry; mapping it to Bash would land on the shell
    // axis with no `command`. The Edit row shape — blocked self-mod, passed shell-mod —
    // is what separates those from the right key.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    const target = plantProtectedFile();

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: grokPayload(GROK_SEARCH_REPLACE, {
        file_path: target,
        old_string: OLD_STRING,
        new_string: NEW_STRING,
        replace_all: false,
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });

  it('a Grok run_terminal_command mentioning a protected path without a read-only head shell-mod-blocks', async () => {
    // Without the map, `run_terminal_command` is not a shell tool, so the adapter
    // funnels a passed row. Mapping it to Write would mention-block on the tool axis
    // instead (blocked self-mod, passed shell-mod) — the shell-mod blocked row is what
    // proves the name landed on the shell axis. `echo` is not an allowlisted head.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    plantProtectedFile();

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: grokPayload(GROK_RUN, {
        command: `echo x >> ${PROTECTED_FILE}`,
        description: 'append to the protected file',
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['passed', 'self-mod', PROTECTED_ENTRY],
      ['blocked', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });

  it('a snake_case-only Grok write still self-mod-blocks a protected file', async () => {
    // The live envelope carries both keys, so a mapper that only reads `toolName` stays
    // green on the dual-key fixtures. A snake_case-only Grok envelope is the other end
    // of that axis — the same shape Claude already sends — and must still map.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    const target = plantProtectedFile();

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 's-1',
        cwd: repoRoot,
        tool_name: GROK_WRITE,
        tool_input: { file_path: target, content: 'nothing special\n' },
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });

  it('a Claude Write payload (snake_case only) still self-mod-blocks a protected file', async () => {
    // Write/Edit/Bash are not keys of the map, so a Claude envelope must pass through
    // untouched. A map that lowercases every name, or that uses Claude names as keys
    // pointing at something else, would drop this payload off the mutating roster and
    // funnel-pass a protected Write — the existing Claude fixtures going green would
    // not catch a Grok-only map that rewrites the names they already use.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    const target = plantProtectedFile();

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: claudeWritePayload(target),
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });

  it('a table-outside name still funnel-passes, never fail-closes', async () => {
    // MCP names are a declared limit: leave them unmapped, record the adapter
    // supplement, exit 0. A map that treats unknown names as a parse fault fail-closes
    // under the hook label. The args carry no protected path — a file_path under a
    // protected entry would path-match even unmapped, and the funnel row is the
    // contract the spec names for a name the table does not carry.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: grokPayload(UNKNOWN_TOOL, { query: 'status' }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  });
});
