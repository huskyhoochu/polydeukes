import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Equivalence contract (PRD §4.4 / §5.3): the hand-written JSON Schema and the
// runtime `defineConfig()` validator must agree on every JSON-representable
// input. For each VALID fixture, defineConfig must accept AND ajv must validate;
// for each INVALID fixture, defineConfig must throw AND ajv must reject. If a
// single fixture is rejected by only one side, the schema and validator have
// drifted — and the test fails. The equivalence IS the contract.
//
// Scope of the fixtures here is exactly the JSON-representable inputs. Non-JSON
// rejections (a function testCmd) are structurally unrepresentable in a schema,
// so they are covered by config.test.ts alone, not this file.
//
// Dummy commands are FAKE (`fake-runner`, never vitest/pytest/go test) so the
// core grep gate stays satisfied even inside fixtures.
// ---------------------------------------------------------------------------

// The schema artifact — hand-written, published at core/schema/polydeukes.schema.json.
// It does not exist yet: in the RED phase this import path resolves to nothing and
// this whole file is EXPECTED to fail here.
const schemaPath = fileURLToPath(new URL('../schema/polydeukes.schema.json', import.meta.url));
const schemaSource = readFileSync(schemaPath, 'utf8');
const schema = JSON.parse(schemaSource) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// Shared fixtures — JSON-representable only.
const VALID_CONFIGS: readonly unknown[] = [
  // Minimal single-language config with a {scope} template.
  {
    languages: {
      typescript: {
        productionGlob: 'packages/core/src/**/*',
        testCmd: 'fake-runner {scope} --strict',
      },
    },
  },
  // productionGlob as an array; a scope-free template (no {scope}).
  {
    languages: {
      python: {
        productionGlob: ['services/api/**/*.py', 'services/worker/**/*.py'],
        testCmd: 'fake-py-runner --all',
      },
    },
  },
  // All optional fields present and well-typed.
  {
    languages: {
      typescript: {
        productionGlob: 'packages/core/src/**/*',
        testCmd: 'fake-runner {scope}',
      },
    },
    protectedPaths: ['src/covenant/**'],
    adapters: ['packages/adapter-foo'],
    telemetry: { logPath: 'custom/telemetry.log' },
  },
  // telemetry present but empty (logPath omitted — default is filled by the validator,
  // and the schema treats logPath as optional).
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    telemetry: {},
  },
];

const INVALID_CONFIGS: readonly unknown[] = [
  // Missing languages.
  {},
  // Empty languages object.
  { languages: {} },
  // Empty-string testCmd template.
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: '' },
    },
  },
  // Non-string testCmd (number) — a JSON-representable wrong type.
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 42 },
    },
  },
  // Missing productionGlob.
  {
    languages: {
      typescript: { testCmd: 'fake-runner {scope}' },
    },
  },
  // Empty-string productionGlob.
  {
    languages: {
      typescript: { productionGlob: '', testCmd: 'fake-runner {scope}' },
    },
  },
  // Empty-array productionGlob.
  {
    languages: {
      typescript: { productionGlob: [], testCmd: 'fake-runner {scope}' },
    },
  },
  // productionGlob array with an empty-string element.
  {
    languages: {
      typescript: {
        productionGlob: ['packages/core/src/**/*', ''],
        testCmd: 'fake-runner {scope}',
      },
    },
  },
  // Unknown top-level key (protectedPath typo).
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    protectedPath: ['src/covenant/**'],
  },
  // Unknown LanguageProfile key (testCommand typo).
  {
    languages: {
      typescript: {
        productionGlob: 'packages/core/src/**/*',
        testCmd: 'fake-runner {scope}',
        testCommand: 'fake-runner {scope}',
      },
    },
  },
  // Unknown telemetry key (logPathh typo).
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    telemetry: { logPathh: 'custom/telemetry.log' },
  },
  // Non-string telemetry.logPath.
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    telemetry: { logPath: 42 },
  },
  // protectedPaths with a non-string element.
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    protectedPaths: ['src/covenant/**', 42],
  },
  // Top-level non-object (array).
  ['languages'],
];

/** True when defineConfig accepts the input (does not throw). */
function defineConfigAccepts(config: unknown): boolean {
  try {
    defineConfig(config);
    return true;
  } catch {
    return false;
  }
}

describe('§5.3 JSON Schema artifact', () => {
  it('declares the draft 2020-12 $schema', () => {
    // AC §5.3: the artifact must be a draft 2020-12 schema. Mutation caught: a schema
    // authored against an older draft that ajv/dist/2020 would silently misinterpret.
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });
});

describe('§5.3 schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    // Both sides must accept. If either side rejects a genuinely valid config, the
    // schema and validator have drifted.
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('§5.3 schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    // Both sides must reject. If only one side rejects, the equivalence — the whole
    // point of publishing a schema alongside the validator — is broken.
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
