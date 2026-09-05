import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config.ts';
import { validate, validLanguages } from './helpers.ts';

// Schema ⟺ defineConfig equivalence for a judged entry's `enforce` key ('block' | 'advise',
// closed). For each VALID fixture defineConfig must accept AND ajv must validate; for each
// INVALID fixture defineConfig must throw AND ajv must reject. A one-sided verdict means the
// published schema and the validator have drifted — the equivalence IS the contract.
//
// Every constraint the key carries needs its own invalid fixture, or one side can go blind
// to it: the closed enumeration, the string type, and the draft branch's closed key set.

/** Attach one disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...validLanguages, disciplines };
}

/** The declaration every entry below carries; only the level under test varies. */
const ban = {
  mechanism: 'forbidden-command',
  scope: { source: 'command' },
  extract: {
    hits: [{ op: 'source', of: 'command' }, { op: 'lines' }, { op: 'matches', re: 'zzz_banned' }],
  },
  relate: [{ id: 'no-hit', relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
};

const VALID_CONFIGS: readonly unknown[] = [
  withDisciplines([{ id: 'softly-held', declare: ban, enforce: 'advise' }]),
  withDisciplines([{ id: 'hard-held', declare: ban, enforce: 'block' }]),
  // The key beside an enforce-less sibling and a draft: the level must be admitted by the
  // judged oneOf branch while the draft branch keeps refusing it.
  withDisciplines([
    { id: 'plain-held', declare: ban },
    { id: 'soft-held', declare: ban, enforce: 'advise' },
    { id: 'bilingual-docs-sync', why: 'keep the en and ko doc mirrors in sync', draft: true },
  ]),
];

const INVALID_CONFIGS: readonly unknown[] = [
  // An unknown level — the enumeration is closed.
  withDisciplines([{ id: 'measured-probe', declare: ban, enforce: 'measure' }]),
  // A boolean kills a schema that types the key loosely and a validator that tests
  // presence or truthiness rather than the value.
  withDisciplines([{ id: 'boolean-probe', declare: ban, enforce: true }]),
  // A draft carrying the level — pins the draft branch's `additionalProperties: false`,
  // whose key set stays id·why·draft.
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

describe('enforce schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid enforce fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    // Both sides must accept. A validator-only key leaves every consumer's IDE schema
    // rejecting it; a schema-only key validates configs defineConfig still throws on.
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('enforce schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid enforce fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    // Both sides must reject; a one-sided rejection is the drift this file exists to catch.
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
