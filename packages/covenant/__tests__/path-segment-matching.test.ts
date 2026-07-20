import { describe, expect, it } from 'vitest';
// COVENANT-07 §4.1 — `pathMatchesProtected` does not exist yet (RED phase). This import
// must fail to resolve until mention.ts is upgraded from substring to path-segment matching.
import { mentionsPath, pathMatchesProtected } from '../src/mention.js';
import { inputWithArgs } from './helpers.js';

// ---------------------------------------------------------------------------
// COVENANT-07 §5.1 — path-segment matching primitive. The protected path and
// candidate strings below are fixture values, chosen to exercise ancestor,
// descendant, equal, and the segment-boundary prefix trap. Shortened notation
// (no `packages/` prefix) per PRD notation rule.
// ---------------------------------------------------------------------------

const PROTECTED = 'core/src';

describe('pathMatchesProtected — ancestor / descendant / equal (PRD §5.1)', () => {
  it('an ancestor of the protected path matches (parent directory)', () => {
    // Mutation caught: ancestor relation dropped (only descendant/equal checked) — this
    // is exactly the `rm -rf packages/core` parent-operation bypass the ticket closes.
    expect(pathMatchesProtected('core', PROTECTED)).toBe(true);
  });

  it('a descendant of the protected path matches (a file inside it)', () => {
    // Mutation caught: descendant relation dropped, so edits under the protected dir leak.
    expect(pathMatchesProtected('core/src/x', PROTECTED)).toBe(true);
  });

  it('the protected path itself matches (equal)', () => {
    // Mutation caught: equality excluded (e.g. a strict ancestor-or-descendant relation
    // that forgets the boundary-equal case), so the exact protected path would pass.
    expect(pathMatchesProtected('core/src', PROTECTED)).toBe(true);
  });
});

describe('pathMatchesProtected — segment-boundary prefix trap (PRD §5.1)', () => {
  it('a sibling sharing a path-segment prefix does NOT match (core/src-generated)', () => {
    // Mutation caught: reverting to substring semantics (`value.includes(path)`) — the
    // substring false positive `core/src-generated` ⊇ `core/src` this ticket eliminates.
    expect(pathMatchesProtected('core/src-generated', PROTECTED)).toBe(false);
  });
});

describe('pathMatchesProtected — absolute candidate paths (high-review regression)', () => {
  it('an ABSOLUTE descendant matches the relative protected path', () => {
    // Claude Code sends file_path as an absolute path; the relative protected path
    // 'core/src' must match it as a contiguous segment subsequence, not an index-0 prefix.
    // Mutation caught: prefix anchored at segment 0 — the exact absolute-path bypass that
    // silently reopened self-mod protection.
    expect(
      pathMatchesProtected('/home/u/proj/packages/core/src/index.ts', 'packages/core/src'),
    ).toBe(true);
  });

  it('an absolute sibling sharing a segment prefix still does NOT match', () => {
    // The boundary trap must survive the absolute-path fix: core/src-generated is not
    // core/src at any offset.
    expect(
      pathMatchesProtected('/home/u/proj/packages/core/src-generated/x.ts', 'packages/core/src'),
    ).toBe(false);
  });
});

describe('pathMatchesProtected — ancestor is root-anchored, not any suffix (re-review regression)', () => {
  it('an unrelated path whose TAIL coincides with the protected head does NOT match', () => {
    // The ancestor direction must require the WHOLE candidate to prefix the protected path.
    // Mutation caught: scanning every candidate suffix — `x/packages/core` is not an ancestor
    // of `packages/core/src`, so blocking it would falsely stop unrelated legitimate work.
    expect(pathMatchesProtected('x/packages/core', 'packages/core/src')).toBe(false);
    expect(pathMatchesProtected('vendor/packages', 'packages/core/src')).toBe(false);
    expect(pathMatchesProtected('tools/packages/core', 'packages/core/src')).toBe(false);
  });

  it('a genuine relative ancestor (root-anchored prefix) still matches', () => {
    // `rm -rf packages/core` — the whole candidate is a prefix of the protected path.
    expect(pathMatchesProtected('packages/core', 'packages/core/src')).toBe(true);
    expect(pathMatchesProtected('packages', 'packages/core/src')).toBe(true);
  });
});

describe('pathMatchesProtected — normalization (PRD §4.1 segment normalize)', () => {
  it('a leading "./" and trailing "/" on the candidate are normalized before matching', () => {
    // Mutation caught: normalization skipped, so `./core/src/` splits into segments with a
    // leading `.` and/or an empty trailing segment and fails to equal `core/src`.
    expect(pathMatchesProtected('./core/src/', PROTECTED)).toBe(true);
  });

  it('a leading "./" and trailing "/" on the protected path are normalized before matching', () => {
    // Mutation caught: normalization applied to only one side, so a protected path written
    // as `./core/src/` never equals a bare `core/src` candidate.
    expect(pathMatchesProtected('core/src', './core/src/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// COVENANT-07 §5.1 — mentionsPath keeps recursive traversal but now judges each
// string token with segment semantics, not raw substring.
// ---------------------------------------------------------------------------

describe('mentionsPath — recursive traversal with segment semantics (PRD §5.1)', () => {
  it('does NOT match a sibling sharing a segment prefix nested inside args (src-gen)', () => {
    // Mutation caught: substring semantics retained inside the traversal — `packages/core/
    // src-gen/x.ts` would substring-hit `packages/core/src` and produce a false block/route.
    const args = inputWithArgs({ file_path: 'packages/core/src-gen/x.ts' }).toolCalls[0].args;
    expect(mentionsPath(args, 'packages/core/src')).toBe(false);
  });

  it('matches an ABSOLUTE file_path nested in args (the real Edit payload shape)', () => {
    // Claude Code Edit/Write always send an absolute file_path — the self-mod judge reads it
    // through mentionsPath. Mutation caught: absolute paths silently unprotected.
    const args = inputWithArgs({
      file_path: '/home/u/proj/packages/core/src/index.ts',
    }).toolCalls[0].args;
    expect(mentionsPath(args, 'packages/core/src')).toBe(true);
  });

  it('matches a protected path embedded behind a `--flag=` token', () => {
    // A `--dest=<protected>` argument must surface the path as its own candidate.
    // Mutation caught: the token split omits `=`, so the flag-form write is missed.
    const args = inputWithArgs({ command: 'cp x --dest=packages/core/src/y' }).toolCalls[0].args;
    expect(mentionsPath(args, 'packages/core/src')).toBe(true);
  });
});
