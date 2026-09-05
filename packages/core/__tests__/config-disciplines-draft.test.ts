import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfig } from '../src/config.ts';

// A `disciplines:` entry may be a draft — `{ id, why, draft: true }` and nothing else: a
// practice registered as prose ahead of promotion, carrying no predicate, scope, or trigger.
// defineConfig splits drafts out at resolution time so the covenant compiler never sees one:
// `disciplines` keeps the judged entries, `drafts` carries the drafts in declaration order.

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
/** The declaration a judged entry carries beside the drafts under test. */
const judgedDeclare = {
  mechanism: 'naming',
  scope: { source: 'target.path', include: ['\\.db$'] },
  extract: {
    outside: [
      { op: 'source', of: 'target.path' },
      { op: 'matches', re: '^(?!store/)' },
    ],
  },
  relate: [{ id: 'placed', relation: { op: 'empty', of: 'outside' }, message: 'm' }],
};

const judgedFirst = { id: 'no-todo', declare: judgedDeclare };
const judgedSecond = { id: 'changelog-frozen', declare: judgedDeclare };

/** Asserts the concrete error instance and returns it so callers can assert on the message. */
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

describe('defineConfig disciplines — draft acceptance and resolution split', () => {
  it('accepts { id, why, draft: true } and carries it verbatim into drafts', () => {
    // The promotion ladder's first rung: the entry must survive verbatim, not be rewritten.
    const resolved = defineConfig(withDisciplines([draftEntry])) as ResolvedWithDrafts;

    expect(resolved.drafts).toEqual([draftEntry]);
  });

  it('splits a mixed array: judged entries stay in disciplines, the draft moves to drafts', () => {
    // The draft sits BETWEEN two judged entries so the fixture catches both failures at once:
    // a draft left in disciplines would reach the covenant compiler, and extracting it must
    // not disturb the judged entries' relative order.
    const resolved = defineConfig(
      withDisciplines([judgedFirst, draftEntry, judgedSecond]),
    ) as ResolvedWithDrafts;

    expect(resolved.disciplines).toEqual([judgedFirst, judgedSecond]);
    expect(resolved.drafts).toEqual([draftEntry]);
  });

  it('preserves draft declaration order across judged neighbours', () => {
    // A judged entry separates the two drafts: collecting drafts into a keyed map or
    // re-sorting them instead of keeping array order shows up here.
    const secondDraft = { id: 'measure-before-design', why: 'count producers first', draft: true };
    const resolved = defineConfig(
      withDisciplines([draftEntry, judgedFirst, secondDraft]),
    ) as ResolvedWithDrafts;

    expect(resolved.drafts).toEqual([draftEntry, secondDraft]);
  });

  it('does not fabricate a drafts key when the array carries no draft', () => {
    // Zero drafts leaves no `drafts` field at all — a default-fill assigning `drafts: []`
    // would make an absent key indistinguishable from an explicit empty one.
    const resolved = defineConfig(withDisciplines([judgedFirst])) as ResolvedWithDrafts;

    expect('drafts' in resolved).toBe(false);
  });

  it('a drafts-only array resolves with disciplines as the empty judged list', () => {
    // `disciplines` mirrors the input's presence: a declared array in means judged entries
    // out, so a drafts-only config resolves to `[]` exactly like an explicitly empty input,
    // and the covenant compiler maps that to zero registrations. Dropping the field instead
    // would make the resolution non-derivable from the input.
    const resolved = defineConfig(withDisciplines([draftEntry])) as ResolvedWithDrafts;

    expect(resolved.disciplines).toEqual([]);
    expect(resolved.drafts).toEqual([draftEntry]);
  });
});

// Every rejection must name the offending entry's id, so the author can find it.

describe('defineConfig disciplines — draft rejections', () => {
  it('rejects draft: true with why absent, naming the entry', () => {
    // A draft's only body is its prose, so why is required here even though the judged
    // branch keeps it optional — without it the entry says nothing about the practice.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-no-why', draft: true }]),
    );

    expect(error.message).toContain('draft-no-why');
  });

  it('rejects draft: true with an empty-string why', () => {
    // Present-but-empty is the same empty shell: the check is "non-empty string", not
    // "key present".
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-empty-why', why: '', draft: true }]),
    );

    expect(error.message).toContain('draft-empty-why');
  });

  it('rejects draft: true combined with a predicate key (declare)', () => {
    // An entry that both drafts and judges is ambiguous about whether it judges; the
    // registered-but-not-enforced case belongs to the `enforce` axis instead. This fixture
    // and the three below are one per predicate key: an implementation rejecting only
    // `forbid` would pass a single fixture while leaving three fail-open holes.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-declare', why: 'w', draft: true, declare: {} }]),
    );

    expect(error.message).toContain('draft-with-declare');
  });

  it('rejects draft: true combined with `enforce`', () => {
    // A level on an entry that never judges is dead data; the draft branch's key set is
    // id · why · draft and nothing else.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-with-enforce', why: 'w', draft: true, enforce: 'block' }]),
    );

    expect(error.message).toContain('draft-with-enforce');
  });

  it('rejects a truthy non-boolean draft value', () => {
    // Under an `if (entry.draft)` truthiness check, `draft: 1` becomes a draft by typo —
    // draft status is declared, never inferred. The `draft: false` fixture below is falsy
    // and so cannot catch this.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'draft-truthy-number', why: 'w', draft: 1 }]),
    );

    expect(error.message).toContain('draft-truthy-number');
  });

  it('rejects draft: false as dead data', () => {
    // `draft: false` means the same as absence, so accepting it plants a value no path
    // reads. The flag is the literal `true`, not "any boolean".
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'dead-draft-false', why: 'w', draft: false }]),
    );

    expect(error.message).toContain('dead-draft-false');
  });

  it('rejects two drafts sharing an id', () => {
    // Ids are the promotion handle, so the uniqueness scan must cover drafts too — two
    // drafts named alike would promote ambiguously.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'dup-draft', why: 'first', draft: true },
        { id: 'dup-draft', why: 'second', draft: true },
      ]),
    );

    expect(error.message).toContain('dup-draft');
  });

  it('rejects a draft whose id duplicates a judged entry id', () => {
    // The scan runs over the whole array, not per kind: a draft shadowing a judged entry's
    // id would leave explain and the promotion path unsure which entry the id names.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'shared-id', declare: judgedDeclare },
        { id: 'shared-id', why: 'w', draft: true },
      ]),
    );

    expect(error.message).toContain('shared-id');
  });

  it('rejects a draft whose id is a meta-covenant label (self-mod)', () => {
    // Draft ids share the explain label space with the meta-covenant registrations, so the
    // reserved-label check has to apply to drafts and not only to judged entries.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'self-mod', why: 'w', draft: true }]),
    );

    expect(error.message).toContain('self-mod');
  });
});
