import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/index.ts';
import { validate, validLanguages } from './helpers.ts';

// ---------------------------------------------------------------------------
// CONFIG-11 AC-1 — schema ⟺ defineConfig equivalence for the judged entry's
// `enforce` key (`'block' | 'advise'`, closed). Mirrors
// config-schema-draft-contract.test.ts: for each VALID fixture, defineConfig must
// accept AND ajv must validate; for each INVALID fixture, defineConfig must throw
// AND ajv must reject. A one-sided verdict means the schema and validator have
// drifted — the equivalence IS the contract.
//
// Dev-log gate (core.dev-log.schema-equivalence-blind-without-fixture): every
// constraint the new node carries gets its own invalid fixture — the closed
// enumeration (an unknown level), the string type (the `why: 123` blind spot's
// shape on this key), and the draft branch's closed key set (enforce on a draft).
// ---------------------------------------------------------------------------

/** Attach one disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...validLanguages, disciplines };
}

const VALID_CONFIGS: readonly unknown[] = [
  // §4.1 row 1 — the middle rung.
  withDisciplines([{ id: 'softly-held', forbid: 'zzz_banned', enforce: 'advise' }]),
  // §4.1 row 2 — the explicit fixed rung.
  withDisciplines([{ id: 'hard-held', forbid: 'zzz_banned', enforce: 'block' }]),
  // The key on every judged family, beside an enforce-less sibling and a draft: the
  // level must be admitted by each judged oneOf branch, not only the delta one.
  withDisciplines([
    { id: 'plain-held', forbid: 'zzz_banned' },
    { id: 'soft-path', immutable: 'CHANGELOG.md', enforce: 'advise' },
    { id: 'soft-command', forbidCommand: 'zzz_cmd', enforce: 'advise' },
    { id: 'soft-context', requirePrecedent: { command: 'zzz view ' }, enforce: 'advise' },
    { id: 'bilingual-docs-sync', why: 'keep the en and ko doc mirrors in sync', draft: true },
  ]),
];

const INVALID_CONFIGS: readonly unknown[] = [
  // --- closed enumeration: only 'block' and 'advise' exist ---
  // An unknown level (CONFIG-06's reserved third value, enforced as a rejection).
  withDisciplines([{ id: 'measured-probe', forbid: 'x', enforce: 'measure' }]),
  // --- type: a string, never a boolean ---
  // `enforce: true` — kills a schema that types the key loosely and a validator
  // that tests presence or truthiness.
  withDisciplines([{ id: 'boolean-probe', forbid: 'x', enforce: true }]),
  // --- draft branch: the key set stays id·why·draft ---
  // A draft carrying the level — one fixture guards the draft branch's
  // `additionalProperties: false` against the new key.
  withDisciplines([{ id: 'draft-with-enforce', why: 'w', draft: true, enforce: 'advise' }]),
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

describe('CONFIG-11 AC-1 — enforce schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid enforce fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    // Both sides must accept. Mutation caught: only one side gaining the key — a
    // validator-only enforce leaves every consumer's IDE schema rejecting it, and a
    // schema-only enforce validates configs defineConfig still throws on.
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('CONFIG-11 AC-1 — enforce schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid enforce fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    // Both sides must reject. A one-sided rejection is exactly the `why: 123` blind
    // spot the dev-log gate exists to prevent — here probed on the NEW key.
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
