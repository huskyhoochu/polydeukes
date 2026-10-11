import { describe, expect, it } from 'vitest';
import { EXIT_BREAK_BLOCKING, EXIT_BREAK_NON_BLOCKING, EXIT_UPHOLD } from '../src/exit-codes.ts';
// Imports from the package entry point — the same surface `@polydeukes/core` publishes.
import {
  type CovenantInput,
  type CovenantVerdict,
  parseInput,
  verdictToExitCode,
} from '../src/protocol.ts';

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

describe('round-trip serialization', () => {
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

/** What JSON.parse itself says about `text` — the reason quotes it after the fixed prefix. */
function jsonParseMessage(text: string): string {
  try {
    JSON.parse(text);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`fixture parses as JSON: ${text}`);
}

describe('fail-closed (security boundary — cannot judge = block)', () => {
  // Parsing failure, missing required fields, and empty input all mean "cannot judge" and
  // must resolve to exit-2 with a reason naming the branch that refused. The gate fails
  // CLOSED by RETURNING 2, never by throwing — an unhandled throw could be caught upstream
  // and treated as a pass. The reason is what a host that built the input by hand reads
  // back: a refusal with no reason is indistinguishable from a discipline's block.

  it('unparseable JSON yields fail-closed exit-2 without throwing, the reason quoting JSON.parse', () => {
    // A reason that names only "not JSON" hides which byte broke; one that returns the raw
    // JSON.parse message has no prefix a host can match on.
    const text = '{ this is not json';
    let result: ReturnType<typeof parseInput> | undefined;

    expect(() => {
      result = parseInput(text);
    }).not.toThrow();

    expect(result).toEqual({
      ok: false,
      exitCode: EXIT_BREAK_BLOCKING,
      reason: `input is not JSON: ${jsonParseMessage(text)}`,
    });
    expect(result && result.ok === false && result.exitCode).toBe(2);
  });

  it('an empty string yields fail-closed exit-2 without throwing, under the not-JSON reason', () => {
    // Empty stdin, i.e. no payload piped. JSON.parse('') throws, and the gate must swallow
    // that and block rather than special-case '' into a pass or into its own reason.
    let result: ReturnType<typeof parseInput> | undefined;

    expect(() => {
      result = parseInput('');
    }).not.toThrow();

    expect(result).toEqual({
      ok: false,
      exitCode: 2,
      reason: `input is not JSON: ${jsonParseMessage('')}`,
    });
  });

  it.each([
    ['toolCalls', { subagentSpawns: [], userMessages: [] }],
    ['subagentSpawns', { toolCalls: [], userMessages: [] }],
    ['userMessages', { toolCalls: [], subagentSpawns: [] }],
  ])(
    'JSON missing %s (parses, but violates the schema) is fail-closed to exit-2 naming that collection',
    (name, payload) => {
      // Valid JSON, invalid IR: a JSON.parse-only parser lets this through as a malformed
      // CovenantInput, so schema validation must run after the parse succeeds. Each fixture
      // omits exactly one collection, so a parser that names the wrong one — or names the
      // first collection on every miss — fails here and not on an order coincidence.
      const result = parseInput(JSON.stringify(payload));

      expect(result).toEqual({
        ok: false,
        exitCode: 2,
        reason: `input carries no ${name} array`,
      });
    },
  );

  it('a collection present but not an array is the same refusal as a missing one', () => {
    // `{}` and `"x"` are the shapes a host writes when it serialises a map or a single
    // message; a parser testing presence alone carries them into the dispatcher, where the
    // first `.length` or iteration reads a value no judge was written for.
    for (const subagentSpawns of [{}, 'spawn', 1]) {
      expect(
        parseInput(JSON.stringify({ toolCalls: [], subagentSpawns, userMessages: [] })),
        `subagentSpawns: ${JSON.stringify(subagentSpawns)}`,
      ).toEqual({ ok: false, exitCode: 2, reason: 'input carries no subagentSpawns array' });
    }
  });

  it('JSON that is not an object (array/null/primitive) is fail-closed to exit-2 as not-an-object', () => {
    // Every value here parses as valid JSON but is not a CovenantInput. `null` and `[]`
    // are the ones a bare `typeof x === 'object'` check would wave through — and the ones
    // a parser that reaches the collection check first would misreport as a missing
    // toolCalls array.
    for (const hostile of ['null', '[]', '42', '"a string"', 'true']) {
      expect(parseInput(hostile), `payload: ${hostile}`).toEqual({
        ok: false,
        exitCode: 2,
        reason: 'input is not a JSON object',
      });
    }
  });
});
