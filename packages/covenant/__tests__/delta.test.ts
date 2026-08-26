import { describe, expect, it } from 'vitest';
// The delta layer: new-violation-only judgment over a file's pre/post pair — pre-existing
// debt is forgiven, only added matches break.
import { captureBaseline, diffBaselines, judgeAddedViolations } from '../src/delta.js';

/** Matches a hardcoded 6-digit hex colour literal, e.g. `#ffffff`. */
const HEX = /#[0-9a-f]{6}/g;

describe('judgeAddedViolations — debt amnesty', () => {
  it('upholds when pre already has two matches and the edit touches neither', () => {
    // Pre-existing debt must be forgiven, or every edit to a debt-bearing file blocks:
    // judgment is on the delta, never on presence of any match in post.
    const pre = 'a: #ffffff;\nb: #000000;\n';
    const post = 'a: #ffffff;\nmargin: 0;\nb: #000000;\n';
    expect(judgeAddedViolations({ pre, post }, HEX)).toEqual({ upheld: true });
  });

  it('upholds when the two pre matches are only moved (line positions changed)', () => {
    // Relocating a violation without altering its matched text is not a new violation: the
    // multiset is identical across pre and post, though a line-based or positional diff
    // would flag the moved line as new.
    const pre = 'a: #ffffff;\nb: #000000;\n';
    const post = 'b: #000000;\nheader {}\na: #ffffff;\n';
    expect(judgeAddedViolations({ pre, post }, HEX)).toEqual({ upheld: true });
  });
});

describe('judgeAddedViolations — new violation', () => {
  it('blocks when the edit adds one new match and names it in the reason', () => {
    // The reason must cite the newly matched string — a break with no evidence names
    // nothing the reader can act on.
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
    // The reason must point only at what THIS edit added, never at forgiven debt: built
    // from post's full match set it would surface the pre-existing literal too.
    const pre = 'a: #ffffff;\n';
    const post = 'a: #ffffff;\nc: #123456;\n';
    const verdict = judgeAddedViolations({ pre, post }, HEX);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).not.toContain('#ffffff');
    }
  });
});

describe('judgeAddedViolations — swap detection', () => {
  it('blocks when one match is replaced by a different match at equal total count', () => {
    // A total-count comparison passes this (one in, one out). Only the per-string multiset
    // makes #abcdef an added instance, so counting alone collapses swap detection.
    const pre = 'a: #ffffff;\n';
    const post = 'a: #abcdef;\n';
    const verdict = judgeAddedViolations({ pre, post }, HEX);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('#abcdef');
    }
  });

  it('treats an in-place content change of an existing match as a new violation', () => {
    // Editing #ffffff to #000000 is a new matched string at the same total count, so the
    // multiset must be keyed by text rather than by position or line.
    const pre = 'x: #ffffff;\n';
    const post = 'x: #000000;\n';
    const verdict = judgeAddedViolations({ pre, post }, HEX);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('#000000');
    }
  });
});

describe('judgeAddedViolations — new file', () => {
  it('blocks when pre is null and post has one match (empty baseline, all post is added)', () => {
    // File creation has no debt to forgive — every post match is added. Coercing a null pre
    // to an equal-to-post baseline forgives brand-new violations in a created file.
    const verdict = judgeAddedViolations({ pre: null, post: 'a: #ffffff;\n' }, HEX);
    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('#ffffff');
    }
  });

  it('upholds when pre is null and post has zero matches', () => {
    // The partner direction: a clean new file passes, so a null pre is not itself a
    // violation.
    expect(judgeAddedViolations({ pre: null, post: 'margin: 0;\n' }, HEX)).toEqual({
      upheld: true,
    });
  });
});

describe('judgeAddedViolations — deletion only', () => {
  it('upholds when a match is removed and nothing is added', () => {
    // Judgment exposes the added direction only, so removing a violation never blocks —
    // cleanup is always allowed. A symmetric-difference emptiness test would block it.
    const pre = 'a: #ffffff;\nb: #000000;\n';
    const post = 'b: #000000;\n';
    expect(judgeAddedViolations({ pre, post }, HEX)).toEqual({ upheld: true });
  });
});

