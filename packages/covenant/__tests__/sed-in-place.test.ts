import { describe, expect, it } from 'vitest';
import { extractMutations } from '../src/bash-line.js';
// COVENANT-04c §4.2/§5.2. `sedInPlaceRule` does not exist yet (RED phase) — this
// import must fail to resolve until mutation-rules.ts exports it.
import { sedInPlaceRule } from '../src/mutation-rules.js';

// ---------------------------------------------------------------------------
// sed-in-place rule (PRD §5.2). Driven through extractMutations with real shell
// lines — the integration surface 04d assembles.
// ---------------------------------------------------------------------------
describe('§5.2 sed-in-place rule', () => {
  it('detects the file operand of the original assessment vector', () => {
    // The exact one-liner that defeated memoriq's tool-shaped check.
    const result = extractMutations("sed -i 's/exit 2/exit 0/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('detects the file with the suffixed in-place flag "-i.bak"', () => {
    // Boundary across the in-place divide: "-i.bak" is the prefix in-place form,
    // not a distinct non-mutating flag.
    const result = extractMutations("sed -i.bak 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('detects the file with the long in-place flag "--in-place"', () => {
    const result = extractMutations("sed --in-place 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('detects the file with the suffixed long in-place flag "--in-place=.bak"', () => {
    const result = extractMutations("sed --in-place=.bak 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('does not fire without an in-place flag (sed writes to stdout)', () => {
    // Mutation caught: a rule that reports operands regardless of "-i" would flag a
    // plain stdout-writing sed as a file mutation.
    const result = extractMutations("sed 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([]);
  });

  it('detects both file operands of a two-file in-place sed', () => {
    // Mutation caught: reporting only the first file operand would miss "g".
    const result = extractMutations("sed -i 's/a/b/' f g", [sedInPlaceRule]);

    expect(result.mutations).toEqual([
      { path: 'f', rule: 'sed-in-place' },
      { path: 'g', rule: 'sed-in-place' },
    ]);
  });

  it('fires on an absolute sed path by basename (/usr/bin/sed)', () => {
    // Mutation caught: an exact-string match on "sed" would miss "/usr/bin/sed".
    const result = extractMutations("/usr/bin/sed -i 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('skips the -e value and reports only the file (no script-skip when -e present)', () => {
    // Mutation caught: not skipping "-e"'s value word would report the expression as
    // a file; and once "-e" is present the first operand is a file, not a script.
    const result = extractMutations("sed -i -e 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('skips the -f script path (a read target) and reports only the file', () => {
    // Mutation caught: reporting "script.sed" — the "-f" script file is read, not
    // written; only "f" is the mutation target.
    const result = extractMutations('sed -i -f script.sed f', [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('skips the prefixed --expression= value and reports only the file', () => {
    // Mutation caught: not recognizing the "="-attached long-expression form, so the
    // expression is reported as a file path.
    const result = extractMutations("sed -i --expression='s/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('keeps the script-skip after "--" (first operand is still the script)', () => {
    // Mutation caught: treating "--" as if it introduced "-e"/"-f", or dropping the
    // script-skip after it, would report the script "s/a/b/" as a file.
    const result = extractMutations("sed -i -- 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('does not fire on a wrapper command whose basename is not sed (sudo sed)', () => {
    // First-word basename is "sudo", not "sed" — wrapper commands are permanently
    // out of scope for this rule (04d path-mention policy covers them).
    const result = extractMutations("sudo sed -i 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports no mutation for an opaque file operand but keeps the core indeterminate', () => {
    // Fail-closed: an opaque operand value is not reported as a confident path,
    // while the 04a core still flags the command indeterminate.
    const result = extractMutations("sed -i 's/a/b/' $(t)", [sedInPlaceRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThanOrEqual(1);
  });
});
