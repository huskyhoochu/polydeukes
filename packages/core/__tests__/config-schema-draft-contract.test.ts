import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/index.ts';
import { validate, validLanguages } from './helpers.ts';

// ---------------------------------------------------------------------------
// CONFIG-10 AC-3 — schema ⟺ defineConfig equivalence for the draft entry
// (`{ id, why, draft: true }`, the discipline oneOf's fifth branch). Mirrors
// config-schema-context-family-contract.test.ts: for each VALID fixture,
// defineConfig must accept AND ajv must validate; for each INVALID fixture,
// defineConfig must throw AND ajv must reject. A one-sided verdict means the
// schema and validator have drifted — the equivalence IS the contract.
//
// Dev-log gate (core.dev-log.schema-equivalence-blind-without-fixture): every
// constraint of the new draft branch gets its own invalid fixture — required
// why, why minLength, why type (the historical `why: 123` blind spot), the
// draft literal `true` (both directions), and the closed key set (one predicate
// fixture guards the whole `additionalProperties: false` gate; the per-key axis
// lives in config-disciplines-draft.test.ts where each validator branch differs).
// Id collisions stay validator-only: entries that differ beyond the id are
// outside what uniqueItems can express (COVENANT-10 precedent), so those
// fixtures live in config-disciplines-draft.test.ts.
// ---------------------------------------------------------------------------

/** Attach one disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...validLanguages, disciplines };
}

const VALID_CONFIGS: readonly unknown[] = [
  // AC-1 — the accept fixture: id + non-empty why + draft: true, nothing else.
  withDisciplines([
    { id: 'bilingual-docs-sync', why: 'keep the en and ko doc mirrors in sync', draft: true },
  ]),
  // AC-1 — the mixed array (2 judged + 1 draft): the draft branch must coexist with the
  // four judged branches inside one array.
  withDisciplines([
    { id: 'no-todo', forbid: 'TODO' },
    { id: 'bilingual-docs-sync', why: 'keep the en and ko doc mirrors in sync', draft: true },
    { id: 'changelog-immutable', immutable: 'CHANGELOG.md' },
  ]),
];

const INVALID_CONFIGS: readonly unknown[] = [
  // --- why: required, non-empty string (the draft's only body) ---
  // why absent (required boundary).
  withDisciplines([{ id: 'draft-no-why', draft: true }]),
  // Empty-string why (minLength boundary).
  withDisciplines([{ id: 'draft-empty-why', why: '', draft: true }]),
  // Non-string why (type boundary — the `why: 123` blind spot on the new branch).
  withDisciplines([{ id: 'draft-why-number', why: 123, draft: true }]),
  // --- closed key set: no predicate, no scope, no trigger ---
  // draft + predicate key — one fixture guards the whole closed-key-set gate
  // (`additionalProperties: false` on the draft branch rejects every extra key by the
  // same mechanism, so sibling keys would re-test the same gate).
  withDisciplines([{ id: 'draft-with-forbid', why: 'w', draft: true, forbid: 'x' }]),
  // --- draft literal: only `true` exists ---
  // draft: false — dead data synonymous with absence.
  withDisciplines([{ id: 'dead-draft-false', why: 'w', draft: false }]),
  // draft: 1 — a truthy non-boolean; kills a schema mutant that loosens `const: true`
  // into a bare type constraint (and the validator mutant that tests truthiness).
  withDisciplines([{ id: 'draft-truthy-number', why: 'w', draft: 1 }]),
  // --- id constraints apply to the draft branch too ---
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

describe('CONFIG-10 AC-3 — draft schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid draft fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    // Both sides must accept. Mutation caught: only one side gaining the draft branch —
    // a validator-only draft would leave every consumer's IDE schema rejecting it, and
    // a schema-only draft would validate configs defineConfig still throws on.
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('CONFIG-10 AC-3 — draft schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid draft fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    // Both sides must reject. A one-sided rejection is exactly the `why: 123` blind
    // spot the dev-log gate exists to prevent — here probed on the NEW branch.
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
