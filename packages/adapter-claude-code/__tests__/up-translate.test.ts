import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import { parseInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// ADAPTER-01. Import from the package entry point (src/index.ts) — the same
// surface that `@polydeukes/adapter-claude-code` will publish.
import { buildCovenantInput, type ClaudePreToolUsePayload, translateEvent } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — realistic Claude Code PreToolUse hook payloads (snake_case, PRD §4.1).
// Agent/tool literals live in this test file and in the adapter — never in core.
// ---------------------------------------------------------------------------

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
    // Mutation caught: kind swapped to subagentSpawn, name dropped, or args stripped.
    const result = translateEvent(editFixture);

    expect(result).toEqual({
      ok: true,
      kind: 'toolCall',
      value: { name: 'Edit', args: editFixture.tool_input },
    });
  });

  it('translates a Task fixture with subagent_type into a subagentSpawn, not a toolCall', () => {
    // Mutation caught: Task demoted to a plain toolCall (spawn evidence silently lost),
    // or kind picked from tool_name instead of tool_input.subagent_type.
    const result = translateEvent(taskFixture);

    expect(result).toEqual({
      ok: true,
      kind: 'subagentSpawn',
      value: { kind: 'tdd-writer' },
    });
  });

  it('buildCovenantInput folds Edit + Task + Write in observation order', () => {
    // Mutation caught: order not preserved, subagentSpawns/toolCalls arrays swapped or
    // merged, userMessages not fixed to [].
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
    // Proves stdin-JSON compatibility with CORE-01's protocol (PRD §5.1 last bullet).
    // Mutation caught: buildCovenantInput producing a shape parseInput rejects, or a
    // shape that parses but does not deep-equal the original built value.
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
    // Mutation caught: a typeof/Array.isArray check removed, letting a hostile payload
    // through as ok:true, or an unhandled throw escaping the function.
    for (const hostile of ['not an object', null, []]) {
      let result: ReturnType<typeof translateEvent> | undefined;
      expect(() => {
        result = translateEvent(hostile);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
  });

  it('a payload missing tool_name fails classification', () => {
    // Mutation caught: tool_name presence check dropped, defaulting to undefined-as-name.
    const missingToolName = { tool_input: { file_path: 'src/app.ts' } };

    const result = translateEvent(missingToolName);

    expect(result.ok).toBe(false);
  });

  it('a payload missing tool_input fails classification', () => {
    // Mutation caught: tool_input presence check dropped, defaulting to {} silently.
    const missingToolInput = { tool_name: 'Edit' };

    const result = translateEvent(missingToolInput);

    expect(result.ok).toBe(false);
  });

  it('a Task fixture without subagent_type fails classification, never demoting to a toolCall', () => {
    // P0: Task without subagent_type must NOT be demoted to a plain toolCall — that
    // would silently lose spawn evidence and let a writer-less edit through undetected.
    // Mutation caught: the subagent_type check removed, falling through to toolCall.
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
    // P0: a single malformed payload in the batch must block the whole build, not be
    // silently dropped (a silent drop is a bypass vector, per PRD §4.2/§7).
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
  // This test covenant imports ONLY core types — never the adapter's translate
  // functions or Claude Code vocabulary — proving all judgment-relevant evidence
  // already lives inside the IR that buildCovenantInput produces.

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
    // Mutation caught: the covenant's spawn check inverted or removed, always upholding.
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
    // Mutation caught: the covenant ignoring subagentSpawns entirely, or requiring
    // spawn kind to equal something other than the injected REQUIRED_SPAWN_KIND.
    const built = buildCovenantInput([taskFixture, editFixture]);
    expect(built.ok).toBe(true);
    if (built.ok !== true) return;

    const verdict = judgeProductionEditsNeedWriterSpawn(built.value);

    expect(verdict).toEqual({ upheld: true });
  });
});
