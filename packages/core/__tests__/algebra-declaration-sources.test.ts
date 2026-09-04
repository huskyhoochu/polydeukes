import { describe, expect, it } from 'vitest';
import { SOURCE_KINDS, validateAlgebraDeclaration } from '../src/algebra.ts';
import { ConfigValidationError } from '../src/validation.ts';

// The `sources` block names files outside the target that the supply layer reads before
// judgment: `sources: { <name>: { file: '<repo-relative path>' } }`.
// The kind position is closed (`SOURCE_KINDS`), a name may not shadow
// one of the fixed world sources (`FIXED_SOURCE_NAMES`), the path is a non-empty relative
// path with no `..` segment. Every fault names its path under the caller's location. The validator still reads no file: it checks the shape of the naming.

// Source names, paths, and the location are fixture values: the validator only checks
// that names resolve and paths are well-formed, never what a file contains.
const LOCATION = 'disciplines[0].declare';
const SOURCE_KO = 'ko';
const SOURCE_EN = 'en';
const FILE_KO = 'locales/ko.json';
const FILE_EN = 'locales/en.json';
const SOURCE_PRE = 'pre';
const EXTRACT_KO = 'koKeys';
const EXTRACT_EN = 'enKeys';

/** The world-supplied names a declaration may name in `supply` without a `sources` entry. */
const FIXED_NAMES = ['target.path', 'pre', 'post', 'state', 'changes'] as const;

/** A declaration reading one file outside the target and comparing it to the target's post. */
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

/** The sourced declaration with its `sources` block replaced wholesale. */
function withSources(sources: unknown): unknown {
  return { ...sourcedDeclaration, sources };
}

