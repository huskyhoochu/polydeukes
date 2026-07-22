import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// CONFIG-07 §4.3 — schema ⟺ defineConfig equivalence for the `adapters`
// namespace map. Mirrors the structure of config-schema-contract.test.ts: for
// each VALID fixture, defineConfig must accept AND ajv must validate; for each
// INVALID fixture, defineConfig must throw AND ajv must reject. If a single
// fixture is rejected by only one side, the schema and validator have drifted.
// The equivalence IS the contract.
//
// One fixture per §4.3 constraint. Invalid: array (old form), string,
// namespace value string, namespace value array. Valid: empty map, one
// namespace with arbitrary content (absent is already covered by the existing
// contract file). Dummy commands are FAKE (`fake-runner`) so the core grep gate
// stays satisfied even inside fixtures.
//
// New fixtures live in this NEW file (not the existing contract file) because
// the RED phase must not modify existing test files.
// ---------------------------------------------------------------------------

const schemaPath = fileURLToPath(new URL('../schema/polydeukes.schema.json', import.meta.url));
const schemaSource = readFileSync(schemaPath, 'utf8');
const schema = JSON.parse(schemaSource) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

// A valid single-language config the adapters fixtures attach to.
const validLanguages = {
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
};

const VALID_CONFIGS: readonly unknown[] = [
  // §4.3 valid ⑥ — empty namespace map.
  { ...validLanguages, adapters: {} },
  // §4.3 valid ⑦ — one namespace with arbitrary content (content is NOT validated;
  // its verbatim acceptance must hold on BOTH the schema and the validator side).
  { ...validLanguages, adapters: { git: { anything: 1, enforce: 'advise' } } },
];

const INVALID_CONFIGS: readonly unknown[] = [
  // §4.3 invalid ① — old array form. A directory list is no longer a valid adapters value.
  { ...validLanguages, adapters: ['packages/adapter-foo', 'packages/adapter-bar'] },
  // §4.1 boundary — the EMPTY old-form array must reject on both sides too: a schema
  // relaxation that lets [] through while the validator still throws would otherwise
  // drift undetected (review finding, PR #30).
  { ...validLanguages, adapters: [] },
  // §4.3 invalid ② — string adapters value (non-object).
  { ...validLanguages, adapters: 'git' },
  // §4.3 invalid ③ — namespace value is a string (must be an object).
  { ...validLanguages, adapters: { git: 'enforce' } },
  // §4.3 invalid ④ — namespace value is an array (typeof object but not a plain-object map).
  { ...validLanguages, adapters: { git: ['enforce'] } },
  // §4.1 boundary — a null namespace value must reject on both sides (JSON Schema
  // `type: object` excludes null; the validator's plain-object check must agree).
  { ...validLanguages, adapters: { git: null } },
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

describe('§4.3 adapters schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid adapters fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    // Both sides must accept. If either rejects a genuinely valid adapters config,
    // the schema and validator have drifted.
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('§4.3 adapters schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid adapters fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    // Both sides must reject. If only one rejects, the equivalence — the whole point
    // of publishing a schema alongside the validator — is broken.
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
