import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfig, normalizeProtectedPaths } from '../src/index.ts';

// `adapters` is a namespace map: keys are unvalidated ecosystem names and values must be
// plain objects whose CONTENTS core never inspects — the vocabulary belongs to each adapter,
// whose own validator rejects unknown keys. Fixtures are typed `unknown` because the loader
// feeds defineConfig parsed data the compiler never saw, and testCmd bodies use fake shell
// commands because the core never runs the command it carries.

const baseValidConfig = {
  languages: {
    typescript: {
      productionGlob: 'packages/core/src/**/*',
      testCmd: 'fake-runner {scope} --strict',
    },
  },
} as const;

/** Asserts the concrete error instance and returns it so callers can assert on the message. */
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
    // Absent stays absent — a default-fill assigning `adapters: {}` or `adapters: undefined`
    // would erase the distinction between an omitted key and an empty map.
    const resolved = defineConfig(baseValidConfig);

    expect('adapters' in resolved).toBe(false);
  });

  it('accepts an empty adapters map and exposes it verbatim as an empty object', () => {
    // An emptiness check must neither reject the empty map nor drop the key from the output.
    const resolved = defineConfig({ ...baseValidConfig, adapters: {} });

    expect(resolved.adapters).toEqual({});
  });

  it('exposes a namespace value with arbitrary unknown content verbatim (deep equal, unmutated)', () => {
    // Content is not validated, so the exposure must be deep-equal to the input: this catches
    // a validator that strips namespace content or a resolver that shallow-copies nested keys.
    const adaptersInput = { git: { anything: 1, nested: { deep: ['a', 'b'] } } };
    const resolved = defineConfig({ ...baseValidConfig, adapters: adaptersInput });

    expect(resolved.adapters).toEqual({ git: { anything: 1, nested: { deep: ['a', 'b'] } } });
    expect(adaptersInput).toEqual({ git: { anything: 1, nested: { deep: ['a', 'b'] } } });
  });

  it('accepts multiple namespaces, each with its own arbitrary content', () => {
    // Two namespaces catch a resolver that keeps only the first, or one that checks
    // namespace names against a fixed allowlist.
    const resolved = defineConfig({
      ...baseValidConfig,
      adapters: { git: { enforce: 'advise' }, docker: { foo: true } },
    });

    expect(resolved.adapters).toEqual({ git: { enforce: 'advise' }, docker: { foo: true } });
  });
});

describe('§4.1 adapters namespace map — rejected shapes (fail closed at authoring time)', () => {
  it('rejects the old array form with a migration message pointing to protectedPaths', () => {
    // An array used to be a directory list unioned into the protection surface. Accepting one
    // now is a fail-open regression to those semantics, and an error without the destination
    // field leaves an author stranded on a silent breaking change.
    const error = expectConfigValidationError({
      ...baseValidConfig,
      adapters: ['packages/adapter-foo', 'packages/adapter-bar'],
    });
    expect(error.message).toContain('adapters');
    expect(error.message).toContain('protectedPaths');
  });

  it('rejects an empty array (old form) with the same migration message', () => {
    // An array is never a namespace map, empty included: an array check gated on non-empty
    // length would let `adapters: []` through as a would-be map.
    const error = expectConfigValidationError({ ...baseValidConfig, adapters: [] });
    expect(error.message).toContain('adapters');
    expect(error.message).toContain('protectedPaths');
  });

  it('rejects a string adapters value, naming that adapters must be an object map', () => {
    const error = expectConfigValidationError({ ...baseValidConfig, adapters: 'git' });
    expect(error.message).toContain('adapters');
    expect(error.message.toLowerCase()).toContain('object');
  });

  it('rejects a numeric adapters value, naming that adapters must be an object map', () => {
    // The second primitive: a check that special-cases strings but no other primitive.
    const error = expectConfigValidationError({ ...baseValidConfig, adapters: 42 });
    expect(error.message).toContain('adapters');
    expect(error.message.toLowerCase()).toContain('object');
  });

  it('rejects a namespace whose value is a string, naming the namespace path', () => {
    // The message must name `adapters.<name>`, not just `adapters` — an error that names only
    // the container leaves the author hunting for the offending namespace.
    const error = expectConfigValidationError({
      ...baseValidConfig,
      adapters: { git: 'enforce' },
    });
    expect(error.message).toContain('adapters.git');
    expect(error.message.toLowerCase()).toContain('object');
  });

  it('rejects a namespace whose value is an array, naming the namespace path', () => {
    // An array is typeof 'object': a per-namespace check without the `Array.isArray`
    // exclusion lets it pass.
    const error = expectConfigValidationError({
      ...baseValidConfig,
      adapters: { git: ['enforce'] },
    });
    expect(error.message).toContain('adapters.git');
    expect(error.message.toLowerCase()).toContain('object');
  });

  it('rejects a namespace whose value is null, naming the namespace path', () => {
    // null is typeof 'object' too: the third exclusion a per-namespace check must carry.
    const error = expectConfigValidationError({
      ...baseValidConfig,
      adapters: { git: null },
    });
    expect(error.message).toContain('adapters.git');
  });
});

// normalizeProtectedPaths takes `{ protectedPaths?: string[] }` alone — no adapters union.
// Every per-entry rule (trim, './' and trailing '/' fixpoint strip, empty-drop,
// first-occurrence dedupe) survives that narrowing, which is what these tests re-pin.

describe('§4.2 normalizeProtectedPaths — narrowed to protectedPaths only', () => {
  it('normalizes protectedPaths without an adapters input', () => {
    const result = normalizeProtectedPaths({ protectedPaths: ['src/core', 'src/covenant'] });

    expect(result).toEqual(['src/core', 'src/covenant']);
  });

  it('returns an empty array when protectedPaths is absent', () => {
    // A fallback injecting a default path ('' or '.') would over-match every input.
    const result = normalizeProtectedPaths({});

    expect(result).toEqual([]);
  });

  it('applies the unchanged normalization rules (trim, ./ and trailing / strip, dedupe)', () => {
    // One fixture pins trim, leading-'./' and trailing-'/' fixpoint strip, and
    // first-occurrence dedupe together.
    const result = normalizeProtectedPaths({
      protectedPaths: ['  ./x/y//  ', 'x/y', 'a/b/'],
    });

    expect(result).toEqual(['x/y', 'a/b']);
  });

  it('drops empty-equivalent entries after normalization', () => {
    // An unchecked '' or '/' substring-matches every input, turning the protection surface
    // into a match-everything sieve.
    const result = normalizeProtectedPaths({ protectedPaths: ['', '/', '  ', 'real/path'] });

    expect(result).toEqual(['real/path']);
  });
});
