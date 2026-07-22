import { describe, expect, it } from 'vitest';
// CONFIG-06 §4.1/§4.2 RED phase. The adapter-git namespace validator — the first
// tenant of the CONFIG-07 adapter namespace container. Imported from the package entry
// point (the published surface). This symbol does NOT exist yet; the signature asserted
// here is the GREEN-phase contract:
//   resolveGitAdapterSettings(namespace: unknown): { enforce: 'block' | 'advise' }
// It receives the value of `adapters.git` (undefined when the namespace or the whole
// adapters map is absent). Unknown values/keys fail-fast (throw); absence fills block.
import { resolveGitAdapterSettings } from '../src/index.ts';

describe('CONFIG-06 §4.2 resolveGitAdapterSettings — default fill (silent-relaxation is block)', () => {
  it('fills { enforce: block } when the namespace is absent (undefined)', () => {
    // §4.2 fixture 1: an absent namespace (or an absent adapters map) resolves to the
    // strictest level. Mutation caught: the undefined branch defaulting to 'advise'
    // (silent relaxation) or throwing instead of filling block.
    expect(resolveGitAdapterSettings(undefined)).toEqual({ enforce: 'block' });
  });

  it('fills { enforce: block } when enforce is absent (empty object)', () => {
    // §4.2 fixture 2: a present-but-empty namespace still resolves to block — the
    // enforce default is the "no silent relaxation" principle itself. Mutation caught:
    // an empty object treated as invalid (throw) or defaulted to advise.
    expect(resolveGitAdapterSettings({})).toEqual({ enforce: 'block' });
  });
});

describe('CONFIG-06 §4.2 resolveGitAdapterSettings — verbatim pass-through', () => {
  it('returns { enforce: block } verbatim', () => {
    // §4.2 fixture 3a. Mutation caught: an explicit block being coerced/renamed, or the
    // validator dropping the enforce field.
    expect(resolveGitAdapterSettings({ enforce: 'block' })).toEqual({ enforce: 'block' });
  });

  it('returns { enforce: advise } verbatim', () => {
    // §4.2 fixture 3b: the one relaxed level must round-trip unchanged. Mutation caught:
    // advise being narrowed back to block, which would defeat the whole ticket.
    expect(resolveGitAdapterSettings({ enforce: 'advise' })).toEqual({ enforce: 'advise' });
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
