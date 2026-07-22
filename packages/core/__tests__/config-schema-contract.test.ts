import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
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
// COVENANT-10 §4.1 / AC §5.1 (last item): `disciplines` fixtures extend the same
// equivalence harness. The schema uses `format: 'regex'` for the pattern fields, so
// the Ajv instance is armed with ajv-formats (already a devDependency) — otherwise
// format keywords are ignored and the non-compilable-regex fixtures would drift.
//
// Dummy commands are FAKE (`fake-runner`, never vitest/pytest/go test) so the
// core grep gate stays satisfied even inside fixtures. `guard|harness|kb` appears
// only inside a discipline forbid pattern — that is discipline DATA (AC §5.7 exempts
// pattern literals from the vocabulary gate).
// ---------------------------------------------------------------------------

// The schema artifact — hand-written, published at core/schema/polydeukes.schema.json.
// It does not exist yet: in the RED phase this import path resolves to nothing and
// this whole file is EXPECTED to fail here.
const schemaPath = fileURLToPath(new URL('../schema/polydeukes.schema.json', import.meta.url));
const schemaSource = readFileSync(schemaPath, 'utf8');
const schema = JSON.parse(schemaSource) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Arm format validation ('regex' etc.) so the schema's `format: regex` pattern fields
// are actually enforced — required for the discipline regex-compilability fixtures.
addFormats(ajv);
const validate = ajv.compile(schema);

// A valid single-language config the discipline fixtures attach to.
const validLanguages = {
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
};

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
  // Optional fields present and well-typed (adapters fixtures live in the dedicated
  // config-schema-adapters-contract file since CONFIG-07).
  {
    languages: {
      typescript: {
        productionGlob: 'packages/core/src/**/*',
        testCmd: 'fake-runner {scope}',
      },
    },
    protectedPaths: ['src/covenant/**'],
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
  // COVENANT-10: one entry per predicate family, string-shorthand and object-form forbid.
  {
    ...validLanguages,
    disciplines: [
      {
        id: 'vocabulary',
        why: 'ban new control-framing vocabulary',
        in: ['packages/core/src/**'],
        except: 'packages/core/src/legacy/**',
        forbid: '\\b(guard|harness|kb)\\b',
      },
      { id: 'object-forbid', forbid: { added: '#[0-9a-f]{6}' } },
      { id: 'config-immutable', immutable: ['config/*.lock'] },
      { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=(0|false)\\b' },
    ],
  },
  // CONFIG-03 §5.2: a top-level `$schema` string (IDE reference) must be accepted by
  // BOTH the validator and the JSON Schema. The equivalence is only enforced where a
  // fixture exists (dev-log lesson) — so the opening carries its own fixture.
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...validLanguages,
  },
  // CONFIG-05 — minimal valid waiver: token non-empty, ttlMinutes finite and > 0.
  // The optional top-level `waiver` key with BOTH required fields must be accepted by
  // both the validator and the JSON Schema.
  {
    ...validLanguages,
    waiver: { token: 'fake-waive-token', ttlMinutes: 10 },
  },
];

