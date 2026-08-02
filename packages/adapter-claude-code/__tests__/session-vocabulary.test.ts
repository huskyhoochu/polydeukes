import { describe, expect, it } from 'vitest';
// DIST-01 §3-b RED phase. The session surface's Claude Code tool vocabulary moves out
// of the repository hook (a file no other project can import) into this adapter — the
// adapter owns its surface's tool names and assembly consumes them, exactly as
// adapter-git owns STAGED_WRITE/STAGED_DELETE. None of these exports exist yet, so
// this file fails at import by construction.
//
// AUDIT disposition (approved): SHELL_TOOLS/COMMAND_ARGS value pins were dropped —
// assembly.e2e.test.ts covers both behaviorally (the sed -i shell-mod block, the
// read-only allowlist pass), which is stronger than a constant equality and runs on
// every suite. The transcriptPathFromPayload failure axes were cut to the one no
// producer emits and no type check covers (a non-JSON string); null/array/absent/
// non-string narrowing is what the strict `unknown` handling the compiler demands
// already enforces. What remains is exactly what nothing else defends.
import { MUTATING_TOOLS, transcriptPathFromPayload } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — realistic Claude Code PreToolUse payload strings (snake_case). The
// transcript path is an injected fixture value, never a real session file: the
// function under test extracts a string and touches no filesystem.
// ---------------------------------------------------------------------------

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

describe('DIST-01 §3-b session tool vocabulary — the adapter owns the literals', () => {
  it('exports MUTATING_TOOLS as exactly the four evidence-bearing mutating tools', () => {
    // P0, and the ONLY defence for a dropped entry: judgeSelfModification skips a call
    // outright when mutatingNames.includes() is false, so a tool missing from this
    // array is judged by nobody — and the repository carries ZERO MultiEdit payloads
    // in any suite, so no behavioral test would ever notice MultiEdit (or
    // NotebookEdit) falling out. Mutation caught: one tool dropped — that tool's
    // writes into protected paths pass unjudged, fail-open with no failing test but
    // this one.
    expect(MUTATING_TOOLS).toEqual(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  });
});

describe('DIST-01 §3-b transcriptPathFromPayload — evidence loss narrows to undefined', () => {
  it('extracts transcript_path from a well-formed payload', () => {
    // Mutation caught: the wrong envelope key read (transcriptPath), or extraction
    // moved onto the up-translated IR where the field no longer exists — either way
    // the valve and the context family would silently lose their evidence channel on
    // EVERY payload, which no fail-closed exit code ever surfaces.
    expect(transcriptPathFromPayload(rawPayload({ transcript_path: TRANSCRIPT_PATH }))).toBe(
      TRANSCRIPT_PATH,
    );
  });

  it('returns undefined for a payload that is not JSON', () => {
    // The one failure shape the type system cannot refuse (the input is already a
    // string). Mutation caught: the JSON.parse throw escaping the function — the
    // assembled hook would fail closed before dispatch, killing the witness valve AND
    // the dispatch that owns the unparseable-payload verdict (one adapter blocked
    // record) in the same stroke: lost evidence must close the valve, never the hook
    // (ADAPTER-04 §4.4).
    expect(transcriptPathFromPayload('PreToolUse{ not json')).toBeUndefined();
  });
});
