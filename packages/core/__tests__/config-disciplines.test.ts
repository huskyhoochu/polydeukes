import { describe, expect, it } from 'vitest';
// COVENANT-10 §4.1 / AC §5.1 — `defineConfig(unknown)` accepts an optional top-level
// `disciplines: DisciplineEntry[]`. Exactly one predicate key per entry (forbid | immutable
// | forbidCommand); `in`/`except` only on forbid entries; ids unique and non-empty; regex
// strings must be compilable; unknown keys rejected (deferred-axis enforcement). Every
// failure throws ConfigValidationError with a field path naming the offending entry/key.
// The validated data passes through to ResolvedConfig.disciplines verbatim. These symbols
// are the GREEN contract; disciplines support does not exist yet, so this file is RED.
import { ConfigValidationError, defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures. A valid base config (v2 config-as-data) that disciplines attach to.
// `guard|harness|kb` appears ONLY inside a discipline's forbid pattern string — that is
// the discipline DATA being tested (the vocabulary rule exempts pattern literals, AC §5.7).
// testCmd bodies are FAKE (`fake-runner`) so the core grep gate stays satisfied.
// ---------------------------------------------------------------------------

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

// ===========================================================================
// AC §5.1 — valid disciplines pass and pass through verbatim
// ===========================================================================

describe('defineConfig disciplines — valid entries (AC §5.1)', () => {
  it('accepts one entry per predicate family (plus a string-shorthand forbid) and carries them verbatim', () => {
    // P0 pass-through invariant: a well-formed disciplines array must validate and reach
    // ResolvedConfig.disciplines byte-for-byte (compilation is covenant's job, not core's).
    // Mutation caught: the validator dropping/rewriting a field (e.g. normalizing the
    // string-shorthand forbid into an object, or dropping `why`/`in`/`except`).
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
    // P0 no-fabrication (CORE-04 precedent): a config without disciplines must resolve with
    // no `disciplines` key, distinct from an explicit empty array. Mutation caught: a
    // default-fill assigning `disciplines: []` when the key is absent.
    const resolved = defineConfig(baseConfig);

    expect('disciplines' in resolved).toBe(false);
  });
});

// ===========================================================================
// AC §5.1 — predicate-key cardinality (exactly one)
// ===========================================================================

describe('defineConfig disciplines — predicate cardinality (AC §5.1)', () => {
  it('rejects an entry with zero predicate keys, naming the entry index', () => {
    // P0 fail-fast (roadmap AC verbatim): an entry with no forbid/immutable/forbidCommand
    // is unjudgeable and must be refused at authoring time. Mutation caught: the
    // exactly-one-predicate check dropped (a keyless entry silently accepted = a dead
    // discipline that protects nothing).
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'no-predicate', why: 'oops' }]),
    );

    expect(error.message).toContain('no-predicate');
  });

  it('rejects an entry with two predicate keys (forbid + immutable), naming the entry', () => {
    // P0 fail-fast (roadmap AC verbatim): two predicates make the family ambiguous.
    // Mutation caught: the check weakened to "at least one" instead of "exactly one".
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'two-predicates', forbid: 'x', immutable: 'y/**' }]),
    );

    expect(error.message).toContain('two-predicates');
  });

  it('rejects an entry with forbid + forbidCommand together', () => {
    // P0: the delta and command families are mutually exclusive per entry.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'delta-and-command', forbid: 'x', forbidCommand: 'y' }]),
    );

    expect(error.message).toContain('delta-and-command');
  });
});

// ===========================================================================
// AC §5.1 — forbid object variants deferred to COVENANT-12
// ===========================================================================

describe('defineConfig disciplines — forbid object variants (COVENANT-12 deferral, AC §5.1)', () => {
  it('rejects forbid: { removed: ... } (removed is deferred)', () => {
    // P0 deferred-direction rejection: only `{ added }` is accepted before COVENANT-12.
    // Mutation caught: the object-form validator accepting any direction key.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'removed-dir', forbid: { removed: 'x' } }]),
    );

    expect(error.message).toContain('removed-dir');
  });

  it('rejects forbid: { present: ... } (present is deferred)', () => {
    // P0 deferred-direction rejection partner.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'present-dir', forbid: { present: 'x' } }]),
    );

    expect(error.message).toContain('present-dir');
  });

  it('rejects forbid: { added: <number> } (added value must be a string pattern)', () => {
    // P0 type boundary: the added pattern must be a compilable regex string, not a number.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'added-number', forbid: { added: 1 } }]),
    );

    expect(error.message).toContain('added-number');
  });

  it('rejects forbid: {} (empty object has no direction key)', () => {
    // P0 boundary: an empty forbid object supplies no pattern at all.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'empty-forbid', forbid: {} }]),
    );

    expect(error.message).toContain('empty-forbid');
  });
});

