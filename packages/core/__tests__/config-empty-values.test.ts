import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfig } from '../src/index.ts';
import { validLanguages } from './helpers.ts';

// Empty-string rejection in the five spots that carry a pattern or a path. An empty pattern
// matches at every position, so one typo turns a scoped discipline into a universal block;
// an empty logPath silently redirects telemetry.

// Asserts the concrete error instance (not just "did it throw") and returns it so callers
// can assert on the message.
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
    // '' compiles as a regex and matches everywhere, so the delta entry would break every
    // in-scope edit; a type-only check accepts it.
    const error = expectConfigValidationError({
      ...validLanguages,
      disciplines: [{ id: 'empty-forbid', forbid: '' }],
    });

    expect(error.message).toContain('forbid');
  });

  it('rejects forbid: { added: "" }, naming the forbid field', () => {
    // The object form takes its own validation branch, so a fix that only rejects the
    // string shorthand leaves this spelling open.
    const error = expectConfigValidationError({
      ...validLanguages,
      disciplines: [{ id: 'empty-added', forbid: { added: '' } }],
    });

    expect(error.message).toContain('forbid');
  });

  it('rejects a forbidCommand of "", naming the forbidCommand field', () => {
    // An empty command pattern matches every shell call — the command family would block
    // all of Bash. Its own branch needs the same non-empty check as the delta fields.
    const error = expectConfigValidationError({
      ...validLanguages,
      disciplines: [{ id: 'empty-cmd', forbidCommand: '' }],
    });

    expect(error.message).toContain('forbidCommand');
  });
});

describe('§4.2 empty-element rejection — protectedPaths', () => {
  it('rejects an empty-string element among valid ones, naming protectedPaths', () => {
    // The empty entry is placed beside a valid one deliberately: it catches a some/every
    // inversion that lets one empty element hide behind valid siblings, as well as an
    // element check that tests only typeof string.
    const error = expectConfigValidationError({
      ...validLanguages,
      protectedPaths: ['src/covenant/**', ''],
    });

    expect(error.message).toContain('protectedPaths');
  });
});

describe('§4.2 telemetry.logPath — trim-then-non-empty (the witness.token idiom)', () => {
  it('rejects logPath: "", naming logPath', () => {
    // A type-only check lets '' through and resolves telemetry to an empty path.
    const error = expectConfigValidationError({
      ...validLanguages,
      telemetry: { logPath: '' },
    });

    expect(error.message).toContain('logPath');
  });

  it('rejects a whitespace-only logPath, naming logPath', () => {
    // '  ' has length > 0 but trims to nothing, so a length check without trim accepts it —
    // the same boundary witness.token pins with trim().
    const error = expectConfigValidationError({
      ...validLanguages,
      telemetry: { logPath: '  ' },
    });

    expect(error.message).toContain('logPath');
  });
});

describe('§6 invariant — non-empty values in the same five spots stay accepted', () => {
  it('accepts non-empty forbid (both forms) and forbidCommand entries', () => {
    // The mirror direction: the rejections must not over-reach. Catches a non-empty check
    // inverted or applied to the wrong field.
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
