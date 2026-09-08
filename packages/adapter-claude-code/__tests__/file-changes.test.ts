import { describe, expect, it } from 'vitest';
import { collectFileChanges } from '../src/file-changes.ts';

// Realistic Claude Code PreToolUse payloads (snake_case). Claude vocabulary
// (old_string / new_string) lives here and in the adapter, never in core.

const editPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Edit',
  tool_input: { file_path: 'src/app.ts', old_string: 'alpha', new_string: 'beta' },
};

const writePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Write',
  tool_input: { file_path: 'src/new-file.ts', content: 'export const x = 1;' },
};

const multiEditPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'MultiEdit',
  tool_input: {
    file_path: 'src/seq.ts',
    edits: [
      { old_string: 'one', new_string: 'two' },
      { old_string: 'two', new_string: 'three' },
    ],
  },
};

const bashPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf /tmp/x' },
};

/** A reader returning a fixed pre-state for the expected file, null otherwise. */
function readerFor(filePath: string, content: string | null): (fp: string) => string | null {
  return (fp: string) => (fp === filePath ? content : null);
}

describe('collectFileChanges — Write', () => {
  it('produces create evidence for a new file (reader returns null)', () => {
    // Absence of a file is the create discriminant. Tagging it modify opens a
    // debt-forgiveness hole downstream.
    const change = collectFileChanges(writePayload, () => null);

    expect(change).toEqual({
      kind: 'create',
      path: 'src/new-file.ts',
      post: 'export const x = 1;',
    });
  });
});

describe('collectFileChanges — MultiEdit', () => {
  it('applies edits sequentially so the post reflects all edits', () => {
    // The 2nd edit targets the 1st edit's result, so edits applied against pre
    // independently would yield 'value = two'.
    const change = collectFileChanges(multiEditPayload, readerFor('src/seq.ts', 'value = one'));

    expect(change).toEqual({
      kind: 'modify',
      path: 'src/seq.ts',
      pre: 'value = one',
      post: 'value = three',
    });
  });
});

describe('collectFileChanges — omission of unresolvable post-state', () => {
  it('yields nothing when the Edit old_string is absent from pre (null, not an error)', () => {
    // An Edit whose virtual application fails omits evidence — it is neither an error
    // nor a fabricated post.
    const change = collectFileChanges(editPayload, readerFor('src/app.ts', 'no match here'));

    expect(change).toBeNull();
  });
});

describe('collectFileChanges — non-mutating payloads', () => {
  it('returns null for a Bash payload', () => {
    // A non-file-mutating tool contributes no evidence — there is no file to judge.
    expect(collectFileChanges(bashPayload, () => null)).toBeNull();
  });
});