// ===========================================================================
// AC §5.1 — unknown keys (deferred-axis enforcement — enforce/waiver rejected)
// ===========================================================================

describe('defineConfig disciplines — unknown key rejection (AC §5.1, deferred-axis)', () => {
  it('rejects an entry carrying an unknown `enforce` key, naming that key', () => {
    // P0 deferred-axis enforcement (user decision ①): the enforce/waiver surface keys are
    // NOT accepted — silent ignore would be a fail-open accident (CONFIG-04 §3 precedent).
    // Mutation caught: the per-entry additionalProperties=false gate removed.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'has-enforce', forbid: 'x', enforce: 'advise' }]),
    );

    expect(error.message).toContain('enforce');
  });

  it('rejects an entry carrying an unknown `waiver` key, naming that key', () => {
    // P0 deferred-axis enforcement partner: per-discipline waiver is a future axis and must
    // be refused now, not silently dropped.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'has-waiver', forbid: 'x', waiver: 'PDKS-1' }]),
    );

    expect(error.message).toContain('waiver');
  });
});

// ===========================================================================
// AC §5.1 — in/except only on forbid entries
// ===========================================================================

describe('defineConfig disciplines — scope keys are forbid-only (AC §5.1)', () => {
  it('rejects `in` on an immutable entry', () => {
    // P0: immutable is its own scope (its glob), so `in` is a meaningless combination and
    // must be refused (silent acceptance would imply a scope that is never applied).
    // Mutation caught: the family-specific key restriction dropped.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'immutable-with-in', immutable: 'y/**', in: 'z/**' }]),
    );

    expect(error.message).toContain('immutable-with-in');
  });

  it('rejects `except` on a forbidCommand entry', () => {
    // P0: forbidCommand judges on the command axis, not paths, so `except` is meaningless.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'command-with-except', forbidCommand: 'x', except: 'z/**' }]),
    );

    expect(error.message).toContain('command-with-except');
  });
});

// ===========================================================================
// AC §5.1 — id validity and uniqueness
// ===========================================================================

describe('defineConfig disciplines — id constraints (AC §5.1)', () => {
  it('rejects duplicate ids across entries, naming the duplicated id', () => {
    // P0 uniqueness: ids are the telemetry label and verdict-reason prefix; a collision
    // would merge two disciplines' measurements. Mutation caught: the cross-entry
    // uniqueness check dropped.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'dup', forbid: 'a' },
        { id: 'dup', immutable: 'b/**' },
      ]),
    );

    expect(error.message).toContain('dup');
  });

  it('rejects an empty-string id', () => {
    // P0 boundary: an empty id is a present-but-invalid handle. Mutation caught: the
    // non-empty check on id dropped.
    expectConfigValidationError(withDisciplines([{ id: '', forbid: 'a' }]));
  });

  it('rejects a non-string id', () => {
    // P0 type boundary: a numeric id must be refused, not stringified.
    expectConfigValidationError(withDisciplines([{ id: 7, forbid: 'a' }]));
  });
});

// ===========================================================================
// AC §5.1 — regex compilability (core checks compilability only, never runs it)
// ===========================================================================

describe('defineConfig disciplines — regex compilability (AC §5.1)', () => {
  it('rejects a non-compilable forbid regex string (unbalanced paren)', () => {
    // P0: a pattern that `new RegExp` cannot compile is a broken discipline — refuse it at
    // authoring time rather than fail at judge time. Mutation caught: the compilability
    // probe removed (an uncompilable pattern would slip to the covenant compiler).
    expectConfigValidationError(withDisciplines([{ id: 'bad-forbid-re', forbid: '(' }]));
  });

  it('rejects a non-compilable forbidCommand regex string', () => {
    // P0 partner on the command family.
    expectConfigValidationError(withDisciplines([{ id: 'bad-cmd-re', forbidCommand: '(' }]));
  });
});

// ===========================================================================
// AC §5.1 — shape of disciplines and entries
// ===========================================================================

describe('defineConfig disciplines — container/entry shape (AC §5.1)', () => {
  it('rejects disciplines that is not an array', () => {
    // P0: the top-level disciplines must be an array. Mutation caught: the Array.isArray
    // check on disciplines dropped.
    expectConfigValidationError(withDisciplines({ id: 'x', forbid: 'a' }));
  });

  it('rejects a disciplines entry that is not an object', () => {
    // P0: each entry must be a record; a bare string is not a DisciplineEntry.
    expectConfigValidationError(withDisciplines(['not-an-object']));
  });
});
