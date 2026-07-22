import { describe, expect, it } from 'vitest';
// Import from the package entry point (src/index.ts) — the same surface
// `@polydeukes/core` publishes.
import { ConfigValidationError, defineConfig, normalizeProtectedPaths } from '../src/index.ts';

// ---------------------------------------------------------------------------
// CONFIG-07 — `adapters:` redefinition (PRD §4.1 / §4.2).
//
// OLD (removed): `adapters?: string[]` — a directory list unioned into the
// protection surface. NEW: `adapters?: Record<string, object>` — a namespace
// map. Keys are ecosystem values (like `languages` keys — core never validates
// names). Values must be plain objects; their CONTENTS are NOT validated
// (verbatim pass-through into ResolvedConfig — the vocabulary belongs to each
// adapter, whose own validator fail-fasts on unknown keys).
//
// `defineConfig(unknown)` is the runtime validator: fixtures are typed as
// `unknown` at the call boundary because the loader (CONFIG-03) feeds it parsed
// data the compiler never saw. testCmd bodies use FAKE shell commands
// (`fake-runner`, never a real test runner) so the core grep gate stays
// satisfied even inside fixtures.
// ---------------------------------------------------------------------------

const baseValidConfig = {
  languages: {
    typescript: {
      productionGlob: 'packages/core/src/**/*',
      testCmd: 'fake-runner {scope} --strict',
    },
  },
} as const;

// Shared assertion: asserts the concrete error instance (not just "did it throw")
// and returns it so callers can assert on the message.
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

describe('§4.1 adapters namespace map — accepted shapes (verbatim pass-through)', () => {
  it('leaves adapters absent in the ResolvedConfig when the config omits adapters', () => {
    // §4.1 row 1: absent stays absent. Mutation caught: a default-fill assigning
    // `adapters: {}` or `adapters: undefined` when the key is not present at all.
    const resolved = defineConfig(baseValidConfig);

    expect('adapters' in resolved).toBe(false);
  });

  it('accepts an empty adapters map and exposes it verbatim as an empty object', () => {
    // §4.1 row 4: `adapters: {}` is valid. Mutation caught: an emptiness check that
    // rejects the empty map (over-strict), or one that drops the key from the output.
    const resolved = defineConfig({ ...baseValidConfig, adapters: {} });

    expect(resolved.adapters).toEqual({});
  });

  it('exposes a namespace value with arbitrary unknown content verbatim (deep equal, unmutated)', () => {
    // §4.1 row 5: a plain-object namespace value passes regardless of its content —
    // content is NOT validated (the vocabulary belongs to the adapter). The exposure
    // must be deep-equal to the input AND the original object must not be mutated.
    // Mutation caught: a validator that inspects/strips namespace content, or a
    // resolver that shallow-copies away nested keys.
    const adaptersInput = { git: { anything: 1, nested: { deep: ['a', 'b'] } } };
    const resolved = defineConfig({ ...baseValidConfig, adapters: adaptersInput });

    expect(resolved.adapters).toEqual({ git: { anything: 1, nested: { deep: ['a', 'b'] } } });
    // The input object itself must not have been mutated by validation.
    expect(adaptersInput).toEqual({ git: { anything: 1, nested: { deep: ['a', 'b'] } } });
  });

  it('accepts multiple namespaces, each with its own arbitrary content', () => {
    // §4.1 row 5 extended: namespace names are unvalidated ecosystem values, and any
    // number of them coexist. Mutation caught: a resolver that keeps only the first
    // namespace, or one that validates namespace names against a fixed allowlist.
    const resolved = defineConfig({
      ...baseValidConfig,
      adapters: { git: { enforce: 'advise' }, docker: { foo: true } },
    });

    expect(resolved.adapters).toEqual({ git: { enforce: 'advise' }, docker: { foo: true } });
  });
});