/** The sourced declaration whose single source `ko` carries the given value. */
function withSourceValue(value: unknown): unknown {
  return withSources({ [SOURCE_KO]: value });
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

describe('validateAlgebraDeclaration — sources block, accepted declarations', () => {
  it('accepts a declaration whose sources names ko and whose supply names ko, verbatim', () => {
    // The block is new: a validator with a closed top-level key set that was not widened
    // refuses it as an unknown key, and one that normalizes (drops `sources`) loses the
    // binding the supply layer plans from.
    expect(validateAlgebraDeclaration(sourcedDeclaration, LOCATION)).toEqual(sourcedDeclaration);
  });

  it('accepts two sources bound to two files', () => {
    // A block keyed by name holds any number of entries; a validator reading only the first
    // (or refusing more than one kind across the block) fails the pair-parity form above.
    const declaration = {
      ...sourcedDeclaration,
      sources: { [SOURCE_KO]: { file: FILE_KO }, [SOURCE_EN]: { file: FILE_EN } },
      supply: { [SOURCE_KO]: 'error', [SOURCE_EN]: 'pass' },
    };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });

  it('accepts sources without a supply entry — absence policy is not a naming requirement', () => {
    // `sources` says what a name is; `supply` says what its absence does. A validator that
    // demands a supply entry per source welds the two blocks the grammar keeps apart.
    const { supply: _supply, ...withoutSupply } = sourcedDeclaration;

    expect(() => validateAlgebraDeclaration(withoutSupply, LOCATION)).not.toThrow();
  });

  it.each(
    FIXED_NAMES,
  )('accepts supply naming the fixed source %s with no sources block', (name) => {
    // The supply cross-check must resolve against sources OR the fixed list. Checking
    // against `sources` alone rejects every declaration that names `pre` today; a fixed list
    // that stayed at four rejects `changes`, the newest fixed name.
    const { sources: _sources, ...unsourced } = sourcedDeclaration;
    // With the block gone the extract reads fixed sources only: an unbound source name is
    // its own fault, and this case is about the supply cross-check.
    const declaration = {
      ...unsourced,
      supply: { [name]: 'pass' },
      extract: { ...sourcedDeclaration.extract, [EXTRACT_KO]: [{ op: 'source', of: SOURCE_PRE }] },
    };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });

  it('accepts a nested relative path', () => {
    // A path check that admits only a bare filename (no `/`) refuses every real layout.
    expect(() =>
      validateAlgebraDeclaration(withSourceValue({ file: 'a/b/c/ko.json' }), LOCATION),
    ).not.toThrow();
  });

  it('accepts a path whose segment merely contains two dots (a..b, ..hidden)', () => {
    // The rule is "no `..` SEGMENT"; a substring check (`includes('..')`) over-blocks
    // names that are legal on every filesystem.
    expect(() =>
      validateAlgebraDeclaration(withSourceValue({ file: 'a..b/..hidden/ko.json' }), LOCATION),
    ).not.toThrow();
  });
});

describe('validateAlgebraDeclaration — sources block, names', () => {
  it.each(FIXED_NAMES)('rejects a source named %s — it shadows a fixed world source', (name) => {
    // A user source under a fixed name would be silently overridden (or override) the
    // world's own key; the fault names the colliding entry under `.sources.`.
    const error = expectRejection(withSources({ [name]: { file: FILE_KO } }));

    expect(error.message).toContain(`${LOCATION}.sources.${name}`);
  });

  it('rejects a sources block that is not a plain object, at .sources', () => {
    // An array or a string is `typeof 'object'`-adjacent enough to slip past a loose check
    // and then iterate as zero sources — the block vanishes instead of faulting.
    for (const block of [[{ file: FILE_KO }], FILE_KO, null]) {
      const error = expectRejection(withSources(block));

      expect(error.message).toContain(`${LOCATION}.sources`);
      expect(error.message).not.toContain(`${LOCATION}.sources.`);
    }
  });
});

describe('validateAlgebraDeclaration — sources block, the file path', () => {
  it('rejects an absolute path (/etc/x)', () => {
    // The supply layer joins the path onto the repo root; an absolute path escapes it and
    // reads any file the process can. Fault at the entry, not the block.
    const error = expectRejection(withSourceValue({ file: '/etc/x' }));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
  });

  it.each(['../x', 'a/../b', 'x/..'])('rejects a path with a .. segment (%s)', (file) => {
    // Leading, middle, and trailing: a check anchored at the start alone lets `a/../b`
    // climb out of the repo after one legal segment.
    const error = expectRejection(withSourceValue({ file }));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
  });

  it('rejects an empty-string path', () => {
    // `''` joined onto the root is the root directory — a read that fails with a
    // non-ENOENT error at judgment time instead of a fault at declaration time.
    const error = expectRejection(withSourceValue({ file: '' }));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
  });

  it('rejects a path that is not a string', () => {
    // A number under a length check alone (`value.length > 0`) is `undefined > 0` — false,
    // but by accident; a boolean `true` has no length either. The type check is the contract.
    const error = expectRejection(withSourceValue({ file: 1 }));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
  });
});

describe('validateAlgebraDeclaration — sources block, the kind position is closed', () => {
  it('rejects an unknown kind (channel) naming the closed list', () => {
    // A kind outside the closed list binds a source the supply layer cannot read; admitting
    // it by name defers the fault to judgment time. The message shows the author what IS allowed.
    const error = expectRejection(withSourceValue({ channel: true }));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
    for (const kind of SOURCE_KINDS) {
      expect(error.message).toContain(kind);
    }
  });

  it('rejects a value carrying two kinds ({ file, sidecar })', () => {
    // Exactly one kind per source: a check that only requires `file` be present passes a
    // value that also names a second reading the layer would have to pick between.
    const error = expectRejection(withSourceValue({ file: FILE_KO, sidecar: 'x' }));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
  });

  it('rejects an unknown key beside file ({ file, mode }), naming it', () => {
    // A misspelled option would be silently ignored under an open key set.
    const error = expectRejection(withSourceValue({ file: FILE_KO, mode: 'x' }));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
    expect(error.message).toContain('mode');
  });

  it('rejects a value with no kind at all ({})', () => {
    // The degenerate entry: a name bound to nothing. An unknown-key check alone passes it.
    const error = expectRejection(withSourceValue({}));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
  });

  it('rejects a value that is a bare string', () => {
    // The shorthand `ko: 'locales/ko.json'` is not the grammar; reading it as `{ file }`
    // would open a second spelling the schema cannot mirror.
    const error = expectRejection(withSourceValue(FILE_KO));

    expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
  });

  it('rejects null and an array as a source value', () => {
    // Both are `typeof 'object'`; only a plain-object check separates them from an entry.
    for (const value of [null, [{ file: FILE_KO }]]) {
      const error = expectRejection(withSourceValue(value));

      expect(error.message).toContain(`${LOCATION}.sources.${SOURCE_KO}`);
    }
  });
});

describe('validateAlgebraDeclaration — the sources block at its two ends', () => {
  it('accepts an empty sources block — it binds nothing and plans nothing', () => {
    // Binding nothing means the extract names nothing outside the fixed sources either.
    expect(() =>
      validateAlgebraDeclaration(
        {
          ...sourcedDeclaration,
          sources: {},
          supply: { [SOURCE_PRE]: 'error' },
          extract: {
            ...sourcedDeclaration.extract,
            [EXTRACT_KO]: [{ op: 'source', of: SOURCE_PRE }],
          },
        },
        LOCATION,
      ),
    ).not.toThrow();
  });

  it('rejects an empty-string source name, at .sources', () => {
    // `''` collides with no fixed name and carries a well-formed path, so a name check that
    // only looks for collisions lets it through — and `{ op: 'source', of: '' }` then reads
    // a world key nobody can spell in a discipline.
    const error = expectRejection({ ...sourcedDeclaration, sources: { '': { file: FILE_KO } } });

    expect(error.message).toContain(`${LOCATION}.sources`);
  });
});

describe('validateAlgebraDeclaration — supply keys stay inside the source-name universe', () => {
  // The universe closed with the transcript kind: a `supply` key is either one of the fixed
  // five or a name this declaration's `sources` block binds. This check reads a sibling
  // block, which JSON Schema cannot express, so it is validator-only — the schema-contract
  // suite's header lists it as such, and no schema fixture mirrors it.
  const TYPO = 'transcrpt';

  it('rejects a supply key that is neither fixed nor bound, naming both sets', () => {
    // Today a misspelled key passes because only the VALUE is checked, and the policy the
    // author wrote for the real source never applies: an `error` meant for `ko` sits under
    // `k0` while `ko` falls to the default. The message must show both admitted sets.
    const error = expectRejection({
      ...sourcedDeclaration,
      supply: { [SOURCE_KO]: 'error', [TYPO]: 'pass' },
    });

    expect(error.message).toContain(LOCATION);
    expect(error.message).toContain(`'${TYPO}'`);
    for (const name of FIXED_NAMES) {
      expect(error.message).toContain(`'${name}'`);
    }
    expect(error.message).toContain(`'${SOURCE_KO}'`);
  });

  it('rejects a supply key with no sources block, naming the fixed five alone', () => {
    // With nothing bound, the admitted set is the fixed list; a check that only runs when a
    // `sources` block exists lets every unsourced declaration keep a dead supply key.
    const { sources: _sources, ...unsourced } = sourcedDeclaration;
    const error = expectRejection({
      ...unsourced,
      supply: { [TYPO]: 'pass' },
      extract: { ...sourcedDeclaration.extract, [EXTRACT_KO]: [{ op: 'source', of: SOURCE_PRE }] },
    });

    expect(error.message).toContain(`'${TYPO}'`);
    expect(error.message).toContain("'target.path'");
  });

  it('accepts a supply keyed by a bound name and a fixed name together', () => {
    // Both halves of the universe in one block: a check against `sources` alone refuses
    // `pre`, one against the fixed list alone refuses `ko`.
    const declaration = { ...sourcedDeclaration, supply: { [SOURCE_KO]: 'error', pre: 'pass' } };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });

  it('accepts a supply keyed by a transcript-bound name', () => {
    // The newest kind must be in the bound set like the other two; a cross-check reading
    // `.file` or `.sidecar` to collect names misses the transcript binding.
    const SESSION = 'session';
    const declaration = {
      ...sourcedDeclaration,
      sources: { [SOURCE_KO]: { file: FILE_KO }, [SESSION]: { transcript: true } },
      supply: { [SOURCE_KO]: 'error', [SESSION]: 'pass' },
    };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });
});
