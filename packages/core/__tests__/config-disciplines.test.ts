import { describe, expect, it } from 'vitest';
// `defineConfig(unknown)` accepts an optional top-level `disciplines: DisciplineEntry[]`.
// Exactly one predicate key per entry (forbid | immutable | forbidCommand); `in`/`except`
// only on forbid entries; ids unique and non-empty; regex strings must be compilable;
// unknown keys rejected. Every failure throws ConfigValidationError with a field path
// naming the offending entry or key, and validated data passes through to
// ResolvedConfig.disciplines verbatim.
import { ConfigValidationError, defineConfig } from '../src/index.ts';

// The banned-vocabulary literal appears only inside a discipline's forbid pattern string,
// where it is the discipline data under test. testCmd bodies are deliberately fake
// (`fake-runner`) because the core never runs the command it carries.

const baseConfig = {
  languages: {
    typescript: {
      productionGlob: 'packages/core/src/**/*',
      testCmd: 'fake-runner {scope}',
    },
  },
} as const;

/** Attach a disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...baseConfig, disciplines };
}

// Asserts the concrete error instance and returns it so callers can assert on the message.
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

describe('defineConfig disciplines — valid entries', () => {
  it('accepts one entry per predicate family (plus a string-shorthand forbid) and carries them verbatim', () => {
    // A well-formed array must reach ResolvedConfig.disciplines byte-for-byte — compiling
    // patterns is the covenant package's job, not core's. The assertion catches the
    // validator normalizing the string-shorthand forbid into an object, or dropping
    // `why`/`in`/`except`.
    const disciplines = [
      {
        id: 'vocabulary',
        why: 'ban new control-framing vocabulary in sources',
        in: ['packages/core/src/**'],
        except: 'packages/core/src/legacy/**',
        forbid: '\\b(guard|harness|kb)\\b',
      },
      { id: 'object-forbid', forbid: { added: '#[0-9a-f]{6}' } },
      { id: 'config-immutable', immutable: ['config/*.lock'] },
      { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=(0|false)\\b' },
    ];

    const resolved = defineConfig(withDisciplines(disciplines));

    expect(resolved.disciplines).toEqual(disciplines);
  });

  it('does not fabricate a disciplines key when the config omits disciplines', () => {
    // A config without disciplines must resolve with no `disciplines` key at all, which is
    // distinct from an explicit empty array — no default-fill may blur the two.
    const resolved = defineConfig(baseConfig);

    expect('disciplines' in resolved).toBe(false);
  });
});

describe('defineConfig disciplines — predicate cardinality', () => {
  it('rejects an entry with zero predicate keys, naming the entry index', () => {
    // An entry with no forbid/immutable/forbidCommand is unjudgeable; accepting it yields a
    // dead discipline that protects nothing while appearing registered.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'no-predicate', why: 'oops' }]),
    );

    expect(error.message).toContain('no-predicate');
  });

  it('rejects an entry with two predicate keys (forbid + immutable), naming the entry', () => {
    // Two predicates make the entry's family ambiguous, so the count is exactly one rather
    // than at least one.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'two-predicates', forbid: 'x', immutable: 'y/**' }]),
    );

    expect(error.message).toContain('two-predicates');
  });

  it('rejects an entry with forbid + forbidCommand together', () => {
    // The delta and command families are mutually exclusive per entry.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'delta-and-command', forbid: 'x', forbidCommand: 'y' }]),
    );

    expect(error.message).toContain('delta-and-command');
  });
});

describe('defineConfig disciplines — forbid object variants', () => {
  it('rejects forbid: { removed: ... } (removed is deferred)', () => {
    // `{ added }` is the only accepted direction key; the object-form validator must not
    // admit an arbitrary one.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'removed-dir', forbid: { removed: 'x' } }]),
    );

    expect(error.message).toContain('removed-dir');
  });

  it('rejects forbid: { present: ... } (present is deferred)', () => {
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'present-dir', forbid: { present: 'x' } }]),
    );

    expect(error.message).toContain('present-dir');
  });

  it('rejects forbid: { added: <number> } (added value must be a string pattern)', () => {
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'added-number', forbid: { added: 1 } }]),
    );

    expect(error.message).toContain('added-number');
  });

  it('rejects forbid: {} (empty object has no direction key)', () => {
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'empty-forbid', forbid: {} }]),
    );

    expect(error.message).toContain('empty-forbid');
  });
});

describe('defineConfig disciplines — unknown key rejection (deferred-axis)', () => {
  it('rejects an entry carrying an unknown `witness` key, naming that key', () => {
    // `witness` is a top-level key only. On an entry it must be refused rather than
    // silently dropped: an author who believes the key took effect gets a fail-open gate.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'has-witness', forbid: 'x', witness: 'PDKS-1' }]),
    );

    expect(error.message).toContain('witness');
  });
});

describe('defineConfig disciplines — scope keys are forbid-only', () => {
  it('rejects `in` on an immutable entry', () => {
    // An immutable entry's glob is already its scope, so `in` would imply a narrowing that
    // is never applied.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'immutable-with-in', immutable: 'y/**', in: 'z/**' }]),
    );

    expect(error.message).toContain('immutable-with-in');
  });

  it('rejects `except` on a forbidCommand entry', () => {
    // forbidCommand judges the command line, not paths, so a path exception cannot apply.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'command-with-except', forbidCommand: 'x', except: 'z/**' }]),
    );

    expect(error.message).toContain('command-with-except');
  });
});

describe('defineConfig disciplines — id constraints', () => {
  it('rejects duplicate ids across entries, naming the duplicated id', () => {
    // An id is the telemetry label and the verdict-reason prefix, so a collision silently
    // merges two disciplines' measurements.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'dup', forbid: 'a' },
        { id: 'dup', immutable: 'b/**' },
      ]),
    );

    expect(error.message).toContain('dup');
  });

  it('rejects an empty-string id', () => {
    // An empty id is a present-but-unusable handle: it satisfies a presence check while
    // naming nothing in telemetry.
    expectConfigValidationError(withDisciplines([{ id: '', forbid: 'a' }]));
  });

  it('rejects a non-string id', () => {
    // A numeric id must be refused, not stringified.
    expectConfigValidationError(withDisciplines([{ id: 7, forbid: 'a' }]));
  });
});

// Core checks that a pattern compiles; it never runs one.
describe('defineConfig disciplines — regex compilability', () => {
  it('rejects a non-compilable forbid regex string (unbalanced paren)', () => {
    // A pattern `new RegExp` cannot compile is a broken discipline: refuse it at authoring
    // time rather than let it reach the covenant compiler and fail at judge time.
    expectConfigValidationError(withDisciplines([{ id: 'bad-forbid-re', forbid: '(' }]));
  });

  it('rejects a non-compilable forbidCommand regex string', () => {
    expectConfigValidationError(withDisciplines([{ id: 'bad-cmd-re', forbidCommand: '(' }]));
  });
});

describe('defineConfig disciplines — container/entry shape', () => {
  it('rejects disciplines that is not an array', () => {
    // A single entry object is the plausible mistake here, and it is typeof 'object' like
    // the array — only an explicit Array.isArray check separates them.
    expectConfigValidationError(withDisciplines({ id: 'x', forbid: 'a' }));
  });

  it('rejects a disciplines entry that is not an object', () => {
    expectConfigValidationError(withDisciplines(['not-an-object']));
  });
});
