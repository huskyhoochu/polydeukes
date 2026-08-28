import type { AlgebraDeclaration, ExtractStep, RelationDecl } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import {
  type CompiledDeclaration,
  judgeDeclaration,
  type Witness,
  type World,
} from '../src/declaration-engine.ts';
import { compileOrFail } from './declaration-engine-helpers.ts';

// The four expansion laws the engine is built on — `NonEmpty ≡ ¬Empty`, `Equal ≡ Subset`
// both ways, `Implies ≡ Subset` of the key projections, `Unchanged ≡ Equal` over shared
// keys — checked by exhaustive enumeration over a finite universe: values {a, b, c}, keys
// {k1, k2, k3}, item lists of length ≤ 3 with distinct keys. The reference below is written
// from the set definitions with plain Set/Map operations and imports nothing from the
// engine, so a law implemented as its own expansion is compared against something other
// than itself. The enumeration count is printed so the domain of the claim is visible.

// Source and extract names are fixture values; `state` is the one name the contract
// reserves for a pre/post pair.
const SRC_LEFT = 'left';
const SRC_RIGHT = 'right';
const PAIRED_SOURCE = 'state';
const LEFT = 'leftItems';
const RIGHT = 'rightItems';
const PAIRED = 'pairedItems';
const ENTRY = 'law-entry';

const VALUES = ['a', 'b', 'c'] as const;
const KEYS = ['k1', 'k2', 'k3'] as const;
const MAX_LENGTH = 3;

type Item = { readonly key: string; readonly value: string };
type Answer = { readonly holds: boolean; readonly witnesses: readonly Witness[] };

/** Every item list of length ≤ MAX_LENGTH over KEYS × VALUES with distinct keys. */
function universe(): Item[][] {
  const lists: Item[][] = [[]];
  const grow = (prefix: Item[]): void => {
    if (prefix.length === MAX_LENGTH) return;
    const used = new Set(prefix.map((i) => i.key));
    for (const key of KEYS) {
      if (used.has(key)) continue;
      for (const value of VALUES) {
        const next = [...prefix, { key, value }];
        lists.push(next);
        grow(next);
      }
    }
  };
  grow([]);
  return lists;
}

// ── Reference implementations — set definitions, engine-free ─────────────────────────

function refEmpty(of: readonly Item[]): Answer {
  return { holds: of.length === 0, witnesses: of.map(({ key, value }) => ({ key, value })) };
}

function refSubset(of: readonly Item[], inn: readonly Item[]): Answer {
  const present = new Set(inn.map((i) => i.value));
  const witnesses = of
    .filter((i) => !present.has(i.value))
    .map(({ key, value }) => ({ key, value }));
  return { holds: witnesses.length === 0, witnesses };
}

/** NonEmpty ≡ ¬Empty, with the single extract-named witness when it fails. */
function refNonEmpty(of: readonly Item[], extractName: string): Answer {
  const empty = refEmpty(of);
  return empty.holds
    ? { holds: false, witnesses: [{ key: extractName, value: null }] }
    : { holds: true, witnesses: [] };
}

/** Equal ≡ Subset(a, b) ∧ Subset(b, a); witnesses left-side then right-side. */
function refEqual(a: readonly Item[], b: readonly Item[]): Answer {
  const leftOnly = refSubset(a, b).witnesses.map((x) => ({ ...x, side: 'left' as const }));
  const rightOnly = refSubset(b, a).witnesses.map((x) => ({ ...x, side: 'right' as const }));
  const witnesses = [...leftOnly, ...rightOnly];
  return { holds: witnesses.length === 0, witnesses };
}

/** Implies ≡ Subset of the key projections; witnesses are the `of` items themselves. */
function refImplies(of: readonly Item[], requires: readonly Item[]): Answer {
  const keys = new Set(requires.map((i) => i.key));
  const witnesses = of.filter((i) => !keys.has(i.key)).map(({ key, value }) => ({ key, value }));
  return { holds: witnesses.length === 0, witnesses };
}

/** Unchanged ≡ Equal over the shared keys; witnesses are the post items that differ. */
function refUnchanged(pre: readonly Item[], post: readonly Item[]): Answer {
  const before = new Map(pre.map((i) => [i.key, i.value]));
  const witnesses = post
    .filter((i) => before.has(i.key) && before.get(i.key) !== i.value)
    .map(({ key, value }) => ({ key, value }));
  return { holds: witnesses.length === 0, witnesses };
}

// ── Engine side ─────────────────────────────────────────────────────────────────────

function listPipeline(source: string): ExtractStep[] {
  return [
    { op: 'source', of: source },
    { op: 'select', path: 'items' },
    { op: 'keyBy', field: 'k' },
    { op: 'field', name: 'v' },
  ];
}

function listValue(items: readonly Item[]): unknown {
  return { items: items.map(({ key, value }) => ({ k: key, v: value })) };
}

function compileSingle(relation: RelationDecl): CompiledDeclaration {
  const decl: AlgebraDeclaration = {
    discipline: 'law',
    extract: { [LEFT]: listPipeline(SRC_LEFT), [RIGHT]: listPipeline(SRC_RIGHT) },
    relate: [{ id: ENTRY, relation, message: 'm' }],
  };
  return compileOrFail(decl);
}

function compilePaired(): CompiledDeclaration {
  const decl: AlgebraDeclaration = {
    discipline: 'law',
    extract: { [PAIRED]: listPipeline(PAIRED_SOURCE) },
    relate: [{ id: ENTRY, relation: { op: 'Unchanged', of: PAIRED }, message: 'm' }],
  };
  return compileOrFail(decl);
}