const INVALID_CONFIGS: readonly unknown[] = [
  // CONFIG-03 §5.2: a non-string `$schema` must be rejected by both sides — the key is
  // allowed but still type-checked.
  {
    ...validLanguages,
    $schema: 42,
  },
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
  // COVENANT-10 — zero predicate keys.
  { ...validLanguages, disciplines: [{ id: 'no-predicate', why: 'oops' }] },
  // COVENANT-10 — two predicate keys.
  { ...validLanguages, disciplines: [{ id: 'two', forbid: 'x', immutable: 'y/**' }] },
  // COVENANT-10 — deferred forbid direction (removed).
  { ...validLanguages, disciplines: [{ id: 'removed-dir', forbid: { removed: 'x' } }] },
  // COVENANT-10 — deferred forbid direction (present).
  { ...validLanguages, disciplines: [{ id: 'present-dir', forbid: { present: 'x' } }] },
  // COVENANT-10 — forbid object with non-string added.
  { ...validLanguages, disciplines: [{ id: 'added-number', forbid: { added: 1 } }] },
  // COVENANT-10 — empty forbid object.
  { ...validLanguages, disciplines: [{ id: 'empty-forbid', forbid: {} }] },
  // COVENANT-10 — unknown per-entry key (enforce).
  { ...validLanguages, disciplines: [{ id: 'has-enforce', forbid: 'x', enforce: 'advise' }] },
  // COVENANT-10 — in on a non-forbid (immutable) entry.
  { ...validLanguages, disciplines: [{ id: 'immutable-with-in', immutable: 'y/**', in: 'z/**' }] },
  // COVENANT-10 — except on a forbidCommand entry.
  {
    ...validLanguages,
    disciplines: [{ id: 'command-with-except', forbidCommand: 'x', except: 'z/**' }],
  },
  // COVENANT-10 — duplicate id across entries. The two entries are FULLY identical
  // (copy-paste duplication): JSON Schema cannot express by-key uniqueness, so the
  // schema side rejects via uniqueItems while defineConfig rejects by id.
  {
    ...validLanguages,
    disciplines: [
      { id: 'dup', forbid: 'a' },
      { id: 'dup', forbid: 'a' },
    ],
  },
  // COVENANT-10 — non-string why (schema types it; the validator must agree — REVIEW
  // caught this as a latent one-sided rejection).
  { ...validLanguages, disciplines: [{ id: 'why-typed', forbid: 'a', why: 123 }] },
  // COVENANT-10 — empty-string id.
  { ...validLanguages, disciplines: [{ id: '', forbid: 'a' }] },
  // COVENANT-10 — non-string id.
  { ...validLanguages, disciplines: [{ id: 7, forbid: 'a' }] },
  // COVENANT-10 — non-compilable forbid regex (format: regex catches this).
  { ...validLanguages, disciplines: [{ id: 'bad-forbid-re', forbid: '(' }] },
  // COVENANT-10 — non-compilable forbidCommand regex.
  { ...validLanguages, disciplines: [{ id: 'bad-cmd-re', forbidCommand: '(' }] },
  // COVENANT-10 — disciplines not an array.
  { ...validLanguages, disciplines: { id: 'x', forbid: 'a' } },
  // COVENANT-10 — a disciplines entry that is not an object.
  { ...validLanguages, disciplines: ['not-an-object'] },
  // CONFIG-05 — waiver is a string (non-object). The `waiver` value must be an object;
  // a scalar has neither `token` nor `ttlMinutes`.
  { ...validLanguages, waiver: 'covenant-waive' },
  // CONFIG-05 — waiver is an array. An array is typeof 'object' but is not a waiver record.
  { ...validLanguages, waiver: ['covenant-waive'] },
  // CONFIG-05 — unknown key inside waiver (`ttl` typo alongside the two required fields).
  // The waiver-level unknown-key gate mirrors the telemetry precedent.
  { ...validLanguages, waiver: { token: 'fake-waive-token', ttlMinutes: 10, ttl: 5 } },
  // CONFIG-05 — token missing (only ttlMinutes present). Both fields are required.
  { ...validLanguages, waiver: { ttlMinutes: 10 } },
  // CONFIG-05 — token non-string (number).
  { ...validLanguages, waiver: { token: 123, ttlMinutes: 10 } },
  // CONFIG-05 — token empty string. Boundary: trim-length 0 ⟺ schema minLength 1.
  { ...validLanguages, waiver: { token: '', ttlMinutes: 10 } },
  // CONFIG-05 — token whitespace-only. Boundary: validator `token.trim().length === 0`
  // ⟺ schema `pattern: \S` (requires at least one non-whitespace character).
  { ...validLanguages, waiver: { token: '   ', ttlMinutes: 10 } },
  // CONFIG-05 — ttlMinutes missing (only token present). Both fields are required.
  { ...validLanguages, waiver: { token: 'fake-waive-token' } },
  // CONFIG-05 — ttlMinutes non-number (string).
  { ...validLanguages, waiver: { token: 'fake-waive-token', ttlMinutes: '10' } },
  // CONFIG-05 — ttlMinutes 0. Boundary AT the exclusive lower bound: 0 is excluded
  // (validator `ttlMinutes > 0` ⟺ schema `exclusiveMinimum: 0`).
  { ...validLanguages, waiver: { token: 'fake-waive-token', ttlMinutes: 0 } },
  // CONFIG-05 — ttlMinutes negative. Boundary ACROSS the exclusive lower bound.
  { ...validLanguages, waiver: { token: 'fake-waive-token', ttlMinutes: -5 } },
  // CONFIG-05 — per-discipline waiver key is STILL rejected (COVENANT-10 §2 reservation).
  // Enforced by the discipline-entry unknown-key gate; a `waiver` key on an entry must throw.
  {
    ...validLanguages,
    disciplines: [{ id: 'per-discipline-waiver', forbid: 'x', waiver: { ttlMinutes: 5 } }],
  },
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
