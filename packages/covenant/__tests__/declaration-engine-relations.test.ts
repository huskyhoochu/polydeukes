import type { AlgebraDeclaration, ExtractStep, RelateEntry, RelationDecl } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import type { Witness, World } from '../src/declaration-engine.ts';
import { judge, witnessesOf } from './declaration-engine-helpers.ts';

// The seven relations and the witness each produces when it does not hold:
// `Empty` lists every item; `NonEmpty` lists exactly one `{ key: <extract name>, value:
// null }`; `Subset` lists the `of` items whose value is absent from `in`; `Equal` lists the
// left-only items (`side: 'left'`) then the right-only ones (`side: 'right'`); `Implies`
// lists the `of` items whose key is absent from `requires`; `Ordered` lists the later item
// of each adjacent pair that breaks monotonicity; `Unchanged` lists the post item of each
// shared key whose value differs. No relation sorts or deduplicates: reversing the input
// reverses the witnesses. `Break.message` renders the template over the first witness.

// Source and extract names are fixture values; `state` is the one name the contract
// reserves for a pre/post pair.
const SRC_LEFT = 'left';
const SRC_RIGHT = 'right';
const PAIRED_SOURCE = 'state';
const LEFT = 'leftItems';
const RIGHT = 'rightItems';
const PAIRED = 'pairedItems';
const ENTRY = 'probe-entry';

type Pair = readonly [key: string, value: unknown];

/** `[source, select, keyBy, field]` — turns `{ items: [{k, v}] }` into arbitrary keyed items. */
function listPipeline(source: string): ExtractStep[] {
  return [
    { op: 'source', of: source },
    { op: 'select', path: 'items' },
    { op: 'keyBy', field: 'k' },
    { op: 'field', name: 'v' },
  ];
}

function listValue(pairs: readonly Pair[]): unknown {
  return { items: pairs.map(([k, v]) => ({ k, v })) };
}

function twoSided(left: readonly Pair[], right: readonly Pair[]): World {
  return { [SRC_LEFT]: listValue(left), [SRC_RIGHT]: listValue(right) };
}

function pairedWorld(pre: readonly Pair[], post: readonly Pair[]): World {
  return { [PAIRED_SOURCE]: { pre: listValue(pre), post: listValue(post) } };
}

function singleDecl(relate: RelateEntry[]): AlgebraDeclaration {
  return {
    discipline: 'probe',
    mechanism: 'scoped-valve',
    extract: { [LEFT]: listPipeline(SRC_LEFT), [RIGHT]: listPipeline(SRC_RIGHT) },
    relate,
  };
}

function pairedDecl(relate: RelateEntry[]): AlgebraDeclaration {
  return {
    discipline: 'probe',
    mechanism: 'scoped-valve',
    extract: { [PAIRED]: listPipeline(PAIRED_SOURCE) },
    relate,
  };
}

function entry(relation: RelationDecl, message = 'm'): RelateEntry {
  return { id: ENTRY, relation, message };
}

const w = (key: string, value: unknown, side?: 'left' | 'right'): Witness =>
  side === undefined ? { key, value } : { key, value, side };

describe('Empty — holds on no items, witnesses every item', () => {
  const decl = singleDecl([entry({ op: 'empty', of: LEFT })]);

  it('holds on an empty extract', () => {
    expect(judge(decl, twoSided([], [])).kind).toBe('pass');
  });

  it('breaks with every item, in input order', () => {
    expect(
      witnessesOf(
        judge(
          decl,
          twoSided(
            [
              ['k1', 'a'],
              ['k2', 'b'],
            ],
            [],
          ),
        ),
      ),
    ).toEqual([w('k1', 'a'), w('k2', 'b')]);
  });
});

