import { describe, expect, it } from 'vitest';
// The validator receives the value of `adapters.git` — undefined when the namespace or
// the whole adapters map is absent. Unknown values and keys fail fast; absence fills the
// strictest level.
import { resolveGitAdapterSettings } from '../src/index.ts';

describe('CONFIG-06 §4.2 resolveGitAdapterSettings — default fill (silent-relaxation is block)', () => {
  it('fills { enforce: block } when the namespace is absent (undefined)', () => {
    expect(resolveGitAdapterSettings(undefined)).toEqual({ enforce: 'block', protectedPaths: [] });
  });

  it('fills { enforce: block } when enforce is absent (empty object)', () => {
    // The enforce default is the "no silent relaxation" principle itself: a
    // present-but-empty namespace may not be read as permission to relax.
    expect(resolveGitAdapterSettings({})).toEqual({ enforce: 'block', protectedPaths: [] });
  });
});

describe('CONFIG-06 §4.2 resolveGitAdapterSettings — verbatim pass-through', () => {
  it('returns { enforce: block } verbatim', () => {
    expect(resolveGitAdapterSettings({ enforce: 'block' })).toEqual({
      enforce: 'block',
      protectedPaths: [],
    });
  });

  it('returns { enforce: advise } verbatim', () => {
    // The one relaxed level must round-trip unchanged — narrowing it back to block would
    // make the setting unreachable.
    expect(resolveGitAdapterSettings({ enforce: 'advise' })).toEqual({
      enforce: 'advise',
      protectedPaths: [],
    });
  });
});

describe('CONFIG-06 §4.2 resolveGitAdapterSettings — fail-fast rejection', () => {
  it('throws on the reserved level (measure) with a field-path-named message', () => {
    // 'measure' is a reserved level with no implementation behind it; the validator
    // rejecting it is what keeps it unusable.
    expect(() => resolveGitAdapterSettings({ enforce: 'measure' })).toThrow(
      /adapters\.git\.enforce/,
    );
  });

  it('throws on a non-string enforce value with a field-path-named message', () => {
    expect(() => resolveGitAdapterSettings({ enforce: 1 })).toThrow(/adapters\.git\.enforce/);
  });

  it('throws on an unknown key inside the namespace with a field-path-named message', () => {
    // A typo must not pass silently: an ignored extra key configures nothing while the
    // author believes it configured something.
    expect(() => resolveGitAdapterSettings({ enforce: 'block', extra: true })).toThrow(
      /adapters\.git/,
    );
  });
});

describe('CONFIG-08 §4.1 resolveGitAdapterSettings — protectedPaths acceptance', () => {
  it('accepts an explicit empty additive list', () => {
    // An empty additive list is valid vocabulary, not an unknown key.
    expect(resolveGitAdapterSettings({ protectedPaths: [] })).toEqual({
      enforce: 'block',
      protectedPaths: [],
    });
  });

  it('passes a valid additive list through verbatim while enforce still fills block', () => {
    // The list's presence must not disturb the enforce default fill.
    expect(resolveGitAdapterSettings({ protectedPaths: ['packages/core/src'] })).toEqual({
      enforce: 'block',
      protectedPaths: ['packages/core/src'],
    });
  });

  it('resolves enforce and protectedPaths together when both are present', () => {
    // Real configs carry both keys, so neither may shadow the other — an early return on
    // enforce would never read the list.
    expect(
      resolveGitAdapterSettings({ enforce: 'advise', protectedPaths: ['packages/core/src'] }),
    ).toEqual({ enforce: 'advise', protectedPaths: ['packages/core/src'] });
  });
});

describe('CONFIG-08 §4.1 resolveGitAdapterSettings — protectedPaths rejection', () => {
  it('throws on a non-array protectedPaths with the exact contract message', () => {
    // A scalar spelling must fail fast, never be wrapped into a one-entry list — a shape
    // typo passing silently would seed the protection surface with unvalidated data.
    expect(() => resolveGitAdapterSettings({ protectedPaths: 'packages/core/src' })).toThrow(
      /adapters\.git\.protectedPaths must be an array of strings/,
    );
  });

  it('throws on a non-string element with the same message', () => {
    // Per-element validation is the fail-open-critical half: a number reaching path
    // matching can never match anything, so the entry would silently protect nothing.
    expect(() => resolveGitAdapterSettings({ protectedPaths: [42] })).toThrow(
      /adapters\.git\.protectedPaths must be an array of strings/,
    );
  });

  it('still throws on a truly unknown key (lowercase typo of the new vocabulary)', () => {
    // A case-insensitive key match would let the typo'd spelling configure nothing while
    // its author believes paths are protected.
    expect(() => resolveGitAdapterSettings({ protectedpaths: ['packages/core/src'] })).toThrow(
      /adapters\.git/,
    );
  });
});
