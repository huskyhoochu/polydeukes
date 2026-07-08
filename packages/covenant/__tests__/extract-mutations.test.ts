import { describe, expect, it } from 'vitest';
import type { MutationRule, SimpleCommand } from '../src/bash-line.js';
// COVENANT-04a §4.2/§5.2. The module does not exist yet (RED phase) — this import
// must fail to resolve until bash-line.ts is implemented.
import { extractMutations } from '../src/bash-line.js';

// ---------------------------------------------------------------------------
// Test-only dummy rule (PRD §4.2: 04a ships zero built-in rules — verification
// uses a rule defined here, not a real one from 04b/04c).
// A command whose first word is "mutate" is treated as writing its second word.
// ---------------------------------------------------------------------------
const dummySecondArgRule: MutationRule = {
  name: 'dummy-second-arg',
  detect(command: SimpleCommand) {
    const [first, second] = command.words;
    if (first?.text !== 'mutate' || !second) return [];
    if (second.opaque) return [];
    return [{ path: second.text, rule: 'dummy-second-arg' }];
  },
};

describe('§5.2 rule seam — mutation detection', () => {
  it('an injected dummy rule reports the mutation target it detects', () => {
    const result = extractMutations('mutate f', [dummySecondArgRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'dummy-second-arg' }]);
  });

  it('applies the rule per simple command: only the matching command contributes', () => {
    // Mutation caught: a rule application that only inspects the first simple command
    // of the line (or merges all commands into one before running the rule).
    const result = extractMutations('safe x; mutate f', [dummySecondArgRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'dummy-second-arg' }]);
  });

  it('accumulates results from multiple rules, each matching its own command', () => {
    // Mutation caught: an implementation that applies only rules[0] (or stops at the
    // first matching rule) would pass every single-rule test but break the real
    // deployment shape, where 04b and 04c rules are plugged in together.
    const dummyFirstArgRule: MutationRule = {
      name: 'dummy-first-arg',
      detect(command: SimpleCommand) {
        const [first, second] = command.words;
        if (first?.text !== 'scribble' || !second || second.opaque) return [];
        return [{ path: second.text, rule: 'dummy-first-arg' }];
      },
    };
    const result = extractMutations('mutate f; scribble g', [
      dummySecondArgRule,
      dummyFirstArgRule,
    ]);

    expect(result.mutations).toEqual([
      { path: 'f', rule: 'dummy-second-arg' },
      { path: 'g', rule: 'dummy-first-arg' },
    ]);
  });
});

describe('§5.2 nested shell execution is indeterminate', () => {
  it('"eval \'...\'" is indeterminate regardless of the inner string, even with zero rules', () => {
    // PRD §4.3: nested shell = reinterpretation boundary, not recursively parsed.
    const result = extractMutations("eval 'rm -rf /'", []);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });

  it('"bash -c \'...\'" is indeterminate regardless of the inner string', () => {
    const result = extractMutations("bash -c 'anything'", []);

    expect(result.indeterminate.length).toBeGreaterThan(0);
  });

  it('"sh -c \'...\'" is indeterminate regardless of the inner string', () => {
    const result = extractMutations("sh -c 'anything'", []);

    expect(result.indeterminate.length).toBeGreaterThan(0);
  });

  it('does not recursively parse the inner string of a nested shell call for mutations', () => {
    // Even though the inner string textually matches the dummy rule's pattern
    // ("mutate f"), it must NOT surface as a mutation — it is inside eval's argument,
    // a reinterpretation boundary that 04a explicitly does not parse into.
    const result = extractMutations("eval 'mutate f'", [dummySecondArgRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });
});

describe('§5.2 opaque token in target position', () => {
  it('an opaque redirect target is indeterminate even with zero rules', () => {
    // Mutation caught: an opacity scan that inspects command.words only — an append-write
    // to an unknowable path (`x >> $var`) would yield mutations:[] AND indeterminate:[],
    // the forbidden confident pass (PRD §7 "모호하면 판정불가").
    const result = extractMutations('x >> $var', []);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });

  it('an opaque second argument to the dummy rule is indeterminate, not a mutation', () => {
    // Mutation caught: a rule seam that ignores opacity and reports the raw opaque
    // text as a concrete path, or one that silently drops the case (empty arrays).
    const result = extractMutations('mutate $(echo f)', [dummySecondArgRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });
});

describe('§5.2 clean input with no rules', () => {
  it('no rules and no indeterminate constructs yields both arrays empty', () => {
    const result = extractMutations('echo hello', []);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate).toEqual([]);
  });
});

describe('§5.2/§5.3 tokenize failure surfaces as indeterminate, not a throw', () => {
  it('an unclosed quote line is reported via indeterminate rather than thrown', () => {
    expect(() => extractMutations("echo 'oops", [])).not.toThrow();
    const result = extractMutations("echo 'oops", []);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });
});

describe('§5.3 fail-closed no-throw fuzz cases', () => {
  it('never throws on an empty string', () => {
    expect(() => extractMutations('', [])).not.toThrow();
    const result = extractMutations('', []);
    expect(result).toEqual({ mutations: [], indeterminate: [] });
  });

  it('never throws on operators-only input (";;")', () => {
    expect(() => extractMutations(';;', [])).not.toThrow();
  });

  it('never throws on unicode content', () => {
    expect(() => extractMutations('echo 한글 파일명', [])).not.toThrow();
  });

  it('never throws on a long pathological line', () => {
    const pathological = `${'a'.repeat(2000)} | ${'$('.repeat(500)}x${')'.repeat(500)}`;
    expect(() => extractMutations(pathological, [])).not.toThrow();
  });
});
