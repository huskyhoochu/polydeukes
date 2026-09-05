import { describe, expect, it } from 'vitest';
import { validateAlgebraDeclaration } from '../src/algebra.ts';
import { FIXED_SOURCE_NAMES } from '../src/source-names.ts';
import { validateAlgebra } from './helpers.ts';

// Schema ⟺ validateAlgebraDeclaration equivalence for the `sources` block.
// Same mechanism as algebra-declaration-schema-contract.test.ts — every VALID fixture must
// pass both sides, every INVALID one must fail both — kept in its own file so the shipped
// fixture tables stay untouched. `validateAlgebra` is the importable ajv compile from
// ./helpers.ts; `../src/index.ts` is avoided so a barrel change cannot mask a module one.
//
// The supply-name cross-check ("a `supply` name is in `sources` or the fixed list") reads a
// sibling block, which JSON Schema cannot express; it lives in algebra-declaration-sources.test.ts
// alone, as reference resolution lives in algebra-declaration.test.ts.

// Source names and paths are fixture values; neither side reads what a name means.
const SOURCE_KO = 'ko';
const SOURCE_EN = 'en';
const FILE_KO = 'locales/ko.json';
const FILE_EN = 'locales/en.json';
const SOURCE_PRE = 'pre';
const EXTRACT_KO = 'koKeys';
const EXTRACT_EN = 'enKeys';

/** The world-supplied names a source may not shadow. */
const FIXED_NAMES = FIXED_SOURCE_NAMES;

const sourcedDeclaration = {
  discipline: 'probe',
  // `scoped-valve` is the one mechanism whose spec admits every axis and relation, so the
  // `sources` variants below never turn on the catalogue check.
  mechanism: 'scoped-valve',
  sources: { [SOURCE_KO]: { file: FILE_KO } },
  supply: { [SOURCE_KO]: 'error' },
  extract: {
    [EXTRACT_KO]: [{ op: 'source', of: SOURCE_KO }],
    [EXTRACT_EN]: [{ op: 'source', of: SOURCE_PRE }],
  },
  relate: [{ id: 'parity', relation: { op: 'equal', of: [EXTRACT_KO, EXTRACT_EN] }, message: 'm' }],
  witness: {
    relate: [{ id: 'valve', relation: { op: 'nonEmpty', of: EXTRACT_KO }, message: 'w' }],
  },
};

/**
 * The same declaration with no `sources` block — `supply` then names fixed sources only,
 * and the extract reads fixed sources only, since nothing binds `ko` any more.
 */
const { sources: _sources, ...unsourcedDeclaration } = {
  ...sourcedDeclaration,
  supply: { [SOURCE_PRE]: 'error' },
  extract: { ...sourcedDeclaration.extract, [EXTRACT_KO]: [{ op: 'source', of: SOURCE_PRE }] },
};

/** The sourced declaration with its `sources` block replaced wholesale. */
function withSources(sources: unknown): unknown {
  return { ...sourcedDeclaration, sources };
}

/** The sourced declaration whose single source `ko` carries the given value. */
function withSourceValue(value: unknown): unknown {
  return withSources({ [SOURCE_KO]: value });
}

const VALID_DECLARATIONS: readonly unknown[] = [
  // One source, one supply entry — the pair-parity form.
  sourcedDeclaration,
  // Two sources, both supply policies.
  {
    ...sourcedDeclaration,
    sources: { [SOURCE_KO]: { file: FILE_KO }, [SOURCE_EN]: { file: FILE_EN } },
    supply: { [SOURCE_KO]: 'error', [SOURCE_EN]: 'pass' },
  },
  // A nested relative path.
  withSourceValue({ file: 'a/b/c/ko.json' }),
  // Two dots inside a segment are not a `..` segment (a pattern must anchor on `/`).
  withSourceValue({ file: 'a..b/..hidden/ko.json' }),
  // An empty block binds nothing and is a valid declaration.
  { ...unsourcedDeclaration, sources: {} },
  // Supply naming the fixed world source `changes` with no sources block — the newest fixed
  // name must be on the list the cross-check consults.
  { ...unsourcedDeclaration, supply: { changes: 'pass' } },
];

const INVALID_DECLARATIONS: readonly unknown[] = [
  // An empty-string source name.
  withSources({ '': { file: FILE_KO } }),
  // names
  // A source shadowing each fixed world source (propertyNames excludes the five).
  ...FIXED_NAMES.map((name) => withSources({ [name]: { file: FILE_KO } })),
  // A sources block that is not an object.
  withSources([{ file: FILE_KO }]),
  // the file path
  // Absolute path.
  withSourceValue({ file: '/etc/x' }),
  // `..` segment — leading, middle, trailing.
  withSourceValue({ file: '../x' }),
  withSourceValue({ file: 'a/../b' }),
  withSourceValue({ file: 'x/..' }),
  // Empty string (minLength).
  withSourceValue({ file: '' }),
  // Not a string.
  withSourceValue({ file: 1 }),
  // the kind position
  // Unknown kind.
  withSourceValue({ sidecar: 'x' }),
  // Two kinds at once.
  withSourceValue({ file: FILE_KO, sidecar: 'x' }),
  // Unknown key beside file (additionalProperties).
  withSourceValue({ file: FILE_KO, mode: 'x' }),
  // No kind at all (required).
  withSourceValue({}),
  // A bare string where an entry is expected.
  withSourceValue(FILE_KO),
  // null and an array as an entry.
  withSourceValue(null),
  withSourceValue([{ file: FILE_KO }]),
];

/** True when the validator accepts the input (does not throw). */
function validatorAccepts(declaration: unknown): boolean {
  try {
    validateAlgebraDeclaration(declaration);
    return true;
  } catch {
    return false;
  }
}

describe('algebra schema ⟺ validateAlgebraDeclaration equivalence — sources (VALID fixtures)', () => {
  it.each(
    VALID_DECLARATIONS.map((declaration, index) => [index, declaration] as const),
  )('valid sourced declaration #%i: validator accepts AND ajv validates', (_index, declaration) => {
    // A validator-only acceptance leaves every consumer's IDE schema rejecting a legal
    // `sources` block; a schema-only acceptance validates documents the validator throws on.
    expect(validatorAccepts(declaration)).toBe(true);
    expect(validateAlgebra(declaration)).toBe(true);
  });
});

describe('algebra schema ⟺ validateAlgebraDeclaration equivalence — sources (INVALID fixtures)', () => {
  it.each(
    INVALID_DECLARATIONS.map((declaration, index) => [index, declaration] as const),
  )('invalid sourced declaration #%i: validator throws AND ajv rejects', (_index, declaration) => {
    expect(validatorAccepts(declaration)).toBe(false);
    expect(validateAlgebra(declaration)).toBe(false);
  });
});