describe('NonEmpty — holds on at least one item, one witness naming the extract', () => {
  const decl = singleDecl([entry({ op: 'nonEmpty', of: LEFT })]);

  it('holds on one item', () => {
    expect(judge(decl, twoSided([['k1', 'a']], [])).kind).toBe('pass');
  });

  it('breaks with exactly one witness { key: <extract name>, value: null }', () => {
    // An empty witness list on a break is the fail-open shape: the break would render no
    // message and the valve nothing to open on. Exactly one, keyed by the extract's name.
    expect(witnessesOf(judge(decl, twoSided([], [])))).toEqual([w(LEFT, null)]);
  });
});

describe('Subset — every value of `of` occurs in `in`', () => {
  const decl = singleDecl([entry({ op: 'subset', of: LEFT, in: RIGHT })]);

  it('holds by value regardless of keys', () => {
    // A (key, value) comparison would break this; the relation compares values.
    const world = twoSided(
      [
        ['k1', 'a'],
        ['k2', 'b'],
      ],
      [
        ['x', 'b'],
        ['y', 'a'],
        ['z', 'c'],
      ],
    );
    expect(judge(decl, world).kind).toBe('pass');
  });

  it('breaks with the `of` items missing from `in`, in `of` order, duplicates kept', () => {
    const world = twoSided(
      [
        ['k1', 'a'],
        ['k2', 'x'],
        ['k3', 'x'],
        ['k4', 'b'],
      ],
      [['y', 'a']],
    );
    expect(witnessesOf(judge(decl, world))).toEqual([w('k2', 'x'), w('k3', 'x'), w('k4', 'b')]);
  });

  it('compares values structurally', () => {
    // Reference equality on parsed objects would break a Subset that holds.
    const world = twoSided([['k1', { a: [1] }]], [['y', { a: [1] }]]);
    expect(judge(decl, world).kind).toBe('pass');
  });

  it('compares a bigint value without throwing', () => {
    // JSON serialisation refuses a bigint; the comparison must answer, not escape.
    const world = twoSided([['k1', 10n]], [['y', 10n]]);
    expect(judge(decl, world).kind).toBe('pass');
    expect(witnessesOf(judge(decl, twoSided([['k1', 10n]], [['y', 11n]])))).toEqual([w('k1', 10n)]);
  });
});

describe('Equal — Subset both ways, witnesses left then right', () => {
  const decl = singleDecl([entry({ op: 'equal', of: [LEFT, RIGHT] })]);

  it('holds when the two value sets coincide, whatever the keys and order', () => {
    const world = twoSided(
      [
        ['k1', 'a'],
        ['k2', 'b'],
      ],
      [
        ['y', 'b'],
        ['x', 'a'],
      ],
    );
    expect(judge(decl, world).kind).toBe('pass');
  });

  it('breaks with left-only items (side left) followed by right-only items (side right)', () => {
    const world = twoSided(
      [
        ['k1', 'a'],
        ['k2', 'b'],
        ['k3', 'c'],
      ],
      [
        ['k4', 'c'],
        ['k5', 'd'],
        ['k6', 'e'],
      ],
    );
    expect(witnessesOf(judge(decl, world))).toEqual([
      w('k1', 'a', 'left'),
      w('k2', 'b', 'left'),
      w('k5', 'd', 'right'),
      w('k6', 'e', 'right'),
    ]);
  });

  it('breaks on a right-only item alone — the second direction is not optional', () => {
    // Implementing Equal as a single Subset(left, right) holds here.
    const world = twoSided(
      [['k1', 'a']],
      [
        ['x', 'a'],
        ['y', 'b'],
      ],
    );
    expect(witnessesOf(judge(decl, world))).toEqual([w('y', 'b', 'right')]);
  });
});

