import { createHash } from 'node:crypto';
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
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareHook } from '../src/prepare-hook.ts';

const SESSION_ID = '../../host/session:one';
const OTHER_SESSION_ID = 'host-session-two';
const PROMPT = 'pdks witness\ncontinue';
const RECEIVED_AT_MS = 1_788_000_000_000;
let repoRoot: string;
beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-codex-session-evidence-')));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});
function evidencePath(sessionId = SESSION_ID) {
  return join(
    repoRoot,
    '.polydeukes',
    'codex-sessions',
    `${createHash('sha256').update(sessionId).digest('hex')}.jsonl`,
  );
}
function invoke(payload: Record<string, unknown>) {
  return prepareHook({ repoRoot, rawPayload: JSON.stringify(payload) });
}
function lifecycle(event: string, fields: Record<string, unknown> = {}, sessionId = SESSION_ID) {
  return invoke({ hook_event_name: event, session_id: sessionId, ...fields });
}
function observation(sessionId = SESSION_ID) {
  return invoke({
    cwd: repoRoot,
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    tool_name: 'apply_patch',
    tool_input: { command: '*** Begin Patch\n*** Add File: target.txt\n+text\n*** End Patch\n' },
    transcript_path: join(repoRoot, 'unstable-transcript.jsonl'),
  });
}
function input(sessionId = SESSION_ID) {
  const result = observation(sessionId);
  expect(result.outcome).toBe('check');
  if (result.outcome !== 'check') throw new Error('expected observed input');
  return result.input;
}

describe('prepareHook lifecycle evidence storage', () => {
  it('keeps an unknown-source prompt out of human witness evidence', () => {
    // A raw session filename permits traversal; an event name alone cannot authenticate origin.
    expect(lifecycle('UserPromptSubmit', { prompt: PROMPT })).toEqual({ outcome: 'recorded' });
    expect(evidencePath()).not.toContain(SESSION_ID);
    expect(input().session?.userMessages).toEqual([]);
  });
  it('keeps tool order and plain-object arguments without inventing success', () => {
    // The observed response does not prove a successful precedent.
    expect(
      lifecycle('PostToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'pwd' },
        tool_response: { output: repoRoot },
      }),
    ).toEqual({ outcome: 'recorded' });
    expect(
      lifecycle('PostToolUse', { tool_name: 'apply_patch', tool_input: { command: 'patch' } }),
    ).toEqual({ outcome: 'recorded' });
    expect(input().session?.toolCalls).toEqual([
      { name: 'Bash', args: { command: 'pwd' } },
      { name: 'apply_patch', args: { command: 'patch' } },
    ]);
    expect(input().session?.toolCalls.every((call) => !('succeeded' in call))).toBe(true);
  });
  it('supplies an empty named session without invented actor or channels', () => {
    const ir = input();
    expect(ir.session).toEqual({ evidencePath: evidencePath(), userMessages: [], toolCalls: [] });
    expect('actor' in ir).toBe(false);
    expect('channels' in (ir.session ?? {})).toBe(false);
  });
  it('deletes only its hashed session file and accepts repeated cleanup', () => {
    lifecycle('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'pwd' } });
    lifecycle(
      'PostToolUse',
      { tool_name: 'Bash', tool_input: { command: 'whoami' } },
      OTHER_SESSION_ID,
    );
    expect(lifecycle('SessionEnd')).toEqual({ outcome: 'recorded' });
    expect(existsSync(evidencePath())).toBe(false);
    expect(existsSync(evidencePath(OTHER_SESSION_ID))).toBe(true);
    expect(lifecycle('SessionEnd')).toEqual({ outcome: 'recorded' });
  });
  it('keeps resumed history separate from another session', () => {
    lifecycle('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'pwd' } });
    expect(input().session?.toolCalls).toHaveLength(1);
    expect(input(OTHER_SESSION_ID).session?.toolCalls).toEqual([]);
    expect(input().session?.toolCalls).toHaveLength(1);
  });
  it('never reads the transcript as evidence', () => {
    // A transcript may contain convincing human text but is outside Codex stable events.
    writeFileSync(
      join(repoRoot, 'unstable-transcript.jsonl'),
      JSON.stringify({
        origin: { kind: 'human' },
        type: 'user',
        message: { role: 'user', content: PROMPT },
        timestamp: new Date(RECEIVED_AT_MS).toISOString(),
      }),
    );
    expect(input().session?.userMessages).toEqual([]);
  });
});

describe('prepareHook lifecycle evidence failures', () => {
  it('reports a failed append as unavailable', () => {
    writeFileSync(join(repoRoot, '.polydeukes'), 'not a directory');
    expect(
      lifecycle('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'pwd' } }),
    ).toMatchObject({
      outcome: 'unavailable',
      reason: expect.stringMatching(/session|ENOTDIR|directory/i),
    });
  });
  it.skipIf(process.getuid?.() === 0)(
    'reports failed cleanup while keeping the session file',
    () => {
      const sessionsDir = dirname(evidencePath());
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(evidencePath(), `${JSON.stringify({ kind: 'tool', name: 'Bash' })}\n`);
      chmodSync(sessionsDir, 0o500);
      try {
        expect(lifecycle('SessionEnd')).toMatchObject({
          outcome: 'unavailable',
          reason: expect.any(String),
        });
        expect(existsSync(evidencePath())).toBe(true);
      } finally {
        chmodSync(sessionsDir, 0o700);
      }
    },
  );
  it('keeps a corrupt record unavailable rather than supplying empty history', () => {
    mkdirSync(dirname(evidencePath()), { recursive: true });
    writeFileSync(evidencePath(), '{not-json}\n');
    expect(observation()).toMatchObject({
      outcome: 'unavailable',
      reason: expect.stringMatching(/session|json|record/i),
    });
  });
});

it('reports scalar post-tool input as unavailable without recording invented arguments', () => {
  expect(
    lifecycle('PostToolUse', { tool_name: 'apply_patch', tool_input: 'opaque' }),
  ).toMatchObject({ outcome: 'unavailable', reason: expect.any(String) });
  expect(input().session?.toolCalls).toEqual([]);
});