describe('captureBaseline — multiset extraction', () => {
  it('returns an empty baseline for null content', () => {
    // Null content (no file) is an empty multiset. Stringifying null to "null" happens to
    // contain no hex, but breaks the pre=null contract for other patterns.
    const baseline = captureBaseline(null, HEX);
    expect(baseline.size).toBe(0);
  });

  it('counts repeated identical matched strings by occurrence', () => {
    // Multiset, not set: the swap and repeated-debt cases both hinge on this count being
    // exact, so keying by presence collapses them.
    const baseline = captureBaseline('#ffffff #ffffff #ffffff #000000', HEX);
    expect(baseline.get('#ffffff')).toBe(3);
    expect(baseline.get('#000000')).toBe(1);
    expect(baseline.size).toBe(2);
  });

  it('extracts every occurrence across the whole content, not just the first', () => {
    // Without the guaranteed `g` flag only the first match is captured, so the baseline
    // undercounts and later diffs misfire.
    const baseline = captureBaseline('#111111\n#222222\n#333333', HEX);
    expect(baseline.size).toBe(3);
    expect(baseline.get('#222222')).toBe(1);
  });

  it('captures every occurrence when the caller pattern lacks the g flag', () => {
    // The internal clone must append `g` when the caller's pattern lacks it: matchAll on a
    // non-global RegExp throws, so reusing the caller's flags crashes instead of scanning.
    const nonGlobal = /#[0-9a-f]{6}/;
    const baseline = captureBaseline('#111111 #222222', nonGlobal);
    expect(baseline.size).toBe(2);
    expect(baseline.get('#111111')).toBe(1);
  });
});

describe('diffBaselines — symmetric difference', () => {
  it('computes added and removed with intersection cancellation', () => {
    // Shared entries cancel; only the surplus in each direction remains. Dropping the
    // min-cancellation leaks the shared entry into both sides.
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
    // The count arithmetic is max(post - pre, 0) per direction: a raw subtraction emits a
    // negative or leaks a removed count into added, and boolean presence reports 1 not 2.
    const pre = captureBaseline('#aaaaaa', HEX);
    const post = captureBaseline('#aaaaaa #aaaaaa #aaaaaa', HEX);
    const { added, removed } = diffBaselines(pre, post);
    expect(added.get('#aaaaaa')).toBe(2);
    expect(removed.has('#aaaaaa')).toBe(false);
  });

  it('yields two empty maps when both baselines are identical', () => {
    // No surplus in either direction: the cancellation must not emit a zero-count entry.
    const pre = captureBaseline('#ffffff #000000', HEX);
    const post = captureBaseline('#000000 #ffffff', HEX);
    const { added, removed } = diffBaselines(pre, post);
    expect(added.size).toBe(0);
    expect(removed.size).toBe(0);
  });
});

describe('captureBaseline / judgeAddedViolations — determinism', () => {
  it('returns identical baselines when captureBaseline is called twice with the same args', () => {
    // Matching against the caller's RegExp directly advances its lastIndex between calls,
    // so the second call starts mid-string and undercounts. The layer clones instead.
    const content = '#ffffff and #000000 and #ffffff';
    const first = captureBaseline(content, HEX);
    const second = captureBaseline(content, HEX);
    expect([...second.entries()].sort()).toEqual([...first.entries()].sort());
    expect(second.get('#ffffff')).toBe(2);
  });

  it('is unaffected by a caller RegExp whose lastIndex is already polluted', () => {
    // A /g RegExp the caller already ran exec() on carries a non-zero lastIndex. Without
    // the clone, matching resumes from that offset and drops the leading matches.
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
    // After judging, the caller's RegExp lastIndex must be exactly what the caller left it.
    // Using the passed RegExp in place advances it and corrupts the caller's next use.
    const pattern = /#[0-9a-f]{6}/g;
    expect(pattern.lastIndex).toBe(0);
    judgeAddedViolations({ pre: '#ffffff', post: '#ffffff #000000' }, pattern);
    expect(pattern.lastIndex).toBe(0);
  });

  it('yields identical verdicts when judgeAddedViolations is called twice with the same args', () => {
    // End-to-end determinism: any lastIndex leak makes the second call see a different
    // match set and flips the verdict between runs.
    const fileDelta = { pre: '#ffffff', post: '#ffffff #123456' } as const;
    const first = judgeAddedViolations(fileDelta, HEX);
    const second = judgeAddedViolations(fileDelta, HEX);
    expect(second).toEqual(first);
  });
});
