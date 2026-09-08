/**
 * Virtual post-state parser — computes the file content after a `write` or
 * `search_replace` payload would be applied, from the tool input alone.
 *
 * Pure computation only — no I/O, no process spawning. Reading the pre-state from
 * disk is the caller's job. Host vocabulary (`old_string`/`new_string`/`replace_all`)
 * stays confined to this package, never the core.
 */

import { parsePayloadEnvelope } from './payload-envelope.ts';

/**
 * `VirtualPostState` — the result of computing one payload's post-state.
 *
 * Success carries the virtual file `{ filePath, content }`; failure carries a
 * human-readable `reason`. A failure is never silently replaced by the pre-state —
 * that would disguise the change as "no change", a bypass vector.
 */
export type VirtualPostState =
  | { ok: true; value: { filePath: string; content: string } }
  | { ok: false; reason: string };

/**
 * Apply one `old_string` → `new_string` substitution to `content`.
 *
 * Preconditions mirror the host tool's own acceptance rules: non-empty `old_string`,
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
  // expand $-replacement patterns ($&, $$, $'), diverging from the host tool.
  if (replaceAll === true) {
    return { ok: true, content: content.replaceAll(oldString, () => newString) };
  }
  if (occurrences > 1) {
    return { ok: false, reason: 'old_string occurs more than once without replace_all' };
  }
  return { ok: true, content: content.replace(oldString, () => newString) };
}

/**
 * Compute the virtual post-state of one Grok payload (pure).
 *
 * `preState` is the target file's current content, `null` when the file does not
 * exist. Never throws: any input that cannot be classified — a non-object payload,
 * a missing name or input or `file_path`, an unsatisfiable substitution, or any
 * tool other than `write`/`search_replace` — resolves to `{ ok: false, reason }`.
 */
export function virtualPostState(payload: unknown, preState: string | null): VirtualPostState {
  const envelope = parsePayloadEnvelope(payload);
  if (envelope.ok !== true) {
    return { ok: false, reason: envelope.reason };
  }

  const { toolName, toolInput } = envelope;
  const filePath = toolInput.file_path;
  if (typeof filePath !== 'string') {
    return { ok: false, reason: 'toolInput is missing a string file_path' };
  }

  if (toolName === 'write') {
    if (typeof toolInput.content !== 'string') {
      return { ok: false, reason: 'write toolInput is missing a string content' };
    }
    return { ok: true, value: { filePath, content: toolInput.content } };
  }

  if (toolName === 'search_replace') {
    if (preState === null) {
      return { ok: false, reason: 'search_replace requires a non-null pre-state' };
    }
    const applied = applyEdit(preState, toolInput);
    if (applied.ok !== true) {
      return { ok: false, reason: applied.reason };
    }
    return { ok: true, value: { filePath, content: applied.content } };
  }

  return { ok: false, reason: `tool ${toolName} has no computable post-state` };
}
