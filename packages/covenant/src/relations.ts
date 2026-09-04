/**
 * The seven relations, each answering a witness list rather than a boolean: an empty list
 * means the relation holds, and every other list names the elements that broke it, in the
 * order the extraction supplied them. No relation sorts or deduplicates, because the two
 * surfaces that read a judgment agree on the witness order only if it is the input's.
 *
 * `empty`, `subset` and `ordered` are written directly; the other four are expansions over
 * them — `nonEmpty` is the negation of `empty`, `equal` is `subset` in both directions,
 * `implies` is `subset` of the two key projections, and `unchanged` is `equal` over the keys
 * the two states share.
 */

import { canonical, comparatorFor, type Items, sameValue } from './extract-steps.js';

/** One element for which a relation does not hold; `side` is `equal`'s two directions. */
export type Witness = {
  readonly key: string;
  readonly value: unknown;
  readonly side?: 'left' | 'right';
};

/** The pre value behind an `unchanged` witness, for the message that reports the change. */
export type WitnessWithBefore = Witness & { readonly before?: unknown };

/** Every item is a witness: the relation asked for none. */
export function relateEmpty(of: Items): readonly Witness[] {
  return of.map(({ key, value }) => ({ key, value }));
}

/**
 * The negation of `empty`. Emptiness itself is the witness, so the one witness names the
 * extraction rather than an element — there is no element to name.
 */
export function relateNonEmpty(of: Items, extractName: string): readonly Witness[] {
  return of.length === 0 ? [{ key: extractName, value: null }] : [];
}

/** The `of` items whose value occurs nowhere in `in`, in `of` order, duplicates kept. */
export function relateSubset(of: Items, inItems: Items): readonly Witness[] {
  const present = new Set(inItems.map((item) => canonical(item.value)));
  return of
    .filter((item) => !present.has(canonical(item.value)))
    .map(({ key, value }) => ({ key, value }));
}

/** `subset` both ways: the left-only items first, then the right-only ones. */
export function relateEqual(left: Items, right: Items): readonly Witness[] {
  return [
    ...relateSubset(left, right).map((witness) => ({ ...witness, side: 'left' as const })),
    ...relateSubset(right, left).map((witness) => ({ ...witness, side: 'right' as const })),
  ];
}

/** `subset` of the key projections: the `of` items whose key `requires` does not carry. */
export function relateImplies(of: Items, requires: Items): readonly Witness[] {
  const keys = new Set(requires.map((item) => item.key));
  return of.filter((item) => !keys.has(item.key)).map(({ key, value }) => ({ key, value }));
}

/**
 * Adjacent pairs rise; `strict` forbids equal neighbours. The witness is the later item of
 * each pair that breaks it, so a caller reading the first witness sees where the sequence
 * turned — an ordering reduced to a sort would answer only whether it held.
 */
export function relateOrdered(of: Items, strict: boolean): readonly Witness[] {
  const witnesses: Witness[] = [];
  const compare = comparatorFor(of);
  for (let index = 1; index < of.length; index += 1) {
    const order = compare(of[index - 1], of[index]);
    if (order > 0 || (strict && order === 0)) {
      witnesses.push({ key: of[index].key, value: of[index].value });
    }
  }
  return witnesses;
}

/**
 * `equal` over the shared keys: the post item of every key both states carry whose value
 * changed. A key only one side has is an addition or a removal, not a change.
 */
export function relateUnchanged(pre: Items, post: Items): readonly WitnessWithBefore[] {
  const before = new Map(pre.map((item) => [item.key, item.value]));
  return post
    .filter((item) => before.has(item.key) && !sameValue(before.get(item.key), item.value))
    .map((item) => ({ key: item.key, value: item.value, before: before.get(item.key) }));
}
