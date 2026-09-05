/**
 * `source-names.ts` — the source names every world carries on its own.
 *
 * Both the declaration grammar and the mechanism catalogue read this list, so it lives
 * apart from either: the grammar refuses a `sources` binding that shadows one of them, and
 * the catalogue derives an axis from each — the change axis from the six that read the
 * change, the actor axis from `actor`.
 */

/** The source names the world supplies on its own; a `sources` entry may not shadow one. */
export const FIXED_SOURCE_NAMES = [
  'target.path',
  'pre',
  'post',
  'state',
  'changes',
  'command',
  'actor',
] as const;
