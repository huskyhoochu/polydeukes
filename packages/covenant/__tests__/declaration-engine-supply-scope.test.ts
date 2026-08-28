import type { AlgebraDeclaration, ScopeBlock, SupplyBlock } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { type World, witnessOpens } from '../src/declaration-engine.ts';
import { compileOrFail, judge } from './declaration-engine-helpers.ts';

// The three gates that stand before the relations. Supply: a source absent from the world
// answers `supply-error` under `error` or no policy, and `not-applicable/supply-pass`
// under `pass`; a `json` step that cannot parse answers `supply-error` naming the source
// whatever the policy; the first supply failure ends the judgment. Scope: the source must
// be a string matching at least one include and no exclude, or the verdict is
// `not-applicable/scope` and no pipeline runs. `witnessOpens`: the witness block's entries
// must all hold; a supply failure there closes the valve.

// Source, path, and extract names are fixture values.
const SRC = 'doc';
const SRC_OTHER = 'other';
const SRC_MISSING = 'absent';
const PATH_SRC = 'target.path';
const ITEMS = 'docItems';
const OTHER = 'otherItems';
const JOINED = 'joinedItems';
const ENTRY = 'probe-entry';

/** One pipeline reading `SRC`; `NonEmpty` holds whenever the source is present. */
function sourceDecl(supply?: SupplyBlock, scope?: ScopeBlock): AlgebraDeclaration {
  return {
    discipline: 'probe',
    ...(scope !== undefined && { scope }),
    ...(supply !== undefined && { supply }),
    extract: { [ITEMS]: [{ op: 'source', of: SRC }] },
    relate: [{ id: ENTRY, relation: { op: 'NonEmpty', of: ITEMS }, message: 'm' }],
  };
}

describe('supply policy — a source absent from the world', () => {
  it('answers supply-error naming the source under `error`', () => {
    expect(judge(sourceDecl({ [SRC]: 'error' }), {})).toEqual({
      kind: 'supply-error',
      source: SRC,
      reason: expect.any(String),
    });
  });

  it('answers not-applicable/supply-pass naming the source under `pass`', () => {
    expect(judge(sourceDecl({ [SRC]: 'pass' }), {})).toEqual({
      kind: 'not-applicable',
      reason: 'supply-pass',
      source: SRC,
    });
  });

  it('answers supply-error when no policy is written — absence is not a pass', () => {
    // The fail-closed default: an empty supply block must not become a universal pass.
    expect(judge(sourceDecl(), {}).kind).toBe('supply-error');
    expect(judge(sourceDecl({ [SRC_OTHER]: 'pass' }), {}).kind).toBe('supply-error');
  });

  it('judges normally when the source is present, whatever the policy', () => {
    expect(judge(sourceDecl({ [SRC]: 'pass' }), { [SRC]: 'x' }).kind).toBe('pass');
    expect(judge(sourceDecl(), { [SRC]: 'x' }).kind).toBe('pass');
  });

  it('a present source whose value is null or empty is supplied, not absent', () => {
    // `World[of] === undefined` is the absence test; null and '' are values.
    expect(judge(sourceDecl({ [SRC]: 'pass' }), { [SRC]: null }).kind).toBe('pass');
    expect(judge(sourceDecl({ [SRC]: 'pass' }), { [SRC]: '' }).kind).toBe('pass');
  });
});

describe('supply policy — json parse failure', () => {
  const decl: AlgebraDeclaration = {
    discipline: 'probe',
    supply: { [SRC]: 'pass' },
    extract: { [ITEMS]: [{ op: 'source', of: SRC }, { op: 'json' }] },
    relate: [{ id: ENTRY, relation: { op: 'NonEmpty', of: ITEMS }, message: 'm' }],
  };

  it('answers supply-error naming the source even under a `pass` policy', () => {
    // `pass` governs absence only; a present-but-unparseable value is a failure of supply.
    expect(judge(decl, { [SRC]: '{ "a": 1, }' })).toEqual({
      kind: 'supply-error',
      source: SRC,
      reason: expect.any(String),
    });
  });
});

