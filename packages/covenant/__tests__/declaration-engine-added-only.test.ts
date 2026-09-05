import type { AlgebraDeclaration } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import type { World } from '../src/declaration-engine.ts';
import { judge, witnessesOf } from './declaration-engine-helpers.ts';

// The change axis written as a declaration: `pre` and `post` each become the set of matched
// strings keyed by the match, `onlyIn` keeps what `post` has and `pre` lacks, and `empty`
// over that difference is the verdict. `supply: empty` is what lets a create (no `pre`) and
// a delete (no `post`) into the same pipeline as an empty side instead of ending the
// judgment. The second declaration freezes a path: one create is allowed, a modify or a
// delete of any kind is not.

// Paths, patterns, and ids are fixture values.
const PATH_SRC = 'target.path';
const IN_SCOPE = 'lib/a.txt';
const OUT_OF_SCOPE = 'docs/a.txt';
const PATTERN = '\\b(lantern|beacon)\\b';
const ENTRY = 'nothing-added';

const addedOnly: AlgebraDeclaration = {
  discipline: 'no-lantern',
  mechanism: 'added-only',
  scope: { source: PATH_SRC, include: ['^lib/'] },
  supply: { pre: 'empty', post: 'empty' },
  extract: {
    before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: PATTERN }],
    after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: PATTERN }],
    added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
  },
  relate: [{ id: ENTRY, relation: { op: 'empty', of: 'added' }, message: 'adds {key}: {value}' }],
};

const addedOnlyExcluding: AlgebraDeclaration = {
  ...addedOnly,
  scope: { source: PATH_SRC, include: ['^lib/'], exclude: ['^lib/generated/'] },
};

const addedOnlyPassingPost: AlgebraDeclaration = {
  ...addedOnly,
  supply: { pre: 'empty', post: 'pass' },
};

/** A world of one in-scope change; `pre`/`post` are absent keys when not given. */
function world(sides: { pre?: string; post?: string }, path = IN_SCOPE): World {
  return { [PATH_SRC]: path, ...sides };
}

describe('added-only — scope and supply edges', () => {
  it('a path the exclude list names is not judged even when post adds a match', () => {
    // Routing is not the only place exclude must hold: the engine judges every world it is
    // handed, and an exclude that only the router honours lets a commit-surface world through.
    const verdict = judge(addedOnlyExcluding, world({ post: 'lantern' }, 'lib/generated/a.txt'));

    expect(verdict.kind).toBe('not-applicable');
  });

  it('a line carrying two matches yields one witness keyed by the first', () => {
    // The declared limit: `keyByPattern` keys a line by its first match, so the second word
    // on the same line surfaces on the next judgment, after the first is fixed.
    const verdict = judge(addedOnly, world({ post: 'lantern beacon' }));

    expect(witnessesOf(verdict, ENTRY).map((w) => w.key)).toEqual(['lantern']);
  });

  it('an `empty` side and a `pass` side coexist — the absent pass side ends the judgment as supply-pass', () => {
    // `empty` continues, `pass` stops: with both declared, the absent `post` still lands the
    // world as not judged rather than as an empty side that would read a delete as clean.
    const verdict = judge(addedOnlyPassingPost, world({ pre: 'lantern' }));

    expect(verdict).toMatchObject({
      kind: 'not-applicable',
      reason: 'supply-pass',
      source: 'post',
    });
  });
});

describe('added-only — debt amnesty', () => {
  it('passes when pre already has two matches and the edit adds only unrelated lines', () => {
    // Judgment is on the difference, never on presence in post: a relation over `after`
    // alone blocks every edit to a file that already carries the word.
    const pre = 'x lantern\ny beacon\n';
    const post = 'x lantern\nmargin: 0\ny beacon\n';

    expect(judge(addedOnly, world({ pre, post })).kind).toBe('pass');
  });

  it('passes when the two matches only move to other lines', () => {
    // Keyed by the match text, not by line number or position: a positional difference
    // reads a relocated line as new.
    const pre = 'x lantern\ny beacon\n';
    const post = 'y beacon\nheader\nx lantern\n';

    expect(judge(addedOnly, world({ pre, post })).kind).toBe('pass');
  });
});

describe('added-only — a new match breaks', () => {
  it('breaks on the one added match — key is the match, value the line, and the forgiven match is absent', () => {
    // The witness names only what this edit added: one built from `after` alone lists the
    // pre-existing `lantern` too, and one keyed by the line loses the match text.
    const pre = 'x lantern\n';
    const post = 'x lantern\nz beacon\n';

    expect(witnessesOf(judge(addedOnly, world({ pre, post })), ENTRY)).toEqual([
      { key: 'beacon', value: 'z beacon' },
    ]);
  });

  it('breaks on a swap — one match replaced by a different one at equal count', () => {
    // A count comparison passes this (one out, one in); only the key difference sees that
    // `beacon` is new.
    const pre = 'x lantern\n';
    const post = 'x beacon\n';

    expect(witnessesOf(judge(addedOnly, world({ pre, post })), ENTRY)).toEqual([
      { key: 'beacon', value: 'x beacon' },
    ]);
  });
});

