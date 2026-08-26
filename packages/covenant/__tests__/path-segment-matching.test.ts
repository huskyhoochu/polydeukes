import { describe, expect, it } from 'vitest';
import { mentionsPath, pathMatchesProtected } from '../src/mention.js';
import { inputWithArgs } from './helpers.js';

// The protected path and candidate strings are chosen to exercise the ancestor, descendant,
// equal, and segment-boundary-prefix cases of the matching primitive.

const PROTECTED = 'core/src';

describe('pathMatchesProtected — ancestor / descendant / equal', () => {
  it('an ancestor of the protected path matches (parent directory)', () => {
    // Without the ancestor relation, `rm -rf packages/core` destroys the protected path by
    // operating on its parent and passes.
    expect(pathMatchesProtected('core', PROTECTED)).toBe(true);
  });

  it('a descendant of the protected path matches (a file inside it)', () => {
    // Without the descendant relation, edits under the protected directory leak.
    expect(pathMatchesProtected('core/src/x', PROTECTED)).toBe(true);
  });

  it('the protected path itself matches (equal)', () => {
    // A strict ancestor-or-descendant relation that forgets the equal case passes the exact
    // protected path.
    expect(pathMatchesProtected('core/src', PROTECTED)).toBe(true);
  });
});

describe('pathMatchesProtected — segment-boundary prefix trap', () => {
  it('a sibling sharing a path-segment prefix does NOT match (core/src-generated)', () => {
    // Substring semantics (`value.includes(path)`) report `core/src-generated` as a match.
    expect(pathMatchesProtected('core/src-generated', PROTECTED)).toBe(false);
  });
});

describe('pathMatchesProtected — absolute candidate paths (high-review regression)', () => {
  it('an ABSOLUTE descendant matches the relative protected path', () => {
    // The tool axis sends file_path absolute, so a relative protected path must match it as a
    // contiguous segment subsequence. A prefix anchored at segment 0 misses every absolute
    // candidate and silently unprotects the whole surface.
    expect(
      pathMatchesProtected('/home/u/proj/packages/core/src/index.ts', 'packages/core/src'),
    ).toBe(true);
  });

  it('an absolute sibling sharing a segment prefix still does NOT match', () => {
    // The boundary must hold at every offset, not only at segment 0.
    expect(
      pathMatchesProtected('/home/u/proj/packages/core/src-generated/x.ts', 'packages/core/src'),
    ).toBe(false);
  });
});

describe('pathMatchesProtected — ancestor is root-anchored, not any suffix (re-review regression)', () => {
  it('an unrelated path whose TAIL coincides with the protected head does NOT match', () => {
    // The ancestor direction requires the WHOLE candidate to prefix the protected path.
    // Scanning every candidate suffix instead blocks unrelated work: `x/packages/core` is not
    // an ancestor of `packages/core/src`.
    expect(pathMatchesProtected('x/packages/core', 'packages/core/src')).toBe(false);
    expect(pathMatchesProtected('vendor/packages', 'packages/core/src')).toBe(false);
    expect(pathMatchesProtected('tools/packages/core', 'packages/core/src')).toBe(false);
  });

  it('a genuine relative ancestor (root-anchored prefix) still matches', () => {
    // The whole candidate is a prefix of the protected path, which is the shape that destroys
    // it by deleting its parent.
    expect(pathMatchesProtected('packages/core', 'packages/core/src')).toBe(true);
    expect(pathMatchesProtected('packages', 'packages/core/src')).toBe(true);
  });
});

describe('pathMatchesProtected — segment normalization', () => {
  it('a leading "./" and trailing "/" on the candidate are normalized before matching', () => {
    // Unnormalized, `./core/src/` splits into segments with a leading `.` and an empty
    // trailing one and fails to equal `core/src`.
    expect(pathMatchesProtected('./core/src/', PROTECTED)).toBe(true);
  });

  it('a leading "./" and trailing "/" on the protected path are normalized before matching', () => {
    // Normalizing only one side leaves a protected path written `./core/src/` never equal to
    // a bare `core/src` candidate.
    expect(pathMatchesProtected('core/src', './core/src/')).toBe(true);
  });
});

describe('mentionsPath — recursive traversal with segment semantics', () => {
  it('does NOT match a sibling sharing a segment prefix nested inside args (src-gen)', () => {
    // Substring semantics inside the traversal make `packages/core/src-gen/x.ts` hit
    // `packages/core/src` and produce a false block.
    const args = inputWithArgs({ file_path: 'packages/core/src-gen/x.ts' }).toolCalls[0].args;
    expect(mentionsPath(args, 'packages/core/src')).toBe(false);
  });

  it('matches an ABSOLUTE file_path nested in args (the real Edit payload shape)', () => {
    // Edit and Write always send an absolute file_path, and the self-mod judge reads it
    // through mentionsPath, so a relative-only match silently unprotects everything.
    const args = inputWithArgs({
      file_path: '/home/u/proj/packages/core/src/index.ts',
    }).toolCalls[0].args;
    expect(mentionsPath(args, 'packages/core/src')).toBe(true);
  });

  it('matches a protected path embedded behind a `--flag=` token', () => {
    // A `--dest=<protected>` argument must surface the path as its own candidate; a token
    // split that omits `=` misses the flag-form write.
    const args = inputWithArgs({ command: 'cp x --dest=packages/core/src/y' }).toolCalls[0].args;
    expect(mentionsPath(args, 'packages/core/src')).toBe(true);
  });
});
