import { describe, expect, it } from 'vitest';
// Imports from the package entry point — the same surface `@polydeukes/core` publishes.
import {
  type CovenantInput,
  type CovenantVerdict,
  EXIT_BREAK_BLOCKING,
  EXIT_BREAK_NON_BLOCKING,
  EXIT_UPHOLD,
  parseInput,
  verdictToExitCode,
} from '../src/index.ts';

// A minimal agent-neutral IR. The tool names here are deliberately generic: concrete
// agent and tool literals are *values* an adapter fills in, never the core's *vocabulary*.

// A fully-populated, valid input covering all three IR collections.
const fullInput: CovenantInput = {
  toolCalls: [{ name: 'edit', args: { path: 'a.ts' } }],
  subagentSpawns: [{ kind: 'reviewer' }],
  userMessages: [{ text: 'please refactor' }],
};

// A minimal valid input: all three collections present but empty (nothing happened yet).
const emptyCollectionsInput: CovenantInput = {
  toolCalls: [],
  subagentSpawns: [],
  userMessages: [],
};

// parseInput returns a discriminated result so an unparseable payload can never be
// mistaken for a valid input: on success it carries the restored value, on failure the
// blocking exit code.

describe('§5.1 round-trip serialization', () => {
  it('deserializes a valid stdin-JSON string into a CovenantInput', () => {
    const result = parseInput(JSON.stringify(fullInput));

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toEqual(fullInput);
    }
  });

  it('round-trip invariant: a CovenantInput with only empty collections is preserved', () => {
    // Empty-but-present collections are valid input, not missing ones.
    const result = parseInput(JSON.stringify(emptyCollectionsInput));

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toEqual(emptyCollectionsInput);
    }
  });

  it('verdictToExitCode(upheld) === 0 (uphold)', () => {
    const upheld: CovenantVerdict = { upheld: true };

    expect(verdictToExitCode(upheld)).toBe(0);
    // Not a re-assertion of the line above: pinning both the literal and the named
    // constant fails if EXIT_UPHOLD ever drifts away from what the mapper returns.
    expect(verdictToExitCode(upheld)).toBe(EXIT_UPHOLD);
  });

  it('verdictToExitCode(broken) === 1 (break non-blocking — the body emits only 1; translating to 2 is the wrapper responsibility)', () => {
    // Responsibility boundary: the core body must not emit blocking-2 itself — translating
    // 1 into 2 belongs to the wrapper. Returning 0 here would be a fail-open.
    const broken: CovenantVerdict = { upheld: false, reason: 'attempted edit of a protected path' };

    expect(verdictToExitCode(broken)).toBe(1);
    expect(verdictToExitCode(broken)).toBe(EXIT_BREAK_NON_BLOCKING);
  });

  it('exit-code semantics: uphold/non-blocking/blocking are distinct as 0/1/2', () => {
    // The three exit codes must stay distinct and ordered by severity: collapsing any two
    // to the same value erases the blocking/non-blocking distinction callers depend on.
    expect(EXIT_UPHOLD).toBe(0);
    expect(EXIT_BREAK_NON_BLOCKING).toBe(1);
    expect(EXIT_BREAK_BLOCKING).toBe(2);
    expect(new Set([EXIT_UPHOLD, EXIT_BREAK_NON_BLOCKING, EXIT_BREAK_BLOCKING]).size).toBe(3);
  });
});

describe('§5.2 fail-closed (security boundary P0 — cannot judge = block)', () => {
  // Parsing failure, missing required fields, and empty input all mean "cannot judge" and
  // must resolve to exit-2. The gate fails CLOSED by RETURNING 2, never by throwing — an
  // unhandled throw could be caught upstream and treated as a pass.

  it('unparseable JSON yields fail-closed exit-2 without throwing', () => {
    let result: ReturnType<typeof parseInput> | undefined;

    expect(() => {
      result = parseInput('{ this is not json');
    }).not.toThrow();

    expect(result?.ok).toBe(false);
    if (result && result.ok === false) {
      expect(result.exitCode).toBe(2);
      expect(result.exitCode).toBe(EXIT_BREAK_BLOCKING);
    }
  });

  it('an empty string yields fail-closed exit-2 without throwing', () => {
    // Empty stdin, i.e. no payload piped. JSON.parse('') throws, and the gate must swallow
    // that and block rather than special-case '' into a pass.
    let result: ReturnType<typeof parseInput> | undefined;

    expect(() => {
      result = parseInput('');
    }).not.toThrow();

    expect(result?.ok).toBe(false);
    if (result && result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });

  it('JSON missing required fields (parses, but violates the schema) is fail-closed to exit-2', () => {
    // Valid JSON, invalid IR: a JSON.parse-only parser lets this through as a malformed
    // CovenantInput, so schema validation must run after the parse succeeds.
    const validJsonInvalidSchema = JSON.stringify({ toolCalls: [] }); // missing the rest

    const result = parseInput(validJsonInvalidSchema);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });

  it('JSON that is not an object (array/null/primitive) is fail-closed to exit-2', () => {
    // Every value here parses as valid JSON but is not a CovenantInput. `null` and `[]`
    // are the ones a bare `typeof x === 'object'` check would wave through.
    for (const hostile of ['null', '[]', '42', '"a string"', 'true']) {
      const result = parseInput(hostile);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.exitCode).toBe(2);
      }
    }
  });
});
