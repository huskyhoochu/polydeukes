/**
 * @polydeukes/adapter-git — up-translates a git staged diff into the agent-neutral
 * covenant input IR at commit time (ADAPTER-git §4.1).
 *
 * Pre-alpha. This module is the pure translation core — no I/O, no process spawning.
 * The tool-name constants are adapter-owned values (ADAPTER-01 precedent): the core
 * type stays literal-free, and this boundary is where git's vocabulary is translated
 * away before it reaches the core.
 */

import type { CovenantInput } from '@polydeukes/core';

export { collectStagedChanges } from './collect.js';

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
 */
export type StagedChange = {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  pre: string | null;
  post: string | null;
};

/**
 * Fold staged changes into one {@link CovenantInput} (pure, PRD §4.1).
 *
 * One `toolCall` per change in input order; `fileChanges` pairs pre/post for writes
 * only — a deletion has no post content, so its element is omitted while its toolCall
 * survives (ADAPTER-04 "unsatisfiable element omitted"). The commit surface has no
 * session, so `subagentSpawns`/`userMessages` are honestly empty (CORE-04).
 */
export function covenantInputFromStagedChanges(changes: StagedChange[]): CovenantInput {
  const input: CovenantInput = {
    toolCalls: [],
    subagentSpawns: [],
    userMessages: [],
    fileChanges: [],
  };

  for (const change of changes) {
    const name = change.status === 'deleted' ? STAGED_DELETE : STAGED_WRITE;
    input.toolCalls.push({ name, args: { file_path: change.path } });
    if (change.status !== 'deleted' && change.post !== null) {
      input.fileChanges?.push({ path: change.path, pre: change.pre, post: change.post });
    }
  }

  return input;
}
