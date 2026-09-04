import { describe, expect, it } from 'vitest';
import { MUTATING_TOOLS, transcriptPathFromPayload } from '../src/session-vocabulary.ts';

// The transcript path is an injected fixture value, never a real session file: the
// function under test extracts a string and touches no filesystem.

const TRANSCRIPT_PATH = '/tmp/sessions/session-abc.jsonl';

/** A well-formed PreToolUse payload string carrying `overrides` on top of the envelope. */
function rawPayload(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: '/repo',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' },
    ...overrides,
  });
}

describe('session tool vocabulary — the adapter owns the literals', () => {
  it('exports MUTATING_TOOLS as exactly the four evidence-bearing mutating tools', () => {
    // The only defence for a dropped entry: judgeSelfModification skips a call
    // outright when mutatingNames.includes() is false, so a tool missing from this
    // array is judged by nobody. The repository carries zero MultiEdit payloads in any
    // suite, so no behavioral test would notice MultiEdit or NotebookEdit falling out
    // — that tool's writes into protected paths would pass unjudged.
    expect(MUTATING_TOOLS).toEqual(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  });
});

describe('transcriptPathFromPayload — evidence loss narrows to undefined', () => {
  it('extracts transcript_path from a well-formed payload', () => {
    // Reading the wrong envelope key, or extracting from the up-translated IR where
    // the field no longer exists, silently loses the valve's and the context family's
    // evidence channel on every payload — no exit code ever surfaces that.
    expect(
      transcriptPathFromPayload({ rawPayload: rawPayload({ transcript_path: TRANSCRIPT_PATH }) }),
    ).toBe(TRANSCRIPT_PATH);
  });

  it('returns undefined for a payload that is not JSON', () => {
    // The one failure shape the type system cannot refuse, since the input is already
    // a string. A JSON.parse throw escaping the function would fail the assembled hook
    // closed before dispatch, killing the witness valve and the dispatch that owns the
    // unparseable-payload verdict in one stroke: lost evidence must close the valve,
    // never the hook.
    expect(transcriptPathFromPayload({ rawPayload: 'PreToolUse{ not json' })).toBeUndefined();
  });
});
