/**
 * Virtual post-state parser (ADAPTER-02) — computes the file content *after* an
 * Edit/Write/MultiEdit payload would be applied, from `tool_input` alone.
 *
 * Pure computation only — no I/O, no process spawning. Reading the pre-state from
 * disk is the caller's job. Claude vocabulary (`old_string`/`new_string`/
 * `replace_all`) stays confined to this package, never the core.
 */

import { isPlainObject } from '@polydeukes/core';
import { parsePayloadEnvelope } from './payload-envelope.js';

/**
 * `VirtualPostState` — the result of computing one payload's post-state (PRD §3.1).
 *
 * Success carries the virtual file `{ filePath, content }`; failure carries a
 * human-readable `reason`. A failure is never silently replaced by the pre-state —
 * that would disguise the change as "no change" (a bypass vector, PRD §6).
 */
export type VirtualPostState =
  | { ok: true; value: { filePath: string; content: string } }
  | { ok: false; reason: string };

/**
 * Apply one `old_string` → `new_string` substitution to `content` (PRD §3.2).
 *
 * Preconditions mirror the Edit tool's own acceptance rules: non-empty `old_string`,
 * `old_string !== new_string`, and occurrence count exactly 1 (or ≥1 with
 * `replace_all`). Each rejection cause yields a distinguishable reason.
 */
function applyEdit(
  content: string,
  edit: Record<string, unknown>,
): { ok: true; content: string } | { ok: false; reason: string } {
  const { old_string: oldString, new_string: newString, replace_all: replaceAll } = edit;
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return { ok: false, reason: 'edit is missing a string old_string/new_string' };
  }
  if (oldString === '') {
    return { ok: false, reason: 'old_string is empty' };
  }
  if (oldString === newString) {
    return { ok: false, reason: 'old_string equals new_string' };
  }
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') {
    return { ok: false, reason: 'replace_all is not a boolean' };
  }

  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) {
    return { ok: false, reason: 'old_string does not occur in the pre-state' };
  }
  // Replacer functions insert newString literally — passing it as a plain string would
  // expand $-replacement patterns ($&, $$, $'), diverging from the real Edit tool.
  if (replaceAll === true) {
    return { ok: true, content: content.replaceAll(oldString, () => newString) };
  }
  if (occurrences > 1) {
    return { ok: false, reason: 'old_string occurs more than once without replace_all' };
  }
  return { ok: true, content: content.replace(oldString, () => newString) };
}

/**
 * Compute the virtual post-state of one Claude Code payload (pure, PRD §3.1).
 *
 * `preState` is the target file's current content, `null` when the file does not
 * exist. Never throws: any input that cannot be classified — a non-object payload,
 * a missing `tool_name`/`tool_input`/`file_path`, an unsatisfiable Edit, a partial
 * MultiEdit, or any tool other than Write/Edit/MultiEdit — resolves to
 * `{ ok: false, reason }` (fail-closed, PRD §4.2).
 */
export function virtualPostState(payload: unknown, preState: string | null): VirtualPostState {
  const envelope = parsePayloadEnvelope(payload);
  if (envelope.ok !== true) {
    return { ok: false, reason: envelope.reason };
  }

  const { toolName, toolInput } = envelope;
  if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') {
    return { ok: false, reason: `tool ${toolName} has no computable post-state` };
  }
  const filePath = toolInput.file_path;
  if (typeof filePath !== 'string') {
    return { ok: false, reason: 'tool_input is missing a string file_path' };
  }

  if (toolName === 'Write') {
    if (typeof toolInput.content !== 'string') {
      return { ok: false, reason: 'Write tool_input is missing a string content' };
    }
    return { ok: true, value: { filePath, content: toolInput.content } };
  }

  if (toolName === 'Edit') {
    if (preState === null) {
      return { ok: false, reason: 'Edit requires a non-null pre-state' };
    }
    const applied = applyEdit(preState, toolInput);
    if (applied.ok !== true) {
      return { ok: false, reason: applied.reason };
    }
    return { ok: true, value: { filePath, content: applied.content } };
  }

  // MultiEdit — the only tool left after the dispatch filter above.
  const edits = toolInput.edits;
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, reason: 'MultiEdit tool_input is missing a non-empty edits array' };
  }

  // Real-tool parity: MultiEdit creates a file when there is no pre-state and the
  // FIRST edit's old_string is empty — that edit seeds the content. Anywhere else an
  // empty old_string stays rejected by applyEdit.
  let content: string;
  let startIndex = 0;
  if (preState === null) {
    const first = edits[0];
    if (!isPlainObject(first) || first.old_string !== '' || typeof first.new_string !== 'string') {
      return {
        ok: false,
        reason:
          'MultiEdit requires a non-null pre-state unless the first edit creates the file (empty old_string)',
      };
    }
    content = first.new_string;
    startIndex = 1;
  } else {
    content = preState;
  }

  // Sequential application: edit N targets the result of edit N-1. Any failure
  // fails the whole call — a partial result must never leak (PRD §6).
  for (let index = startIndex; index < edits.length; index++) {
    const edit = edits[index];
    if (!isPlainObject(edit)) {
      return { ok: false, reason: `MultiEdit edit at index ${index} is not a non-null object` };
    }
    const applied = applyEdit(content, edit);
    if (applied.ok !== true) {
      return { ok: false, reason: `MultiEdit edit at index ${index} failed: ${applied.reason}` };
    }
    content = applied.content;
  }
  return { ok: true, value: { filePath, content } };
}
