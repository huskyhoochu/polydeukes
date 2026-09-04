import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The migration-specific half of the config key rename to `witness:`: the old key is
// rejected as unknown (the config is one hand-edited file, and accepting both would hide
// whether the migration happened), and the published schema speaks the new vocabulary
// alone. Acceptance and sub-key validation live in config.test.ts and
// config-schema-contract.test.ts. The old word appears here only as the subject under test.
import { ConfigValidationError, defineConfig } from '../src/config.ts';

// `testCmd` is deliberately `fake-runner`: the value is opaque to the core, which never
// runs it, so naming a real runner would suggest a coupling that does not exist.
const validBaseConfig = {
  languages: {
    typescript: {
      productionGlob: 'packages/core/src/**/*',
      testCmd: 'fake-runner {scope}',
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

describe('witness key — old-key rejection', () => {
  it('rejects the old waiver key as an unknown top-level key', () => {
    // The old key must fail loud, naming the key, so an unfinished migration is visible at
    // load time. Accepting it silently resolves to a config whose valve values are ignored,
    // and the valve then never opens for the human either — a lockout with no error.
    const error = expectConfigValidationError({
      ...validBaseConfig,
      waiver: { token: 'fake-witness-token', ttlMinutes: 10 },
    });
    expect(error.message).toContain('waiver');
  });
});

describe('published JSON Schema — witness present, old vocabulary gone', () => {
  it('the schema declares a witness property and $defs entry and never mentions the old key', () => {
    // The published schema moves with the validator. Renaming the runtime validator while
    // the schema still advertises the old key steers every IDE-guided config author straight
    // into the unknown-key rejection.
    const schemaPath = fileURLToPath(new URL('../schema/polydeukes.schema.json', import.meta.url));
    const raw = readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(raw) as {
      properties?: Record<string, unknown>;
      $defs?: Record<string, unknown>;
    };

    expect(schema.properties?.witness).toBeDefined();
    expect(schema.$defs?.witness).toBeDefined();
    expect(raw).not.toMatch(/waiv/i);
  });
});