describe('supply policy — the paired source `state`', () => {
  const PAIRED = 'pairedItems';
  const decl: AlgebraDeclaration = {
    discipline: 'probe',
    extract: { [PAIRED]: [{ op: 'source', of: 'state' }] },
    relate: [{ id: ENTRY, relation: { op: 'Unchanged', of: PAIRED }, message: 'm' }],
  };

  it('a state that is not a { pre, post } pair is a supply-error naming state', () => {
    // The world's shape is supply's business, not compilation's: a string, a null, and a
    // pair missing one side all answer as a failed supply, never as a pass or a throw.
    for (const state of ['text', null, { pre: '[]' }, { post: '[]' }]) {
      expect(judge(decl, { state })).toEqual({
        kind: 'supply-error',
        source: 'state',
        reason: expect.any(String),
      });
    }
  });

  it('a well-formed pair is judged', () => {
    expect(judge(decl, { state: { pre: '[]', post: '[]' } }).kind).toBe('pass');
  });

  it('an absent state follows the supply policy like any other source', () => {
    const passing: AlgebraDeclaration = { ...decl, supply: { state: 'pass' } };
    expect(judge(passing, {})).toEqual({
      kind: 'not-applicable',
      reason: 'supply-pass',
      source: 'state',
    });
    expect(judge(decl, {})).toMatchObject({ kind: 'supply-error', source: 'state' });
  });
});

describe('supply policy — a failure under a combinator names the pipeline', () => {
  it('json failing after a union answers supply-error naming the joined pipeline', () => {
    // A merged item has no single source behind it, so the pipeline is what the author
    // can act on.
    const decl: AlgebraDeclaration = {
      discipline: 'probe',
      extract: {
        [ITEMS]: [{ op: 'source', of: SRC }],
        [OTHER]: [{ op: 'source', of: SRC_OTHER }],
        [JOINED]: [{ op: 'union', of: [ITEMS, OTHER] }, { op: 'json' }],
      },
      relate: [{ id: ENTRY, relation: { op: 'NonEmpty', of: JOINED }, message: 'm' }],
    };
    expect(judge(decl, { [SRC]: 'not json', [SRC_OTHER]: '[]' })).toMatchObject({
      kind: 'supply-error',
      source: JOINED,
    });
  });
});

describe('supply policy — the first failure ends the judgment', () => {
  it('a later entry that would break does not turn a supply-error into broken', () => {
    const decl: AlgebraDeclaration = {
      discipline: 'probe',
      supply: { [SRC_MISSING]: 'error' },
      extract: {
        [ITEMS]: [{ op: 'source', of: SRC_MISSING }],
        [OTHER]: [{ op: 'source', of: SRC }],
      },
      relate: [
        { id: 'needs-missing', relation: { op: 'NonEmpty', of: ITEMS }, message: 'm' },
        { id: 'breaks', relation: { op: 'Empty', of: OTHER }, message: 'm' },
      ],
    };
    expect(judge(decl, { [SRC]: 'x' })).toMatchObject({
      kind: 'supply-error',
      source: SRC_MISSING,
    });
  });
});

