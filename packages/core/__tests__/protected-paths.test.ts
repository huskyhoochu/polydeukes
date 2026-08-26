import { describe, expect, it } from 'vitest';
// Imported through the package entry point — the same surface `@polydeukes/core` publishes.
import { normalizeProtectedPaths } from '../src/index.ts';

// All path strings below are injected fixture values; the core source must never carry
// such literals.

describe('normalizeProtectedPaths — protectedPaths list (PRD §5.1)', () => {
  it('includes every protectedPaths entry in the output, in first-occurrence order', () => {
    // Catches an entry silently dropped, or input order not preserved — the hole where a
    // listed path ends up unprotected.
    const result = normalizeProtectedPaths({
      protectedPaths: ['src/core', 'packages/adapter-foo'],
    });

    expect(result).toEqual(['src/core', 'packages/adapter-foo']);
  });

  it('returns an empty array when protectedPaths is absent', () => {
    // Catches a fallback that injects a default path (e.g. '' or '.'), which would
    // over-match every input downstream.
    const result = normalizeProtectedPaths({});

    expect(result).toEqual([]);
  });

  it('returns an empty array when protectedPaths is present but empty', () => {
    // An empty array is not the same as absent, but must yield the same []; catches a
    // length check that treats an empty array as a special value.
    const result = normalizeProtectedPaths({ protectedPaths: [] });

    expect(result).toEqual([]);
  });
});

describe('normalizeProtectedPaths — per-entry normalization rules (PRD §5.1)', () => {
  it('strips a leading "./" from a path', () => {
    // Without the strip, 'x/y' and './x/y' are distinct substrings that match differently
    // against the dispatcher.
    const result = normalizeProtectedPaths({ protectedPaths: ['./x/y'] });

    expect(result).toEqual(['x/y']);
  });

  it('strips a trailing "/" from a path', () => {
    // Without the strip, 'x/y/' matches a strictly narrower set of inputs than 'x/y' —
    // silent fail-open narrowing.
    const result = normalizeProtectedPaths({ protectedPaths: ['x/y/'] });

    expect(result).toEqual(['x/y']);
  });

  it('strips repeated leading "./" prefixes to a fixpoint', () => {
    // A single-pass strip ('if' instead of 'while') leaves './x/y', which substring-matches
    // no real payload path — silent fail-open narrowing.
    const result = normalizeProtectedPaths({ protectedPaths: ['././x/y'] });

    expect(result).toEqual(['x/y']);
  });

  it('strips repeated trailing "/" suffixes to a fixpoint', () => {
    // A single-pass strip leaves 'x/y/', which never matches the bare directory mention
    // 'x/y' — the same silent narrowing on the suffix side.
    const result = normalizeProtectedPaths({ protectedPaths: ['x/y//'] });

    expect(result).toEqual(['x/y']);
  });

  it('trims surrounding whitespace from a path', () => {
    // Without the trim, '  x/y  ' never substring-matches a real path.
    const result = normalizeProtectedPaths({ protectedPaths: ['  x/y  '] });

    expect(result).toEqual(['x/y']);
  });
});

describe('normalizeProtectedPaths — empty-equivalent entries dropped (PRD §5.1)', () => {
  it('drops an empty-string entry from the output', () => {
    // An unchecked '' substring-matches every input, turning the protection surface into a
    // match-everything sieve.
    const result = normalizeProtectedPaths({ protectedPaths: [''] });

    expect(result).toEqual([]);
  });

  it('drops a bare "/" entry (normalizes to empty)', () => {
    // Catches an empty check applied before the trailing-'/' strip, which would let '/'
    // survive as an empty-equivalent path.
    const result = normalizeProtectedPaths({ protectedPaths: ['/'] });

    expect(result).toEqual([]);
  });

  it('drops a whitespace-only entry (normalizes to empty)', () => {
    // Catches an empty check run before the trim, which would keep a whitespace-only string
    // as a match-everything path.
    const result = normalizeProtectedPaths({ protectedPaths: ['  '] });

    expect(result).toEqual([]);
  });
});

describe('normalizeProtectedPaths — deduplication after normalization (PRD §5.1)', () => {
  it('collapses post-normalization duplicates into one, preserving first occurrence', () => {
    // Catches dedup done on raw strings before normalization, which would treat 'x/y' and
    // './x/y/' as distinct.
    const result = normalizeProtectedPaths({ protectedPaths: ['x/y', './x/y/'] });

    expect(result).toEqual(['x/y']);
  });
});
