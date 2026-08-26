import { describe, expect, it } from 'vitest';
import { extractMutations } from '../src/bash-line.js';
import { redirectWriteRule, teeRule } from '../src/mutation-rules.js';

// Both rules are driven through extractMutations with real shell lines rather than called
// directly, so each case exercises the assembled surface.
describe('§5.1 redirect-write rule', () => {
  it('detects a plain write redirect target (printf coverage proof)', () => {
    // printf writes nothing without a redirect: the redirect structure, not the command
    // word, is what this rule catches.
    const result = extractMutations("printf 'x' > f", [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('detects an append redirect target (>>)', () => {
    const result = extractMutations('echo x >> f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('detects an all-streams write redirect target (&>)', () => {
    const result = extractMutations('cmd &> f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('detects an fd-prefixed write redirect target (2>)', () => {
    // Stderr redirection to a path is still a write, so an operator match accepting only a
    // bare ">" misses it.
    const result = extractMutations('cmd 2> f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('detects an all-streams append redirect target (&>>)', () => {
    const result = extractMutations('cmd &>> f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('does not report a read redirect target (<)', () => {
    // "<" carries no ">", so it is a read and must never be reported as a write.
    const result = extractMutations('cat < f', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports the file write but not the fd-duplication target (> f 2>&1)', () => {
    // fd duplication — an all-digit target — is not a path write; treating "2>&1" as one
    // reports "1" as a mutation target.
    const result = extractMutations('cmd > f 2>&1', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('does not report an fd-reference target of >& (>&2)', () => {
    // Reporting every ">"-bearing operator target surfaces "2" from ">&2", an fd reference.
    const result = extractMutations('cmd >&2', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports a csh-style >& redirect whose target is a path, not an fd', () => {
    // ">& file" targets a path — not all digits, not "-" — so it is a write, and the
    // fd-duplication exclusion must not swallow it.
    const result = extractMutations('cmd >& file', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'file', rule: 'redirect-write' }]);
  });

  it('does not report a move-fd target (2>&1-)', () => {
    // Bash's move-fd form targets "1-", an fd reference rather than a path, so reporting it
    // carries a phantom mutation on a pure fd manipulation.
    const result = extractMutations('cmd 2>&1-', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports no mutation for a process-substitution target but keeps the core indeterminate', () => {
    // `>(…)` hides the real write path inside the substitution, so the target is opaque: no
    // confident path is reported and the indeterminate entry survives.
    const result = extractMutations('cmd >(tee f)', [redirectWriteRule, teeRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThanOrEqual(1);
  });

  it('does not report a >&- fd-close target', () => {
    // "-" is an fd reference (close), not a path, so excluding only all-digit targets
    // reports it wrongly.
    const result = extractMutations('cmd >&-', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('applies per simple command: only the command with the write redirect contributes', () => {
    // The write redirect lives in the second command, so merging the line into one command
    // or inspecting only the first loses it.
    const result = extractMutations('safe_cmd; echo x > f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('reports no mutation for an opaque redirect target but keeps the core indeterminate', () => {
    // A command-substitution target has an unknowable value, so the rule stays silent while
    // the core still flags one indeterminate entry.
    const result = extractMutations('echo x > $(target)', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThanOrEqual(1);
  });
});

describe('§5.2 tee rule', () => {
  it('detects the single non-flag argument of tee', () => {
    const result = extractMutations('tee f', [teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'tee' }]);
  });

  it('detects every non-flag argument of tee', () => {
    // Reporting only the first argument misses "g".
    const result = extractMutations('tee f g', [teeRule]);

    expect(result.mutations).toEqual([
      { path: 'f', rule: 'tee' },
      { path: 'g', rule: 'tee' },
    ]);
  });

  it('skips a short flag and reports only the path (tee -a f)', () => {
    // Reporting every word after "tee" surfaces the flag "-a" as a path.
    const result = extractMutations('tee -a f', [teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'tee' }]);
  });

  it('skips a long flag and reports only the path (tee --append f)', () => {
    const result = extractMutations('tee --append f', [teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'tee' }]);
  });

  it('fires on an absolute tee path by basename (/usr/bin/tee f)', () => {
    // An exact-string match on "tee" misses "/usr/bin/tee".
    const result = extractMutations('/usr/bin/tee f', [teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'tee' }]);
  });

  it('treats a word after the -- end-of-options marker as a path even if it starts with -', () => {
    // After "--", flag-shaped words are paths and "--" itself is skipped, so unconditionally
    // skipping "-"-prefixed words drops "-weird".
    const result = extractMutations('tee -- -weird', [teeRule]);

    expect(result.mutations).toEqual([{ path: '-weird', rule: 'tee' }]);
  });

  it('reports a lone - operand as a path (GNU tee writes a literal "-" file)', () => {
    // GNU tee treats a lone "-" as a file operand and creates or truncates a file named "-",
    // so skipping it as a flag loses a real write.
    const result = extractMutations('tee -', [teeRule]);

    expect(result.mutations).toEqual([{ path: '-', rule: 'tee' }]);
  });

  it('does not report a multi-digit fd prefix as a tee operand (tee 12> f)', () => {
    // Bash folds "12>" into an fd redirect, so tee receives no "12" operand and only the
    // redirect target is a write.
    const result = extractMutations('tee 12> f', [redirectWriteRule, teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('does not fire on a wrapper command whose basename is not tee (sudo tee f)', () => {
    // The first word's basename is "sudo", not "tee": wrapper commands are out of scope for
    // this rule, and the path-mention policy covers them instead.
    const result = extractMutations('sudo tee f', [teeRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports no mutation for an opaque tee argument but keeps the core indeterminate', () => {
    // An opaque argument value is not reported as a confident path, while the core still
    // flags the command indeterminate.
    const result = extractMutations('tee $(target)', [teeRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThanOrEqual(1);
  });
});

describe('§5.3 fail-closed no-throw with both rules injected', () => {
  const bothRules = [redirectWriteRule, teeRule];

  it('never throws on an empty string and returns the result shape', () => {
    expect(() => extractMutations('', bothRules)).not.toThrow();
    const result = extractMutations('', bothRules);

    expect(result).toEqual({ mutations: [], indeterminate: [] });
  });

  it('never throws on redirect-operators-only input (">>>")', () => {
    expect(() => extractMutations('>>>', bothRules)).not.toThrow();
  });
});