describe('scope — the four paths to not-applicable/scope', () => {
  const scope: ScopeBlock = { source: PATH_SRC, include: ['^src/'], exclude: ['\\.md$'] };
  const decl = sourceDecl(undefined, scope);
  const world = (path: unknown): World => ({ [PATH_SRC]: path, [SRC]: 'x' });

  it('a path matching an include and no exclude is judged', () => {
    expect(judge(decl, world('src/a.ts')).kind).toBe('pass');
  });

  it('a scope without an include admits every path its exclude does not name', () => {
    // "Everything except the docs tree" is written with exclude alone; an empty include
    // list must not read as "nothing is included".
    const excludeOnly = sourceDecl(undefined, { source: PATH_SRC, exclude: ['^docs/'] });
    expect(judge(excludeOnly, world('src/a.ts')).kind).toBe('pass');
    expect(judge(excludeOnly, world('docs/a.md'))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });

  it('a path matching no include is out of scope', () => {
    expect(judge(decl, world('lib/a.ts'))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });

  it('a path matching an exclude is out of scope even when an include matches', () => {
    expect(judge(decl, world('src/a.md'))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });

  it('excludeIgnoreCase folds case on exclude only', () => {
    // Both ends: with the flag `.MD` is excluded; without it `.MD` is judged; and the flag
    // never reaches include, so an upper-case directory still fails include.
    const folded = sourceDecl(undefined, { ...scope, excludeIgnoreCase: true });
    expect(judge(folded, world('src/A.MD'))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
    expect(judge(decl, world('src/A.MD')).kind).toBe('pass');
    expect(judge(folded, world('SRC/a.ts'))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });

  it('a non-string or absent scope source is out of scope', () => {
    expect(judge(decl, world(42))).toMatchObject({ kind: 'not-applicable', reason: 'scope' });
    expect(judge(decl, { [SRC]: 'x' })).toMatchObject({ kind: 'not-applicable', reason: 'scope' });
  });

  it('an include is matched anywhere in the path, not anchored by the engine', () => {
    // The declaration owns its anchors: `(?:^|/)docs/` in the W2 ledger scope must match
    // an absolute path.
    const anywhere = sourceDecl(undefined, { source: PATH_SRC, include: ['(?:^|/)docs/'] });
    expect(judge(anywhere, world('/abs/repo/docs/a.json')).kind).toBe('pass');
  });

  it('out of scope runs no pipeline — a source that would fail supply is never read', () => {
    // The extract's source is absent under `error`; only a scope miss that returns before
    // extraction can answer scope rather than supply-error.
    const unreadable = sourceDecl({ [SRC]: 'error' }, scope);
    expect(judge(unreadable, { [PATH_SRC]: 'lib/a.ts' })).toEqual({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });
});

describe('witnessOpens — the valve after the verdict', () => {
  /** Body: two source pipelines, an entry that breaks; witness: union over the body names. */
  function withWitness(witness: AlgebraDeclaration['witness']): AlgebraDeclaration {
    return {
      discipline: 'probe',
      extract: {
        [ITEMS]: [{ op: 'source', of: SRC }],
        [OTHER]: [{ op: 'source', of: SRC_OTHER }],
      },
      relate: [{ id: ENTRY, relation: { op: 'Empty', of: ITEMS }, message: 'm' }],
      witness,
    };
  }
  const bothPresent: World = { [SRC]: 'x', [SRC_OTHER]: 'y' };

  it('opens when the witness extract over body names satisfies every witness entry', () => {
    const decl = withWitness({
      extract: { [JOINED]: [{ op: 'union', of: [ITEMS, OTHER] }] },
      relate: [{ id: 'valve', relation: { op: 'NonEmpty', of: JOINED }, message: 'm' }],
    });
    // The body's own entry breaks on this world; the valve is independent of that.
    expect(judge(decl, bothPresent).kind).toBe('broken');
    expect(witnessOpens(compileOrFail(decl), bothPresent)).toBe(true);
  });

  it('stays closed when a witness relation does not hold', () => {
    const decl = withWitness({
      extract: { [JOINED]: [{ op: 'union', of: [ITEMS, OTHER] }] },
      relate: [{ id: 'valve', relation: { op: 'Empty', of: JOINED }, message: 'm' }],
    });
    expect(witnessOpens(compileOrFail(decl), bothPresent)).toBe(false);
  });

  it('stays closed when one of several witness entries does not hold', () => {
    // `some` for `every` opens on the entry that holds.
    const decl = withWitness({
      extract: { [JOINED]: [{ op: 'union', of: [ITEMS, OTHER] }] },
      relate: [
        { id: 'valve-holds', relation: { op: 'NonEmpty', of: JOINED }, message: 'm' },
        { id: 'valve-breaks', relation: { op: 'Empty', of: JOINED }, message: 'm' },
      ],
    });
    expect(witnessOpens(compileOrFail(decl), bothPresent)).toBe(false);
  });

  it('stays closed when a witness source is absent from the world', () => {
    const decl = withWitness({
      extract: { [JOINED]: [{ op: 'source', of: SRC_MISSING }] },
      relate: [{ id: 'valve', relation: { op: 'NonEmpty', of: JOINED }, message: 'm' }],
    });
    expect(witnessOpens(compileOrFail(decl), bothPresent)).toBe(false);
  });

  it('stays closed when the declaration has no witness block', () => {
    expect(witnessOpens(compileOrFail(withWitness(undefined)), bothPresent)).toBe(false);
  });
});
