import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfig } from '../src/config.ts';

// testCmd bodies are deliberately fake shell commands (`fake-runner`, never a real test
// runner's name) because the core never runs the command a `testCmd` carries.

const validTwoLanguageConfig = {
  languages: {
    typescript: {
      productionGlob: 'packages/core/src/**/*',
      testCmd: 'fake-runner {scope} --strict',
    },
    python: {
      productionGlob: ['services/api/**/*.py', 'services/worker/**/*.py'],
      testCmd: 'fake-py-runner {scope}',
    },
  },
} as const;

// Asserts the concrete error instance, not just "did it throw", and returns it so
// callers can assert on the message.
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

describe('template testCmd — valid path and {scope} substitution', () => {
  it('accepts a template testCmd and substitutes {scope} into the compiled command', () => {
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.languages.typescript.testCmd('pkg-a')).toBe('fake-runner pkg-a --strict');
  });

  it('substitutes every {scope} occurrence (replaceAll semantics), not just the first', () => {
    // Catches `replaceAll` weakened to `replace`, which leaves later tokens literal.
    const resolved = defineConfig({
      languages: {
        typescript: {
          productionGlob: 'packages/core/src/**/*',
          testCmd: 'fake-runner {scope} && fake-lint {scope} --in {scope}',
        },
      },
    });

    expect(resolved.languages.typescript.testCmd('pkg-a')).toBe(
      'fake-runner pkg-a && fake-lint pkg-a --in pkg-a',
    );
  });

  it('produces the same command as an equivalent v1 function fixture across sample scopes', () => {
    // The template must behave exactly like plain string interpolation, so a
    // same-intent function is the oracle across several scopes.
    const v1Fn = (scope: string): string => `fake-runner ${scope} && fake-lint ${scope}`;
    const resolved = defineConfig({
      languages: {
        typescript: {
          productionGlob: 'packages/core/src/**/*',
          testCmd: 'fake-runner {scope} && fake-lint {scope}',
        },
      },
    });

    for (const scope of ['pkg-a', 'services/api', 'a b', '']) {
      expect(resolved.languages.typescript.testCmd(scope)).toBe(v1Fn(scope));
    }
  });

  it('accepts a template without {scope} and returns it verbatim when called', () => {
    // A scope-ignoring command (whole-suite run) is valid — `{scope}` is not mandated.
    const resolved = defineConfig({
      languages: {
        typescript: {
          productionGlob: 'packages/core/src/**/*',
          testCmd: 'fake-runner --all',
        },
      },
    });

    expect(resolved.languages.typescript.testCmd('pkg-a')).toBe('fake-runner --all');
  });

  it('preserves non-{scope} braces (${VAR}, {a,b}, awk {print}) verbatim', () => {
    // Only the literal token `{scope}` is substituted; other braces are the shell's own
    // vocabulary. Catches a naive `{...}` regex that eats any brace group.
    const resolved = defineConfig({
      languages: {
        typescript: {
          productionGlob: 'packages/core/src/**/*',
          testCmd: "fake-runner ${VAR} {a,b} {scope} && fake-awk 'BEGIN {print}'",
        },
      },
    });

    expect(resolved.languages.typescript.testCmd('pkg-a')).toBe(
      "fake-runner ${VAR} {a,b} pkg-a && fake-awk 'BEGIN {print}'",
    );
  });

  it('inserts scope values containing $-replacement patterns ($&, $$) literally', () => {
    // A string replacement argument lets GetSubstitution interpret $-patterns, so scope
    // '$&' would re-insert '{scope}' and '$$' would collapse to '$'.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.languages.typescript.testCmd('$&')).toBe('fake-runner $& --strict');
    expect(resolved.languages.typescript.testCmd('$$')).toBe('fake-runner $$ --strict');
  });

  it('preserves input fields (productionGlob, multi-language) in the resolved value', () => {
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.languages.typescript.productionGlob).toBe('packages/core/src/**/*');
    expect(resolved.languages.python.productionGlob).toEqual([
      'services/api/**/*.py',
      'services/worker/**/*.py',
    ]);
    expect(resolved.languages.python.testCmd('services/api')).toBe('fake-py-runner services/api');
  });
});

