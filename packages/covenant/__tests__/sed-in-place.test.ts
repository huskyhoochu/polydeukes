import { describe, expect, it } from 'vitest';
import { extractMutations } from '../src/bash-line.ts';
import { sedInPlaceRule } from '../src/mutation-rules.ts';

// Driven through extractMutations with real shell lines rather than by calling the rule
// directly, so each case exercises the assembled surface.
describe('sed-in-place rule', () => {
  it('detects the file operand of the original assessment vector', () => {
    // The one-liner shape that defeats a check keyed on tool names alone: a shell command
    // rewrites a file with no mutating tool call involved.
    const result = extractMutations("sed -i 's/exit 2/exit 0/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('detects the file with the suffixed in-place flag "-i.bak"', () => {
    // "-i.bak" is the suffixed in-place form, not a distinct non-mutating flag.
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
    // Without the in-place flag sed writes to stdout, so reporting operands regardless of
    // "-i" flags a read as a file mutation.
    const result = extractMutations("sed 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([]);
  });

  it('detects both file operands of a two-file in-place sed', () => {
    // Reporting only the first file operand misses "g".
    const result = extractMutations("sed -i 's/a/b/' f g", [sedInPlaceRule]);

    expect(result.mutations).toEqual([
      { path: 'f', rule: 'sed-in-place' },
      { path: 'g', rule: 'sed-in-place' },
    ]);
  });

  it('fires on an absolute sed path by basename (/usr/bin/sed)', () => {
    // An exact-string match on "sed" misses "/usr/bin/sed".
    const result = extractMutations("/usr/bin/sed -i 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('skips the -e value and reports only the file (no script-skip when -e present)', () => {
    // Not skipping "-e"'s value word reports the expression as a file; and once "-e" is
    // present the first operand is a file, not a script.
    const result = extractMutations("sed -i -e 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('skips the -f script path (a read target) and reports only the file', () => {
    // The "-f" script file is read, not written, so only "f" is a mutation target.
    const result = extractMutations('sed -i -f script.sed f', [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('skips the prefixed --expression= value and reports only the file', () => {
    // Not recognizing the "="-attached long-expression form reports the expression as a path.
    const result = extractMutations("sed -i --expression='s/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('keeps the script-skip after "--" (first operand is still the script)', () => {
    // Treating "--" as if it introduced "-e"/"-f", or dropping the script-skip after it,
    // reports the script "s/a/b/" as a file.
    const result = extractMutations("sed -i -- 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'sed-in-place' }]);
  });

  it('does not fire on a wrapper command whose basename is not sed (sudo sed)', () => {
    // The first word's basename is "sudo", not "sed": wrapper commands are out of scope for
    // this rule, and the path-mention policy covers them instead.
    const result = extractMutations("sudo sed -i 's/a/b/' f", [sedInPlaceRule]);

    expect(result.mutations).toEqual([]);
  });

  it('reports no mutation for an opaque file operand but keeps the core indeterminate', () => {
    // An opaque operand value is not reported as a confident path, while the core still
    // flags the command indeterminate.
    const result = extractMutations("sed -i 's/a/b/' $(t)", [sedInPlaceRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate.length).toBeGreaterThanOrEqual(1);
  });
});
