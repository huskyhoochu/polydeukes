/**
 * Delta layer — new-violation-only judgment over a file's pre/post pair
 * (COVENANT-05, PRD §4.1–4.4).
 *
 * The execution foundation of the delta-family predicate `forbid:{added}`:
 * pre-existing debt (matches already in pre) is forgiven, and only the matches
 * this edit adds are judged. Pure total functions — zero I/O, zero failure
 * branches; unresolvable post-states never reach this layer (PRD §4.4, the
 * caller's fail-closed responsibility).
 */

import type { CovenantVerdict } from '@polydeukes/core';

/** A file's content pair around an edit. `pre` is null when the file does not exist yet (creation edit). */
export type FileDelta = { pre: string | null; post: string };

/** Pattern-match multiset: matched string → occurrence count (PRD §4.2). */
export type Baseline = ReadonlyMap<string, number>;

/**
 * Extract every pattern-match occurrence in `content` as a multiset (PRD §4.2).
 *
 * `null` content (no file) yields an empty baseline, so on a creation edit
 * every post match counts as added. Matching runs on an internal clone that
 * guarantees the `g` flag — the caller's RegExp `lastIndex` is never read nor
 * written, so identical arguments always yield identical baselines (PRD §4.3).
 */
export function captureBaseline(content: string | null, pattern: RegExp): Baseline {
  const baseline = new Map<string, number>();
  if (content === null) return baseline;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);
  for (const match of content.matchAll(scanner)) {
    baseline.set(match[0], (baseline.get(match[0]) ?? 0) + 1);
  }
  return baseline;
}

/**
 * Symmetric multiset difference between two baselines (PRD §4.2).
 *
 * For each matched string the surplus is netted per direction as
 * `max(post − pre, 0)` into `added` and `max(pre − post, 0)` into `removed`;
 * the intersection cancels out and zero-count entries are never emitted.
 * Judgment consumes `added` only — `removed` is produced for later delta-family
 * predicates (COVENANT-12) and deliberately has no judge here.
 */
export function diffBaselines(
  pre: Baseline,
  post: Baseline,
): { added: Baseline; removed: Baseline } {
  const added = new Map<string, number>();
  const removed = new Map<string, number>();
  for (const [text, postCount] of post) {
    const surplus = postCount - (pre.get(text) ?? 0);
    if (surplus > 0) added.set(text, surplus);
  }
  for (const [text, preCount] of pre) {
    const surplus = preCount - (post.get(text) ?? 0);
    if (surplus > 0) removed.set(text, surplus);
  }
  return { added, removed };
}

/**
 * Judge a file edit on the added direction only (PRD §4.1–4.2).
 *
 * Breaks iff the edit adds at least one new match instance — the reason names
 * every added matched string, never the forgiven pre-existing debt. Deletions
 * and pure relocations uphold: `removed` does not participate in judgment.
 */
export function judgeAddedViolations(fileDelta: FileDelta, pattern: RegExp): CovenantVerdict {
  const { added } = diffBaselines(
    captureBaseline(fileDelta.pre, pattern),
    captureBaseline(fileDelta.post, pattern),
  );
  if (added.size === 0) return { upheld: true };
  return {
    upheld: false,
    reason: `edit adds new forbidden match(es): ${[...added.keys()].join(', ')}`,
  };
}
