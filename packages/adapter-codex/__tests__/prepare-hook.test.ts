import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareHook } from '../src/prepare-hook.ts';

const TOOL = 'apply_patch';
const TARGET = 'nested.txt';
let repoRoot: string;
beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-prepare-')));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});
function payload(extra: Record<string, unknown> = {}) {
  const toolInput = {
    command: `*** Begin Patch\n*** Add File: ${TARGET}\n+new text\n*** End Patch\n`,
  };
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 'session-a',
    tool_name: TOOL,
    tool_input: toolInput,
    cwd: repoRoot,
    ...extra,
  });
}
function prepare(rawPayload: string) {
  return prepareHook({ repoRoot, rawPayload });
}

describe('prepareHook process-free input contract', () => {
  it('returns a judged create with the actual target and content without an npm installation', () => {
    // Dropping mutation evidence would make protected-path judgment fall back to mentions.
    const result = prepare(payload());
    expect(result).toMatchObject({
      outcome: 'check',
      input: {
        toolCalls: [
          { name: TOOL, fileChange: { kind: 'create', path: TARGET, post: 'new text\n' } },
        ],
      },
    });
  });
  it.each([
    ['absent', ''],
    ['cut JSON', '{"tool'],
    ['non-object', 'null'],
  ])('returns unavailable for %s input', (_name, raw) => {
    // Treating an incomplete envelope as an empty observation would fabricate permission.
    expect(prepare(raw)).toMatchObject({ outcome: 'unavailable', reason: expect.any(String) });
  });
  it('refuses an explicitly truncated envelope before making an IR', () => {
    // Complete JSON can still carry a host truncation marker.
    expect(prepare(payload({ truncated: true }))).toMatchObject({
      outcome: 'unavailable',
      reason: expect.any(String),
    });
  });
  it('allows future envelope fields without dropping consumed mutation evidence', () => {
    // Rejecting an unused host field would block every call after an additive host upgrade.
    const result = prepare(payload({ future_host_field: { version: 2 } }));
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ fileChange: { path: TARGET } }] },
    });
  });
  it('resolves a relative file against the event cwd before making it root relative', () => {
    // Root-anchoring a relative event path judges a different file from the host.
    mkdirSync(join(repoRoot, 'sub'));
    expect(prepare(payload({ cwd: join(repoRoot, 'sub') }))).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ fileChange: { path: `sub/${TARGET}` } }] },
    });
  });
  it('reports a pre-state read failure instead of claiming a creation', () => {
    // A directory at the target is unreadable file evidence, rather than a missing file.
    mkdirSync(join(repoRoot, TARGET));
    expect(prepare(payload())).toMatchObject({
      outcome: 'unavailable',
      reason: expect.any(String),
    });
  });
});

describe('prepareHook lifecycle provenance and session boundaries', () => {
  function lifecycle(event: string, fields: Record<string, unknown> = {}, session = 'session-a') {
    return prepare(
      JSON.stringify({ hook_event_name: event, session_id: session, cwd: repoRoot, ...fields }),
    );
  }
  function sessionInput(session = 'session-a') {
    const result = prepare(payload({ session_id: session }));
    expect(result.outcome).toBe('check');
    if (result.outcome !== 'check') throw new Error('expected observed input');
    return result.input.session;
  }
  it('records an unknown-source prompt without admitting it as human witness evidence', () => {
    // The event name and absence of a subagent marker cannot prove a human origin.
    expect(lifecycle('UserPromptSubmit', { prompt: 'open witness' })).toEqual({
      outcome: 'recorded',
    });
    expect(sessionInput()?.userMessages ?? []).toEqual([]);
  });
  it('keeps failed post-tool evidence distinct from successful precedent', () => {
    // Converting a failed call into succeeded grants history-dependent permissions.
    lifecycle('PostToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'false' },
      tool_response: { exit_code: 1 },
      success: false,
    });
    const calls = sessionInput()?.toolCalls ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.succeeded).not.toBe(true);
    expect(sessionInput('other-session')?.toolCalls ?? []).toEqual([]);
  });
  it('cleans the ended session while retaining another session history', () => {
    // A shared sidecar reset destroys unrelated active evidence.
    lifecycle('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'pwd' } });
    lifecycle(
      'PostToolUse',
      { tool_name: 'Bash', tool_input: { command: 'whoami' } },
      'other-session',
    );
    expect(lifecycle('SessionEnd')).toEqual({ outcome: 'recorded' });
    expect(sessionInput()?.toolCalls ?? []).toEqual([]);
    expect(sessionInput('other-session')?.toolCalls).toHaveLength(1);
  });
});

describe('prepareHook working-directory context', () => {
  it.each(['.', 'sub'])('carries shell cwd %s without rewriting the command', (directory) => {
    // Dropping cwd routes a relative redirect to a different file; rewriting command loses its evidence.
    const shellTool = 'Bash';
    const command = "printf 'literal ../text' > gate.txt";
    mkdirSync(join(repoRoot, 'sub'));
    const result = prepare(
      payload({
        cwd: join(repoRoot, directory),
        tool_name: shellTool,
        tool_input: { command },
      }),
    );
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ name: shellTool, cwd: directory, args: { command } }] },
    });
  });
});
