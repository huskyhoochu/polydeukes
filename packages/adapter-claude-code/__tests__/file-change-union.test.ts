import { describe, expect, it } from 'vitest';
// The session adapter tags its evidence with the union: pre === null → create, else modify.
import { collectFileChanges } from '../src/file-changes.ts';

const writePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Write',
  tool_input: { file_path: 'src/new-file.ts', content: 'export const x = 1;' },
};

/** A reader returning a fixed pre-state for the expected file, null otherwise. */
function readerFor(filePath: string, content: string | null): (fp: string) => string | null {
  return (fp: string) => (fp === filePath ? content : null);
}

describe('collectFileChanges — union tagging', () => {
  it('tags a Write with no pre-state (reader returns null) as kind create with no pre field', () => {
    // Absence of a file IS the create discriminant. Catches an untagged flat shape,
    // which downstream switches cannot judge, and a leftover pre:null sentinel riding
    // the create variant — toEqual rejects a defined null field.
    const change = collectFileChanges(writePayload, () => null);

    expect(change).toEqual({
      kind: 'create',
      path: 'src/new-file.ts',
      post: 'export const x = 1;',
    });
  });

  it('tags a Write over existing content as kind modify carrying both the pre and the post', () => {
    // A real pre-state makes the SAME payload a modify — the discriminant is the
    // evidence, not the tool. Existing content tagged create would let an immutable
    // discipline uphold an overwrite as first authoring.
    const change = collectFileChanges(
      writePayload,
      readerFor('src/new-file.ts', 'export const seed = 1;'),
    );

    expect(change).toEqual({
      kind: 'modify',
      path: 'src/new-file.ts',
      pre: 'export const seed = 1;',
      post: 'export const x = 1;',
    });
  });
});
