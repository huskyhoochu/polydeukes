import { describe, expect, it } from 'vitest';
import { virtualPostState } from '../src/virtual-post-state.ts';

// Two dispositions this parser deliberately refuses to soften. A softer implementation
// could answer the untouched original when old_string never occurs, or an empty file when
// there is no pre-state; either substitution disguises a failed computation as a judgeable
// change. Both answer a named failure instead, and these fixtures pin the exact reason
// strings so a drift toward the softer answers goes red.

/** One Edit payload in the hook's envelope shape. */
function editPayload(toolInput: Record<string, unknown>) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/repo',
    tool_name: 'Edit',
    tool_input: toolInput,
  };
}

describe('virtualPostState — dispositions that never soften', () => {
  it('an Edit whose old_string never occurs answers a named failure — never the untouched original', () => {
    // The real Edit tool rejects this call, so there is no change to judge; echoing the
    // pre-state instead would disguise the call as "no change", a bypass vector.
    const result = virtualPostState(
      editPayload({ file_path: 'ledger.md', old_string: 'zzz', new_string: 'X' }),
      'a b a',
    );

    expect(result).toEqual({ ok: false, reason: 'old_string does not occur in the pre-state' });
  });

  it('an Edit with no pre-state answers a named failure — never a fabricated empty file', () => {
    // Substituting an empty string would compute a post-state for a file that does not
    // exist; no evidence is supplied, and the caller's fallback owns the call.
    const result = virtualPostState(
      editPayload({ file_path: 'ledger.md', old_string: 'a', new_string: 'b' }),
      null,
    );

    expect(result).toEqual({ ok: false, reason: 'Edit requires a non-null pre-state' });
  });
});
