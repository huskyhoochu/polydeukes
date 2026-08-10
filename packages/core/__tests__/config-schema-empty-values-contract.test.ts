import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// CONFIG-09 AC-5 — schema ⟺ defineConfig equivalence for the five new empty-value
// rejections (§4.2). Same mechanics as config-schema-contract.test.ts: every NEW
// constraint carries one invalid fixture asserted on BOTH sides — the published
// schema rejects it (minLength 1; for logPath the trim boundary needs the \S
// pattern, the witness.token idiom) AND defineConfig throws. If only one side
// rejects, the schema and validator have drifted.
//
// Dummy commands are FAKE (`fake-runner`) so the core grep gate stays satisfied
// even inside fixtures.
// ---------------------------------------------------------------------------

const schemaPath = fileURLToPath(new URL('../schema/polydeukes.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const validLanguages = {
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
};

// One invalid fixture per new constraint (§4.2 table), plus the trim boundary.
const INVALID_CONFIGS: readonly unknown[] = [
  // CONFIG-09 — string-form forbid empty.
  { ...validLanguages, disciplines: [{ id: 'empty-forbid', forbid: '' }] },
  // CONFIG-09 — forbid.added empty.
  { ...validLanguages, disciplines: [{ id: 'empty-added', forbid: { added: '' } }] },
  // CONFIG-09 — forbidCommand empty.
  { ...validLanguages, disciplines: [{ id: 'empty-cmd', forbidCommand: '' }] },
  // CONFIG-09 — protectedPaths with an empty element next to a valid one.
  { ...validLanguages, protectedPaths: ['src/covenant/**', ''] },
  // CONFIG-09 — telemetry.logPath empty. Boundary: trim-length 0 ⟺ schema minLength 1.
  { ...validLanguages, telemetry: { logPath: '' } },
  // CONFIG-09 — telemetry.logPath whitespace-only. Boundary: validator trim() ⟺ schema
  // `pattern: \S` (at least one non-whitespace character) — minLength alone misses this.
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

describe('AC-5 schema ⟺ defineConfig equivalence — empty-value fixtures (INVALID)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    // Both sides must reject. A one-sided rejection means the published schema and the
    // runtime validator no longer describe the same language.
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