describe('Implies — keys(of) ⊆ keys(requires)', () => {
  const decl = singleDecl([entry({ op: 'implies', of: LEFT, requires: RIGHT })]);

  it('holds by key regardless of values', () => {
    const world = twoSided(
      [
        ['k1', 'a'],
        ['k2', 'b'],
      ],
      [
        ['k2', 'x'],
        ['k1', 'y'],
        ['k3', 'z'],
      ],
    );
    expect(judge(decl, world).kind).toBe('pass');
  });

  it('breaks with the `of` items whose key is absent from `requires`, in `of` order', () => {
    // Same values on both sides: a value comparison would hold.
    const world = twoSided(
      [
        ['k1', 'a'],
        ['k2', 'a'],
        ['k3', 'a'],
      ],
      [['k2', 'a']],
    );
    expect(witnessesOf(judge(decl, world))).toEqual([w('k1', 'a'), w('k3', 'a')]);
  });

  it('over `lines` keys, an insertion above an item renames it', () => {
    // `lines` keys each item by its source line number, so the key is a position rather
    // than an identity: an insertion above an item renames it. Both sides open with a
    // blank line, which `lines` drops while still consuming its number — so a step that
    // renumbered after filtering would key the surviving lines densely and this
    // comparison would hold.
    const linePipeline = (source: string): ExtractStep[] => [
      { op: 'source', of: source },
      { op: 'lines' },
      { op: 'matches', re: '^x' },
    ];
    const decl: AlgebraDeclaration = {
      discipline: 'probe',
      mechanism: 'scoped-valve',
      extract: {
        [LEFT]: linePipeline(SRC_LEFT),
        [RIGHT]: linePipeline(SRC_RIGHT),
      },
      relate: [
        { id: ENTRY, relation: { op: 'implies', of: LEFT, requires: RIGHT }, message: '{value}' },
      ],
    };
    const right = 'x1\n\nbody\nx2';
    // The same two `x` lines with one more body line between them: `x2` moves 4 → 5.
    const left = 'x1\n\nbody\nbody\nx2';

    expect(witnessesOf(judge(decl, { [SRC_LEFT]: left, [SRC_RIGHT]: right }), ENTRY)).toEqual([
      w('5', 'x2'),
    ]);
  });
});

describe('Ordered — adjacent pairs are monotone by value', () => {
  const lax = singleDecl([entry({ op: 'ordered', of: LEFT })]);
  const strict = singleDecl([entry({ op: 'ordered', of: LEFT, strict: true })]);

  it('holds on a non-decreasing sequence, equal neighbours included', () => {
    expect(
      judge(
        lax,
        twoSided(
          [
            ['k1', 1],
            ['k2', 2],
            ['k3', 2],
            ['k4', 10],
          ],
          [],
        ),
      ).kind,
    ).toBe('pass');
  });

  it('holds on an empty and a single-item sequence', () => {
    expect(judge(strict, twoSided([], [])).kind).toBe('pass');
    expect(judge(strict, twoSided([['k1', 1]], [])).kind).toBe('pass');
  });

  it('compares numbers numerically', () => {
    // A string comparison reads 10 < 9 and breaks a sequence that is ordered.
    expect(
      judge(
        lax,
        twoSided(
          [
            ['k1', 9],
            ['k2', 10],
          ],
          [],
        ),
      ).kind,
    ).toBe('pass');
  });

  it('breaks with the later item of each descending pair, in position order', () => {
    // Witness values [1, 0] are not ascending: a sorted witness list would read [0, 1].
    const world = twoSided(
      [
        ['k1', 3],
        ['k2', 1],
        ['k3', 2],
        ['k4', 0],
      ],
      [],
    );
    expect(witnessesOf(judge(lax, world))).toEqual([w('k2', 1), w('k4', 0)]);
  });

  it('reversed input yields the descending pairs of the reversed sequence, in position order', () => {
    // Ordered is directional, so reversing the input changes which pairs descend rather
    // than reversing the witness list: [0, 2, 1, 3] descends once, at (2, 1).
    const world = twoSided(
      [
        ['k4', 0],
        ['k3', 2],
        ['k2', 1],
        ['k1', 3],
      ],
      [],
    );
    expect(witnessesOf(judge(lax, world))).toEqual([w('k2', 1)]);
  });

  it('strict forbids equal neighbours and witnesses the later of the two', () => {
    const world = twoSided(
      [
        ['k1', 1],
        ['k2', 2],
        ['k3', 2],
      ],
      [],
    );
    expect(witnessesOf(judge(strict, world))).toEqual([w('k3', 2)]);
  });
});

