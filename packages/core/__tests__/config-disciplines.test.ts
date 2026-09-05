import { describe, expect, it } from 'vitest';
// `defineConfig(unknown)` accepts an optional top-level `disciplines: DisciplineEntry[]`.
// Exactly one predicate key per entry (forbid | immutable | forbidCommand); `in`/`except`
// only on forbid entries; ids unique and non-empty; regex strings must be compilable;
// unknown keys rejected. Every failure throws ConfigValidationError with a field path
// naming the offending entry or key, and validated data passes through to
// ResolvedConfig.disciplines verbatim.
import { ConfigValidationError, defineConfig } from '../src/config.ts';

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
  it('accepts one entry per predicate family and carries them verbatim', () => {
    // A well-formed array must reach ResolvedConfig.disciplines byte-for-byte — compiling
    // patterns is the covenant package's job, not core's. The assertion catches the
    // validator rewriting a declaration block, or dropping `why`/`in`/`except`.
    const disciplines = [
      {
        id: 'needs-view',
        why: 'a dependency bump without a registry check has shipped a broken major',
        in: ['packages/core/src/**'],
        except: 'packages/core/src/legacy/**',
        requirePrecedent: { command: 'npm view ' },
      },
      {
        id: 'no-hex',
        declare: {
          mechanism: 'added-only',
          scope: { source: 'target.path', include: ['^src/'] },
          supply: { pre: 'empty', post: 'empty' },
          extract: {
            before: [
              { op: 'source', of: 'pre' },
              { op: 'lines' },
              { op: 'keyByPattern', re: '(#[0-9a-f]{6})' },
            ],
            after: [
              { op: 'source', of: 'post' },
              { op: 'lines' },
              { op: 'keyByPattern', re: '(#[0-9a-f]{6})' },
            ],
            added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
          },
          relate: [
            { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
          ],
        },
      },
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

  it('rejects an entry with two predicate keys, naming the entry', () => {
    // Two predicates make the entry's family ambiguous, so the count is exactly one rather
    // than at least one.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'two-predicates', forbidCommand: 'x', requirePrecedent: { command: 'y' } },
      ]),
    );

    expect(error.message).toContain('two-predicates');
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

describe('defineConfig disciplines — scope keys are requirePrecedent-only', () => {
  it('rejects `in` on a forbidCommand entry', () => {
    // forbidCommand judges the command line, not paths, so a path narrowing cannot apply.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'command-with-in', forbidCommand: 'y', in: 'z/**' }]),
    );

    expect(error.message).toContain('command-with-in');
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

// An algebra declaration is a separate document with its own validator; the `disciplines`
// surface does not carry its blocks. An entry smuggling `extract` or `relate` in beside a
// predicate must be refused by the closed key set, and the message must name the key.

describe('defineConfig disciplines — algebra blocks are not entry keys', () => {
  it('rejects an entry carrying an `extract` block, naming that key', () => {
    // Opening the entry to `extract` without a judgment path would register a discipline
    // nothing judges — a fail-open entry that reads as armed.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'has-extract', forbid: 'x', extract: { a: [{ op: 'source', of: 'pre' }] } },
      ]),
    );

    expect(error.message).toContain('extract');
  });

  it('rejects an entry carrying a `relate` block, naming that key', () => {
    // Same gate, second key: an implementation opening the set by name rather than by
    // closing it would let the second one through.
    const error = expectConfigValidationError(
      withDisciplines([
        {
          id: 'has-relate',
          forbid: 'x',
          relate: [{ id: 'r', relation: { op: 'empty', of: 'a' }, message: 'm' }],
        },
      ]),
    );

    expect(error.message).toContain('relate');
  });
});
