import { describe, expect, it } from 'vitest';
// Import from the package entry point (src/index.ts) — the same surface
// `@polydeukes/core` publishes.
import {
  ConfigValidationError,
  defineConfig,
  type LanguageProfile,
  type PolydeukesConfig,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — PRD §4.1 schema. Language keys are plausible user values
// ('typescript'/'python'); testCmd bodies are deliberately FAKE shell commands
// so the core's grep gate (no vitest/pytest/go test literals) stays satisfied
// even inside test fixtures.
// ---------------------------------------------------------------------------

function fakeProfile(scopePrefix: string): LanguageProfile {
  return {
    productionGlob: `${scopePrefix}/src/**/*`,
    testCmd: (scope: string) => `fake-runner run ${scope}`,
  };
}

const validTwoLanguageConfig: PolydeukesConfig = {
  languages: {
    typescript: fakeProfile('packages/core'),
    python: {
      productionGlob: ['services/api/**/*.py', 'services/worker/**/*.py'],
      testCmd: (scope: string) => `fake-py-runner ${scope}`,
    },
  },
};

// Shared assertion for the invalid-path tests: asserts the concrete error instance
// (not just "did it throw") and returns it so callers can assert on the message.
function expectConfigValidationError(invalidConfig: PolydeukesConfig): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

describe('§5.1 defineConfig valid path', () => {
  it('accepts a valid config with two languages and preserves input fields in the return value', () => {
    // Mutation caught: defineConfig that drops a language key, mutates productionGlob,
    // or replaces testCmd with a different function than the one supplied.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.languages.typescript.productionGlob).toBe('packages/core/src/**/*');
    expect(resolved.languages.python.productionGlob).toEqual([
      'services/api/**/*.py',
      'services/worker/**/*.py',
    ]);
    expect(resolved.languages.typescript.testCmd).toBe(
      validTwoLanguageConfig.languages.typescript.testCmd,
    );
    expect(resolved.languages.python.testCmd).toBe(validTwoLanguageConfig.languages.python.testCmd);
  });

  it('languages[key].testCmd(scope) on the returned config returns a non-empty string', () => {
    // Mutation caught: defineConfig wrapping testCmd in something that returns '' or
    // undefined instead of forwarding the original function's shell-string result.
    const resolved = defineConfig(validTwoLanguageConfig);

    const tsCommand = resolved.languages.typescript.testCmd('packages/core');
    const pyCommand = resolved.languages.python.testCmd('services/api');

    expect(typeof tsCommand).toBe('string');
    expect(tsCommand.length).toBeGreaterThan(0);
    expect(typeof pyCommand).toBe('string');
    expect(pyCommand.length).toBeGreaterThan(0);
  });

  it('fills the default telemetry.logPath when telemetry is omitted entirely', () => {
    // Mutation caught: a default-filling step that is skipped, or that fills the wrong
    // constant path.
    const resolved = defineConfig(validTwoLanguageConfig);

    expect(resolved.telemetry?.logPath).toBe('.polydeukes/roi.log');
  });

  it('fills the default telemetry.logPath when telemetry is present but logPath is omitted', () => {
    // Boundary: telemetry object exists (not undefined) but its logPath key is absent —
    // catches a default-fill guarded only on `telemetry` truthiness, not on the field.
    const resolved = defineConfig({ ...validTwoLanguageConfig, telemetry: {} });

    expect(resolved.telemetry?.logPath).toBe('.polydeukes/roi.log');
  });

  it('preserves an explicitly set telemetry.logPath instead of overriding it with the default', () => {
    // P1 across-boundary case: the default must NOT clobber a user-supplied value.
    // Mutation caught: defineConfig that always writes the default regardless of input.
    const resolved = defineConfig({
      ...validTwoLanguageConfig,
      telemetry: { logPath: 'custom/telemetry.log' },
    });

    expect(resolved.telemetry?.logPath).toBe('custom/telemetry.log');
  });
});

describe('§5.2 defineConfig invalid path (throws ConfigValidationError)', () => {
  it('throws when a language is missing productionGlob, naming the language key and field', () => {
    // P0: fail-closed at developer time. Mutation caught: validation that skips the
    // productionGlob-presence check entirely, or a message that omits the offending path.
    const invalidConfig = {
      languages: {
        typescript: {
          // productionGlob deliberately omitted — invalid input under test.
          testCmd: (scope: string) => `fake-runner run ${scope}`,
        },
      },
      // Deliberately invalid literal (productionGlob missing) — route the cast through
      // `unknown` because the shapes intentionally do not overlap.
    } as unknown as PolydeukesConfig;

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('typescript');
    expect(error.message).toContain('productionGlob');
  });

  it('throws when productionGlob is an empty string', () => {
    // Boundary: empty string is a "present but invalid" value, distinct from "missing".
    const invalidConfig: PolydeukesConfig = {
      languages: {
        typescript: {
          productionGlob: '',
          testCmd: (scope: string) => `fake-runner run ${scope}`,
        },
      },
    };

    expectConfigValidationError(invalidConfig);
  });

  it('throws when productionGlob is an empty array', () => {
    // Boundary: an array form that carries zero glob patterns is as invalid as a
    // missing field — mutation caught: a length check on the array being skipped.
    const invalidConfig: PolydeukesConfig = {
      languages: {
        typescript: {
          productionGlob: [],
          testCmd: (scope: string) => `fake-runner run ${scope}`,
        },
      },
    };

    expectConfigValidationError(invalidConfig);
  });

  it('throws when productionGlob array contains an empty string element', () => {
    // Boundary: a non-empty array can still hide an invalid empty-string element.
    // Mutation caught: validation that only checks array length, not each element.
    const invalidConfig: PolydeukesConfig = {
      languages: {
        typescript: {
          productionGlob: ['packages/core/src/**/*', ''],
          testCmd: (scope: string) => `fake-runner run ${scope}`,
        },
      },
    };

    expectConfigValidationError(invalidConfig);
  });

  it('throws when a language profile is not an object, naming the language key', () => {
    // A null/primitive profile must surface as the promised ConfigValidationError with a
    // field path — not escape as a raw TypeError from dereferencing the profile.
    const invalidConfig = {
      languages: { typescript: null },
      // Deliberately invalid literal (profile is null) — route the cast through `unknown`
      // because the shapes intentionally do not overlap.
    } as unknown as PolydeukesConfig;

    const error = expectConfigValidationError(invalidConfig);
    expect(error.message).toContain('typescript');
  });

  it('throws when languages is missing', () => {
    // P0: a config with no language axis at all must never pass validation silently.
    const invalidConfig = {} as PolydeukesConfig;

    expectConfigValidationError(invalidConfig);
  });

  it('throws when languages is an empty object', () => {
    // Boundary: `languages` present as a key but carrying zero entries — distinct
    // failure surface from "missing entirely", both must be rejected the same way.
    const invalidConfig: PolydeukesConfig = { languages: {} };

    expectConfigValidationError(invalidConfig);
  });

  it('throws when testCmd is not a function', () => {
    // Mutation caught: a typeof-function check on testCmd removed or weakened to
    // accept any truthy value (e.g. a string template).
    const invalidConfig = {
      languages: {
        typescript: {
          productionGlob: 'packages/core/src/**/*',
          testCmd: 'fake-runner run packages/core',
        },
      },
      // Deliberately invalid literal (testCmd is a string, not a function) — route the
      // cast through `unknown` because the shapes intentionally do not overlap.
    } as unknown as PolydeukesConfig;

    expectConfigValidationError(invalidConfig);
  });

  it('throws when protectedPaths contains a non-string element', () => {
    // Mutation caught: an every-element-is-string check on protectedPaths dropped,
    // letting a stray number/object slip through the grate meant for CONFIG-02.
    const invalidConfig = {
      ...validTwoLanguageConfig,
      // Deliberately invalid literal: 42 is not a string. The spread widens the type
      // enough that no directive is needed — only the runtime check can catch this.
      protectedPaths: ['src/covenant/**', 42],
    } as unknown as PolydeukesConfig;

    expectConfigValidationError(invalidConfig);
  });
});