describe('Unchanged — shared keys carry equal values across pre and post', () => {
  const decl = pairedDecl([entry({ op: 'unchanged', of: PAIRED })]);

  it('holds when only unshared keys differ — removals and additions are not changes', () => {
    const world = pairedWorld(
      [
        ['k1', 'a'],
        ['k2', 'b'],
      ],
      [
        ['k2', 'b'],
        ['k3', 'c'],
      ],
    );
    expect(judge(decl, world).kind).toBe('pass');
  });

  it('breaks with the post item of each shared key whose value differs', () => {
    // The witness carries the post value ('c'), not the pre value ('b').
    const world = pairedWorld(
      [
        ['k1', 'a'],
        ['k2', 'b'],
      ],
      [
        ['k1', 'a'],
        ['k2', 'c'],
      ],
    );
    expect(witnessesOf(judge(decl, world))).toEqual([w('k2', 'c')]);
  });

  it('treats undefined and null as different values', () => {
    const world = pairedWorld([['k1', null]], [['k1', undefined]]);
    expect(witnessesOf(judge(decl, world))).toEqual([w('k1', undefined)]);
  });
});

describe('order determinism — reversed input yields reversed witnesses', () => {
  type ReversalCase = {
    relation: string;
    decl: AlgebraDeclaration;
    a: readonly Pair[];
    b: readonly Pair[];
    world: (a: readonly Pair[], b: readonly Pair[]) => World;
    witnesses: readonly Witness[];
  };

  // Each case's witnesses are the forward answer; the reversed answer is derived below,
  // so an engine that sorts, deduplicates, or walks a Set stays green only if the forward
  // list happens to be its own reverse — none of these is.
  const cases: ReversalCase[] = [
    {
      relation: 'empty',
      decl: singleDecl([entry({ op: 'empty', of: LEFT })]),
      a: [
        ['k1', 'a'],
        ['k2', 'b'],
        ['k3', 'c'],
      ],
      b: [],
      world: twoSided,
      witnesses: [w('k1', 'a'), w('k2', 'b'), w('k3', 'c')],
    },
    {
      relation: 'subset',
      decl: singleDecl([entry({ op: 'subset', of: LEFT, in: RIGHT })]),
      a: [
        ['k1', 'x'],
        ['k2', 'a'],
        ['k3', 'y'],
      ],
      b: [['z', 'a']],
      world: twoSided,
      witnesses: [w('k1', 'x'), w('k3', 'y')],
    },
    {
      relation: 'implies',
      decl: singleDecl([entry({ op: 'implies', of: LEFT, requires: RIGHT })]),
      a: [
        ['k1', 'a'],
        ['k2', 'a'],
        ['k3', 'a'],
      ],
      b: [['k2', 'a']],
      world: twoSided,
      witnesses: [w('k1', 'a'), w('k3', 'a')],
    },
    {
      relation: 'unchanged',
      decl: pairedDecl([entry({ op: 'unchanged', of: PAIRED })]),
      a: [
        ['k1', 'a'],
        ['k2', 'b'],
        ['k3', 'c'],
      ],
      b: [
        ['k1', 'x'],
        ['k2', 'b'],
        ['k3', 'z'],
      ],
      world: pairedWorld,
      witnesses: [w('k1', 'x'), w('k3', 'z')],
    },
  ];

  it.each(cases)('$relation: reversed input yields the reversed witnesses', (c) => {
    const reversed = c.world([...c.a].reverse(), [...c.b].reverse());
    expect(witnessesOf(judge(c.decl, reversed))).toEqual([...c.witnesses].reverse());
  });

  it('Equal: reversing the input reverses each side but keeps left before right', () => {
    // The side grouping is the contract, the order inside a side is the input's.
    const decl = singleDecl([entry({ op: 'equal', of: [LEFT, RIGHT] })]);
    const world = twoSided(
      [
        ['k2', 'b'],
        ['k1', 'a'],
      ],
      [
        ['k6', 'e'],
        ['k5', 'd'],
      ],
    );
    expect(witnessesOf(judge(decl, world)).map((x) => x.side)).toEqual([
      'left',
      'left',
      'right',
      'right',
    ]);
  });
});

