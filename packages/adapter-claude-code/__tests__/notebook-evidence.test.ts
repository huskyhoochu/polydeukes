import { describe, expect, it } from 'vitest';
// NotebookEdit evidence is CELL-level: path = the notebook file, pre/post = the target
// cell's source before/after the edit. The evidence is not a reproduction of the
// serialized file, so a banned word in a cell is judged without JSON-escape noise.
import { collectFileChanges } from '../src/file-changes.ts';

// The measured NotebookEdit PreToolUse shape (live transcript, 2026-07-27):
// notebook_path and new_source are always present; edit_mode ∈ replace|insert|delete and
// DEFAULTS TO replace when absent; cell_id targets the cell (insert: the new cell lands
// after it, or at the notebook start when cell_id is absent); cell_type is required for
// insert only. The `changes[]` array shape in the published hook docs is stale — this is
// the payload the tool actually sends.

const NOTEBOOK_PATH = 'src/analysis.ipynb';
const NEW_SOURCE = "print('replaced by probe')";

/** nbformat 4.5, string-form sources; two cells so cell targeting is observable. */
const notebookJson = JSON.stringify({
  cells: [
    { id: 'cell-one', cell_type: 'code', source: "print('original')", metadata: {} },
    { id: 'cell-two', cell_type: 'markdown', source: '# heading', metadata: {} },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
});

/** nbformat also allows array-of-lines sources — each line already carries its `\n`. */
const arraySourceJson = JSON.stringify({
  cells: [
    { id: 'cell-one', cell_type: 'code', source: ['line one\n', 'line two\n'], metadata: {} },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
});

function notebookPayload(input: Record<string, unknown>) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/repo',
    tool_name: 'NotebookEdit',
    tool_input: { notebook_path: NOTEBOOK_PATH, ...input },
  };
}

/** A reader returning a fixed pre-state for the expected file, null otherwise. */
function readerFor(filePath: string, content: string | null): (fp: string) => string | null {
  return (fp: string) => (fp === filePath ? content : null);
}

const readNotebook = readerFor(NOTEBOOK_PATH, notebookJson);

describe('collectFileChanges — NotebookEdit cell evidence', () => {
  it('replace yields modify evidence with the target cell source as pre and new_source as post', () => {
    // Catches whole-notebook JSON standing in for the cell pre, and a lookup pinned to cells[0].
    const change = collectFileChanges(
      notebookPayload({ cell_id: 'cell-two', new_source: NEW_SOURCE, edit_mode: 'replace' }),
      readNotebook,
    );

    expect(change).toEqual({
      kind: 'modify',
      path: NOTEBOOK_PATH,
      pre: '# heading',
      post: NEW_SOURCE,
    });
  });

  it('an absent edit_mode defaults to replace', () => {
    // The measured payload may omit edit_mode; reading absence as an unknown mode would omit
    // evidence for the commonest form of the call.
    const change = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, cell_type: 'code' }),
      readNotebook,
    );

    expect(change).toEqual({
      kind: 'modify',
      path: NOTEBOOK_PATH,
      pre: "print('original')",
      post: NEW_SOURCE,
    });
  });

  it('insert after a cell yields modify evidence with an empty pre', () => {
    // An insert adds everything it writes — a pre borrowed from the anchor cell would
    // forgive content that duplicates the anchor.
    const change = collectFileChanges(
      notebookPayload({
        cell_id: 'cell-one',
        new_source: NEW_SOURCE,
        cell_type: 'code',
        edit_mode: 'insert',
      }),
      readNotebook,
    );

    expect(change).toEqual({ kind: 'modify', path: NOTEBOOK_PATH, pre: '', post: NEW_SOURCE });
  });

  it('insert without cell_id (notebook start) yields the same empty-pre evidence', () => {
    // An unconditional cell_id lookup would read the absent anchor as a missing cell and omit.
    const change = collectFileChanges(
      notebookPayload({ new_source: NEW_SOURCE, cell_type: 'code', edit_mode: 'insert' }),
      readNotebook,
    );

    expect(change).toEqual({ kind: 'modify', path: NOTEBOOK_PATH, pre: '', post: NEW_SOURCE });
  });

  it('delete yields modify evidence with an empty post even when new_source carries text', () => {
    // edit_mode governs the post: a delete collapsing into replace would judge the ignored
    // new_source as an addition.
    const change = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'delete' }),
      readNotebook,
    );

    expect(change).toEqual({
      kind: 'modify',
      path: NOTEBOOK_PATH,
      pre: "print('original')",
      post: '',
    });
  });

  it('joins an array-form cell source into the pre by concatenation', () => {
    // nbformat semantics: a '\n' join would double every line break; source[0] would truncate.
    const change = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'replace' }),
      readerFor(NOTEBOOK_PATH, arraySourceJson),
    );

    expect(change).toEqual({
      kind: 'modify',
      path: NOTEBOOK_PATH,
      pre: 'line one\nline two\n',
      post: NEW_SOURCE,
    });
  });
});

