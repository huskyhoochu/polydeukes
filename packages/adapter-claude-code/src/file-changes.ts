/**
 * File-change evidence computation (COVENANT-10 §4.3) — turns one Edit/Write/MultiEdit
 * payload into the agent-neutral `FileChange` evidence the discipline layer judges.
 *
 * Pure translation: pre-state comes through an injected reader (disk is the caller's
 * choice), post-state through `virtualPostState`. An unresolvable post-state OMITS the
 * element (the specified disposition, PRD §4.3 — the real tool rejects the same edit,
 * so there is no change to judge); non-mutating tools and unparseable envelopes yield
 * an empty array, never an error.
 */

import type { FileChange } from '@polydeukes/core';
import { parsePayloadEnvelope } from './payload-envelope.js';
import { virtualPostState } from './virtual-post-state.js';

/** The tools whose post-state is computable — the only fileChanges contributors. */
const MUTATING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);

/**
 * Collect the file-change evidence of one raw PreToolUse payload (COVENANT-10 §4.3).
 *
 * `readPreState` returns the target file's current content, `null` when it does not
 * exist — that absence IS the union discriminant (CORE-06 §4.2): no pre-state tags a
 * `create`, an existing one a `modify` (these tools cannot delete). Evidence is
 * singular like its IR home (`toolCall.fileChange`): one payload proves at most one
 * change, and `null` means nothing provable.
 */
export function collectFileChanges(
  rawPayload: unknown,
  readPreState: (filePath: string) => string | null,
): FileChange | null {
  const envelope = parsePayloadEnvelope(rawPayload);
  if (envelope.ok !== true) return null;
  if (!MUTATING_TOOLS.has(envelope.toolName)) return null;
  const filePath = envelope.toolInput.file_path;
  if (typeof filePath !== 'string') return null;

  const pre = readPreState(filePath);
  const post = virtualPostState(rawPayload, pre);
  if (post.ok !== true) return null;
  return pre === null
    ? { kind: 'create', path: filePath, post: post.value.content }
    : { kind: 'modify', path: filePath, pre, post: post.value.content };
}
