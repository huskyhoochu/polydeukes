import { describe, expect, it } from 'vitest';
// Import from the package entry point (src/index.ts) — the same surface
// `@polydeukes/core` publishes. normalizeProtectedPaths is CONFIG-02's new export.
import { normalizeProtectedPaths } from '../src/index.ts';

// ---------------------------------------------------------------------------
// PRD §5.1 — normalizeProtectedPaths pure-function unit tests.
// All path/adapter strings below are injected fixture values; the core source
// must never carry such literals (PRD §4.1/§7 grep gate).
// ---------------------------------------------------------------------------

describe('normalizeProtectedPaths — union of protectedPaths and adapters (PRD §5.1)', () => {
  it('includes both registered adapter directories in the output', () => {
    // AC: "two adapters registered -> output contains both". Mutation caught: the
    // adapters field dropped from the union (auto-include regression -> the exact
    // assessment §9 difficulty 7 hole where a registered adapter is silently unprotected).
    const result = normalizeProtectedPaths({
      adapters: ['packages/adapter-foo', 'packages/adapter-bar'],
    });

    expect(result).toContain('packages/adapter-foo');
    expect(result).toContain('packages/adapter-bar');
  });

  it('returns the union of both fields with protectedPaths entries before adapters entries', () => {
    // AC: union with first-occurrence order (protectedPaths first, adapters second).
    // Mutation caught: concatenation order reversed, or one field silently discarded.
    const result = normalizeProtectedPaths({
      protectedPaths: ['src/core'],
      adapters: ['packages/adapter-foo'],
    });

    expect(result).toEqual(['src/core', 'packages/adapter-foo']);
  });

  it('returns an empty array when both fields are absent', () => {
    // AC: "both absent -> []". Mutation caught: a fallback that injects a default
    // path (e.g. '' or '.'), which would over-match every input downstream.
    const result = normalizeProtectedPaths({});

    expect(result).toEqual([]);
  });

  it('returns an empty array when both fields are present but empty', () => {
    // Boundary: empty arrays are not the same as absent, but must yield the same [].
    // Mutation caught: a length check that treats an empty array as a special value.
    const result = normalizeProtectedPaths({ protectedPaths: [], adapters: [] });

    expect(result).toEqual([]);
  });
});

describe('normalizeProtectedPaths — per-entry normalization rules (PRD §5.1)', () => {
  it('strips a leading "./" from a path', () => {
    // Rule: leading './' removed ('./x/y' -> 'x/y'). Mutation caught: the leading-'./'
    // strip skipped, leaving 'x/y' and './x/y' as distinct substrings that match
    // differently against the dispatcher.
    const result = normalizeProtectedPaths({ protectedPaths: ['./x/y'] });

    expect(result).toEqual(['x/y']);
  });

  it('strips a trailing "/" from a path', () => {
    // Rule: trailing '/' removed ('x/y/' -> 'x/y'). Mutation caught: the trailing-'/'
    // strip skipped — 'x/y/' matches a strictly narrower set of inputs than 'x/y',
    // a real fail-open-narrowing bug the PRD calls out.
    const result = normalizeProtectedPaths({ protectedPaths: ['x/y/'] });

    expect(result).toEqual(['x/y']);
  });

  it('strips repeated leading "./" prefixes to a fixpoint', () => {
    // Mutation caught: a single-pass strip ('if' instead of 'while') leaving './x/y',
    // which substring-matches no real payload path — silent fail-open narrowing.
    const result = normalizeProtectedPaths({ protectedPaths: ['././x/y'] });

    expect(result).toEqual(['x/y']);
  });

  it('strips repeated trailing "/" suffixes to a fixpoint', () => {
    // Mutation caught: a single-pass strip leaving 'x/y/', which never matches the
    // bare directory mention 'x/y' — the same silent narrowing on the suffix side.
    const result = normalizeProtectedPaths({ protectedPaths: ['x/y//'] });

    expect(result).toEqual(['x/y']);
  });

  it('trims surrounding whitespace from a path', () => {
    // AC: whitespace trim. Mutation caught: trim step removed, leaving '  x/y  ' which
    // never substring-matches a real path.
    const result = normalizeProtectedPaths({ protectedPaths: ['  x/y  '] });

    expect(result).toEqual(['x/y']);
  });
});

describe('normalizeProtectedPaths — empty-equivalent entries dropped (PRD §5.1)', () => {
  it('drops an empty-string entry from the output', () => {
    // AC: "'' dropped". P0 fail-open guard: an unguarded '' substring-matches every
    // input, turning the protection surface into a match-everything sieve.
    const result = normalizeProtectedPaths({ protectedPaths: [''] });

    expect(result).toEqual([]);
  });

  it('drops a bare "/" entry (normalizes to empty)', () => {
    // AC: "'/' dropped". Mutation caught: the post-normalization empty check applied
    // before the trailing-'/' strip, letting '/' survive as an empty-equivalent path.
    const result = normalizeProtectedPaths({ protectedPaths: ['/'] });

    expect(result).toEqual([]);
  });

  it('drops a whitespace-only entry (normalizes to empty)', () => {
    // AC: "'  ' dropped". Mutation caught: the empty check run before trim, so a
    // whitespace-only string is kept as a match-everything path.
    const result = normalizeProtectedPaths({ protectedPaths: ['  '] });

    expect(result).toEqual([]);
  });
});

describe('normalizeProtectedPaths — deduplication after normalization (PRD §5.1)', () => {
  it('collapses post-normalization duplicates into one, preserving first occurrence', () => {
    // AC: "'x/y' and './x/y/' collapse to one, order preserved". Mutation caught:
    // dedup done on raw strings (before normalization), so 'x/y' and './x/y/' are
    // treated as distinct and both survive.
    const result = normalizeProtectedPaths({ protectedPaths: ['x/y', './x/y/'] });

    expect(result).toEqual(['x/y']);
  });

  it('collapses a duplicate that spans the protectedPaths/adapters boundary', () => {
    // Mutation caught: dedup applied per-field instead of across the merged union,
    // letting the same normalized path appear once from each field.
    const result = normalizeProtectedPaths({
      protectedPaths: ['x/y'],
      adapters: ['./x/y/'],
    });

    expect(result).toEqual(['x/y']);
  });
});
