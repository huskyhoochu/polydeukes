import { describe, expect, it } from 'vitest';
// A judged `disciplines:` entry may carry `enforce: 'block' | 'advise'` — the middle rung
// of the promotion ladder draft → advise → block. The enumeration is closed and applies to
// judged entries only: a draft never judges, so a level on one is dead data.
import { ConfigValidationError, defineConfig } from '../src/index.ts';

// Entries stay plain objects routed through the `unknown` seam so that every assertion
// below is a runtime validation failure rather than a compile failure.

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

describe('defineConfig disciplines — enforce acceptance', () => {
  it("accepts a judged entry with enforce: 'advise' and carries it verbatim into disciplines", () => {
    // The compiler reads the level off the resolved entry and defaults a missing one to
    // advise, so a validator that strips the key on the way through fails OPEN: an entry
    // that declared block would be judged at advise with nothing to show it was demoted.
    const resolved = defineConfig(withDisciplines([adviseEntry]));

    expect(resolved.disciplines).toEqual([adviseEntry]);
  });

  it("accepts a judged entry with enforce: 'block' and carries it verbatim", () => {
    // Explicit block is not redundant with the default: absence means "inherit", explicit
    // means "fixed", so an explicit block survives a change to the default posture.
    const resolved = defineConfig(withDisciplines([blockEntry]));

    expect(resolved.disciplines).toEqual([blockEntry]);
  });

  it('does not fabricate an enforce key on an entry that omits it', () => {
    // A validator that default-fills the key would freeze today's default into every
    // config, so a later change to the default could no longer reach these entries.
    const resolved = defineConfig(withDisciplines([plainEntry]));

    expect(resolved.disciplines).toEqual([plainEntry]);
    expect('enforce' in (resolved.disciplines?.[0] as object)).toBe(false);
  });
});

describe('defineConfig disciplines — enforce rejections', () => {
  it("rejects the unknown level 'measure', naming the entry", () => {
    // The enumeration is closed rather than "any string": a typo'd or speculative level
    // would otherwise judge silently at whichever branch default the code falls into.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'measured-probe', forbid: 'x', enforce: 'measure' }]),
    );

    expect(error.message).toContain('measured-probe');
  });

  it('rejects a non-string enforce (true), naming the entry', () => {
    // Under a truthiness check `enforce: true` reads as "some level" and falls into a
    // branch nobody chose, so the value is validated by the enumeration, not by presence.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'boolean-probe', forbid: 'x', enforce: true }]),
    );

    expect(error.message).toContain('boolean-probe');
  });

  it('rejects a draft entry carrying enforce (the draft key set stays id·why·draft)', () => {
    // A draft never judges, so a level on one is dead data implying a judgment that never
    // happens: the draft branch's key set stays closed against it.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-enforce', why: 'w', draft: true, enforce: 'advise' }]),
    );

    expect(error.message).toContain('draft-with-enforce');
  });
});