describe('telemetry default-fill (v1 valid-path regression, v2 fixtures)', () => {
  it('fills the default telemetry.logPath when telemetry is omitted entirely', () => {
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.telemetry.logPath).toBe('.polydeukes/roi.log');
  });

  it('fills the default telemetry.logPath when telemetry is present but logPath is omitted', () => {
    // The telemetry object exists but its logPath key is absent — catches a default-fill
    // guarded on `telemetry` truthiness rather than on the field.
    const resolved = defineConfig({ ...validTwoLanguageConfig, telemetry: {} });

    expect(resolved.telemetry.logPath).toBe('.polydeukes/roi.log');
  });

  it('preserves an explicitly set telemetry.logPath instead of overriding it with the default', () => {
    // The default must not clobber a user-supplied value.
    const resolved = defineConfig({
      ...validTwoLanguageConfig,
      telemetry: { logPath: 'custom/telemetry.log' },
    });

    expect(resolved.telemetry.logPath).toBe('custom/telemetry.log');
  });

  it('preserves a valid adapters namespace map in the returned ResolvedConfig', () => {
    // Catches the adapters field being dropped from the return value, which would leave
    // downstream consumers blind to every adapter namespace.
    const resolved = defineConfig({
      ...validTwoLanguageConfig,
      adapters: { git: { enforce: 'advise' } },
    });

    expect(resolved.adapters).toEqual({ git: { enforce: 'advise' } });
  });
});

