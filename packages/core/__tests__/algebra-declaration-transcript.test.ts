import { describe, expect, it } from 'vitest';
import { validateAlgebraDeclaration } from '../src/algebra.ts';
import { ConfigValidationError } from '../src/validation.ts';
import { validateAlgebra } from './helpers.ts';

// The `transcript` kind of a `sources` entry: `sources: { <name>: { transcript: true } }`
// names the session's conversation history, which the session surface hands to assembly and
// the covenant package flattens into a plain snapshot. Like a sidecar, the declaration
// knows only that the name IS the history, so the value is the marker `true` and nothing
// else. The kind position stays closed and exactly-one-kind, the fixed names stay
// unshadowable, and a transcript name is not string-valued, so `scope.source` refuses it.
//
// Every fixture runs on both sides of the contract — validateAlgebraDeclaration and the
// published JSON Schema — from one array per verdict, so the two cannot drift apart.

// Source names and the location are fixture values.
const LOCATION = 'disciplines[0].declare';
const SESSION = 'session';
const SPAWNS = 'spawns';
const SOURCE_KO = 'ko';
const FILE_KO = 'locales/ko.json';

/** A declaration reading the session history and requiring at least one stated plan. */
const transcriptDeclaration = {
  discipline: 'probe',
  mechanism: 'stated-ground',
  sources: { [SESSION]: { transcript: true } },
  supply: { [SESSION]: 'error' },
  extract: {
    plans: [
      { op: 'source', of: SESSION },
      { op: 'userTexts', re: '^/plan\\b' },
    ],
  },
  relate: [{ id: 'stated', relation: { op: 'nonEmpty', of: 'plans' }, message: 'm' }],
};

/** The transcript declaration with its `sources` block replaced wholesale. */
function withSources(sources: unknown): unknown {
  return { ...transcriptDeclaration, sources };
}

