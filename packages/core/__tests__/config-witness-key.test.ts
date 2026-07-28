import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// COVENANT-17 §4.2 — what remains once the config key finished renaming `waiver:` →
// `witness:`. Acceptance and the two sub-keys' validation moved to their renamed homes in
// config.test.ts and config-schema-contract.test.ts; only the migration-specific half lives
// here: the old key is rejected as unknown (the config is one hand-edited file, and double
// acceptance would hide whether the migration happened), and the published schema speaks
// the new vocabulary alone. Both keep the old word deliberately — it is the subject under
// test, the same exception telemetry-witnessed-compat.test.ts holds for legacy rows.
import { ConfigValidationError, defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — config.test.ts conventions, copied minimally (they live inline in that
// shipped file): fake shell commands only, and the shared throw-shape assertion.
// ---------------------------------------------------------------------------

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

describe('COVENANT-17 §4.2 witness key — old-key rejection', () => {
  it('rejects the old waiver key as an unknown top-level key', () => {
    // PRD §4.2 — the old key is NOT silently accepted: a config that still says `waiver:`
    // must fail loud, naming the key, so an unfinished migration is visible at load time
    // instead of resolving to a config whose valve values are quietly ignored (the valve
    // would then never open for the human either — a lockout with no error). Mutation
    // caught: both keys left in the allowed set during the transition.
    const error = expectConfigValidationError({
      ...validBaseConfig,
      waiver: { token: 'fake-witness-token', ttlMinutes: 10 },
    });
    expect(error.message).toContain('waiver');
  });
});

describe('COVENANT-17 §4.2 published JSON Schema — witness present, old vocabulary gone', () => {
  it('the schema declares a witness property and $defs entry and never mentions the old key', () => {
    // §4.2 says the published schema moves WITH the validator (the equivalence contract),
    // and AC §5.1's sweep demands zero waive/waiver on the replacement surfaces —
    // packages/**/schema included. Mutation caught: the runtime validator renamed while
    // the schema still advertises `waiver:` to every IDE, steering config authors straight
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