describe('testCmd rejection — function and non-string templates', () => {
  it('rejects a function testCmd and its message names the string-template migration', () => {
    // A function testCmd is the shape an older schema accepted, so the message has to
    // guide migration rather than merely reject.
    const invalidConfig = {
      languages: {
        typescript: {
          productionGlob: 'packages/core/src/**/*',
          testCmd: (scope: string) => `fake-runner ${scope}`,
        },
      },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('typescript');
    expect(error.message).toContain('testCmd');
    expect(error.message.toLowerCase()).toContain('string');
    expect(error.message.toLowerCase()).toContain('template');
  });

  it('rejects an empty-string testCmd, naming the language key and field path', () => {
    // An empty string is "present but invalid", a distinct shape from a function.
    const invalidConfig = {
      languages: {
        typescript: {
          productionGlob: 'packages/core/src/**/*',
          testCmd: '',
        },
      },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('typescript');
    expect(error.message).toContain('testCmd');
  });
});

describe('top-level non-object input', () => {
  it('rejects null input', () => {
    // A null top level must surface as a validation error, not a raw TypeError.
    expectConfigValidationError(null);
  });

  it('rejects an array input', () => {
    // An array is typeof 'object' but not a config record — catches an object check
    // missing the `Array.isArray` exclusion.
    expectConfigValidationError(['languages']);
  });
});

describe('unknown key rejection (fail-closed — typos must not silently disable discipline)', () => {
  it('rejects an unknown top-level key (protectedPath typo), naming the offending key', () => {
    // A `protectedPath:` typo (missing `s`) would silently drop the protection surface —
    // a fail-open accident.
    const invalidConfig = {
      ...validTwoLanguageConfig,
      protectedPath: ['src/covenant/**'],
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('protectedPath');
  });

  it('rejects an unknown LanguageProfile key (testCommand typo), naming the offending key', () => {
    // A `testCommand:` typo leaves the real testCmd unset while the typo is ignored.
    const invalidConfig = {
      languages: {
        typescript: {
          productionGlob: 'packages/core/src/**/*',
          testCommand: 'fake-runner {scope}',
        },
      },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('testCommand');
  });

  it('rejects an unknown telemetry key (logPathh typo), naming the offending key', () => {
    // A `logPathh:` typo would leave the real logPath defaulted while the intended
    // override is silently dropped.
    const invalidConfig = {
      ...validTwoLanguageConfig,
      telemetry: { logPathh: 'custom/telemetry.log' },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('logPathh');
  });
});

describe('telemetry.logPath type', () => {
  it('rejects a non-string telemetry.logPath', () => {
    // The validator must agree with the published JSON Schema, so a number here has to
    // be rejected rather than passed through.
    const invalidConfig = {
      ...validTwoLanguageConfig,
      telemetry: { logPath: 42 },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('logPath');
  });
});

describe('v1 failure-path regression (fixtures ported to v2 templates)', () => {
  it('rejects a missing productionGlob, naming the language key and field', () => {
    const invalidConfig = {
      languages: {
        typescript: {
          testCmd: 'fake-runner {scope}',
        },
      },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('typescript');
    expect(error.message).toContain('productionGlob');
  });

  it('rejects an empty-string productionGlob', () => {
    // An empty string is "present but invalid", distinct from "missing".
    expectConfigValidationError({
      languages: {
        typescript: { productionGlob: '', testCmd: 'fake-runner {scope}' },
      },
    });
  });

  it('rejects an empty-array productionGlob', () => {
    // An array carrying zero glob patterns is as invalid as a missing field.
    expectConfigValidationError({
      languages: {
        typescript: { productionGlob: [], testCmd: 'fake-runner {scope}' },
      },
    });
  });

  it('rejects a productionGlob array with an empty-string element', () => {
    // A non-empty array can still hide an invalid empty-string element.
    expectConfigValidationError({
      languages: {
        typescript: {
          productionGlob: ['packages/core/src/**/*', ''],
          testCmd: 'fake-runner {scope}',
        },
      },
    });
  });

  it('rejects a null language profile, naming the language key', () => {
    // A null profile must surface as a validation error with a field path, not a raw
    // TypeError from dereferencing it.
    const error = expectConfigValidationError({ languages: { typescript: null } });
    expect(error.message).toContain('typescript');
  });

  it('rejects missing languages', () => {
    expectConfigValidationError({});
  });

  it('rejects an empty languages object', () => {
    // `languages` present but carrying zero entries is a distinct failure surface from
    // "missing entirely"; both are rejected.
    expectConfigValidationError({ languages: {} });
  });

  it('rejects protectedPaths with a non-string element', () => {
    // Catches the every-element-is-string check on protectedPaths being dropped.
    expectConfigValidationError({
      ...validTwoLanguageConfig,
      protectedPaths: ['src/covenant/**', 42],
    });
  });

  it('rejects the removed adapters directory-list form', () => {
    // An array is the removed directory-list shape and must fail closed at config
    // authoring time; the migration wording is pinned in the adapters-namespace file.
    expectConfigValidationError({
      ...validTwoLanguageConfig,
      adapters: ['packages/adapter-foo', 'packages/adapter-bar'],
    });
  });
});

describe('top-level $schema key', () => {
  it('accepts a string $schema key and omits it from the resolution output', () => {
    // `$schema` is an IDE reference: accepted, and absent from the resolution output.
    const resolved = defineConfig({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...validTwoLanguageConfig,
    });

    expect(resolved).not.toHaveProperty('$schema');
    expect(resolved.languages.typescript.testCmd('pkg-a')).toBe('fake-runner pkg-a --strict');
  });

  it('rejects a non-string $schema (number)', () => {
    // The key is allowed but still type-checked — catches an additive change to the
    // allowed key set that skips the string check.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      $schema: 42,
    });
    expect(error.message).toContain('$schema');
  });
});

// The witness cases below are validator-only and stay out of the schema-contract file.
// Infinity and NaN are outside the JSON number system, so no schema keyword rejects
// them, yet a YAML parser produces them from `.inf`/`.nan` — `defineConfig` is the only
// check on that path. The pass-through assertions inspect the ResolvedConfig object
// shape, which the accept/reject schema-contract file does not exercise.
describe('witness — validator-only non-finite ttlMinutes rejection', () => {
  it('rejects ttlMinutes Infinity, naming the witness.ttlMinutes field path', () => {
    // Infinity > 0 is true, so finiteness is the gate — catches a bare `ttlMinutes > 0`
    // check that drops the `Number.isFinite` half.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      witness: { token: 'fake-witness-token', ttlMinutes: Number.POSITIVE_INFINITY },
    });
    expect(error.message).toContain('witness.ttlMinutes');
  });

  it('rejects ttlMinutes NaN, naming the witness.ttlMinutes field path', () => {
    // NaN fails both halves of the check, but an inverted form (`!(ttlMinutes <= 0)`)
    // would wrongly admit it.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      witness: { token: 'fake-witness-token', ttlMinutes: Number.NaN },
    });
    expect(error.message).toContain('witness.ttlMinutes');
  });
});

describe('witness — field-path-named error messages', () => {
  it('names witness.token when the token is whitespace-only', () => {
    // Catches a `trim()` dropped from the emptiness check, which would admit '   '.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      witness: { token: '   ', ttlMinutes: 10 },
    });
    expect(error.message).toContain('witness.token');
  });

  it('names witness.ttlMinutes when ttlMinutes is zero', () => {
    // At the exclusive lower bound: catches `> 0` weakened to `>= 0`.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      witness: { token: 'fake-witness-token', ttlMinutes: 0 },
    });
    expect(error.message).toContain('witness.ttlMinutes');
  });
});

describe('witness — verbatim pass-through and absence in ResolvedConfig', () => {
  it('passes a valid witness through verbatim with no unit conversion', () => {
    // The unit conversion is the consumer's arithmetic, never the core's: ttlMinutes
    // must survive resolution unchanged rather than becoming milliseconds.
    const resolved = defineConfig({
      ...validTwoLanguageConfig,
      witness: { token: 'fake-witness-token', ttlMinutes: 10 },
    });

    expect(resolved.witness).toEqual({ token: 'fake-witness-token', ttlMinutes: 10 });
    expect(resolved.witness?.ttlMinutes).toBe(10);
  });

  it('does not fabricate a witness key when the config omits witness', () => {
    // Absent stays absent: not even `witness: undefined` may be fabricated.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect('witness' in resolved).toBe(false);
  });
});
