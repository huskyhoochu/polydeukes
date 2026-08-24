/**
 * @polydeukes/adapter-git — up-translates a git staged diff into the agent-neutral
 * covenant input IR at commit time (ADAPTER-git §4.1).
 *
 * Pre-alpha. This module is the pure translation core — no I/O, no process spawning.
 * The tool-name constants are adapter-owned values (ADAPTER-01 precedent): the core
 * type stays literal-free, and this boundary is where git's vocabulary is translated
 * away before it reaches the core.
 */

import type { CovenantInput, FileChange } from '@polydeukes/core';

export {
  collectRangeChanges,
  collectStagedChanges,
  collectWorktreeChanges,
} from './collect.js';
export { type GitAdapterSettings, resolveGitAdapterSettings } from './settings.js';

/** Tool name a staged creation or modification surfaces as in the IR. */
export const STAGED_WRITE = 'staged-write';

/** Tool name a staged deletion surfaces as in the IR. */
export const STAGED_DELETE = 'staged-delete';

/**
 * `StagedChange` — one structured staged change (PRD §4.1).
 *
 * The collector fills it from a real repository; the translation core knows only this
 * shape. `pre` is the HEAD blob (`null` for a creation), `post` is the staged blob
 * (`null` for a deletion). A binary blob (no judgeable text) is also `null` on either
 * side — its toolCall survives for path judgment while no corrupted content reaches the
 * delta judges. Paths are repo-root-relative.
 *
 * The worktree and ref-range collectors fill this same shape from their own sources
 * (DIAG-01 §4.1) — every domain is one observation of the commit surface.
 */
export type StagedChange = {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  pre: string | null;
  post: string | null;
};

/**
 * Fold staged changes into one {@link CovenantInput} (pure, PRD §4.1 / CORE-06 §4.2).
 *
 * One `toolCall` per change in input order, each carrying its own union evidence:
 * `added` → `create`, `modified` → `modify`, `deleted` → `delete` — a deletion carries
 * evidence unconditionally (its optional `pre` baseline drops when the HEAD blob is
 * binary). Only a non-deletion whose staged content is unreadable (binary) gets no
 * evidence — that call stays unproven while its toolCall survives for path judgment.
 * The commit surface has no session, so `subagentSpawns`/`userMessages` are honestly
 * empty (CORE-04).
 */
export function covenantInputFromStagedChanges(changes: StagedChange[]): CovenantInput {
  const input: CovenantInput = {
    toolCalls: [],
    subagentSpawns: [],
    userMessages: [],
  };

  for (const change of changes) {
    const name = change.status === 'deleted' ? STAGED_DELETE : STAGED_WRITE;
    const evidence = stagedEvidence(change);
    input.toolCalls.push({
      name,
      args: { file_path: change.path },
      ...(evidence !== null && { fileChange: evidence }),
    });
  }

  return input;
}

/**
 * Tag one staged change as union evidence — `null` only when the staged content itself
 * is unavailable (a binary staged blob), leaving that call unproven.
 *
 * A deletion always carries evidence: the judgment needs no content, so an unreadable
 * (binary) HEAD blob merely drops the optional `pre` baseline. A `modified` change whose
 * HEAD blob is unreadable maps to `create` — an unreadable baseline forgives nothing, so
 * the whole staged content is judged as added (the same judgment main produced).
 */
function stagedEvidence(change: StagedChange): FileChange | null {
  if (change.status === 'deleted') {
    return change.pre === null
      ? { kind: 'delete', path: change.path }
      : { kind: 'delete', path: change.path, pre: change.pre };
  }
  if (change.post === null) return null;
  if (change.status === 'added' || change.pre === null) {
    return { kind: 'create', path: change.path, post: change.post };
  }
  return { kind: 'modify', path: change.path, pre: change.pre, post: change.post };
}
