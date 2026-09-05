import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config.ts';
import { validate, validLanguages } from './helpers.ts';

// Schema ⟺ defineConfig equivalence for the empty-value rejections: every constraint carries
// one invalid fixture asserted on BOTH sides. If only one side rejects, the published schema
// and the runtime validator have drifted.

// One invalid fixture per constraint, plus the trim boundary.
const INVALID_CONFIGS: readonly unknown[] = [
  { ...validLanguages, disciplines: [{ id: 'empty-forbid', forbid: '' }] },
  { ...validLanguages, disciplines: [{ id: 'empty-added', forbid: { added: '' } }] },
  // The empty element sits next to a valid one: per-element checking is what is under test.
  { ...validLanguages, protectedPaths: ['src/covenant/**', ''] },
  // Boundary: validator trim-length 0 ⟺ schema minLength 1.
  { ...validLanguages, telemetry: { logPath: '' } },
  // Boundary: validator trim() ⟺ schema `pattern: \S` — minLength alone misses whitespace.
  { ...validLanguages, telemetry: { logPath: '  ' } },
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

describe('schema ⟺ defineConfig equivalence — empty-value fixtures (INVALID)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
