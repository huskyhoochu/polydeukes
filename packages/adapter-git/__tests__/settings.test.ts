import { describe, expect, it } from 'vitest';
// CONFIG-06 §4.1/§4.2 RED phase. The adapter-git namespace validator — the first
// tenant of the CONFIG-07 adapter namespace container. Imported from the package entry
// point (the published surface). This symbol does NOT exist yet; the signature asserted
// here is the GREEN-phase contract:
//   resolveGitAdapterSettings(namespace: unknown): { enforce: 'block' | 'advise' }
// It receives the value of `adapters.git` (undefined when the namespace or the whole
// adapters map is absent). Unknown values/keys fail-fast (throw); absence fills block.
//
// CONFIG-08 §4.1 extends the resolved shape with the commit-surface additive list:
//   resolveGitAdapterSettings(namespace: unknown):
//     { enforce: 'block' | 'advise'; protectedPaths: string[] }
// (default []). Absence of the key must fill the empty additive, so the CONFIG-06
// exact-equality expectations below were synced to the extended shape in the CONFIG-08
// RED phase — leaving them at the old shape would contradict §4.1 row 1 and make the
// suite unpassable at GREEN.
import { resolveGitAdapterSettings } from '../src/index.ts';

describe('CONFIG-06 §4.2 resolveGitAdapterSettings — default fill (silent-relaxation is block)', () => {
  it('fills { enforce: block } when the namespace is absent (undefined)', () => {
    // §4.2 fixture 1: an absent namespace (or an absent adapters map) resolves to the
    // strictest level. Mutation caught: the undefined branch defaulting to 'advise'
    // (silent relaxation) or throwing instead of filling block.
    expect(resolveGitAdapterSettings(undefined)).toEqual({ enforce: 'block', protectedPaths: [] });
  });

  it('fills { enforce: block } when enforce is absent (empty object)', () => {
    // §4.2 fixture 2: a present-but-empty namespace still resolves to block — the
    // enforce default is the "no silent relaxation" principle itself. Mutation caught:
    // an empty object treated as invalid (throw) or defaulted to advise.
    expect(resolveGitAdapterSettings({})).toEqual({ enforce: 'block', protectedPaths: [] });
  });
});

describe('CONFIG-06 §4.2 resolveGitAdapterSettings — verbatim pass-through', () => {
  it('returns { enforce: block } verbatim', () => {
    // §4.2 fixture 3a. Mutation caught: an explicit block being coerced/renamed, or the
    // validator dropping the enforce field.
    expect(resolveGitAdapterSettings({ enforce: 'block' })).toEqual({
      enforce: 'block',
      protectedPaths: [],
    });
  });

  it('returns { enforce: advise } verbatim', () => {
    // §4.2 fixture 3b: the one relaxed level must round-trip unchanged. Mutation caught:
    // advise being narrowed back to block, which would defeat the whole ticket.
    expect(resolveGitAdapterSettings({ enforce: 'advise' })).toEqual({
      enforce: 'advise',
      protectedPaths: [],
    });
  });
});

describe('CONFIG-06 §4.2 resolveGitAdapterSettings — fail-fast rejection', () => {
  it('throws on the reserved level (measure) with a field-path-named message', () => {
    // §4.2 fixture 4: 'measure' is the reserved level, deliberately pinned as REJECTED —
    // the deferral is enforced by the validator rejecting it now. Mutation caught: an
    // allowlist widened to include measure (opening a deferred level), or a throw whose
    // message omits the field path.
    expect(() => resolveGitAdapterSettings({ enforce: 'measure' })).toThrow(
      /adapters\.git\.enforce/,
    );
  });

  it('throws on a non-string enforce value with a field-path-named message', () => {
    // §4.2 fixture 5. Mutation caught: a type check dropped so a number coerces (e.g.
    // truthiness treated as advise), or the error message losing the field path.
    expect(() => resolveGitAdapterSettings({ enforce: 1 })).toThrow(/adapters\.git\.enforce/);
  });

  it('throws on an unknown key inside the namespace with a field-path-named message', () => {
    // §4.2 fixture 6: the adapter vocabulary fail-fasts on unknown keys (a typo must not
    // pass silently). Mutation caught: an unknown-key check removed so extra keys are
    // ignored, or the error message not naming the namespace.
    expect(() => resolveGitAdapterSettings({ enforce: 'block', extra: true })).toThrow(
      /adapters\.git/,
    );
  });
});

describe('CONFIG-08 §4.1 resolveGitAdapterSettings — protectedPaths acceptance', () => {
  it('accepts an explicit empty additive list', () => {
    // §4.1 row "protectedPaths: []": an empty additive is valid vocabulary, not an
    // unknown key. Mutation caught: the allowlist not widened for the new key, so the
    // whole CONFIG-08 vocabulary still fail-fasts (every configured repo fails closed).
    expect(resolveGitAdapterSettings({ protectedPaths: [] })).toEqual({
      enforce: 'block',
      protectedPaths: [],
    });
  });

  it('passes a valid additive list through verbatim while enforce still fills block', () => {
    // §4.1 row "['packages/core/src']": the commit-surface additive list survives
    // resolution unchanged AND its presence must not disturb the enforce default fill.
    // Mutation caught: the list dropped/emptied on resolve, or protectedPaths presence
    // flipping the enforce branch.
    expect(resolveGitAdapterSettings({ protectedPaths: ['packages/core/src'] })).toEqual({
      enforce: 'block',
      protectedPaths: ['packages/core/src'],
    });
  });

  it('resolves enforce and protectedPaths together when both are present', () => {
    // §4.1 coexistence (the target-state config carries both keys): neither key may
    // shadow the other. Mutation caught: an either-or parse dropping one side, e.g. an
    // early return on enforce that never reads the list.
    expect(
      resolveGitAdapterSettings({ enforce: 'advise', protectedPaths: ['packages/core/src'] }),
    ).toEqual({ enforce: 'advise', protectedPaths: ['packages/core/src'] });
  });
});

describe('CONFIG-08 §4.1 resolveGitAdapterSettings — protectedPaths rejection', () => {
  it('throws on a non-array protectedPaths with the exact contract message', () => {
    // §4.1 row "non-array": a scalar spelling must fail fast, never be coerced into a
    // one-entry list — a shape typo passing silently would seed the protection surface
    // with unvalidated data. Mutation caught: string input wrapped instead of rejected.
    expect(() => resolveGitAdapterSettings({ protectedPaths: 'packages/core/src' })).toThrow(
      /adapters\.git\.protectedPaths must be an array of strings/,
    );
  });

  it('throws on a non-string element with the same message', () => {
    // §4.1 row "[42]": per-element validation is the fail-open-critical half — a number
    // reaching path matching can never match anything, so the entry would silently
    // protect nothing. Mutation caught: only Array.isArray kept, the element check
    // dropped.
    expect(() => resolveGitAdapterSettings({ protectedPaths: [42] })).toThrow(
      /adapters\.git\.protectedPaths must be an array of strings/,
    );
  });

  it('still throws on a truly unknown key (lowercase typo of the new vocabulary)', () => {
    // §4.1 last row, the regression pin: widening the allowlist for `protectedPaths`
    // must not loosen the unknown-key contract around it. Mutation caught: a
    // case-insensitive key match (or the unknown-key check removed while wiring the new
    // key), letting the typo'd spelling configure nothing while claiming protection.
    expect(() => resolveGitAdapterSettings({ protectedpaths: ['packages/core/src'] })).toThrow(
      /adapters\.git/,
    );
  });
});
