import type { AlgebraDeclaration } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import type { World } from '../../src/covenant/declaration-engine.ts';
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

// The same promise over the whole file instead of its lines, with `allMatches` giving every
// call its own key. Over a whole file `keyByPattern` keys the one allowed call and never
// sees the one written after it.
const CALL_PATTERN = '(warn!\\("[^"]*")';
const LEGACY = 'warn!("legacy message here");\n';
const NEW_CALL = 'warn!("brand new message");\n';
const NEW_KEY = 'warn!("brand new message"';

function wholeFile(): AlgebraDeclaration {
  return {
    ...addedOnly,
    extract: {
      before: [
        { op: 'source', of: 'pre' },
        { op: 'allMatches', re: CALL_PATTERN },
      ],
      after: [
        { op: 'source', of: 'post' },
        { op: 'allMatches', re: CALL_PATTERN },
      ],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
  };
}

describe('added-only over a whole file — allMatches sees past the first match', () => {
  const pre = LEGACY;
  const post = `${LEGACY}foo();\n${NEW_CALL}`;

  it('breaks on a new call written after an allowed one, naming the new call as the key', () => {
    // The first-match reading keys both sides by the legacy call and passes; the witness
    // key is the call text itself, not a position, so `{key}` in the message names it.
    expect(witnessesOf(judge(wholeFile(), world({ pre, post })), ENTRY)).toEqual([
      { key: NEW_KEY, value: NEW_KEY },
    ]);
  });

  it('passes when pre and post are the same file carrying both calls', () => {
    // Every key in `after` is in `before`; a step that keyed by position, or an `onlyIn`
    // reading match count, would report the second call as new.
    expect(judge(wholeFile(), world({ pre: post, post })).kind).toBe('pass');
  });

  it('a new call written twice is reported twice under one key', () => {
    // The step does not dedupe; `onlyIn` filters by key membership, so both items of the new
    // key survive. A dedupe in the step or a set-backed difference answers one witness.
    const twice = `${LEGACY}${NEW_CALL}bar();\n${NEW_CALL}`;
    const witnesses = witnessesOf(judge(wholeFile(), world({ pre, post: twice })), ENTRY);
    expect(witnesses).toHaveLength(2);
    expect(witnesses.map((w) => w.key)).toEqual([NEW_KEY, NEW_KEY]);
  });
});

// The same promise with `count: true` on `onlyIn`: a key that `before` carries n times and
// `after` m times yields the m − n surplus items instead of none. Every skip marker shares one
// key, so the set filter forgives a second skip once the file carries one. Which items survive
// is decided by pairing equal values first, then dropping the rest in `after` order.
const SKIP_PATTERN = '(it\\.skip|describe\\.skip)';
const OLD_SKIP = "it.skip('old')";
const NEW_SKIP = "it.skip('new')";

function skipCounted(count?: boolean): AlgebraDeclaration {
  return {
    ...addedOnly,
    extract: {
      before: [
        { op: 'source', of: 'pre' },
        { op: 'lines' },
        { op: 'keyByPattern', re: SKIP_PATTERN },
      ],
      after: [
        { op: 'source', of: 'post' },
        { op: 'lines' },
        { op: 'keyByPattern', re: SKIP_PATTERN },
      ],
      added: [
        { op: 'onlyIn', of: 'after', notIn: 'before', ...(count !== undefined && { count }) },
      ],
    },
  };
}

describe('added-only — onlyIn with count: true compares occurrences per key', () => {
  it('count: false on the same input keeps the set filter — a repeated key passes', () => {
    // The key's presence must not switch the mode on: an engine reading `'count' in step`
    // counts here and breaks a declaration that wrote the flag out explicitly as off.
    const pre = `${OLD_SKIP}\n`;
    const post = `${OLD_SKIP}\n${NEW_SKIP}\n`;

    expect(judge(skipCounted(false), world({ pre, post })).kind).toBe('pass');
  });

  it('n=1, m=3: the two surplus items survive, both kept even though their values are equal', () => {
    // Exactly m − n, as items: an engine that reports every item of a key once m > n answers
    // three, one that dedupes by value or by key answers one. The forgiven `old` is paired away.
    const pre = `${OLD_SKIP}\n`;
    const post = `${OLD_SKIP}\n${NEW_SKIP}\n${NEW_SKIP}\n`;

    expect(witnessesOf(judge(skipCounted(true), world({ pre, post })), ENTRY)).toEqual([
      { key: 'it.skip', value: NEW_SKIP },
      { key: 'it.skip', value: NEW_SKIP },
    ]);
  });

  it.each([
    [
      'm = n with no equal value — the second pass consumes by key alone',
      `${OLD_SKIP}\n`,
      `${NEW_SKIP}\n`,
    ],
    ['m = 0 — an `after` with no match', `${OLD_SKIP}\n`, "it('old')\n"],
  ])('passes when m ≤ n: %s', (_label, pre, post) => {
    // The first row is the one a value-pairing-only engine breaks on: `new` pairs with nothing,
    // so only the key-count pass removes it. The others pin max(0, m − n) at its floor.
    expect(judge(skipCounted(true), world({ pre, post })).kind).toBe('pass');
  });

  it('a key absent from before reports every one of its items', () => {
    // n = 0 is the plain added case and must not read as "no count recorded": a lookup that
    // yields undefined and compares with it drops or keeps the whole key by accident.
    const pre = "it('a')\n";
    const post = `${NEW_SKIP}\n${OLD_SKIP}\n`;

    expect(witnessesOf(judge(skipCounted(true), world({ pre, post })), ENTRY)).toEqual([
      { key: 'it.skip', value: NEW_SKIP },
      { key: 'it.skip', value: OLD_SKIP },
    ]);
  });

  it('one item of before removes one equal item of after, not every equal one', () => {
    // A pasted duplicate of a forgiven line is a new occurrence: a first pass that tests value
    // membership instead of consuming a partner drops both copies and passes.
    const pre = `${OLD_SKIP}\n`;
    const post = `${OLD_SKIP}\n${OLD_SKIP}\n`;

    expect(witnessesOf(judge(skipCounted(true), world({ pre, post })), ENTRY)).toEqual([
      { key: 'it.skip', value: OLD_SKIP },
    ]);
  });

  it('a new skip written above the pre-existing one is the witness, not the old line', () => {
    // Equal values pair first: dropping the first n items of the key in `after` order would
    // break correctly but name `old` — the line the author did not touch — as the violation.
    const pre = `${OLD_SKIP}\n`;
    const post = `${NEW_SKIP}\n${OLD_SKIP}\n`;

    expect(witnessesOf(judge(skipCounted(true), world({ pre, post })), ENTRY)).toEqual([
      { key: 'it.skip', value: NEW_SKIP },
    ]);
  });

  it('survivors of two keys come out in after order, not grouped by key', () => {
    // `it.skip` is the first key met in `after`; a Map keyed by first sight emits its survivor
    // before `describe.skip`'s, while the line order puts `describe.skip('new')` first.
    const pre = `${OLD_SKIP}\ndescribe.skip('old')\n`;
    const post = `${OLD_SKIP}\ndescribe.skip('new')\ndescribe.skip('old')\n${NEW_SKIP}\n`;

    expect(witnessesOf(judge(skipCounted(true), world({ pre, post })), ENTRY)).toEqual([
      { key: 'describe.skip', value: "describe.skip('new')" },
      { key: 'it.skip', value: NEW_SKIP },
    ]);
  });
});

// The declaration from the outside report, verbatim: a test file already carrying one skipped
// case gains a second skip. Under the set filter the row read `passed`.
const TEST_PATH = 'test/a.test.ts';
const REPORT_PRE = "it.skip('old', () => {})\nit('a', () => {})\n";
const REPORT_POST = "it.skip('old', () => {})\nit.skip('a', () => {})\n";

function reportCase(): AlgebraDeclaration {
  return {
    ...addedOnly,
    scope: { source: PATH_SRC, include: ['^test/'] },
    extract: {
      before: [
        { op: 'source', of: 'pre' },
        { op: 'lines' },
        { op: 'keyByPattern', re: '(it\\.skip)' },
      ],
      after: [
        { op: 'source', of: 'post' },
        { op: 'lines' },
        { op: 'keyByPattern', re: '(it\\.skip)' },
      ],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before', count: true }],
    },
  };
}

describe('added-only — the reported second skip beside an existing one', () => {
  it('breaks with count: true, naming the newly skipped case as the witness value', () => {
    // The judgment the report asked for: the second skip is seen, and the message's `{value}`
    // is the changed line rather than the one that was already skipped.
    expect(
      witnessesOf(
        judge(reportCase(), world({ pre: REPORT_PRE, post: REPORT_POST }, TEST_PATH)),
        ENTRY,
      ),
    ).toEqual([{ key: 'it.skip', value: "it.skip('a', () => {})" }]);
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