/** The transcript declaration whose single source `session` carries the given value. */
function withSourceValue(value: unknown): unknown {
  return withSources({ [SESSION]: value });
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

describe('validateAlgebraDeclaration — the transcript kind, accepted declarations', () => {
  it('accepts a source bound { transcript: true }, verbatim', () => {
    // The kind is new: a kind list that stayed at file · sidecar refuses every history
    // binding, and a validator that normalizes (drops the entry) loses the binding the
    // supply arm reads the session by.
    expect(validateAlgebraDeclaration(transcriptDeclaration, LOCATION)).toEqual(
      transcriptDeclaration,
    );
  });

  it('accepts a transcript source and a sidecar source side by side in one block', () => {
    // The W2 precedent shape: exactly-one-kind is per ENTRY, so two channel kinds under two
    // names is one legal block. `precedent` admits history + world and `nonEmpty`.
    const declaration = {
      ...transcriptDeclaration,
      mechanism: 'precedent',
      sources: { [SESSION]: { transcript: true }, [SPAWNS]: { sidecar: true } },
      supply: { [SESSION]: 'pass', [SPAWNS]: 'error' },
      extract: {
        ...transcriptDeclaration.extract,
        records: [{ op: 'source', of: SPAWNS }, { op: 'json' }],
      },
      relate: [
        ...transcriptDeclaration.relate,
        { id: 'spawned', relation: { op: 'nonEmpty', of: 'records' }, message: 'm' },
      ],
    };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });

  it('lists transcript among the admitted kinds when an unknown kind is refused', () => {
    // The refusal message is the author's only view of the closed list; a validator that
    // special-cases the transcript kind outside `SOURCE_KINDS` accepts the binding while
    // telling every author it does not exist.
    const error = expectRejection(withSourceValue({ channel: true }));

    expect(error.message).toContain('transcript');
  });
});

describe('validateAlgebraDeclaration — the transcript value is the literal true', () => {
  it.each([
    ['false', false],
    ['a string', 'session.jsonl'],
    ['an object', {}],
  ])('rejects transcript: %s, at the entry', (_label, value) => {
    // `transcript: false` reads as "not the history" while still binding the name; a string
    // reads as a path to a session file the declaration must not know. Only the literal
    // `true` is the grammar, exactly as for the sidecar marker.
    const error = expectRejection(withSourceValue({ transcript: value }));

    expect(error.message).toContain(`${LOCATION}.sources.${SESSION}`);
  });

  it('rejects a value carrying two channel kinds ({ transcript: true, sidecar: true })', () => {
    // Exactly one kind per source: a check that requires "a kind is present" passes a value
    // naming both channel kinds, and the supply arm would have to pick one for the name.
    const error = expectRejection(withSourceValue({ transcript: true, sidecar: true }));

    expect(error.message).toContain(`${LOCATION}.sources.${SESSION}`);
  });

  it('rejects a value carrying a file and the transcript kind', () => {
    const error = expectRejection(withSourceValue({ file: FILE_KO, transcript: true }));

    expect(error.message).toContain(`${LOCATION}.sources.${SESSION}`);
  });

  it('rejects an unknown key beside transcript ({ transcript: true, since }), naming it', () => {
    // A misspelled option (a TTL, a since-turn) would be silently ignored under an open
    // key set; the age of a turn is the `ageMs` step's business, not the binding's.
    const error = expectRejection(withSourceValue({ transcript: true, since: 0 }));

    expect(error.message).toContain(`${LOCATION}.sources.${SESSION}`);
    expect(error.message).toContain('since');
  });

  it('rejects a transcript source under a fixed world name (changes)', () => {
    // The shadow check must hold for the new kind too.
    const error = expectRejection(withSources({ changes: { transcript: true } }));

    expect(error.message).toContain(`${LOCATION}.sources.changes`);
  });
});

describe('validateAlgebraDeclaration — a transcript source is not a scope source', () => {
  it('rejects a transcript-bound name as scope.source, naming it', () => {
    // A scope regex has meaning over a string; the history is a snapshot object, so a
    // scope on it admits no world at all, and every call would answer zero rows instead of
    // the author learning the declaration is wrong.
    const error = expectRejection({
      ...transcriptDeclaration,
      scope: { source: SESSION, include: ['.*'] },
    });

    expect(error.message).toContain(`'${SESSION}'`);
  });
});

// Schema ⟺ validator equivalence, same mechanism as the sidecar suite: every VALID fixture
// passes both sides, every INVALID one fails both. The `scope.source` rule and the supply
// cross-check read sibling blocks and stay validator-only.

const VALID_DECLARATIONS: readonly unknown[] = [
  // One transcript source under supply: error.
  transcriptDeclaration,
  // A file source and a transcript source in one block.
  {
    ...transcriptDeclaration,
    mechanism: 'scoped-valve',
    sources: { [SOURCE_KO]: { file: FILE_KO }, [SESSION]: { transcript: true } },
    supply: { [SOURCE_KO]: 'error', [SESSION]: 'pass' },
    witness: { relate: [{ id: 'valve', relation: { op: 'nonEmpty', of: 'plans' }, message: 'w' }] },
  },
  // A sidecar source and a transcript source in one block.
  {
    ...transcriptDeclaration,
    mechanism: 'scoped-valve',
    sources: { [SPAWNS]: { sidecar: true }, [SESSION]: { transcript: true } },
    witness: { relate: [{ id: 'valve', relation: { op: 'nonEmpty', of: 'plans' }, message: 'w' }] },
  },
];

const INVALID_DECLARATIONS: readonly unknown[] = [
  // The value is not the literal true.
  withSourceValue({ transcript: false }),
  withSourceValue({ transcript: 'session.jsonl' }),
  withSourceValue({ transcript: {} }),
  withSourceValue({ transcript: [true] }),
  // Two kinds at once.
  withSourceValue({ transcript: true, sidecar: true }),
  withSourceValue({ file: FILE_KO, transcript: true }),
  // Unknown key beside the kind.
  withSourceValue({ transcript: true, since: 0 }),
  // A transcript source shadowing a fixed world name.
  withSources({ changes: { transcript: true } }),
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

describe('algebra schema ⟺ validateAlgebraDeclaration equivalence — transcript (VALID fixtures)', () => {
  it.each(
    VALID_DECLARATIONS.map((declaration, index) => [index, declaration] as const),
  )('valid transcript declaration #%i: validator accepts AND ajv validates', (_index, declaration) => {
    // A validator-only acceptance leaves every consumer's IDE schema rejecting a legal
    // history binding; a schema-only acceptance validates documents the validator throws on.
    expect(validatorAccepts(declaration)).toBe(true);
    expect(validateAlgebra(declaration)).toBe(true);
  });
});

describe('algebra schema ⟺ validateAlgebraDeclaration equivalence — transcript (INVALID fixtures)', () => {
  it.each(
    INVALID_DECLARATIONS.map((declaration, index) => [index, declaration] as const),
  )('invalid transcript declaration #%i: validator throws AND ajv rejects', (_index, declaration) => {
    expect(validatorAccepts(declaration)).toBe(false);
    expect(validateAlgebra(declaration)).toBe(false);
  });
});
