import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config.ts';
import { validate, validLanguages } from './helpers.ts';

// Schema ⟺ defineConfig equivalence for the draft entry `{ id, why, draft: true }`, the
// discipline oneOf's fifth branch. For each VALID fixture defineConfig must accept AND ajv
// must validate; for each INVALID one defineConfig must throw AND ajv must reject. A
// one-sided verdict means the two have drifted — the equivalence IS the contract, and it
// holds only where a fixture exists, so every constraint of the draft branch gets one below.
//
// Id-collision fixtures deliberately stay validator-only, in config-disciplines-draft.test.ts:
// entries differing beyond the id are outside what uniqueItems can express.

/** Attach one disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...validLanguages, disciplines };
}

const VALID_CONFIGS: readonly unknown[] = [
  // id + non-empty why + draft: true, nothing else.
  withDisciplines([
    { id: 'bilingual-docs-sync', why: 'keep the en and ko doc mirrors in sync', draft: true },
  ]),
  // A mixed array: the draft branch must coexist with the judged branches inside one array.
  withDisciplines([
    { id: 'no-todo', forbidCommand: 'TODO' },
    { id: 'bilingual-docs-sync', why: 'keep the en and ko doc mirrors in sync', draft: true },
    { id: 'changelog-precedent', requirePrecedent: { command: 'npm view ' } },
  ]),
];

const INVALID_CONFIGS: readonly unknown[] = [
  // why: required, non-empty string (the draft's only body)
  // why absent (required boundary).
  withDisciplines([{ id: 'draft-no-why', draft: true }]),
  // Empty-string why (minLength boundary).
  withDisciplines([{ id: 'draft-empty-why', why: '', draft: true }]),
  // Non-string why — the type constraint a new schema branch is most likely to omit.
  withDisciplines([{ id: 'draft-why-number', why: 123, draft: true }]),
  // closed key set: no predicate, no scope, no trigger
  // One fixture covers the whole closed-key-set gate: `additionalProperties: false` rejects
  // every extra key by the same mechanism, so sibling keys would re-test one gate. The
  // per-key axis, where the validator branches differ, is in config-disciplines-draft.test.ts.
  withDisciplines([{ id: 'draft-with-command', why: 'w', draft: true, forbidCommand: 'x' }]),
  // draft literal: only `true` exists
  // draft: false — dead data synonymous with absence.
  withDisciplines([{ id: 'dead-draft-false', why: 'w', draft: false }]),
  // draft: 1 — a truthy non-boolean, which `draft: false` above cannot catch: it rejects a
  // schema that loosens `const: true` into a bare type constraint, and a validator that
  // tests truthiness.
  withDisciplines([{ id: 'draft-truthy-number', why: 'w', draft: 1 }]),
  // id constraints apply to the draft branch too
  // A draft claiming a reserved meta-covenant label.
  withDisciplines([{ id: 'self-mod', why: 'w', draft: true }]),
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

describe('draft schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid draft fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    // If only one side gains the draft branch, a validator-only draft leaves every
    // consumer's IDE schema rejecting it, and a schema-only draft validates configs
    // defineConfig still throws on.
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('draft schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid draft fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
