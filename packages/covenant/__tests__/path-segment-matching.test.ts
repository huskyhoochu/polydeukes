import type { CovenantInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// COVENANT-07 §4.1 — `pathMatchesProtected` does not exist yet (RED phase). This import
// must fail to resolve until mention.ts is upgraded from substring to path-segment matching.
import { mentionsPath, pathMatchesProtected } from '../src/mention.js';

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

/** Build a minimal CovenantInput with a single toolCalls[0].args value tree. */
function inputWithArgs(args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name: 'some-tool', args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

describe('mentionsPath — recursive traversal with segment semantics (PRD §5.1)', () => {
  it('does NOT match a sibling sharing a segment prefix nested inside args (src-gen)', () => {
    // Mutation caught: substring semantics retained inside the traversal — `packages/core/
    // src-gen/x.ts` would substring-hit `packages/core/src` and produce a false block/route.
    const args = inputWithArgs({ file_path: 'packages/core/src-gen/x.ts' }).toolCalls[0].args;
    expect(mentionsPath(args, 'packages/core/src')).toBe(false);
  });
});