// Omission dispositions: evidence is omitted, never raised as an error — the mention
// fallback owns the call.

describe('collectFileChanges — NotebookEdit omission dispositions', () => {
  it('yields nothing in any mode when the notebook does not exist', () => {
    // Absence must omit evidence, never fabricate a create — the real tool rejects the edit.
    const reader = () => null;
    const replace = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'replace' }),
      reader,
    );
    const insert = collectFileChanges(
      notebookPayload({ new_source: NEW_SOURCE, cell_type: 'code', edit_mode: 'insert' }),
      reader,
    );
    const remove = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'delete' }),
      reader,
    );

    expect(replace).toBeNull();
    expect(insert).toBeNull();
    expect(remove).toBeNull();
  });

  it('yields nothing when cell_id names no cell in the notebook (replace and delete)', () => {
    // A cell miss must not fall back to another cell or to a whole-file pre.
    const replace = collectFileChanges(
      notebookPayload({ cell_id: 'cell-nine', new_source: NEW_SOURCE, edit_mode: 'replace' }),
      readNotebook,
    );
    const remove = collectFileChanges(
      notebookPayload({ cell_id: 'cell-nine', new_source: NEW_SOURCE, edit_mode: 'delete' }),
      readNotebook,
    );

    expect(replace).toBeNull();
    expect(remove).toBeNull();
  });

  it('yields nothing when the notebook content does not parse as JSON', () => {
    // Unparseable notebook text must not flow through as a raw-string pre.
    const change = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'replace' }),
      readerFor(NOTEBOOK_PATH, 'not json {'),
    );

    expect(change).toBeNull();
  });

  it('yields nothing for an unrecognized edit_mode', () => {
    // Only ABSENCE defaults to replace — an unknown mode is a guess, and evidence is never guessed.
    const change = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'append' }),
      readNotebook,
    );

    expect(change).toBeNull();
  });

  it('yields nothing when new_source is missing', () => {
    // The shared envelope check gates only tool_name/tool_input shape, so the NotebookEdit
    // branch itself must refuse a post it cannot state.
    const change = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', edit_mode: 'replace' }),
      readNotebook,
    );

    expect(change).toBeNull();
  });
});

describe('collectFileChanges — NotebookEdit malformed forms', () => {
  /** Parseable notebooks whose target cell carries a non-string source. */
  const numberSourceJson = JSON.stringify({
    cells: [{ id: 'cell-one', cell_type: 'code', source: 42, metadata: {} }],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  });
  const nullSourceJson = JSON.stringify({
    cells: [{ id: 'cell-one', cell_type: 'code', source: null, metadata: {} }],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  });

  it('yields nothing for an insert whose cell_type is absent', () => {
    // cell_type is required for insert, so the real tool refuses this call — and insert
    // evidence never reads cell_type, so a guessing branch would fabricate a judgment
    // for a mutation that will not happen.
    const change = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'insert' }),
      readNotebook,
    );

    expect(change).toBeNull();
  });

  it('yields nothing when the target cell source is a number or null', () => {
    // A String()-coerced pre ('42', 'null') would judge the added direction against text
    // no cell ever contained.
    const fromNumberSource = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'replace' }),
      readerFor(NOTEBOOK_PATH, numberSourceJson),
    );
    const fromNullSource = collectFileChanges(
      notebookPayload({ cell_id: 'cell-one', new_source: NEW_SOURCE, edit_mode: 'replace' }),
      readerFor(NOTEBOOK_PATH, nullSourceJson),
    );

    expect(fromNumberSource).toBeNull();
    expect(fromNullSource).toBeNull();
  });
});
