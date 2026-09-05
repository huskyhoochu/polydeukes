import { describe, expect, it } from 'vitest';
import type { MutationRule, SimpleCommand } from '../src/bash-line.ts';
import { extractMutations } from '../src/bash-line.ts';

// A test-only rule, so that these cases verify the rule seam rather than any shipped rule's
// behaviour: a command whose first word is "mutate" is treated as writing its second word.
const dummySecondArgRule: MutationRule = {
  name: 'dummy-second-arg',
  detect(command: SimpleCommand) {
    const [first, second] = command.words;
    if (first?.text !== 'mutate' || !second) return [];
    if (second.opaque) return [];
    return [{ path: second.text, rule: 'dummy-second-arg' }];
  },
};

describe('rule seam — mutation detection', () => {
  it('an injected dummy rule reports the mutation target it detects', () => {
    const result = extractMutations('mutate f', [dummySecondArgRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'dummy-second-arg' }]);
  });

  it('applies the rule per simple command: only the matching command contributes', () => {
    // A rule application that inspects only the first simple command, or merges all commands
    // into one before running the rule, misses this.
    const result = extractMutations('safe x; mutate f', [dummySecondArgRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'dummy-second-arg' }]);
  });

  it('accumulates results from multiple rules, each matching its own command', () => {
    // Applying only rules[0], or stopping at the first matching rule, passes every
    // single-rule case and still breaks the shape where several rules are plugged in together.
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

describe('nested shell execution is indeterminate', () => {
  it('"eval \'...\'" is indeterminate regardless of the inner string, even with zero rules', () => {
    // A nested shell is a reinterpretation boundary, never parsed into recursively.
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
    // The inner string textually matches the rule's pattern, but it sits inside eval's
    // argument — a reinterpretation boundary — so it must not surface as a mutation.
    const result = extractMutations("eval 'mutate f'", [dummySecondArgRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });
});

describe('opaque token in target position', () => {
  it('an opaque redirect target is indeterminate even with zero rules', () => {
    // An opacity scan that inspects command.words only answers mutations:[] AND
    // indeterminate:[] for an append-write to an unknowable path — a confident pass over
    // something nothing could decide.
    const result = extractMutations('x >> $var', []);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });

  it('an opaque second argument to the dummy rule is indeterminate, not a mutation', () => {
    // A rule seam that ignores opacity reports the raw opaque text as a concrete path; one
    // that drops the case answers with two empty arrays.
    const result = extractMutations('mutate $(echo f)', [dummySecondArgRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });
});

describe('clean input with no rules', () => {
  it('no rules and no indeterminate constructs yields both arrays empty', () => {
    const result = extractMutations('echo hello', []);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate).toEqual([]);
  });
});

describe('an unread span surfaces as indeterminate, not a throw', () => {
  it('an unclosed quote line is reported via indeterminate rather than thrown', () => {
    expect(() => extractMutations("echo 'oops", [])).not.toThrow();
    const result = extractMutations("echo 'oops", []);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });
});

describe('fail-closed no-throw fuzz cases', () => {
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

describe('nested-shell boundary uses command basename (SSOT with shell-mod)', () => {
  it('"/bin/sh -c \'...\'" is indeterminate — matched by basename, not raw first.text', () => {
    // Comparing the raw first word (`/bin/sh`) against the bare-name set instead of its
    // basename misses this, so the inner `> packages/core/src/y` write surfaces neither as a
    // mutation nor as indeterminate — a confident pass. The basename comparison mirrors
    // shell-mod's allowlist clause.
    const result = extractMutations("/bin/sh -c 'echo x > packages/core/src/y'", []);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThan(0);
  });
});
