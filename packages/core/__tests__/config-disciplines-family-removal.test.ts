import { describe, expect, it } from 'vitest';
// The change-axis families are gone from the entry grammar: an entry carrying `forbid` or
// `immutable` is refused by its own key name with a pointer at `declare:` — not as an
// unknown key, so an author with yesterday's config reads what to rewrite on the first run.
// The predicate set is three (forbidCommand | requirePrecedent | declare); `in`/`except`
// stay on the context family, which still reads them.
import { ConfigValidationError, defineConfig } from '../src/config.ts';

// The banned-pattern text is a fixture value with no relation to this repo's vocabulary.
const PATTERN = '\\b(lantern)\\b';
const GLOB = 'records/archive/**';

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

describe('defineConfig disciplines — the removed change-axis keys are refused by name', () => {
  it("rejects an entry carrying `forbid`, naming the key and pointing at declare: (mechanism 'added-only')", () => {
    // A validator that still admits `forbid` registers an entry no family judges — armed
    // in the config, inert at runtime. One that refuses it as an unknown key leaves the
    // author without the rewrite target.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'old-forbid', forbid: PATTERN }]),
    );

    expect(error.message).toContain('disciplines[0]');
    expect(error.message).toContain("'forbid' is no longer an entry key");
    expect(error.message).toContain('declare:');
    expect(error.message).toContain('added-only');
  });

  it('rejects an entry carrying `immutable`, naming the key and pointing at declare:', () => {
    // Second key, same door: refusing `forbid` by name and `immutable` through the generic
    // unknown-key path leaves the second migration message unwritten.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'old-immutable', immutable: [GLOB] }]),
    );

    expect(error.message).toContain('disciplines[0]');
    expect(error.message).toContain("'immutable' is no longer an entry key");
    expect(error.message).toContain('declare:');
  });

  it('the exactly-one-predicate message lists forbidCommand | requirePrecedent | declare and neither removed key', () => {
    // The predicate list is the closed set the cardinality gate counts over; a list that
    // still names the removed keys counts an entry carrying one as having a predicate.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'no-predicate', why: 'nothing to judge' }]),
    );

    expect(error.message).toContain('(forbidCommand | requirePrecedent | declare)');
    expect(error.message).not.toContain('immutable');
    expect(error.message).not.toMatch(/\bforbid\s*\|/);
  });

  it('still accepts `in` and `except` on a requirePrecedent entry, carried verbatim', () => {
    // The scope keys leave with the context family, not with the change-axis families: a
    // removal that drops them from the admitted set breaks every live context entry.
    const disciplines = [
      {
        id: 'manifest-needs-view',
        in: ['lib/**'],
        except: 'lib/legacy/**',
        requirePrecedent: { command: 'npm view ' },
      },
    ];

    expect(defineConfig(withDisciplines(disciplines)).disciplines).toEqual(disciplines);
  });
});
