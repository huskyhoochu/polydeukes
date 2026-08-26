import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/index.ts';
import { validate, validLanguages } from './helpers.ts';

// Schema ⟺ defineConfig equivalence for the `adapters` namespace map. For each VALID
// fixture defineConfig must accept AND ajv must validate; for each INVALID fixture
// defineConfig must throw AND ajv must reject. A fixture rejected by only one side means
// the published schema and the validator have drifted — the equivalence IS the contract.
// One fixture per constraint the map carries.

const VALID_CONFIGS: readonly unknown[] = [
  { ...validLanguages, adapters: {} },
  // Namespace content is NOT validated; its verbatim acceptance must hold on BOTH sides.
  { ...validLanguages, adapters: { git: { anything: 1, enforce: 'advise' } } },
];

const INVALID_CONFIGS: readonly unknown[] = [
  // The old array form: a directory list is no longer a valid adapters value.
  { ...validLanguages, adapters: ['packages/adapter-foo', 'packages/adapter-bar'] },
  // The EMPTY old-form array is its own fixture: a schema relaxation that lets [] through
  // while the validator still throws would otherwise drift undetected.
  { ...validLanguages, adapters: [] },
  { ...validLanguages, adapters: 'git' },
  { ...validLanguages, adapters: { git: 'enforce' } },
  // An array is typeof object but not a plain-object map.
  { ...validLanguages, adapters: { git: ['enforce'] } },
  // JSON Schema `type: object` excludes null; the validator's plain-object check must agree.
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
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('§4.3 adapters schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid adapters fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