describe('combinators — union, onlyIn, intersect keep the declared order', () => {
  const JOINED = 'joinedItems';

  function combined(first: ExtractStep): AlgebraDeclaration {
    return {
      discipline: 'probe',
      mechanism: 'scoped-valve',
      extract: {
        [LEFT]: listPipeline(SRC_LEFT),
        [RIGHT]: listPipeline(SRC_RIGHT),
        [JOINED]: [first],
      },
      relate: [entry({ op: 'empty', of: JOINED })],
    };
  }

  const left: readonly Pair[] = [
    ['k1', 'a'],
    ['k2', 'b'],
    ['k3', 'c'],
  ];
  const right: readonly Pair[] = [
    ['k3', 'x'],
    ['k4', 'd'],
    ['k1', 'y'],
  ];

  it('union: left items then right items, duplicate keys kept', () => {
    const decl = combined({ op: 'union', of: [LEFT, RIGHT] });
    expect(witnessesOf(judge(decl, twoSided(left, right)))).toEqual([
      w('k1', 'a'),
      w('k2', 'b'),
      w('k3', 'c'),
      w('k3', 'x'),
      w('k4', 'd'),
      w('k1', 'y'),
    ]);
  });

  it('union: reversed inputs reverse each half in place', () => {
    const decl = combined({ op: 'union', of: [LEFT, RIGHT] });
    const reversed = twoSided([...left].reverse(), [...right].reverse());
    expect(witnessesOf(judge(decl, reversed)).map((x) => x.key)).toEqual([
      'k3',
      'k2',
      'k1',
      'k1',
      'k4',
      'k3',
    ]);
  });

  it('onlyIn: the `of` items whose key is absent from `notIn`, in `of` order', () => {
    const decl = combined({ op: 'onlyIn', of: LEFT, notIn: RIGHT });
    expect(witnessesOf(judge(decl, twoSided(left, right)))).toEqual([w('k2', 'b')]);
    const wide = twoSided(
      [
        ['k2', 'b'],
        ['k5', 'e'],
        ['k1', 'a'],
      ],
      right,
    );
    expect(witnessesOf(judge(decl, wide))).toEqual([w('k2', 'b'), w('k5', 'e')]);
  });

  it('onlyIn: reversed `of` input reverses the witnesses', () => {
    const decl = combined({ op: 'onlyIn', of: LEFT, notIn: RIGHT });
    const reversed = twoSided(
      [
        ['k1', 'a'],
        ['k5', 'e'],
        ['k2', 'b'],
      ],
      right,
    );
    expect(witnessesOf(judge(decl, reversed))).toEqual([w('k5', 'e'), w('k2', 'b')]);
  });

  it('onlyIn: compares keys, not values', () => {
    // Value-based difference would keep k1 (value 'a' vs 'y').
    const decl = combined({ op: 'onlyIn', of: LEFT, notIn: RIGHT });
    expect(witnessesOf(judge(decl, twoSided([['k1', 'a']], [['k1', 'y']])))).toEqual([]);
  });

  it('intersect: the `of[0]` items whose key occurs in `of[1]`, in `of[0]` order with `of[0]` values', () => {
    const decl = combined({ op: 'intersect', of: [LEFT, RIGHT] });
    expect(witnessesOf(judge(decl, twoSided(left, right)))).toEqual([w('k1', 'a'), w('k3', 'c')]);
    const reversed = twoSided([...left].reverse(), right);
    expect(witnessesOf(judge(decl, reversed))).toEqual([w('k3', 'c'), w('k1', 'a')]);
  });

  it('intersect with an empty right side yields nothing', () => {
    const decl = combined({ op: 'intersect', of: [LEFT, RIGHT] });
    expect(witnessesOf(judge(decl, twoSided(left, [])))).toEqual([]);
  });
});

