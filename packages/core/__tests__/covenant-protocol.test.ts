import { describe, expect, it } from 'vitest';
// CORE-01 RED phase. Import from the package entry point (src/index.ts) — the same
// surface that `@polydeukes/core` will publish (package.json `exports` → dist/index.js).
// These symbols do not exist yet (only a stub `version` export), so the test is RED by
// construction. The signatures asserted here become the GREEN-phase contract.
import {
  type CovenantInput,
  type CovenantVerdict,
  EXIT_BREAK_BLOCKING,
  EXIT_BREAK_NON_BLOCKING,
  EXIT_UPHOLD,
  parseInput,
  verdictToExitCode,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — minimal agent-neutral IR (PRD §4.2 + assessment §9-1 vocabulary).
// The type intentionally carries NO agent/tool literals (`Edit`/`Write`/`claude`/
// `subagent_type`); those are *values* an adapter fills in, never the core's *vocabulary*.
// ---------------------------------------------------------------------------

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
// mistaken for a valid input (fail-closed). On success it carries the restored value;
// on failure it carries the blocking exit code (2). This shape is the GREEN contract.
//   parseInput(json): { ok: true; value: CovenantInput } | { ok: false; exitCode: 2 }

describe('§5.1 왕복 직렬화 (round-trip serialization)', () => {
  it('유효한 stdin-JSON 문자열을 CovenantInput으로 역직렬화한다', () => {
    // Mutation caught: parseInput that ignores its argument / returns a constant,
    // or that drops one of the three IR collections.
    const result = parseInput(JSON.stringify(fullInput));

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toEqual(fullInput);
    }
  });

  it('왕복 불변식: 빈 컬렉션만 가진 CovenantInput 도 왕복으로 보존된다', () => {
    // Catches a parser that "helpfully" defaults empty arrays to something else,
    // or that rejects empty-but-present collections (they are valid, not missing).
    const result = parseInput(JSON.stringify(emptyCollectionsInput));

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toEqual(emptyCollectionsInput);
    }
  });

  it('verdictToExitCode(upheld) === 0 (uphold)', () => {
    // Mutation caught: upheld→exit mapping flipped (e.g. returns 1 or 2),
    // or `upheld` flag ignored. Asserts the exact business-meaningful code, not >=0.
    const upheld: CovenantVerdict = { upheld: true };

    expect(verdictToExitCode(upheld)).toBe(0);
    // The named constant must agree with the literal 0 (semantics, not re-assertion):
    // if EXIT_UPHOLD drifts from the mapper, this composite check fails.
    expect(verdictToExitCode(upheld)).toBe(EXIT_UPHOLD);
  });

  it('verdictToExitCode(broken) === 1 (break non-blocking — 본체는 1만, 2 번역은 래퍼 책임)', () => {
    // P0-adjacent: the core body MUST NOT emit blocking-2 itself (PRD §4.1 책임 경계).
    // Mutations caught: broken→0 (fail-open!), broken→2 (core overstepping into wrapper's
    // exit-2 translation), or `upheld` flag ignored.
    const broken: CovenantVerdict = { upheld: false, reason: '보호된 경로 편집 시도' };

    expect(verdictToExitCode(broken)).toBe(1);
    expect(verdictToExitCode(broken)).toBe(EXIT_BREAK_NON_BLOCKING);
  });

  it('exit-code 의미론: uphold/non-blocking/blocking 세 코드가 0/1/2 로 구분된다', () => {
    // Business invariant: the three exit codes must be distinct and ordered by severity.
    // Catches a mutation that collapses two codes to the same value (e.g. both 1),
    // which would erase the blocking/non-blocking distinction COVENANT-01 relies on.
    expect(EXIT_UPHOLD).toBe(0);
    expect(EXIT_BREAK_NON_BLOCKING).toBe(1);
    expect(EXIT_BREAK_BLOCKING).toBe(2);
    expect(new Set([EXIT_UPHOLD, EXIT_BREAK_NON_BLOCKING, EXIT_BREAK_BLOCKING]).size).toBe(3);
  });
});

describe('§5.2 fail-closed (보안 경계 P0 — 판정 불가 = 차단)', () => {
  // PRD §4.1 / §5.2: parsing failure, missing required fields, empty input are all
  // "판정 불가" and MUST resolve to exit-2. The gate fails CLOSED — it returns 2,
  // it does NOT throw (an unhandled throw could be caught upstream and treated as pass).

  it('잘못된 JSON(파싱 불가)은 throw 하지 않고 fail-closed 로 exit-2 를 산출한다', () => {
    // P0: a fail-OPEN here is the assessment §3-A 치명결함 (Bash-shaped bypass).
    // Mutation caught: try/catch removed (→ throw escapes), or catch path returns 0/1.
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

  it('빈 문자열은 throw 하지 않고 fail-closed 로 exit-2 를 산출한다', () => {
    // Boundary: empty stdin (no payload piped). JSON.parse('') throws — the gate must
    // swallow that and block. Catches a parser that special-cases '' into a pass.
    let result: ReturnType<typeof parseInput> | undefined;

    expect(() => {
      result = parseInput('');
    }).not.toThrow();

    expect(result?.ok).toBe(false);
    if (result && result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });

  it('필수 필드가 누락된 JSON(파싱은 되지만 스키마 위반)도 fail-closed 로 exit-2', () => {
    // P0 boundary: valid JSON, invalid IR (missing required collections). A naive
    // JSON.parse-only parser would let this through as a malformed CovenantInput.
    // Catches a mutation that drops schema validation after JSON.parse succeeds.
    const validJsonInvalidSchema = JSON.stringify({ toolCalls: [] }); // missing the rest

    const result = parseInput(validJsonInvalidSchema);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });

  it('JSON 이지만 객체가 아닌 입력(배열·null·원시값)도 fail-closed 로 exit-2', () => {
    // Boundary across the "is it an object" check. `null`, `[]`, `42` all parse as
    // valid JSON but are not a CovenantInput. Catches a typeof check mutated to accept
    // any parsed value (a common fail-open hole).
    for (const hostile of ['null', '[]', '42', '"a string"', 'true']) {
      const result = parseInput(hostile);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.exitCode).toBe(2);
      }
    }
  });
});
