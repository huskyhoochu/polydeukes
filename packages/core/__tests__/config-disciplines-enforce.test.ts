import { describe, expect, it } from 'vitest';
// CONFIG-11 §4.1 — a judged `disciplines:` entry may carry `enforce: 'block' | 'advise'`,
// the promotion ladder's middle rung (draft → advise → block). The validator accepts the
// closed two-value enumeration on judged entries only: an unknown value fails fast
// (CONFIG-06's reservation, enforced), a non-string fails fast, and a draft entry never
// takes the key (its key set stays id·why·draft — a level on an entry that never judges
// is dead data). An absent `enforce` leaves every existing rule untouched.
import { ConfigValidationError, defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures. Same base config as config-disciplines-draft.test.ts. `enforce` is not
// on the shipped DisciplineEntry type yet, so entries stay plain objects routed
// through the `unknown` seam — the assertions are runtime failures, never compile
// failures.
// ---------------------------------------------------------------------------

const baseConfig = {
  languages: {
    typescript: {
      productionGlob: 'packages/core/src/**/*',
      testCmd: 'fake-runner {scope}',
    },
  },
} as const;

/** Attach a disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...baseConfig, disciplines };
}

const adviseEntry = { id: 'softly-held', forbid: 'zzz_banned', enforce: 'advise' };
const blockEntry = { id: 'hard-held', forbid: 'zzz_banned', enforce: 'block' };
const plainEntry = { id: 'plain-held', forbid: 'zzz_banned' };

// Asserts the concrete error instance and returns it so callers can assert on the message.
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

// ===========================================================================
// §4.1 rows 1–2 and 6 — the two accepted levels plus absence, carried verbatim
// ===========================================================================

describe('defineConfig disciplines — enforce acceptance (CONFIG-11 §4.1)', () => {
  it("accepts a judged entry with enforce: 'advise' and carries it verbatim into disciplines", () => {
    // P0 acceptance, and the threading precondition: the compiler reads the level off the
    // resolved entry, so a validator that strips the key on the way through would leave
    // every advise entry judged at block. Mutation caught: enforce rejected as an unknown
    // key, or dropped/rewritten during resolution.
    const resolved = defineConfig(withDisciplines([adviseEntry]));

    expect(resolved.disciplines).toEqual([adviseEntry]);
  });

  it("accepts a judged entry with enforce: 'block' and carries it verbatim", () => {
    // P0 ladder rung: explicit block is NOT dead data — it is the pin that survives a
    // POSTURE-01 default flip (absence ≡ inherit, explicit ≡ fixed). Mutation caught: the
    // enumeration narrowed to 'advise' alone, rejecting the promotion end of the ladder.
    const resolved = defineConfig(withDisciplines([blockEntry]));

    expect(resolved.disciplines).toEqual([blockEntry]);
  });

  it('does not fabricate an enforce key on an entry that omits it', () => {
    // P0 absence row (§4.1 last row): absent means "inherit the default", and a validator
    // default-filling 'block' would freeze today's default into every config, breaking the
    // POSTURE-01 flip. Mutation caught: a default-fill during resolution.
    const resolved = defineConfig(withDisciplines([plainEntry]));

    expect(resolved.disciplines).toEqual([plainEntry]);
    expect('enforce' in (resolved.disciplines?.[0] as object)).toBe(false);
  });
});

// ===========================================================================
// §4.1 rows 3–5 — the rejection rows, each naming the entry
// ===========================================================================

describe('defineConfig disciplines — enforce rejections (CONFIG-11 §4.1)', () => {
  it("rejects the unknown level 'measure', naming the entry", () => {
    // P0 closed enumeration: CONFIG-06 reserved a third level and this fixture is that
    // reservation's enforcement. Mutation caught: the check weakened to "any string",
    // letting a typo'd or speculative level silently judge at whichever branch default
    // the implementation falls into.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'measured-probe', forbid: 'x', enforce: 'measure' }]),
    );

    expect(error.message).toContain('measured-probe');
  });

  it('rejects a non-string enforce (true), naming the entry', () => {
    // P0 type boundary: `enforce: true` under a truthiness check would read as "some
    // level" and fall into a branch nobody chose. Mutation caught: the value validated
    // by presence instead of by the string enumeration.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'boolean-probe', forbid: 'x', enforce: true }]),
    );

    expect(error.message).toContain('boolean-probe');
  });

  it('rejects a draft entry carrying enforce (the draft key set stays id·why·draft)', () => {
    // P0 ladder integrity: a draft never judges, so a level on it is dead data implying
    // a judgment that never happens (CONFIG-10's `in`/`when` principle). Mutation caught:
    // the draft branch's closed key set widened to admit the new key.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-enforce', why: 'w', draft: true, enforce: 'advise' }]),
    );

    expect(error.message).toContain('draft-with-enforce');
  });
});
