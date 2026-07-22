import { describe, expect, it } from 'vitest';
// Import from the package entry point (src/index.ts) — the same surface
// `@polydeukes/core` publishes.
import { ConfigValidationError, defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — PRD §4.1 schema v2 (config-as-data). `testCmd` is now a `{scope}`
// template STRING, not a function. Language keys are plausible user values
// ('typescript'/'python'); testCmd bodies are deliberately FAKE shell commands
// (`fake-runner`, never vitest/pytest/go test) so the core's grep gate stays
// satisfied even inside test fixtures.
//
// `defineConfig(unknown)` is the runtime validator: fixtures are typed as
// `unknown` at the call boundary because the loader (CONFIG-03) feeds it parsed
// data the compiler never saw. We use plain object literals and route through
// `unknown` where the shapes intentionally do not overlap.
// ---------------------------------------------------------------------------

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

// Shared assertion for the invalid-path tests: asserts the concrete error instance
// (not just "did it throw") and returns it so callers can assert on the message.
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

describe('§5.1 template testCmd — valid path and {scope} substitution', () => {
  it('accepts a template testCmd and substitutes {scope} into the compiled command', () => {
    // AC §5.1: 'fake-runner {scope} --strict' passes validation and the compiled
    // testCmd('pkg-a') returns 'fake-runner pkg-a --strict'.
    // Mutation caught: a compile step that forwards the raw template unchanged, or
    // substitutes the wrong token / wrong position.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.languages.typescript.testCmd('pkg-a')).toBe('fake-runner pkg-a --strict');
  });

  it('substitutes every {scope} occurrence (replaceAll semantics), not just the first', () => {
    // AC §5.1: multi-occurrence template — all occurrences replaced.
    // Mutation caught: `replaceAll` weakened to `replace` (only the first hit),
    // which would leave later `{scope}` tokens literal.
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
    // AC §5.1 (roadmap AC verbatim): a same-intent v1 function (test-local fixture
    // only) and the v2 template yield identical strings for several scopes,
    // including a multi-occurrence template.
    // Mutation caught: any substitution divergence from plain string interpolation.
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
    // AC §5.1: a scope-ignoring command (whole-suite run) is valid — {scope} is not
    // mandated. Called with any scope, it returns the original text unchanged.
    // Mutation caught: a validator that mandates {scope} presence, or a compile step
    // that mangles a scope-free template.
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
    // AC §5.1 + §4.2: only the literal token `{scope}` is substituted; other braces
    // are shell's own vocabulary and must survive untouched.
    // Mutation caught: a naive `{...}` regex that eats any brace group, corrupting
    // legitimate shell syntax.
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
    // PR #20 review fix (executed counterexample): a string replacement argument lets
    // GetSubstitution interpret $-patterns, so scope '$&' would re-insert '{scope}' and
    // '$$' would collapse to '$'. The compiled testCmd must match v1 string interpolation.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.languages.typescript.testCmd('$&')).toBe('fake-runner $& --strict');
    expect(resolved.languages.typescript.testCmd('$$')).toBe('fake-runner $$ --strict');
  });

  it('preserves input fields (productionGlob, multi-language) in the resolved value', () => {
    // Mutation caught: defineConfig that drops a language key or mutates productionGlob.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.languages.typescript.productionGlob).toBe('packages/core/src/**/*');
    expect(resolved.languages.python.productionGlob).toEqual([
      'services/api/**/*.py',
      'services/worker/**/*.py',
    ]);
    expect(resolved.languages.python.testCmd('services/api')).toBe('fake-py-runner services/api');
  });
});

describe('§5.1 telemetry default-fill (v1 valid-path regression, v2 fixtures)', () => {
  it('fills the default telemetry.logPath when telemetry is omitted entirely', () => {
    // Mutation caught: a default-filling step skipped, or filling the wrong constant.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.telemetry.logPath).toBe('.polydeukes/roi.log');
  });

  it('fills the default telemetry.logPath when telemetry is present but logPath is omitted', () => {
    // Boundary: telemetry object exists (not undefined) but its logPath key is absent —
    // catches a default-fill guarded only on `telemetry` truthiness, not on the field.
    const resolved = defineConfig({ ...validTwoLanguageConfig, telemetry: {} });

    expect(resolved.telemetry.logPath).toBe('.polydeukes/roi.log');
  });

  it('preserves an explicitly set telemetry.logPath instead of overriding it with the default', () => {
    // P1 across-boundary case: the default must NOT clobber a user-supplied value.
    // Mutation caught: defineConfig that always writes the default regardless of input.
    const resolved = defineConfig({
      ...validTwoLanguageConfig,
      telemetry: { logPath: 'custom/telemetry.log' },
    });

    expect(resolved.telemetry.logPath).toBe('custom/telemetry.log');
  });

  it('preserves a valid adapters namespace map in the returned ResolvedConfig', () => {
    // CONFIG-07: adapters is a namespace map. Mutation caught: defineConfig dropping
    // the adapters field from its return value, so downstream consumers never see
    // the adapter namespaces.
    const resolved = defineConfig({
      ...validTwoLanguageConfig,
      adapters: { git: { enforce: 'advise' } },
    });

    expect(resolved.adapters).toEqual({ git: { enforce: 'advise' } });
  });
});

describe('§5.2 testCmd rejection — function and non-string templates', () => {
  it('rejects a function testCmd and its message names the string-template migration', () => {
    // AC §5.2 (v1→v2 inversion): the v1 valid path (testCmd is a function) is now the
    // rejected path. The message must guide migration by mentioning the string template.
    // Mutation caught: a validator that still accepts a function testCmd (fail-open on
    // the core config-as-data invariant), or an error that omits the migration hint.
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
    // Migration guidance must mention that testCmd is now a string template.
    expect(error.message.toLowerCase()).toContain('string');
    expect(error.message.toLowerCase()).toContain('template');
  });

  it('rejects an empty-string testCmd, naming the language key and field path', () => {
    // Boundary: empty string is a "present but invalid" value distinct from a function.
    // Mutation caught: a non-empty check on testCmd skipped.
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

describe('§5.2 top-level non-object input', () => {
  it('rejects null input', () => {
    // AC §5.2: defineConfig(unknown) must reject a null top level, not dereference it
    // into a raw TypeError.
    expectConfigValidationError(null);
  });

  it('rejects an array input', () => {
    // AC §5.2: an array is typeof 'object' but is not a config record.
    // Mutation caught: an object check that forgets `Array.isArray` exclusion.
    expectConfigValidationError(['languages']);
  });
});

describe('§5.2 unknown key rejection (fail-closed — typos must not silently disable discipline)', () => {
  it('rejects an unknown top-level key (protectedPath typo), naming the offending key', () => {
    // AC §5.2 + §4.3: a `protectedPath:` typo (missing `s`) would silently drop the
    // protection surface — a fail-open accident. It must throw and name the key.
    // Mutation caught: `additionalProperties: false` equivalent removed at top level.
    const invalidConfig = {
      ...validTwoLanguageConfig,
      protectedPath: ['src/covenant/**'],
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('protectedPath');
  });

  it('rejects an unknown LanguageProfile key (testCommand typo), naming the offending key', () => {
    // AC §5.2 + §4.3: a `testCommand:` typo leaves the real testCmd unset while the
    // typo is silently ignored — the profile-level unknown-key gate must catch it.
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
    // AC §5.2 + §4.3: telemetry-level unknown-key gate. A `logPathh:` typo would leave
    // the real logPath defaulted while the intended override is dropped.
    const invalidConfig = {
      ...validTwoLanguageConfig,
      telemetry: { logPathh: 'custom/telemetry.log' },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('logPathh');
  });
});

describe('§5.2 telemetry.logPath type (CONFIG-01 intentional-non-scope narrow re-review)', () => {
  it('rejects a non-string telemetry.logPath', () => {
    // AC §5.2 + §4.3: v2 makes the schema⟺validator equivalence a top invariant, so
    // logPath's type must be validated (unlike CONFIG-01 which left it fail-open).
    // Mutation caught: the logPath type check missing, letting a number through and
    // desyncing from the JSON Schema.
    const invalidConfig = {
      ...validTwoLanguageConfig,
      telemetry: { logPath: 42 },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('logPath');
  });
});

describe('§5.2 v1 failure-path regression (fixtures ported to v2 templates)', () => {
  it('rejects a missing productionGlob, naming the language key and field', () => {
    // P0: fail-closed at developer time. Mutation caught: the productionGlob-presence
    // check skipped, or a message that omits the offending path.
    const invalidConfig = {
      languages: {
        typescript: {
          // productionGlob deliberately omitted — invalid input under test.
          testCmd: 'fake-runner {scope}',
        },
      },
    };

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('typescript');
    expect(error.message).toContain('productionGlob');
  });

  it('rejects an empty-string productionGlob', () => {
    // Boundary: empty string is a "present but invalid" value, distinct from "missing".
    expectConfigValidationError({
      languages: {
        typescript: { productionGlob: '', testCmd: 'fake-runner {scope}' },
      },
    });
  });

  it('rejects an empty-array productionGlob', () => {
    // Boundary: an array carrying zero glob patterns is as invalid as a missing field.
    expectConfigValidationError({
      languages: {
        typescript: { productionGlob: [], testCmd: 'fake-runner {scope}' },
      },
    });
  });

  it('rejects a productionGlob array with an empty-string element', () => {
    // Boundary: a non-empty array can still hide an invalid empty-string element.
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
    // A null profile must surface as ConfigValidationError with a field path, not a
    // raw TypeError from dereferencing the profile.
    const error = expectConfigValidationError({ languages: { typescript: null } });
    expect(error.message).toContain('typescript');
  });

  it('rejects missing languages', () => {
    // P0: a config with no language axis at all must never pass validation silently.
    expectConfigValidationError({});
  });

  it('rejects an empty languages object', () => {
    // Boundary: `languages` present as a key but carrying zero entries — a distinct
    // failure surface from "missing entirely", both must be rejected.
    expectConfigValidationError({ languages: {} });
  });

  it('rejects protectedPaths with a non-string element', () => {
    // Mutation caught: an every-element-is-string check on protectedPaths dropped,
    // letting a stray number slip through the grate meant for CONFIG-02.
    expectConfigValidationError({
      ...validTwoLanguageConfig,
      protectedPaths: ['src/covenant/**', 42],
    });
  });

  it('rejects the removed adapters directory-list form', () => {
    // CONFIG-07: an array is the removed directory-list shape — it must fail closed
    // at config authoring time (migration guidance is pinned by the dedicated
    // adapters-namespace test file).
    expectConfigValidationError({
      ...validTwoLanguageConfig,
      adapters: ['packages/adapter-foo', 'packages/adapter-bar'],
    });
  });
});

describe('§5.2 top-level $schema key (CONFIG-03 core opening)', () => {
  it('accepts a string $schema key and omits it from the resolution output', () => {
    // AC §5.2 (item 1): defineConfig accepts a top-level `$schema` string (IDE schema
    // reference) and IGNORES it — it must not appear in the ResolvedConfig. Mutation
    // caught: `$schema` not added to the allowed key set (unknown-key rejection would
    // throw), OR `$schema` leaking into the resolution output.
    const resolved = defineConfig({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...validTwoLanguageConfig,
    });

    expect(resolved).not.toHaveProperty('$schema');
    expect(resolved.languages.typescript.testCmd('pkg-a')).toBe('fake-runner pkg-a --strict');
  });

  it('rejects a non-string $schema (number)', () => {
    // AC §5.2 (item 2): the key is allowed but still type-checked — a non-string
    // `$schema` must throw. Mutation caught: allowing the key without validating its
    // type (a bare additive-to-allowed-set change that skips the string check).
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      $schema: 42,
    });
    expect(error.message).toContain('$schema');
  });
});

// ---------------------------------------------------------------------------
// CONFIG-05 — waiver validator-only behavior (PRD §4.2 / §4.3 fixtures 12–13).
//
// These cases are validator-only — a JSON Schema cannot express them, so they
// live here and NOT in config-schema-contract.test.ts. Rationale: Infinity and
// NaN are outside the JSON number system, so no schema keyword can reject them;
// but the YAML parser CAN still produce them from `.inf`/`.nan`, so `defineConfig`
// is the only guard on that path. Precedent: the function-testCmd fixture is also
// validator-only for the same "structurally unrepresentable in a schema" reason.
//
// The verbatim-pass-through and absence assertions also live here: they inspect
// the ResolvedConfig object shape, which the schema-contract file (accept/reject
// only) does not exercise.
// ---------------------------------------------------------------------------
describe('§4.2 waiver — validator-only non-finite ttlMinutes rejection', () => {
  it('rejects ttlMinutes Infinity, naming the waiver.ttlMinutes field path', () => {
    // §4.2: `!(Number.isFinite(ttlMinutes) && ttlMinutes > 0)` rejects Infinity even
    // though Infinity > 0 is true — finiteness is the gate. A JSON Schema cannot express
    // this (Infinity is outside the JSON number system), so only defineConfig guards it.
    // Mutation caught: a bare `ttlMinutes > 0` check that drops the Number.isFinite half,
    // letting Infinity slip through.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      waiver: { token: 'fake-waive-token', ttlMinutes: Number.POSITIVE_INFINITY },
    });
    expect(error.message).toContain('waiver.ttlMinutes');
  });

  it('rejects ttlMinutes NaN, naming the waiver.ttlMinutes field path', () => {
    // §4.2: NaN fails both Number.isFinite and the `> 0` comparison. The YAML `.nan`
    // path can produce it, so defineConfig is the sole guard. Mutation caught: a check
    // that only compares `ttlMinutes > 0` — NaN comparisons are false, but a mutant that
    // reverses to `!(ttlMinutes <= 0)` would wrongly admit NaN.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      waiver: { token: 'fake-waive-token', ttlMinutes: Number.NaN },
    });
    expect(error.message).toContain('waiver.ttlMinutes');
  });
});

describe('§4.2 waiver — field-path-named error messages', () => {
  it('names waiver.token when the token is whitespace-only', () => {
    // §4.2: `token.trim().length === 0` rejects a whitespace-only token, and the message
    // must name the field path (waiver.token) so the author can locate the offending key.
    // Mutation caught: a trim() dropped from the emptiness check, admitting '   '.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      waiver: { token: '   ', ttlMinutes: 10 },
    });
    expect(error.message).toContain('waiver.token');
  });

  it('names waiver.ttlMinutes when ttlMinutes is zero', () => {
    // §4.2 boundary AT the exclusive lower bound: 0 is excluded (`ttlMinutes > 0`), and
    // the message names the field path. Mutation caught: `> 0` weakened to `>= 0`, which
    // would admit 0.
    const error = expectConfigValidationError({
      ...validTwoLanguageConfig,
      waiver: { token: 'fake-waive-token', ttlMinutes: 0 },
    });
    expect(error.message).toContain('waiver.ttlMinutes');
  });
});

