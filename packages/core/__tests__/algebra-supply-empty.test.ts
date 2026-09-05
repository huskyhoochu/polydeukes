import { describe, expect, it } from 'vitest';
// The third supply policy, `empty`: an absent source is read as an empty item list and the
// judgment continues. It is a property of a single source, so the paired source `state`
// refuses it. The JSON schemas mirror both the new value and the removed entry families.
import { validateAlgebraDeclaration } from '../src/algebra.ts';
import { ConfigValidationError, defineConfig } from '../src/config.ts';
import { schema, validate, validateAlgebra, validLanguages } from './helpers.ts';

// Source names, patterns, and ids are fixture values.
const SOURCE_PATH = 'target.path';
const SOURCE_PRE = 'pre';
const SOURCE_POST = 'post';
const PATTERN = '\\b(lantern)\\b';
const ENTRY = 'nothing-added';

/** The change-axis declaration under test: added lines only, existing debt forgiven. */
const addedOnly = {
  discipline: 'no-lantern',
  mechanism: 'added-only',
  scope: { source: SOURCE_PATH, include: ['^lib/'] },
  supply: { [SOURCE_PRE]: 'empty', [SOURCE_POST]: 'empty' },
  extract: {
    before: [
      { op: 'source', of: SOURCE_PRE },
      { op: 'lines' },
      { op: 'keyByPattern', re: PATTERN },
    ],
    after: [
      { op: 'source', of: SOURCE_POST },
      { op: 'lines' },
      { op: 'keyByPattern', re: PATTERN },
    ],
    added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
  },
  relate: [{ id: ENTRY, relation: { op: 'empty', of: 'added' }, message: 'adds {key}: {value}' }],
};

/** Asserts the concrete error instance and returns it so callers can assert on the message. */
function expectRejection(input: unknown): ConfigValidationError {
  try {
    validateAlgebraDeclaration(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('validateAlgebraDeclaration should have thrown');
}

/** True when defineConfig accepts the input (does not throw). */
function defineConfigAccepts(config: unknown): boolean {
  try {
    defineConfig(config);
    return true;
  } catch {
    return false;
  }
}

describe('validateAlgebraDeclaration — the supply policy `empty`', () => {
  it('accepts `supply: { pre: empty }` on the validator side AND on the schema side', () => {
    // One side admitting the value while the other refuses it makes the same config valid
    // at runtime and invalid in the IDE, or the reverse.
    expect(() => validateAlgebraDeclaration(addedOnly)).not.toThrow();
    expect(validateAlgebra(addedOnly)).toBe(true);
  });

  it('rejects `supply: { state: empty }`, naming the paired source', () => {
    // `state` exists only on a modify and `unchanged` needs both sides; an empty pair is
    // not a pair. Admitting it lets an author write a policy the engine never applies.
    const error = expectRejection({ ...addedOnly, supply: { state: 'empty' } });

    expect(error.message).toContain('supply.state');
    expect(error.message).toContain("'empty'");
    expect(error.message).toContain('paired source');
  });

  it('still rejects a value outside the three, and the value list now names `empty`', () => {
    // Widening the check to "any string" to let `empty` through would let `nothing`
    // through with it; the message must enumerate the closed set the author can pick from.
    const error = expectRejection({ ...addedOnly, supply: { [SOURCE_PRE]: 'nothing' } });

    expect(error.message).toContain('nothing');
    expect(error.message).toContain('error');
    expect(error.message).toContain('pass');
    expect(error.message).toContain('empty');
  });
});

describe('JSON schema mirror — the entry families and the supply value', () => {
  /** The `required` lists of every discipline `oneOf` branch, flattened. */
  function requiredKeysAcrossBranches(): string[] {
    const defs = schema.$defs as Record<string, { oneOf?: { required?: string[] }[] }>;
    const branches = defs.discipline?.oneOf ?? [];
    return branches.flatMap((branch) => branch.required ?? []);
  }

  it('the disciplines oneOf carries no `forbid` and no `immutable` branch, and keeps the other three', () => {
    // A schema branch left behind keeps the IDE green on an entry the runtime refuses.
    const required = requiredKeysAcrossBranches();

    expect(required).not.toContain('forbid');
    expect(required).not.toContain('immutable');
    expect(required).toEqual(
      expect.arrayContaining(['declare', 'forbidCommand', 'requirePrecedent']),
    );
  });

  it('an entry carrying `forbid` or `immutable` is refused by defineConfig AND by ajv', () => {
    // The equivalence in the negative direction: a removal that lands on one side only is
    // the drift the contract suites exist to catch.
    for (const entry of [
      { id: 'old-forbid', forbid: PATTERN },
      { id: 'old-immutable', immutable: ['records/archive/**'] },
    ]) {
      const config = { ...validLanguages, disciplines: [entry] };
      expect(defineConfigAccepts(config), JSON.stringify(entry)).toBe(false);
      expect(validate(config), JSON.stringify(entry)).toBe(false);
    }
  });

  it('a declare entry supplying `empty` is accepted by defineConfig AND by ajv', () => {
    // The config side reaches the declaration body through the runtime validator; both
    // sides must admit the policy or the live entries fail at load.
    const { discipline: _name, ...body } = addedOnly;
    const config = { ...validLanguages, disciplines: [{ id: 'no-lantern', declare: body }] };

    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});