describe('Break rendering — message templates over the first witness', () => {
  it('substitutes {key} and {value} from the first witness', () => {
    const decl = singleDecl([entry({ op: 'empty', of: LEFT }, "task '{key}' is {value}")]);
    const verdict = judge(decl, twoSided([['S1', 'done']], []));
    expect(verdict.kind).toBe('broken');
    if (verdict.kind !== 'broken') return;
    expect(verdict.breaks).toHaveLength(1);
    expect(verdict.breaks[0].id).toBe(ENTRY);
    expect(verdict.breaks[0].message).toBe("task 'S1' is done");
  });

  it('appends (+N) for the witnesses beyond the first', () => {
    // N counts the others, not the total: three witnesses read `(+2)`.
    const decl = singleDecl([entry({ op: 'empty', of: LEFT }, "task '{key}'")]);
    const verdict = judge(
      decl,
      twoSided(
        [
          ['S1', 1],
          ['S2', 2],
          ['S3', 3],
        ],
        [],
      ),
    );
    expect(verdict.kind).toBe('broken');
    if (verdict.kind !== 'broken') return;
    expect(verdict.breaks[0].message).toMatch(/^task 'S1' ?\(\+2\)$/);
  });

  it('does not append a suffix for a single witness', () => {
    const decl = singleDecl([entry({ op: 'empty', of: LEFT }, "task '{key}'")]);
    const verdict = judge(decl, twoSided([['S1', 1]], []));
    if (verdict.kind !== 'broken') throw new Error('expected broken');
    expect(verdict.breaks[0].message).toBe("task 'S1'");
  });

  it("messageBySide picks the template of the first witness's side", () => {
    const bySide: RelateEntry = {
      id: ENTRY,
      relation: { op: 'equal', of: [LEFT, RIGHT] },
      messageBySide: { left: "right lacks '{value}'", right: "left lacks '{value}'" },
    };
    const decl = singleDecl([bySide]);

    const leftOnly = judge(
      decl,
      twoSided(
        [
          ['k1', 'a'],
          ['k2', 'b'],
        ],
        [['x', 'b']],
      ),
    );
    if (leftOnly.kind !== 'broken') throw new Error('expected broken');
    expect(leftOnly.breaks[0].message).toBe("right lacks 'a'");

    const rightOnly = judge(
      decl,
      twoSided(
        [['k1', 'a']],
        [
          ['x', 'a'],
          ['y', 'c'],
        ],
      ),
    );
    if (rightOnly.kind !== 'broken') throw new Error('expected broken');
    expect(rightOnly.breaks[0].message).toBe("left lacks 'c'");
  });

  it('one Break per breaking entry, in declaration order, none for entries that hold', () => {
    const decl = singleDecl([
      { id: 'first-breaks', relation: { op: 'empty', of: LEFT }, message: 'a' },
      { id: 'holds', relation: { op: 'nonEmpty', of: LEFT }, message: 'b' },
      { id: 'last-breaks', relation: { op: 'empty', of: RIGHT }, message: 'c' },
    ]);
    const verdict = judge(decl, twoSided([['k1', 'a']], [['k2', 'b']]));
    if (verdict.kind !== 'broken') throw new Error('expected broken');
    expect(verdict.breaks.map((b) => b.id)).toEqual(['first-breaks', 'last-breaks']);
  });
});
