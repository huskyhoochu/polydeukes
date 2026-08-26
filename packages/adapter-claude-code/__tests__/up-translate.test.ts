import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import { parseInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// Imported from the package entry point — the same surface the package publishes.
import { buildCovenantInput, type ClaudePreToolUsePayload, translateEvent } from '../src/index.ts';

// Realistic Claude Code PreToolUse hook payloads (snake_case). Agent/tool literals
// live here and in the adapter, never in core.

const editFixture: ClaudePreToolUsePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Edit',
  tool_input: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' },
};

const writeFixture: ClaudePreToolUsePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Write',
  tool_input: { file_path: 'src/new-file.ts', content: 'export const x = 1;' },
};

const taskFixture: ClaudePreToolUsePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Task',
  tool_input: { subagent_type: 'tdd-writer', prompt: 'write failing tests' },
};

describe('§5.1 fixture up-translate', () => {
  it('translates an Edit fixture into a toolCall carrying tool_input as args', () => {
    const result = translateEvent(editFixture);

    expect(result).toEqual({
      ok: true,
      kind: 'toolCall',
      value: { name: 'Edit', args: editFixture.tool_input },
    });
  });

  it('translates a Task fixture with subagent_type into a subagentSpawn, not a toolCall', () => {
    // The spawn kind comes from tool_input.subagent_type, not from tool_name.
    const result = translateEvent(taskFixture);

    expect(result).toEqual({
      ok: true,
      kind: 'subagentSpawn',
      value: { kind: 'tdd-writer' },
    });
  });

  it('buildCovenantInput folds Edit + Task + Write in observation order', () => {
    // Observation order is what a precedent judgment reads, so the fold must preserve it.
    const result = buildCovenantInput([editFixture, taskFixture, writeFixture]);

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toEqual({
        toolCalls: [
          { name: 'Edit', args: editFixture.tool_input },
          { name: 'Write', args: writeFixture.tool_input },
        ],
        subagentSpawns: [{ kind: 'tdd-writer' }],
        userMessages: [],
      });
    }
  });

  it('round-trips through JSON.stringify and core parseInput', () => {
    // The adapter's output crosses to the judge as stdin JSON, so a shape core's parser
    // rejects — or one that parses to something different — breaks the wire contract.
    const built = buildCovenantInput([editFixture, taskFixture, writeFixture]);
    expect(built.ok).toBe(true);
    if (built.ok !== true) return;

    const roundTripped = parseInput(JSON.stringify(built.value));

    expect(roundTripped.ok).toBe(true);
    if (roundTripped.ok === true) {
      expect(roundTripped.value).toEqual(built.value);
    }
  });
});

describe('§5.2 fail-closed axis (security boundary P0 — cannot classify = fail)', () => {
  it('translateEvent never throws and fails closed on non-object payloads', () => {
    // A hostile payload must never reach ok:true, and a throw escaping the function
    // would break the fail-closed guarantee just as surely.
    for (const hostile of ['not an object', null, []]) {
      let result: ReturnType<typeof translateEvent> | undefined;
      expect(() => {
        result = translateEvent(hostile);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
  });

  it('a payload missing tool_name fails classification', () => {
    const missingToolName = { tool_input: { file_path: 'src/app.ts' } };

    const result = translateEvent(missingToolName);

    expect(result.ok).toBe(false);
  });

  it('a payload missing tool_input fails classification', () => {
    // Missing tool_input must fail rather than default to {}.
    const missingToolInput = { tool_name: 'Edit' };

    const result = translateEvent(missingToolInput);

    expect(result.ok).toBe(false);
  });

  it('a Task fixture without subagent_type fails classification, never demoting to a toolCall', () => {
    // Falling through to a plain toolCall would silently lose the spawn evidence and let
    // a writer-less edit pass undetected.
    const taskWithoutSubagentType: ClaudePreToolUsePayload = {
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/repo',
      tool_name: 'Task',
      tool_input: { prompt: 'do something' },
    };

    const result = translateEvent(taskWithoutSubagentType);

    expect(result.ok).toBe(false);
  });

  it('buildCovenantInput fails closed with exit-2 and a non-empty reason if any element fails', () => {
    // Silently dropping the bad element is a bypass vector: the batch would be judged
    // as if the call it described had never happened.
    const malformed = { tool_name: 'Edit' }; // missing tool_input

    const result = buildCovenantInput([editFixture, malformed]);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.exitCode).toBe(2);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('§5.3 IR sufficiency — core judges from CovenantInput alone (PRD §4.3)', () => {
  // This test covenant imports ONLY core types — never the adapter's translate functions
  // or Claude Code vocabulary — so it proves all judgment-relevant evidence already lives
  // inside the IR that buildCovenantInput produces.

  const PRODUCTION_PREFIX = 'src/'; // test-injected value, not baked into core or adapter
  const REQUIRED_SPAWN_KIND = 'tdd-writer'; // test-injected value

  function judgeProductionEditsNeedWriterSpawn(input: CovenantInput): CovenantVerdict {
    const hasWriterSpawn = input.subagentSpawns.some((spawn) => spawn.kind === REQUIRED_SPAWN_KIND);
    const editsProductionPath = input.toolCalls.some((call) => {
      const filePath = call.args?.file_path;
      return typeof filePath === 'string' && filePath.startsWith(PRODUCTION_PREFIX);
    });

    if (editsProductionPath && !hasWriterSpawn) {
      return { upheld: false, reason: 'production edit without a preceding tdd-writer spawn' };
    }
    return { upheld: true };
  }

  it('an Edit-only input (no spawn) on a production path is NOT upheld', () => {
    const built = buildCovenantInput([editFixture]);
    expect(built.ok).toBe(true);
    if (built.ok !== true) return;

    const verdict = judgeProductionEditsNeedWriterSpawn(built.value);

    expect(verdict).toEqual({
      upheld: false,
      reason: 'production edit without a preceding tdd-writer spawn',
    });
  });

  it('a Task(tdd-writer) followed by an Edit on a production path IS upheld', () => {
    const built = buildCovenantInput([taskFixture, editFixture]);
    expect(built.ok).toBe(true);
    if (built.ok !== true) return;

    const verdict = judgeProductionEditsNeedWriterSpawn(built.value);

    expect(verdict).toEqual({ upheld: true });
  });
});
