import { describe, expect, it } from 'vitest';
// CONFIG-10 §4.1 / §4.2 — a `disciplines:` entry may be a draft: `{ id, why, draft: true }`
// and nothing else. A draft carries no predicate, no scope, no trigger — it is a practice
// registered as prose ahead of promotion. `defineConfig` splits drafts out at resolution
// time: `ResolvedConfig.disciplines` keeps only judged entries and `ResolvedConfig.drafts`
// carries the drafts in declaration order, so the covenant compiler never sees a draft.
import { ConfigValidationError, defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures. Same base config as config-disciplines.test.ts. `drafts` is not on the
// shipped ResolvedConfig type yet, so the widened alias keeps this file compiling
// while the assertions stay runtime failures.
// ---------------------------------------------------------------------------

type ResolvedWithDrafts = ReturnType<typeof defineConfig> & { drafts?: unknown[] };

const baseConfig = {
  languages: {
    typescript: {
      productionGlob: 'packages/core/src/**/*',
      testCmd: 'fake-runner {scope}',
    },
  },
} as const;

/** Attach a disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...baseConfig, disciplines };
}

const draftEntry = {
  id: 'bilingual-docs-sync',
  why: 'keep the en and ko doc mirrors in sync',
  draft: true,
};
const judgedForbid = { id: 'no-todo', forbid: 'TODO' };
const judgedImmutable = { id: 'changelog-immutable', immutable: 'CHANGELOG.md' };

// Asserts the concrete error instance and returns it so callers can assert on the message.
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

// ===========================================================================
// AC-1 — a draft entry passes and lands in ResolvedConfig.drafts
// ===========================================================================

describe('defineConfig disciplines — draft acceptance and resolution split (CONFIG-10 AC-1)', () => {
  it('accepts { id, why, draft: true } and carries it verbatim into drafts', () => {
    // P0 acceptance: the promotion ladder's first rung. Mutation caught: the validator
    // still rejecting `draft` as an unknown key, or rewriting the entry on the way through.
    const resolved = defineConfig(withDisciplines([draftEntry])) as ResolvedWithDrafts;

    expect(resolved.drafts).toEqual([draftEntry]);
  });

  it('splits a mixed array: judged entries stay in disciplines, the draft moves to drafts', () => {
    // P0 resolution split (§4.2 diagram: 2 judged + 1 draft). Mutation caught: the split
    // dropped (a draft left inside disciplines would reach the covenant compiler), or the
    // judged entries' relative order disturbed by the extraction.
    const resolved = defineConfig(
      withDisciplines([judgedForbid, draftEntry, judgedImmutable]),
    ) as ResolvedWithDrafts;

    expect(resolved.disciplines).toEqual([judgedForbid, judgedImmutable]);
    expect(resolved.drafts).toEqual([draftEntry]);
  });

  it('preserves draft declaration order across judged neighbours', () => {
    // P0 order invariant (§4.2 "order preserved"). Mutation caught: drafts collected into
    // a keyed map or re-sorted instead of keeping array order.
    const secondDraft = { id: 'measure-before-design', why: 'count producers first', draft: true };
    const resolved = defineConfig(
      withDisciplines([draftEntry, judgedForbid, secondDraft]),
    ) as ResolvedWithDrafts;

    expect(resolved.drafts).toEqual([draftEntry, secondDraft]);
  });

  it('does not fabricate a drafts key when the array carries no draft', () => {
    // P0 no-fabrication (CORE-04 precedent): zero drafts → no `drafts` field, distinct
    // from an explicit empty array. Mutation caught: a default-fill assigning `drafts: []`.
    const resolved = defineConfig(withDisciplines([judgedForbid])) as ResolvedWithDrafts;

    expect('drafts' in resolved).toBe(false);
  });

  it('a drafts-only array resolves with disciplines as the empty judged list', () => {
    // P0 derivability (§4.2, review #64): `disciplines` mirrors the input's presence —
    // declared array in, judged entries out, so a drafts-only config resolves to `[]`
    // exactly like an explicitly empty input. The covenant compiler maps an empty list
    // to zero registrations. Mutation caught: the split dropping the field (absent vs
    // [] would make the resolution non-derivable from the input) or leaking the draft.
    const resolved = defineConfig(withDisciplines([draftEntry])) as ResolvedWithDrafts;

    expect(resolved.disciplines).toEqual([]);
    expect(resolved.drafts).toEqual([draftEntry]);
  });
});

// ===========================================================================
// AC-2 — the finite rejection list (§4.1), each naming the entry location
// ===========================================================================

describe('defineConfig disciplines — draft rejections (CONFIG-10 AC-2)', () => {
  it('rejects draft: true with why absent, naming the entry', () => {
    // P0: a draft's only body is its prose — without why it is an empty shell that says
    // nothing about the practice. Mutation caught: the why-required check on the draft
    // branch dropped (the judged branch keeps why optional, so this is draft-specific).
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-no-why', draft: true }]),
    );

    expect(error.message).toContain('draft-no-why');
  });

  it('rejects draft: true with an empty-string why', () => {
    // P0 boundary partner: present-but-empty why is the same empty shell. Mutation
    // caught: the check weakened to "key present" instead of "non-empty string".
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-empty-why', why: '', draft: true }]),
    );

    expect(error.message).toContain('draft-empty-why');
  });

  it('rejects draft: true combined with a predicate key (forbid)', () => {
    // P0: a judged draft is CONFIG-11's enforce axis, not a draft — accepting the pair
    // would make it ambiguous whether the entry judges. Mutation caught: the
    // no-predicate-on-draft gate dropped (forbid stands for all four predicate keys).
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-forbid', why: 'w', draft: true, forbid: 'x' }]),
    );

    expect(error.message).toContain('draft-with-forbid');
  });

  it('rejects draft: true combined with `immutable`', () => {
    // P0 gap fixture (audit): forbid alone would let an implementation reject only that
    // one key. Each predicate key is its own fail-open — a judged draft passing silently.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-immutable', why: 'w', draft: true, immutable: 'x' }]),
    );

    expect(error.message).toContain('draft-with-immutable');
  });

  it('rejects draft: true combined with `forbidCommand`', () => {
    // P0 gap fixture (audit) — same axis, command family.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-command', why: 'w', draft: true, forbidCommand: 'x' }]),
    );

    expect(error.message).toContain('draft-with-command');
  });

  it('rejects draft: true combined with `requirePrecedent`', () => {
    // P0 gap fixture (audit) — same axis, context family.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'draft-with-precedent', why: 'w', draft: true, requirePrecedent: { command: 'x' } },
      ]),
    );

    expect(error.message).toContain('draft-with-precedent');
  });

  it('rejects draft: true combined with `except`', () => {
    // P0 gap fixture (audit): the existing scope gate reads `in`/`except` together, but
    // the draft branch is new code — an implementation blocking only `in` would pass this.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-except', why: 'w', draft: true, except: 'src/**' }]),
    );

    expect(error.message).toContain('draft-with-except');
  });

  it('rejects a truthy non-boolean draft value', () => {
    // P0 gap fixture (audit): `draft: 1` under an `if (entry.draft)` truthiness check
    // becomes a draft by typo — invariant 1 (declared, never inferred) head-on. The
    // draft: false fixture is falsy and cannot kill this mutant.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-truthy-number', why: 'w', draft: 1 }]),
    );

    expect(error.message).toContain('draft-truthy-number');
  });

  it('rejects draft: true combined with `in`', () => {
    // P0: no judgment means no scope — `in` on a draft is dead data implying a routing
    // that never happens. Mutation caught: the scope-key gate missing on the draft branch.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-in', why: 'w', draft: true, in: 'src/**' }]),
    );

    expect(error.message).toContain('draft-with-in');
  });

  it('rejects draft: true combined with `when`', () => {
    // P0: `when` is the context family's trigger; on a draft it implies a trigger that
    // never fires. Mutation caught: the trigger-key gate missing on the draft branch.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-when', why: 'w', draft: true, when: 'x' }]),
    );

    expect(error.message).toContain('draft-with-when');
  });

  it('rejects draft: false as dead data', () => {
    // P0 explicit-declaration invariant (§3): draft:false means the same as absence, so
    // accepting it plants a value no path reads. Mutation caught: the draft flag
    // validated as "any boolean" instead of the literal true.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'dead-draft-false', why: 'w', draft: false }]),
    );

    expect(error.message).toContain('dead-draft-false');
  });

  it('rejects two drafts sharing an id', () => {
    // P0 uniqueness over the WHOLE array: ids are the promotion handle — two drafts named
    // alike would promote ambiguously. Mutation caught: the uniqueness scan skipping
    // draft entries.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'dup-draft', why: 'first', draft: true },
        { id: 'dup-draft', why: 'second', draft: true },
      ]),
    );

    expect(error.message).toContain('dup-draft');
  });

  it('rejects a draft whose id duplicates a judged entry id', () => {
    // P0 cross-kind uniqueness: a draft shadowing a judged entry's id would make explain
    // and the promotion path ambiguous about which entry the id names. Mutation caught:
    // the uniqueness scan running per kind instead of over the whole array.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'shared-id', forbid: 'x' },
        { id: 'shared-id', why: 'w', draft: true },
      ]),
    );

    expect(error.message).toContain('shared-id');
  });

  it('rejects a draft whose id is a meta-covenant label (self-mod)', () => {
    // P0 label-space reservation: draft ids share the explain label space with the
    // meta-covenant registrations. Mutation caught: the meta-label reservation applied
    // only to judged entries.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'self-mod', why: 'w', draft: true }]),
    );

    expect(error.message).toContain('self-mod');
  });
});
