import { describe, expect, it } from 'vitest';
// COVENANT-05 delta layer contract (PRD §4.1–4.4, AC §5.1–5.7): new-violation-only
// judgment over a file's pre/post pair — pre-existing debt is forgiven, only added
// matches break. AC §5.8 (regression) belongs to the VALIDATE full-suite gate, not
// this file.
import { captureBaseline, diffBaselines, judgeAddedViolations } from '../src/delta.js';

// ---------------------------------------------------------------------------
// Fixtures — a realistic forbidden pattern: hardcoded 6-digit hex colours.
// (mirrors the memoriq hardcoded-hex discipline the PRD cites in §4.2).
// ---------------------------------------------------------------------------

/** Matches a hardcoded 6-digit hex colour literal, e.g. `#ffffff`. */
const HEX = /#[0-9a-f]{6}/g;

// ===========================================================================
// AC §5.1 — debt amnesty (pass)
// ===========================================================================

describe('judgeAddedViolations — debt amnesty (PRD §5.1)', () => {
  it('upholds when pre already has two matches and the edit touches neither', () => {
    // P0 incremental-adoption invariant: pre-existing debt must be forgiven. Here two hex
    // literals exist in pre; the edit only inserts an unrelated line. added is empty, so the
    // verdict is upheld. Mutation caught: judging on presence ("any match in post") instead
    // of the delta — that would block every edit to a debt-bearing file, the exact failure
    // this ticket removes.
    const pre = 'a: #ffffff;\nb: #000000;\n';
    const post = 'a: #ffffff;\nmargin: 0;\nb: #000000;\n';
    expect(judgeAddedViolations({ pre, post }, HEX)).toEqual({ upheld: true });
  });

  it('upholds when the two pre matches are only moved (line positions changed)', () => {
    // P0: relocating a violation without altering its matched text is not a new violation.
    // The multiset {#ffffff, #000000} is identical across pre and post despite reordering.
    // Mutation caught: a line-based or positional diff (would flag the moved line as new).
    const pre = 'a: #ffffff;\nb: #000000;\n';
    const post = 'b: #000000;\nheader {}\na: #ffffff;\n';
    expect(judgeAddedViolations({ pre, post }, HEX)).toEqual({ upheld: true });
  });
});

// ===========================================================================
// AC §5.2 — new violation (block), reason names the new match
// ===========================================================================

describe('judgeAddedViolations — new violation (PRD §5.2)', () => {
  it('blocks when the edit adds one new match and names it in the reason', () => {
    // P0 core purpose: a genuinely new violation is blocked. pre carries two hex literals;
    // post adds a third (#123456). The verdict is a break whose reason cites the new matched
    // string. Mutation caught: the added-emptiness check being inverted, or the reason
    // omitting the offending string (a break with no evidence).
    const pre = 'a: #ffffff;\nb: #000000;\n';
    const post = 'a: #ffffff;\nc: #123456;\nb: #000000;\n';
    const verdict = judgeAddedViolations({ pre, post }, HEX);
    expect(verdict.upheld).toBe(false);
    // Narrow for the reason field without asserting on an upheld verdict shape.
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('#123456');
    }
  });

  it('does not name a pre-existing (forgiven) match in the reason', () => {
    // P1: the reason must point only at what THIS edit added, not at forgiven debt. Adding
    // #123456 to a file that already had #ffffff must not surface #ffffff. Mutation caught:
    // the reason being built from post's full match set instead of the added delta.
    const pre = 'a: #ffffff;\n';
    const post = 'a: #ffffff;\nc: #123456;\n';
    const verdict = judgeAddedViolations({ pre, post }, HEX);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).not.toContain('#ffffff');
    }
  });
});

// ===========================================================================
// AC §5.3 — swap detection (A removed + B added, same total count)
// ===========================================================================

describe('judgeAddedViolations — swap detection (PRD §5.3)', () => {
  it('blocks when one match is replaced by a different match at equal total count', () => {
    // P0 discriminating case (PRD §4.2 table): a total-count comparison would PASS this
    // (one in, one out). The match-string multiset makes #abcdef an added instance, so it is
    // blocked. Mutation caught: judging on match COUNT rather than the per-string multiset —
    // the single mutation that collapses swap detection into a false pass.
    const pre = 'a: #ffffff;\n';
    const post = 'a: #abcdef;\n';
    const verdict = judgeAddedViolations({ pre, post }, HEX);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('#abcdef');
    }
  });

  it('treats an in-place content change of an existing match as a new violation', () => {
    // P0 (PRD §4.2 note): editing #ffffff -> #000000 is a new matched string, hence added.
    // Same total count (one before, one after) but the string differs. Mutation caught: a
    // count-only comparison, or keying the multiset by position/line rather than by text.
    const pre = 'x: #ffffff;\n';
    const post = 'x: #000000;\n';
    const verdict = judgeAddedViolations({ pre, post }, HEX);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('#000000');
    }
  });
});

