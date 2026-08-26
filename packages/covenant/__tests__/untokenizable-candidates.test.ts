import { describe, expect, it } from 'vitest';
import { untokenizableLineCandidates } from '../src/mention.js';

// The decomposition is a union: the dequoted raw line verbatim, plus one fragment per maximal
// run of shell metacharacters (; & | < >). Candidate ORDER is incidental, so every assertion
// here is a membership property, never an exact array.

describe('untokenizableLineCandidates — fallback-only union decomposition (COVENANT-07d §2-c)', () => {
  it('keeps the input line itself verbatim as a candidate when fragments exist', () => {
    // A fragments-only decomposition shatters any protected path whose own segment carries a
    // metacharacter.
    const line = 'rm -rf pkg/a&b/dist x';
    expect(untokenizableLineCandidates(line)).toContain(line);
  });

  it('yields the line itself for a line with no metacharacters at all', () => {
    // With no separator to split on, the degenerate input must still hand downstream mention
    // scanning the whole line rather than nothing.
    const line = 'rm -rf some/plain/path x';
    expect(untokenizableLineCandidates(line)).toContain(line);
  });

  it('separates fragments at a metachar, keeping their interior whitespace', () => {
    // Without the ';' split, `dist;echo x` stays one candidate and matches nothing; a
    // whitespace split here would instead pre-shatter what downstream scanning owns.
    const candidates = untokenizableLineCandidates('rm -rf packages/core/dist;echo x');
    expect(candidates).toContain('rm -rf packages/core/dist');
    expect(candidates).toContain('echo x');
  });

  it('treats a stacked metachar run as one separator and mints no empty candidates', () => {
    // A per-character split mints '' between stacked metachars, and an empty candidate
    // mentions nothing while polluting every downstream scan.
    for (const line of ['a;;b', 'a>&b']) {
      const candidates = untokenizableLineCandidates(line);
      expect(candidates).not.toContain('');
      expect(candidates).toContain('a');
      expect(candidates).toContain('b');
    }
  });

  it('yields one fragment per span when several different metachars mix', () => {
    // Splitting only at the first metachar found leaves `b|c` fused, so the '|' spelling of
    // the glue stays open.
    const line = 'a<b|c';
    const candidates = untokenizableLineCandidates(line);
    for (const expected of [line, 'a', 'b', 'c']) {
      expect(candidates).toContain(expected);
    }
  });

  it('never separates at a colon — a PATH-style list stays whole', () => {
    // ':' is deliberately outside the separator set — adding it would over-block URLs and
    // PATH-style lists — and the fallback must keep that exclusion.
    const line = 'PATH=/usr/bin:pkg/x';
    const candidates = untokenizableLineCandidates(line);
    expect(candidates).toContain(line);
    expect(candidates).not.toContain('pkg/x');
    expect(candidates).not.toContain('PATH=/usr/bin');
  });
});
