import type { AlgebraDeclaration } from '@polydeukes/core';
import { validateAlgebraDeclaration } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import type { DeclarationVerdict, World } from '../../src/covenant/declaration-engine.ts';
import { judge, witnessesOf } from './declaration-engine-helpers.ts';

// Key parity over three bundles under `mechanism: pairing`: the deduplicated union of every
// bundle's keys is built with `onlyIn` + `union`, and one `subset` per bundle asks that the
// bundle contain it. A witness names the key and the break's id names the bundle it is
// missing from; no bundle is the reference the others are compared against. The world is
// supplied inline as file text keyed by source name.

// Bundle names and paths are fixture values the declaration fixes, not the engine.
const SRC_KO = 'ko';
const SRC_EN = 'en';
const SRC_FR = 'fr';
const BUNDLES = [SRC_KO, SRC_EN, SRC_FR] as const;
const entryOf = (bundle: string) => `${bundle}-full`;

const raw = {
  discipline: 'probe',
  mechanism: 'pairing',
  sources: Object.fromEntries(BUNDLES.map((l) => [l, { file: `locales/${l}.json` }])),
  supply: Object.fromEntries(BUNDLES.map((l) => [l, 'error'])),
  extract: {
    ...Object.fromEntries(
      BUNDLES.map((l) => [l, [{ op: 'source', of: l }, { op: 'json' }, { op: 'flattenKeys' }]]),
    ),
    enNew: [{ op: 'onlyIn', of: SRC_EN, notIn: SRC_KO }],
    koEn: [{ op: 'union', of: [SRC_KO, 'enNew'] }],
    frNew: [{ op: 'onlyIn', of: SRC_FR, notIn: 'koEn' }],
    all: [{ op: 'union', of: ['koEn', 'frNew'] }],
  },
  relate: BUNDLES.map((l) => ({
    id: entryOf(l),
    relation: { op: 'subset', of: 'all', in: l },
    message: `{value} is missing from ${l}`,
  })),
};

// Validated here so the catalogue's shape check runs on the declaration before any case.
const decl: AlgebraDeclaration = validateAlgebraDeclaration(raw);

const world = (ko: object, en: object, fr: object): World => ({
  [SRC_KO]: JSON.stringify(ko),
  [SRC_EN]: JSON.stringify(en),
  [SRC_FR]: JSON.stringify(fr),
});

function breakIdsOf(verdict: DeclarationVerdict): string[] {
  if (verdict.kind !== 'broken') throw new Error(`expected broken, got ${JSON.stringify(verdict)}`);
  return verdict.breaks.map((b) => b.id);
}

describe('three-bundle key parity under pairing', () => {
  it('the same nested key set in every bundle, keys in differing order → pass', () => {
    // An engine comparing serialized key lists rather than sets breaks on the reordering,
    // and a `flattenKeys` carrying leaf text instead of the dot path breaks en-full and fr-full.
    const verdict = judge(
      decl,
      world(
        { a: { x: 'ㄱ', y: 'ㄴ' }, b: 'ㄷ' },
        { b: 'B', a: { y: 'Y', x: 'X' } },
        { a: { y: 'y', x: 'x' }, b: 'b' },
      ),
    );

    expect(verdict.kind).toBe('pass');
  });

  it('a key only in ko → en-full and fr-full break with that one key each; ko-full holds', () => {
    // The two other bundles are the ones missing it: an engine relating each bundle
    // against ko alone (a reference bundle) would report no break at all here.
    const verdict = judge(decl, world({ a: 'ㄱ', z: 'ㅈ' }, { a: 'A' }, { a: 'a' }));

    expect(breakIdsOf(verdict).sort()).toEqual([entryOf(SRC_EN), entryOf(SRC_FR)]);
    expect(witnessesOf(verdict, entryOf(SRC_EN)).map((w) => w.value)).toEqual(['z']);
    expect(witnessesOf(verdict, entryOf(SRC_FR)).map((w) => w.value)).toEqual(['z']);
  });

  it('a key in en and fr but not ko → ko-full alone breaks, with one witness', () => {
    // The dedup axis: `q` enters the union once through `enNew`; `frNew` excludes it
    // because `koEn` already carries it. A chain of plain unions would witness `q` twice.
    const verdict = judge(decl, world({ a: 'ㄱ' }, { a: 'A', q: 'Q' }, { a: 'a', q: 'q' }));

    expect(breakIdsOf(verdict)).toEqual([entryOf(SRC_KO)]);
    expect(witnessesOf(verdict, entryOf(SRC_KO)).map((w) => w.value)).toEqual(['q']);
    if (verdict.kind === 'broken') {
      expect(verdict.breaks[0].message).toBe(`q is missing from ${SRC_KO}`);
    }
  });

  it('a key only in fr → ko-full and en-full break; the last union carries it', () => {
    // `f` reaches the union only through `frNew` and the final `union`; a chain that drops
    // either leaves `all` without it and every relation holds.
    const verdict = judge(decl, world({ a: 'ㄱ' }, { a: 'A' }, { a: 'a', f: 'f' }));

    expect(breakIdsOf(verdict).sort()).toEqual([entryOf(SRC_EN), entryOf(SRC_KO)]);
    expect(witnessesOf(verdict, entryOf(SRC_KO)).map((w) => w.value)).toEqual(['f']);
    expect(witnessesOf(verdict, entryOf(SRC_EN)).map((w) => w.value)).toEqual(['f']);
  });
});