// ===========================================================================
// AC §5.4 — new file (pre = null)
// ===========================================================================

describe('judgeAddedViolations — new file (PRD §5.4)', () => {
  it('blocks when pre is null and post has one match (empty baseline, all post is added)', () => {
    // P0: file creation has no debt to forgive — every post match is added. Mutation caught:
    // null pre being coerced to an equal-to-post baseline (would forgive brand-new
    // violations in a newly created file, a fail-open hole for creation edits).
    const verdict = judgeAddedViolations({ pre: null, post: 'a: #ffffff;\n' }, HEX);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('#ffffff');
    }
  });

  it('upholds when pre is null and post has zero matches', () => {
    // P1 across-boundary partner of the case above: a clean new file passes. Mutation caught:
    // null pre being treated as itself a violation, or an unconditional block on creation.
    expect(judgeAddedViolations({ pre: null, post: 'margin: 0;\n' }, HEX)).toEqual({
      upheld: true,
    });
  });
});

// ===========================================================================
// AC §5.5 — deletion-only (removed does not participate in judgment)
// ===========================================================================

describe('judgeAddedViolations — deletion only (PRD §5.5)', () => {
  it('upholds when a match is removed and nothing is added', () => {
    // P0 asymmetry (PRD §4.1: judgment exposes added only): removing a violation must never
    // block — cleanup is always allowed. Mutation caught: the judge consulting the `removed`
    // multiset (would block a good-faith deletion), or using a symmetric-difference emptiness
    // test instead of an added-only test.
    const pre = 'a: #ffffff;\nb: #000000;\n';
    const post = 'b: #000000;\n';
    expect(judgeAddedViolations({ pre, post }, HEX)).toEqual({ upheld: true });
  });
});

// ===========================================================================
// AC §5.6 — capture / diff units
// ===========================================================================

describe('captureBaseline — multiset extraction (PRD §5.6)', () => {
  it('returns an empty baseline for null content', () => {
    // P0 (PRD §4.2): null content (no file) is an empty multiset. Mutation caught: null being
    // stringified to "null" (which contains no hex, but would break the pre=null contract for
    // other patterns), or throwing on null.
    const baseline = captureBaseline(null, HEX);
    expect(baseline.size).toBe(0);
  });

  it('counts repeated identical matched strings by occurrence', () => {
    // P0 multiset semantics: three #ffffff occurrences count as 3, distinct from a set that
    // would collapse them to 1. Mutation caught: keying by presence (Set-like) instead of a
    // count map — the swap and repeated-debt cases both hinge on this count being exact.
    const baseline = captureBaseline('#ffffff #ffffff #ffffff #000000', HEX);
    expect(baseline.get('#ffffff')).toBe(3);
    expect(baseline.get('#000000')).toBe(1);
    expect(baseline.size).toBe(2);
  });

  it('extracts every occurrence across the whole content, not just the first', () => {
    // P1 global-scan: without the guaranteed `g` flag only the first match is captured.
    // Mutation caught: the internal clone dropping the `g` flag (PRD §4.3) — the baseline
    // would then undercount and later diffs would misfire.
    const baseline = captureBaseline('#111111\n#222222\n#333333', HEX);
    expect(baseline.size).toBe(3);
    expect(baseline.get('#222222')).toBe(1);
  });

  it('captures every occurrence when the caller pattern lacks the g flag', () => {
    // P0 flag-guarantee branch (PRD §4.3): the internal clone must append `g` when the
    // caller's pattern lacks it. Mutation caught: reusing the caller's flags verbatim —
    // matchAll on a non-global RegExp throws, so a non-g caller would crash instead of
    // getting a full scan.
    const nonGlobal = /#[0-9a-f]{6}/;
    const baseline = captureBaseline('#111111 #222222', nonGlobal);
    expect(baseline.size).toBe(2);
    expect(baseline.get('#111111')).toBe(1);
  });
});