function engineAnswer(compiled: CompiledDeclaration, world: World): Answer {
  const verdict = judgeDeclaration(compiled, world);
  if (verdict.kind === 'pass') return { holds: true, witnesses: [] };
  if (verdict.kind !== 'broken') throw new Error(`unexpected verdict ${JSON.stringify(verdict)}`);
  return { holds: false, witnesses: verdict.breaks.flatMap((b) => b.witnesses) };
}

/** A canonical string of an answer; `side` is kept only when present. */
function canon(answer: Answer): string {
  return JSON.stringify({
    holds: answer.holds,
    witnesses: answer.witnesses.map((x) =>
      x.side === undefined
        ? { key: x.key, value: x.value }
        : { key: x.key, value: x.value, side: x.side },
    ),
  });
}

type Mismatch = { input: string; engine: string; reference: string };

describe('kernel laws — engine relations agree with the set-definition reference', () => {
  const lists = universe();

  it('NonEmpty ≡ ¬Empty over every list', () => {
    const compiled = compileSingle({ op: 'NonEmpty', of: LEFT });
    const mismatches: Mismatch[] = [];
    for (const of of lists) {
      const engine = canon(
        engineAnswer(compiled, { [SRC_LEFT]: listValue(of), [SRC_RIGHT]: listValue([]) }),
      );
      const reference = canon(refNonEmpty(of, LEFT));
      if (engine !== reference) mismatches.push({ input: JSON.stringify(of), engine, reference });
    }
    console.log(`NonEmpty ≡ ¬Empty: ${lists.length} inputs`);
    expect(mismatches).toEqual([]);
  });

  it('Equal ≡ Subset both ways over every pair of lists', () => {
    const compiled = compileSingle({ op: 'Equal', of: [LEFT, RIGHT] });
    const mismatches: Mismatch[] = [];
    let count = 0;
    for (const a of lists) {
      for (const b of lists) {
        count += 1;
        const engine = canon(
          engineAnswer(compiled, { [SRC_LEFT]: listValue(a), [SRC_RIGHT]: listValue(b) }),
        );
        const reference = canon(refEqual(a, b));
        if (engine !== reference)
          mismatches.push({ input: JSON.stringify([a, b]), engine, reference });
      }
    }
    console.log(`Equal ≡ Subset²: ${count} inputs`);
    expect(count).toBe(lists.length * lists.length);
    expect(mismatches).toEqual([]);
  });

  it('Implies ≡ Subset of key projections over every pair of lists', () => {
    const compiled = compileSingle({ op: 'Implies', of: LEFT, requires: RIGHT });
    const mismatches: Mismatch[] = [];
    let count = 0;
    for (const of of lists) {
      for (const requires of lists) {
        count += 1;
        const engine = canon(
          engineAnswer(compiled, { [SRC_LEFT]: listValue(of), [SRC_RIGHT]: listValue(requires) }),
        );
        const reference = canon(refImplies(of, requires));
        if (engine !== reference) {
          mismatches.push({ input: JSON.stringify([of, requires]), engine, reference });
        }
      }
    }
    console.log(`Implies ≡ Subset(keys): ${count} inputs`);
    expect(count).toBe(lists.length * lists.length);
    expect(mismatches).toEqual([]);
  });

  it('Unchanged ≡ Equal over shared keys over every (pre, post) pair', () => {
    const compiled = compilePaired();
    const mismatches: Mismatch[] = [];
    let count = 0;
    for (const pre of lists) {
      for (const post of lists) {
        count += 1;
        const world: World = { [PAIRED_SOURCE]: { pre: listValue(pre), post: listValue(post) } };
        const engine = canon(engineAnswer(compiled, world));
        const reference = canon(refUnchanged(pre, post));
        if (engine !== reference)
          mismatches.push({ input: JSON.stringify([pre, post]), engine, reference });
      }
    }
    console.log(`Unchanged ≡ Equal(shared keys): ${count} inputs`);
    expect(count).toBe(lists.length * lists.length);
    expect(mismatches).toEqual([]);
  });

  it('the primitives themselves agree with the reference — Empty and Subset', () => {
    // The laws above compare expansions against the reference; a primitive that drifted
    // would drag every expansion with it and still agree with a reference built on the
    // same drift, so the primitives are pinned here on their own.
    const empty = compileSingle({ op: 'Empty', of: LEFT });
    const subset = compileSingle({ op: 'Subset', of: LEFT, in: RIGHT });
    const mismatches: Mismatch[] = [];
    for (const a of lists) {
      const e = canon(
        engineAnswer(empty, { [SRC_LEFT]: listValue(a), [SRC_RIGHT]: listValue([]) }),
      );
      const r = canon(refEmpty(a));
      if (e !== r) mismatches.push({ input: JSON.stringify(a), engine: e, reference: r });
      for (const b of lists) {
        const es = canon(
          engineAnswer(subset, { [SRC_LEFT]: listValue(a), [SRC_RIGHT]: listValue(b) }),
        );
        const rs = canon(refSubset(a, b));
        if (es !== rs)
          mismatches.push({ input: JSON.stringify([a, b]), engine: es, reference: rs });
      }
    }
    console.log(`Empty: ${lists.length} inputs · Subset: ${lists.length * lists.length} inputs`);
    expect(mismatches).toEqual([]);
  });
});
