import { describe, expect, it } from 'vitest';
import { extractMutations } from '../src/bash-line.js';
import { redirectWriteRule, teeRule } from '../src/mutation-rules.js';

// ---------------------------------------------------------------------------
// redirect-write rule (PRD §5.1). Driven through extractMutations with real
// shell lines — the integration surface 04d assembles.
// ---------------------------------------------------------------------------
describe('§5.1 redirect-write rule', () => {
  it('detects a plain write redirect target (printf coverage proof)', () => {
    // printf writes nothing without a redirect; the redirect structure — not the
    // command word — is what redirect-write catches. This is the printf case cover.
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
    // Mutation caught: an operator match that only accepts a bare ">" and misses
    // the fd-prefixed "2>" write — stderr redirection to a path is still a write.
    const result = extractMutations('cmd 2> f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('detects an all-streams append redirect target (&>>)', () => {
    const result = extractMutations('cmd &>> f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('does not report a read redirect target (<)', () => {
    // Boundary across the read/write divide: "<" carries no ">", so it is a read
    // and must never be reported as a write mutation.
    const result = extractMutations('cat < f', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports the file write but not the fd-duplication target (> f 2>&1)', () => {
    // Mutation caught: treating "2>&1" as a path write would report "1" as a
    // mutation target. fd duplication (target is all digits) is not a path write.
    const result = extractMutations('cmd > f 2>&1', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('does not report an fd-reference target of >& (>&2)', () => {
    // Mutation caught: a rule that reports every ">"-bearing operator target would
    // surface "2" from ">&2" (fd reference), a false positive.
    const result = extractMutations('cmd >&2', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports a csh-style >& redirect whose target is a path, not an fd', () => {
    // Boundary across the fd-reference divide: ">& file" targets a path (not all
    // digits, not "-"), so it IS a write — the fd-dup exclusion must not swallow it.
    const result = extractMutations('cmd >& file', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'file', rule: 'redirect-write' }]);
  });

  it('does not report a move-fd target (2>&1-)', () => {
    // Mutation caught: bash's move-fd form targets "1-" (an fd reference), not a
    // path — reporting it would carry a phantom mutation on a pure fd manipulation.
    const result = extractMutations('cmd 2>&1-', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports no mutation for a process-substitution target but keeps the core indeterminate', () => {
    // Fail-closed: `>(…)` hides the real write path inside the substitution — the
    // target is opaque, so no confident (mangled) path and the indeterminate survives.
    const result = extractMutations('cmd >(tee f)', [redirectWriteRule, teeRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThanOrEqual(1);
  });

  it('does not report a >&- fd-close target', () => {
    // Mutation caught: "-" is an fd reference (close), not a path — a rule that
    // only excludes all-digit targets would wrongly report "-".
    const result = extractMutations('cmd >&-', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('applies per simple command: only the command with the write redirect contributes', () => {
    // Mutation caught: a rule application that merges the line into one command or
    // only inspects the first — the write redirect lives in the second command.
    const result = extractMutations('safe_cmd; echo x > f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('reports no mutation for an opaque redirect target but keeps the core indeterminate', () => {
    // Fail-closed: a command-substitution target has an unknowable value, so the
    // rule stays silent (no confident mutation) while the 04a core still flags one
    // indeterminate — the fail-closed signal 04d relies on is preserved.
    const result = extractMutations('echo x > $(target)', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// tee rule (PRD §5.2).
// ---------------------------------------------------------------------------
describe('§5.2 tee rule', () => {
  it('detects the single non-flag argument of tee', () => {
    const result = extractMutations('tee f', [teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'tee' }]);
  });

  it('detects every non-flag argument of tee', () => {
    // Mutation caught: a rule that reports only the first argument would miss "g".
    const result = extractMutations('tee f g', [teeRule]);

    expect(result.mutations).toEqual([
      { path: 'f', rule: 'tee' },
      { path: 'g', rule: 'tee' },
    ]);
  });

  it('skips a short flag and reports only the path (tee -a f)', () => {
    // Mutation caught: a rule that reports every word after "tee" would surface
    // "-a" (a flag) as a path.
    const result = extractMutations('tee -a f', [teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'tee' }]);
  });

  it('skips a long flag and reports only the path (tee --append f)', () => {
    const result = extractMutations('tee --append f', [teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'tee' }]);
  });

  it('fires on an absolute tee path by basename (/usr/bin/tee f)', () => {
    // Mutation caught: an exact-string match on "tee" would miss "/usr/bin/tee".
    const result = extractMutations('/usr/bin/tee f', [teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'tee' }]);
  });

  it('treats a word after the -- end-of-options marker as a path even if it starts with -', () => {
    // Mutation caught: a rule that unconditionally skips "-"-prefixed words would
    // drop "-weird". After "--", flag-shaped words are paths, and "--" itself is skipped.
    const result = extractMutations('tee -- -weird', [teeRule]);

    expect(result.mutations).toEqual([{ path: '-weird', rule: 'tee' }]);
  });

  it('reports a lone - operand as a path (GNU tee writes a literal "-" file)', () => {
    // Mutation caught: skipping "-" as a flag — GNU tee treats a lone "-" as a file
    // operand and creates/truncates a file named "-".
    const result = extractMutations('tee -', [teeRule]);

    expect(result.mutations).toEqual([{ path: '-', rule: 'tee' }]);
  });

  it('does not report a multi-digit fd prefix as a tee operand (tee 12> f)', () => {
    // Mutation caught: bash folds "12>" into an fd redirect, so tee receives no "12"
    // operand — only the redirect target f is a write.
    const result = extractMutations('tee 12> f', [redirectWriteRule, teeRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('does not fire on a wrapper command whose basename is not tee (sudo tee f)', () => {
    // First-word basename is "sudo", not "tee" — wrapper commands are permanently
    // out of scope for this rule (04d path-mention policy covers them).
    const result = extractMutations('sudo tee f', [teeRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports no mutation for an opaque tee argument but keeps the core indeterminate', () => {
    // Fail-closed: an opaque argument value is not reported as a confident path,
    // while the 04a core still flags the command indeterminate.
    const result = extractMutations('tee $(target)', [teeRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Invariants (PRD §5.3): both rules injected, no input throws.
// ---------------------------------------------------------------------------
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