describe('§4.1 adapters namespace map — rejected shapes (fail closed at authoring time)', () => {
  it('rejects the old array form with a migration message pointing to protectedPaths', () => {
    // §4.1 row 2: the directory-list form is REMOVED. An array must throw, and the
    // message must guide migration — naming that the directory-list form is gone and
    // that entries move to protectedPaths. Mutation caught: a validator that still
    // accepts an array (fail-open regression to the old union semantics), or an error
    // that omits the migration hint (an author left stranded on a silent breaking change).
    const error = expectConfigValidationError({
      ...baseValidConfig,
      adapters: ['packages/adapter-foo', 'packages/adapter-bar'],
    });
    expect(error.message).toContain('adapters');
    // Migration guidance must name the destination field.
    expect(error.message).toContain('protectedPaths');
  });

  it('rejects an empty array (old form) with the same migration message', () => {
    // §4.1 row 2 boundary: even an EMPTY array is the old directory-list shape and must
    // be rejected — an array is never a namespace map. Mutation caught: an array check
    // guarded on non-empty length, letting `adapters: []` slip through as a would-be map.
    const error = expectConfigValidationError({ ...baseValidConfig, adapters: [] });
    expect(error.message).toContain('adapters');
    expect(error.message).toContain('protectedPaths');
  });

  it('rejects a string adapters value, naming that adapters must be an object map', () => {
    // §4.1 row 3: a non-object (string) is neither the old list nor a map. Mutation
    // caught: a `typeof === 'object'` check that also lets strings/numbers through, or
    // a message that fails to name the object-map requirement.
    const error = expectConfigValidationError({ ...baseValidConfig, adapters: 'git' });
    expect(error.message).toContain('adapters');
    expect(error.message.toLowerCase()).toContain('object');
  });

  it('rejects a numeric adapters value, naming that adapters must be an object map', () => {
    // §4.1 row 3: number is the second non-object case. Mutation caught: a check that
    // special-cases strings but not other primitives.
    const error = expectConfigValidationError({ ...baseValidConfig, adapters: 42 });
    expect(error.message).toContain('adapters');
    expect(error.message.toLowerCase()).toContain('object');
  });

  it('rejects a namespace whose value is a string, naming the namespace path', () => {
    // §4.1 row 6: each namespace VALUE must be a plain object. A string value must
    // throw and the message must name the path `adapters.<name>`. Mutation caught: a
    // per-namespace object check dropped (fail-open: a scalar namespace passes), or an
    // error that names only `adapters` and not the offending namespace key.
    const error = expectConfigValidationError({
      ...baseValidConfig,
      adapters: { git: 'enforce' },
    });
    expect(error.message).toContain('adapters.git');
    expect(error.message.toLowerCase()).toContain('object');
  });

  it('rejects a namespace whose value is an array, naming the namespace path', () => {
    // §4.1 row 6: an array namespace value is typeof 'object' but is not a plain object
    // map. Mutation caught: a per-namespace check using bare `typeof === 'object'`
    // without the `Array.isArray` exclusion, letting an array namespace value pass.
    const error = expectConfigValidationError({
      ...baseValidConfig,
      adapters: { git: ['enforce'] },
    });
    expect(error.message).toContain('adapters.git');
    expect(error.message.toLowerCase()).toContain('object');
  });

  it('rejects a namespace whose value is null, naming the namespace path', () => {
    // §4.1 row 6 boundary: null is typeof 'object' but is not a plain object. Mutation
    // caught: a per-namespace check that forgets the null exclusion (`x !== null`),
    // letting a null namespace value pass as a would-be map.
    const error = expectConfigValidationError({
      ...baseValidConfig,
      adapters: { git: null },
    });
    expect(error.message).toContain('adapters.git');
  });
});

// ---------------------------------------------------------------------------
// §4.2 — normalizeProtectedPaths input narrowed to `{ protectedPaths?: string[] }`.
// The `adapters` input is REMOVED. The union step disappears; every other
// normalization rule (trim, './' and trailing '/' fixpoint strip, empty-drop,
// first-occurrence dedupe) is unchanged.
//
// These tests re-pin the narrowed contract. Existing protected-paths.test.ts
// still asserts the union-with-adapters behavior; those are obsolete under this
// ticket and are reconciled at GREEN/REVIEW — this file does not touch them.
// ---------------------------------------------------------------------------

describe('§4.2 normalizeProtectedPaths — narrowed to protectedPaths only', () => {
  it('normalizes protectedPaths without an adapters input', () => {
    // §4.2: the input is `{ protectedPaths?: string[] }`. The output is the normalized
    // protectedPaths alone — no adapters union. Mutation caught: a residual adapters
    // union step reading a now-absent field, or a resolver that drops protectedPaths.
    const result = normalizeProtectedPaths({ protectedPaths: ['src/core', 'src/covenant'] });

    expect(result).toEqual(['src/core', 'src/covenant']);
  });

  it('returns an empty array when protectedPaths is absent', () => {
    // §4.2 boundary: absent protectedPaths yields []. Mutation caught: a fallback that
    // injects a default path (e.g. '' or '.'), which would over-match every input.
    const result = normalizeProtectedPaths({});

    expect(result).toEqual([]);
  });

  it('applies the unchanged normalization rules (trim, ./ and trailing / strip, dedupe)', () => {
    // §4.2: the per-entry rules survive verbatim. This pins trim, leading-'./' and
    // trailing-'/' fixpoint strip, and first-occurrence dedupe in one case. Mutation
    // caught: any of those rules dropped while removing the adapters union.
    const result = normalizeProtectedPaths({
      protectedPaths: ['  ./x/y//  ', 'x/y', 'a/b/'],
    });

    expect(result).toEqual(['x/y', 'a/b']);
  });

  it('drops empty-equivalent entries after normalization', () => {
    // §4.2: empty-drop rule survives. P0 fail-open: an unchecked '' or '/' substring-
    // matches every input, turning the protection surface into a match-everything sieve.
    // Mutation caught: the empty-drop step removed alongside the adapters union.
    const result = normalizeProtectedPaths({ protectedPaths: ['', '/', '  ', 'real/path'] });

    expect(result).toEqual(['real/path']);
  });
});
