/**
 * File-change evidence computation — turns one Edit/Write/MultiEdit/NotebookEdit
 * payload into the agent-neutral `FileChange` evidence the discipline layer judges.
 *
 * Pure translation: pre-state comes through an injected reader (disk is the caller's
 * choice), post-state through `virtualPostState`. An unresolvable post-state OMITS the
 * element — the real tool rejects the same edit, so there is no change to judge;
 * non-mutating tools and unparseable envelopes yield an empty array, never an error.
 */

import type { FileChange } from '@polydeukes/core';
import { isPlainObject } from '@polydeukes/core';
import { parsePayloadEnvelope } from './payload-envelope.js';
import { virtualPostState } from './virtual-post-state.js';

/** The tools whose post-state is computable — the only fileChanges contributors. */
const MUTATING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The notebook's cells, `null` when the pre-state does not parse as a notebook. */
function parseNotebookCells(content: string): unknown[] | null {
  let notebook: unknown;
  try {
    notebook = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isPlainObject(notebook) || !Array.isArray(notebook.cells)) return null;
  return notebook.cells;
}

/**
 * The source text of the cell `cellId` names — `null` when no cell carries that id or
 * its source is neither spelling nbformat allows. An array source joins as-is: each
 * line already carries its own newline, so a '\n' join would double every break.
 */
function cellSource(cells: unknown[], cellId: unknown): string | null {
  if (typeof cellId !== 'string') return null;
  const cell = cells.find((entry) => isPlainObject(entry) && entry.id === cellId);
  if (!isPlainObject(cell)) return null;
  const { source } = cell;
  if (typeof source === 'string') return source;
  return Array.isArray(source) ? source.join('') : null;
}

/**
 * Cell-level evidence for one NotebookEdit payload.
 *
 * The judged quantity is the target CELL's source, not the notebook's serialization:
 * `path` names the notebook while `pre`/`post` carry the cell's text, so a banned word
 * in a cell is judged without JSON-escape noise. `edit_mode` governs the pair — absent
 * means `replace`, an `insert` adds everything it writes (empty `pre`), and a cell
 * `delete` removes all of it (empty `post`, whatever `new_source` carries).
 *
 * Every form the real tool would reject or this adapter cannot read — a missing or
 * unparseable notebook, an unnamed cell, an unrecognized mode, an `insert` without the
 * `cell_type` it requires, a cell source that is not text — OMITS the evidence instead
 * of guessing one, and the mention fallback owns the call.
 */
function collectNotebookChange(
  toolInput: Record<string, unknown>,
  readPreState: (filePath: string) => string | null,
): FileChange | null {
  const notebookPath = toolInput.notebook_path;
  if (typeof notebookPath !== 'string') return null;
  const newSource = toolInput.new_source;
  if (typeof newSource !== 'string') return null;

  const preState = readPreState(notebookPath);
  if (preState === null) return null;
  const cells = parseNotebookCells(preState);
  if (cells === null) return null;

  const editMode = toolInput.edit_mode ?? 'replace';
  if (editMode === 'insert') {
    if (typeof toolInput.cell_type !== 'string') return null;
    return { kind: 'modify', path: notebookPath, pre: '', post: newSource };
  }
  if (editMode !== 'replace' && editMode !== 'delete') return null;

  const pre = cellSource(cells, toolInput.cell_id);
  if (pre === null) return null;
  return {
    kind: 'modify',
    path: notebookPath,
    pre,
    post: editMode === 'delete' ? '' : newSource,
  };
}

/**
 * Collect the file-change evidence of one raw PreToolUse payload.
 *
 * `readPreState` returns the target file's current content, `null` when it does not
 * exist — that absence IS the union discriminant: no pre-state tags a `create`, an
 * existing one a `modify` (these tools cannot delete). Evidence is
 * singular like its IR home (`toolCall.fileChange`): one payload proves at most one
 * change, and `null` means nothing provable. NotebookEdit names its target differently
 * and proves a cell rather than a file, so it branches into its own computation.
 */
export function collectFileChanges(
  rawPayload: unknown,
  readPreState: (filePath: string) => string | null,
): FileChange | null {
  const envelope = parsePayloadEnvelope(rawPayload);
  if (envelope.ok !== true) return null;
  if (!MUTATING_TOOLS.has(envelope.toolName)) return null;
  if (envelope.toolName === 'NotebookEdit') {
    return collectNotebookChange(envelope.toolInput, readPreState);
  }
  const filePath = envelope.toolInput.file_path;
  if (typeof filePath !== 'string') return null;

  const pre = readPreState(filePath);
  const post = virtualPostState(rawPayload, pre);
  if (post.ok !== true) return null;
  return pre === null
    ? { kind: 'create', path: filePath, post: post.value.content }
    : { kind: 'modify', path: filePath, pre, post: post.value.content };
}