describe('§4.1 waiver — verbatim pass-through and absence in ResolvedConfig', () => {
  it('passes a valid waiver through verbatim with no unit conversion', () => {
    // AC §5.1 + §4.2: the ResolvedConfig carries `waiver` as `{ token, ttlMinutes }`
    // UNCHANGED — no minutes→ms conversion (that is the consumer's arithmetic, not core's).
    // Same verbatim pattern as `disciplines`. Mutation caught: a compile step converting
    // ttlMinutes to milliseconds (10 → 600000), or renaming the field to ttlMs.
    const resolved = defineConfig({
      ...validTwoLanguageConfig,
      waiver: { token: 'fake-waive-token', ttlMinutes: 10 },
    });

    expect(resolved.waiver).toEqual({ token: 'fake-waive-token', ttlMinutes: 10 });
    // Explicitly pin "no unit conversion": ttlMinutes stays 10, never 600000 (ms).
    expect(resolved.waiver?.ttlMinutes).toBe(10);
  });

  it('does not fabricate a waiver key when the config omits waiver', () => {
    // §4.1 / AC §5.1: a waiver-less config must resolve with NO `waiver` key at all —
    // absent stays absent (same no-fabrication rule as `disciplines`). Mutation caught:
    // a default-fill assigning `waiver: {...}` or `waiver: undefined` when the key is absent.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect('waiver' in resolved).toBe(false);
  });
});
