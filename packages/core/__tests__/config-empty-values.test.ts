import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfig } from '../src/index.ts';
import { validLanguages } from './helpers.ts';

// ---------------------------------------------------------------------------
// CONFIG-09 §4.2 / AC-3 — empty-string rejection in the five spots where
// defineConfig accepts today what the same-family fields (`when`,
// `requirePrecedent.command`, `witness.token`) already reject. An empty pattern
// matches at every position, so one typo turns a scoped discipline into a
// universal block; an empty logPath silently redirects telemetry.
//
// testCmd bodies are deliberately FAKE runner strings ('fake-runner {scope}')
// so the core grep gate stays satisfied even inside fixtures.
// ---------------------------------------------------------------------------

// Shared assertion for the invalid-path tests: asserts the concrete error instance
// (not just "did it throw") and returns it so callers can assert on the message.
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

describe('§4.2 empty-pattern rejection — discipline predicate fields', () => {
  it('rejects a string-form forbid of "", naming the forbid field', () => {
    // P0: '' compiles as a regex and matches everywhere — the delta entry would break
    // every in-scope edit. Mutation caught: the string-form branch accepting '' while
    // only type-checking.
    const error = expectConfigValidationError({
      ...validLanguages,
      disciplines: [{ id: 'empty-forbid', forbid: '' }],
    });

    expect(error.message).toContain('forbid');
  });

  it('rejects forbid: { added: "" }, naming the forbid field', () => {
    // P0: the object form takes its own validation branch — a fix that only rejects
    // the string shorthand leaves this spelling open. Mutation caught: the added-form
    // branch left without the non-empty check.
    const error = expectConfigValidationError({
      ...validLanguages,
      disciplines: [{ id: 'empty-added', forbid: { added: '' } }],
    });

    expect(error.message).toContain('forbid');
  });

  it('rejects a forbidCommand of "", naming the forbidCommand field', () => {
    // P0: an empty command pattern matches every shell call — the command family would
    // block all of Bash. Mutation caught: the command-family field skipping the
    // non-empty check the delta fields gained.
    const error = expectConfigValidationError({
      ...validLanguages,
      disciplines: [{ id: 'empty-cmd', forbidCommand: '' }],
    });

    expect(error.message).toContain('forbidCommand');
  });
});

describe('§4.2 empty-element rejection — protectedPaths', () => {
  it('rejects an empty-string element among valid ones, naming protectedPaths', () => {
    // P0: an '' entry has no path meaning and rides along silently next to valid
    // entries. Mutation caught: the element check testing only typeof string, or a
    // some/every inversion that lets one empty element hide behind valid siblings.
    const error = expectConfigValidationError({
      ...validLanguages,
      protectedPaths: ['src/covenant/**', ''],
    });

    expect(error.message).toContain('protectedPaths');
  });
});

describe('§4.2 telemetry.logPath — trim-then-non-empty (the witness.token idiom)', () => {
  it('rejects logPath: "", naming logPath', () => {
    // P0: '' passed the type-only check and would resolve telemetry to an empty path.
    // Mutation caught: the logPath validation staying typeof-only.
    const error = expectConfigValidationError({
      ...validLanguages,
      telemetry: { logPath: '' },
    });

    expect(error.message).toContain('logPath');
  });

  it('rejects a whitespace-only logPath, naming logPath', () => {
    // P0 boundary: '  ' has length > 0 but trims to nothing — the same boundary
    // witness.token pins with trim(). Mutation caught: a length check without trim.
    const error = expectConfigValidationError({
      ...validLanguages,
      telemetry: { logPath: '  ' },
    });

    expect(error.message).toContain('logPath');
  });
});

describe('§6 invariant — non-empty values in the same five spots stay accepted', () => {
  it('accepts non-empty forbid (both forms) and forbidCommand entries', () => {
    // P0 the mirror direction: the new rejections must not over-reach. A valid pattern
    // in each predicate spot resolves. Mutation caught: a non-empty check inverted or
    // applied to the wrong field.
    const resolved = defineConfig({
      ...validLanguages,
      disciplines: [
        { id: 'string-form', forbid: '\\bTODO\\b' },
        { id: 'added-form', forbid: { added: '#[0-9a-f]{6}' } },
        { id: 'command-form', forbidCommand: 'LEFTHOOK=(0|false)\\b' },
      ],
    });

    expect(resolved.disciplines?.map((d) => d.id)).toEqual([
      'string-form',
      'added-form',
      'command-form',
    ]);
  });
});