describe('added-only — supply empty on a create and a delete', () => {
  it('a world with no pre key (create) breaks on a post match — the whole post is added', () => {
    // Without the policy this is a supply-error; under `pass` it is a skip. Either one
    // lets a brand-new violation in a new file through, the case the old family caught
    // most often.
    expect(witnessesOf(judge(addedOnly, world({ post: 'x lantern\n' })), ENTRY)).toEqual([
      { key: 'lantern', value: 'x lantern' },
    ]);
  });

  it('a world with no pre key and a clean post passes', () => {
    // The partner direction: an absent pre is not itself a violation.
    expect(judge(addedOnly, world({ post: 'margin: 0\n' })).kind).toBe('pass');
  });

  it('a world with pre but no post key (delete) passes — nothing is added', () => {
    // An absent post is an empty `after`, so `added` is empty by arithmetic; a policy
    // that treats the missing side as an error blocks every deletion of a debt-bearing file.
    expect(judge(addedOnly, world({ pre: 'x lantern\ny beacon\n' })).kind).toBe('pass');
  });

  it('without the policy an absent pre is still a supply-error — empty is opt-in', () => {
    // The engine must not make absence empty for everyone: a declaration reading `pre`
    // without a policy keeps the fail-closed default.
    const { supply: _supply, ...noPolicy } = addedOnly;

    expect(judge(noPolicy, world({ post: 'x lantern\n' }))).toMatchObject({
      kind: 'supply-error',
      source: 'pre',
    });
  });
});

describe('added-only — declared limits and determinism', () => {
  it('judging the same world twice yields the same witnesses in post order', () => {
    // Two surfaces reach the same verdict only if the witness list preserves the
    // extraction's input order; a set-backed difference that re-orders by key breaks the
    // second judgment against the first.
    const target = world({ post: 'z beacon\nq lantern\n' });

    const first = witnessesOf(judge(addedOnly, target), ENTRY);
    const second = witnessesOf(judge(addedOnly, target), ENTRY);

    expect(first).toEqual([
      { key: 'beacon', value: 'z beacon' },
      { key: 'lantern', value: 'q lantern' },
    ]);
    expect(second).toEqual(first);
  });

  it('set semantics, declared: a second line with a match pre already has passes', () => {
    // Keys are a set, not a multiset. The declared reading is that the discipline blocks
    // the entry of a word, not its repetition; a count-based difference would break here.
    const pre = 'x lantern\n';
    const post = 'x lantern\ny lantern\n';

    expect(judge(addedOnly, world({ pre, post })).kind).toBe('pass');
  });
});

// The frozen-path declaration: `prior` is non-empty on any change with a pre, `deleted`
// is the path itself when post is absent, and their union must be empty.
const FROZEN_ENTRY = 'frozen';
const ARCHIVED = 'records/archive/a.bin';
const LIVE = 'records/live/a.bin';

const frozen: AlgebraDeclaration = {
  discipline: 'archive-frozen',
  mechanism: 'self-absolution-ban',
  scope: { source: PATH_SRC, include: ['^records/archive/'] },
  supply: { pre: 'empty', post: 'empty' },
  extract: {
    prior: [{ op: 'source', of: 'pre' }],
    here: [{ op: 'source', of: PATH_SRC }],
    after: [{ op: 'source', of: 'post' }],
    deleted: [{ op: 'onlyIn', of: 'here', notIn: 'after' }],
    touched: [{ op: 'union', of: ['prior', 'deleted'] }],
  },
  relate: [
    { id: FROZEN_ENTRY, relation: { op: 'empty', of: 'touched' }, message: '{value} is frozen' },
  ],
};

describe('frozen path — one create is allowed, nothing after it', () => {
  it('a create (no pre key) passes', () => {
    // The one allowed kind: a declaration that breaks on any change in scope makes the
    // frozen file impossible to create in the first place.
    expect(judge(frozen, world({ post: 'seed' }, ARCHIVED)).kind).toBe('pass');
  });

  it('a modify breaks', () => {
    expect(
      witnessesOf(judge(frozen, world({ pre: 'old', post: 'new' }, ARCHIVED)), FROZEN_ENTRY),
    ).toHaveLength(1);
  });

  it('a delete with a pre breaks', () => {
    // The break must not hinge on `post` being present: a modify-only (pre-and-post) test
    // reopens the deletion channel around the whole declaration.
    expect(
      witnessesOf(judge(frozen, world({ pre: 'old' }, ARCHIVED)), FROZEN_ENTRY).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('a delete with neither pre nor post (binary) breaks, naming the path', () => {
    // A binary HEAD blob leaves no pre; the path alone must carry the break. A declaration
    // that reads `prior` only lets a binary deletion pass.
    expect(witnessesOf(judge(frozen, { [PATH_SRC]: ARCHIVED }), FROZEN_ENTRY)).toEqual([
      { key: '0', value: ARCHIVED },
    ]);
  });

  it('a path outside the scope is not judged', () => {
    expect(judge(frozen, world({ pre: 'old', post: 'new' }, LIVE))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });
});

describe('added-only — scope', () => {
  it('a path outside the include list is not judged even when post adds a match', () => {
    // The scope stands before the pipelines; a declaration that judges every world blocks
    // the docs tree for a source-only promise.
    expect(judge(addedOnly, world({ post: 'x lantern\n' }, OUT_OF_SCOPE))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });
});
