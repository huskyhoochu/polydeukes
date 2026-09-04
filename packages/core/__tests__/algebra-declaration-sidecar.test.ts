import { describe, expect, it } from 'vitest';
import { validateAlgebraDeclaration } from '../src/algebra.ts';
import { ConfigValidationError } from '../src/validation.ts';
import { validateAlgebra } from './helpers.ts';

// The `sidecar` kind of a `sources` entry: `sources: { <name>: { sidecar: true } }` names a
// channel the surface supplies (a spawn-record list as JSON text), not a file the supply
// layer reads by path. The declaration knows only that the name IS the channel, so the value
// is the marker `true` and nothing else — a path there would claim knowledge of the host's
// directory layout the declaration must not have. The kind position stays closed and
// exactly-one-kind; the fixed source names stay unshadowable.
//
// Every fixture runs on both sides of the contract — validateAlgebraDeclaration and the
// published JSON Schema — from one array per verdict, so the two cannot drift apart.

// Source names and the location are fixture values.
const LOCATION = 'disciplines[0].declare';
const SPAWNS = 'spawns';
const SOURCE_KO = 'ko';
const FILE_KO = 'locales/ko.json';

/** A declaration reading one sidecar channel and requiring at least one record. */
const sidecarDeclaration = {
  discipline: 'probe',
  mechanism: 'precedent',
  sources: { [SPAWNS]: { sidecar: true } },
  supply: { [SPAWNS]: 'error' },
  extract: { records: [{ op: 'source', of: SPAWNS }] },
  relate: [{ id: 'present', relation: { op: 'nonEmpty', of: 'records' }, message: 'm' }],
};

/** The sidecar declaration with its `sources` block replaced wholesale. */
function withSources(sources: unknown): unknown {
  return { ...sidecarDeclaration, sources };
}

/** The sidecar declaration whose single source `spawns` carries the given value. */
function withSourceValue(value: unknown): unknown {
  return withSources({ [SPAWNS]: value });
}

/** Asserts the concrete error instance and returns it so callers can assert on the message. */
function expectRejection(input: unknown): ConfigValidationError {
  try {
    validateAlgebraDeclaration(input, LOCATION);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('validateAlgebraDeclaration should have thrown');
}

describe('validateAlgebraDeclaration — the sidecar kind, accepted declarations', () => {
  it('accepts a source bound { sidecar: true }, verbatim', () => {
    // The kind is new: a kind list that stayed at `file` refuses every channel binding, and
    // a validator that normalizes (drops the entry) loses the binding the plan is made from.
    expect(validateAlgebraDeclaration(sidecarDeclaration, LOCATION)).toEqual(sidecarDeclaration);
  });

  it('accepts a file source and a sidecar source side by side in one block', () => {
    // Exactly-one-kind is per ENTRY, not per block: a validator that fixes one kind for the
    // whole block refuses every declaration that reads a file and a channel together.
    const declaration = {
      ...sidecarDeclaration,
      sources: { [SOURCE_KO]: { file: FILE_KO }, [SPAWNS]: { sidecar: true } },
      supply: { [SOURCE_KO]: 'error', [SPAWNS]: 'error' },
    };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });
});

describe('validateAlgebraDeclaration — the sidecar value is the literal true', () => {
  it.each([
    ['false', false],
    ['a string', 'subagents/'],
    ['an object', {}],
  ])('rejects sidecar: %s, at the entry', (_label, value) => {
    // `sidecar: false` reads as "not a channel" while still binding the name; a string
    // reads as a path the declaration must not know; both would make the marker a value
    // the supply layer has to interpret. Only the literal `true` is the grammar.
    const error = expectRejection(withSourceValue({ sidecar: value }));

    expect(error.message).toContain(`${LOCATION}.sources.${SPAWNS}`);
  });

  it('rejects a value carrying two kinds ({ file, sidecar: true })', () => {
    // Exactly one kind per source: with both present the layer would have to pick between
    // a file read and a channel read for one name.
    const error = expectRejection(withSourceValue({ file: FILE_KO, sidecar: true }));

    expect(error.message).toContain(`${LOCATION}.sources.${SPAWNS}`);
  });

  it('rejects an unknown key beside sidecar ({ sidecar: true, mode }), naming it', () => {
    // A misspelled option would be silently ignored under an open key set.
    const error = expectRejection(withSourceValue({ sidecar: true, mode: 'x' }));

    expect(error.message).toContain(`${LOCATION}.sources.${SPAWNS}`);
    expect(error.message).toContain('mode');
  });

  it('rejects a sidecar source under a fixed world name (changes)', () => {
    // The shadow check must hold for the new kind too: a channel named `changes` would
    // silently override (or be overridden by) the world's own change set.
    const error = expectRejection(withSources({ changes: { sidecar: true } }));

    expect(error.message).toContain(`${LOCATION}.sources.changes`);
  });
});

// Schema ⟺ validator equivalence, same mechanism as the sources contract suite: every VALID
// fixture passes both sides, every INVALID one fails both. `validateAlgebra` is the
// importable ajv compile from ./helpers.ts.

const VALID_DECLARATIONS: readonly unknown[] = [
  // One sidecar source under supply: error.
  sidecarDeclaration,
  // A file source and a sidecar source in one block.
  {
    ...sidecarDeclaration,
    sources: { [SOURCE_KO]: { file: FILE_KO }, [SPAWNS]: { sidecar: true } },
    supply: { [SOURCE_KO]: 'error', [SPAWNS]: 'error' },
  },
];

const INVALID_DECLARATIONS: readonly unknown[] = [
  // The value is not the literal true.
  withSourceValue({ sidecar: false }),
  withSourceValue({ sidecar: 'subagents/' }),
  withSourceValue({ sidecar: {} }),
  withSourceValue({ sidecar: [true] }),
  // Two kinds at once.
  withSourceValue({ file: FILE_KO, sidecar: true }),
  // Unknown key beside the kind.
  withSourceValue({ sidecar: true, mode: 'x' }),
  // A sidecar source shadowing a fixed world name.
  withSources({ changes: { sidecar: true } }),
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

describe('algebra schema ⟺ validateAlgebraDeclaration equivalence — sidecar (VALID fixtures)', () => {
  it.each(
    VALID_DECLARATIONS.map((declaration, index) => [index, declaration] as const),
  )('valid sidecar declaration #%i: validator accepts AND ajv validates', (_index, declaration) => {
    // A validator-only acceptance leaves every consumer's IDE schema rejecting a legal
    // channel binding; a schema-only acceptance validates documents the validator throws on.
    expect(validatorAccepts(declaration)).toBe(true);
    expect(validateAlgebra(declaration)).toBe(true);
  });
});

describe('algebra schema ⟺ validateAlgebraDeclaration equivalence — sidecar (INVALID fixtures)', () => {
  it.each(
    INVALID_DECLARATIONS.map((declaration, index) => [index, declaration] as const),
  )('invalid sidecar declaration #%i: validator throws AND ajv rejects', (_index, declaration) => {
    expect(validatorAccepts(declaration)).toBe(false);
    expect(validateAlgebra(declaration)).toBe(false);
  });
});