describe('diffBaselines — symmetric difference (PRD §5.6)', () => {
  it('computes added and removed with intersection cancellation', () => {
    // P0 delta primitive: shared entries cancel; only the surplus in each direction remains.
    // pre = {A:1, B:1}, post = {B:1, C:1} -> added {C:1}, removed {A:1}, B cancels out.
    // Mutation caught: added/removed being swapped, or the min-cancellation being dropped so
    // B leaks into both sides.
    const pre = captureBaseline('#aaaaaa #bbbbbb', HEX);
    const post = captureBaseline('#bbbbbb #cccccc', HEX);
    const { added, removed } = diffBaselines(pre, post);
    expect(added.get('#cccccc')).toBe(1);
    expect(added.has('#bbbbbb')).toBe(false);
    expect(added.has('#aaaaaa')).toBe(false);
    expect(removed.get('#aaaaaa')).toBe(1);
    expect(removed.has('#bbbbbb')).toBe(false);
  });

  it('nets per-string counts as max(post - pre, 0) in each direction', () => {
    // P0 boundary of the count arithmetic: pre has #aaaaaa x1, post has it x3 -> added 2,
    // removed 0 for that string. Mutation caught: `max(delta, 0)` weakened to a raw
    // subtraction (would emit a negative or leak a removed count into added), or the count
    // being treated as boolean presence (would report 1 instead of 2).
    const pre = captureBaseline('#aaaaaa', HEX);
    const post = captureBaseline('#aaaaaa #aaaaaa #aaaaaa', HEX);
    const { added, removed } = diffBaselines(pre, post);
    expect(added.get('#aaaaaa')).toBe(2);
    expect(removed.has('#aaaaaa')).toBe(false);
  });

  it('yields two empty maps when both baselines are identical', () => {
    // P1 across-boundary partner: no surplus in either direction. Mutation caught: the
    // cancellation emitting a zero-count entry (size would be 1, not 0), or an off-by-one in
    // the min comparison.
    const pre = captureBaseline('#ffffff #000000', HEX);
    const post = captureBaseline('#000000 #ffffff', HEX);
    const { added, removed } = diffBaselines(pre, post);
    expect(added.size).toBe(0);
    expect(removed.size).toBe(0);
  });
});

// ===========================================================================
// AC §5.7 — determinism (no lastIndex leak; identical args => identical result)
// ===========================================================================

describe('captureBaseline / judgeAddedViolations — determinism (PRD §5.7)', () => {
  it('returns identical baselines when captureBaseline is called twice with the same args', () => {
    // P1 (PRD §4.3): repeatable extraction. Mutation caught: the function matching against
    // the caller's RegExp directly (whose lastIndex advances between calls) instead of a
    // fresh clone — the second call would start mid-string and undercount.
    const content = '#ffffff and #000000 and #ffffff';
    const first = captureBaseline(content, HEX);
    const second = captureBaseline(content, HEX);
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
    expect(second.get('#ffffff')).toBe(2);
  });

  it('is unaffected by a caller RegExp whose lastIndex is already polluted', () => {
    // P0 state-leak covenant (PRD §4.3): a /g RegExp that a caller already ran exec() on carries
    // a non-zero lastIndex. The layer must clone and never read that lastIndex, so a fresh
    // regex and a polluted one yield the same baseline. Mutation caught: the clone step being
    // removed (matching would resume from the polluted offset and drop leading matches).
    const content = '#ffffff and #000000';
    const clean = /#[0-9a-f]{6}/g;
    const polluted = /#[0-9a-f]{6}/g;
    // Pollute lastIndex the way a prior caller exec() would.
    polluted.exec(content);
    expect(polluted.lastIndex).not.toBe(0);

    const fromClean = captureBaseline(content, clean);
    const fromPolluted = captureBaseline(content, polluted);
    expect([...fromPolluted.entries()].sort()).toEqual([...fromClean.entries()].sort());
    expect(fromPolluted.size).toBe(2);
  });

  it('does not mutate the caller RegExp lastIndex', () => {
    // P0 no-side-effect (PRD §4.3): after judging, the caller's RegExp lastIndex must be
    // exactly what the caller left it (0 for an untouched /g). Mutation caught: the function
    // using the passed RegExp in place, which would advance and leave lastIndex non-zero,
    // corrupting the caller's next use.
    const pattern = /#[0-9a-f]{6}/g;
    expect(pattern.lastIndex).toBe(0);
    judgeAddedViolations({ pre: '#ffffff', post: '#ffffff #000000' }, pattern);
    expect(pattern.lastIndex).toBe(0);
  });

  it('yields identical verdicts when judgeAddedViolations is called twice with the same args', () => {
    // P1: end-to-end determinism through the judge. Mutation caught: any lastIndex leak that
    // makes the second call see a different match set (would flip the verdict between runs).
    const fileDelta = { pre: '#ffffff', post: '#ffffff #123456' } as const;
    const first = judgeAddedViolations(fileDelta, HEX);
    const second = judgeAddedViolations(fileDelta, HEX);
    expect(second).toEqual(first);
  });
});
