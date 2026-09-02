import type { AlgebraDeclaration, ExtractStep, UnaryStep } from '@polydeukes/core';
import { BINARY_COMBINATOR_NAMES } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import {
  type ConfigFault,
  compileDeclaration,
  EXTRACT_STEPS,
  type Items,
  UNARY_STEP_NAMES,
} from '../src/declaration-engine.ts';
import { extracted, isConfigFault, judge, witnessesOf } from './declaration-engine-helpers.ts';

// The extract registry: twelve unary steps, each a (closed argument keys, validator, runner)
// triple. `compileDeclaration` turns an argument outside the closed keys or of the wrong
// type into a config fault whose `location` names the pipeline; `run` maps `Items` to
// `Items` and nothing else — no step can answer a boolean. Each step below is exercised at
// both ends of its axes: empty input, a dropped element, and preserved order.

// Source and extract names are fixture values: the registry reads no meaning into them.
const SRC = 'doc';
const EXTRACT = 'probe';
const ENTRY = 'probe-entry';

/** Compile a declaration whose single pipeline is `steps` and return the fault it raises. */
function faultOf(steps: readonly ExtractStep[]): ConfigFault {
  const decl: AlgebraDeclaration = {
    discipline: 'probe',
    extract: { [EXTRACT]: [...steps] },
    relate: [{ id: ENTRY, relation: { op: 'Empty', of: EXTRACT }, message: 'm' }],
  };
  const result = compileDeclaration(decl);
  if (!isConfigFault(result)) {
    throw new Error(`expected a config fault for ${JSON.stringify(steps)}`);
  }
  return result;
}

/** The fault a unary step raises when it stands after a well-formed `source`. */
function stepFault(step: UnaryStep): ConfigFault {
  return faultOf([{ op: 'source', of: SRC }, step]);
}

/** Run one registry entry directly on `items`. */
function run(step: UnaryStep, items: Items): Items {
  return EXTRACT_STEPS[step.op].run(items, step);
}

/** Position-keyed items over `values`, the shape `select` hands the steps after it. */
function positioned(values: readonly unknown[]): Items {
  return values.map((value, index) => ({ key: String(index), value }));
}

describe('extract registry — the closed set of unary steps', () => {
  it('lists exactly the twelve unary steps and no combinator', () => {
    // A combinator registered as a unary entry could be placed mid-pipeline, where its
    // two-extraction reading is undefined; a missing entry fails every pipeline naming it.
    expect([...UNARY_STEP_NAMES].sort()).toEqual(
      [
        'field',
        'filter',
        'flattenKeys',
        'items',
        'json',
        'keyBy',
        'keyByPattern',
        'lines',
        'matches',
        'select',
        'sort',
        'source',
      ].sort(),
    );
    expect(Object.keys(EXTRACT_STEPS).sort()).toEqual([...UNARY_STEP_NAMES].sort());
    for (const name of BINARY_COMBINATOR_NAMES) {
      expect(EXTRACT_STEPS[name]).toBeUndefined();
    }
  });

  // One well-formed step and one sample input per entry: the universal below runs each.
  const samples: Record<string, { step: UnaryStep; items: Items }> = {
    source: { step: { op: 'source', of: SRC }, items: positioned([{ [SRC]: 'x' }]) },
    json: { step: { op: 'json' }, items: positioned(['"x"']) },
    select: { step: { op: 'select', path: 'a' }, items: positioned([{ a: [1, 2] }]) },
    keyBy: { step: { op: 'keyBy', field: 'id' }, items: positioned([{ id: 'S1' }]) },
    field: { step: { op: 'field', name: 'n' }, items: positioned([{ n: 1 }]) },
    filter: {
      step: { op: 'filter', when: [{ field: 'n', eq: 1 }] },
      items: positioned([{ n: 1 }]),
    },
    flattenKeys: { step: { op: 'flattenKeys' }, items: positioned([{ a: { b: 1 } }]) },
    sort: { step: { op: 'sort' }, items: positioned(['b', 'a']) },
    lines: { step: { op: 'lines' }, items: positioned(['a\nb']) },
    matches: { step: { op: 'matches', re: 'b' }, items: positioned(['abc']) },
    items: { step: { op: 'items' }, items: positioned([['x', 'y']]) },
    keyByPattern: { step: { op: 'keyByPattern', re: '^(.+)$' }, items: positioned(['x']) },
  };

  it.each(UNARY_STEP_NAMES)('%s: run returns an item list, never a boolean', (name) => {
    // The roadmap's "no extract step returns a boolean" universal, checked on the code
    // path: a step answering `true` would make the relation position redundant.
    const sample = samples[name];
    expect(sample).toBeDefined();
    const out = run(sample.step, sample.items);
    expect(Array.isArray(out)).toBe(true);
    for (const item of out) {
      expect(typeof item.key).toBe('string');
      expect(item).toHaveProperty('value');
    }
  });
});

describe('source — the world value as one item', () => {
  it('lifts World[of] into a single item keyed "0"', () => {
    // A source that spreads an array value into many items would let the world's shape
    // pick the key space, which `select` and `lines` own.
    expect(extracted(SRC, EXTRACT, [], 'text')).toEqual([{ key: '0', value: 'text' }]);
    expect(extracted(SRC, EXTRACT, [], ['a', 'b'])).toEqual([{ key: '0', value: ['a', 'b'] }]);
  });

  it('rejects a non-string `of`, a missing `of`, and an unknown key', () => {
    expect(faultOf([{ op: 'source', of: 5 }]).location).toContain(EXTRACT);
    expect(faultOf([{ op: 'source' }]).location).toContain(EXTRACT);
    expect(faultOf([{ op: 'source', of: SRC, extra: 1 }]).location).toContain(EXTRACT);
  });
});

describe('json — parse each string value', () => {
  const step: UnaryStep = { op: 'json' };

  it('parses each item and keeps its key', () => {
    expect(run(step, positioned(['{"a":1}', '[1,2]']))).toEqual([
      { key: '0', value: { a: 1 } },
      { key: '1', value: [1, 2] },
    ]);
  });

  it('rejects any argument key — the step takes none', () => {
    expect(stepFault({ op: 'json', as: SRC }).location).toContain(EXTRACT);
  });
});

describe('select — dot-path projection', () => {
  it('spreads an array result into position-keyed items in array order', () => {
    // Keys are positions, not the parent key: a `0.1` namespacing would make every later
    // `keyBy`-free relation compare paths nobody declared.
    expect(run({ op: 'select', path: 'a.b' }, positioned([{ a: { b: ['x', 'y'] } }]))).toEqual([
      { key: '0', value: 'x' },
      { key: '1', value: 'y' },
    ]);
  });

  it('projects a path the object does not carry to nothing', () => {
    // An `Empty` over "the debug block" must hold when there is no debug block, so a miss
    // yields no item rather than an item whose value is undefined.
    expect(run({ op: 'select', path: 'debug.enabled' }, positioned([{ a: 1 }]))).toEqual([]);
  });

  it('projects a scalar result as one item', () => {
    expect(run({ op: 'select', path: 'a.b' }, positioned([{ a: { b: 'leaf' } }]))).toEqual([
      { key: '0', value: 'leaf' },
    ]);
  });

  it('drops an item whose value is not a plain object', () => {
    // A throw here would turn a malformed world into a crash instead of an empty extract.
    expect(run({ op: 'select', path: 'a' }, positioned(['text', 7, null]))).toEqual([]);
  });

  it('rejects a non-string `path`, a missing `path`, and an unknown key', () => {
    expect(stepFault({ op: 'select', path: 1 }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'select' }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'select', path: 'a', of: 'x' }).location).toContain(EXTRACT);
  });
});

describe('keyBy — re-index by a field value', () => {
  const step: UnaryStep = { op: 'keyBy', field: 'id' };

  it('keys each element by its field, as a string, in input order', () => {
    // `7` must become `'7'`: the key space is strings, and a number key breaks the
    // key-equality every relation over keys relies on.
    expect(run(step, positioned([{ id: 'S2' }, { id: 7 }, { id: 'S1' }]))).toEqual([
      { key: 'S2', value: { id: 'S2' } },
      { key: '7', value: { id: 7 } },
      { key: 'S1', value: { id: 'S1' } },
    ]);
  });

  it('drops an element without the field and a non-object element', () => {
    expect(run(step, positioned([{ name: 'x' }, 'text', { id: 'S1' }]))).toEqual([
      { key: 'S1', value: { id: 'S1' } },
    ]);
  });

  it('rejects a non-string `field`, a missing `field`, and an unknown key', () => {
    expect(stepFault({ op: 'keyBy', field: 1 }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'keyBy' }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'keyBy', field: 'id', path: 'x' }).location).toContain(EXTRACT);
  });
});

describe('field — keep the key, take one property as the value', () => {
  const step: UnaryStep = { op: 'field', name: 'passes' };

  it('keeps each key and replaces the value with value[name]', () => {
    const items: Items = [
      { key: 'S1', value: { passes: true } },
      { key: 'S2', value: { passes: false } },
    ];
    expect(run(step, items)).toEqual([
      { key: 'S1', value: true },
      { key: 'S2', value: false },
    ]);
  });

  it('an absent property yields undefined, not null', () => {
    // The ledger's `retries notIn [0, null]` relies on the two being different values.
    const out = run(step, [{ key: 'S1', value: { retries: 0 } }]);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('S1');
    expect(out[0].value).toBeUndefined();
  });

  it('drops a non-object element', () => {
    expect(run(step, positioned(['text', 1]))).toEqual([]);
  });

  it('rejects a non-string `name`, a missing `name`, and an unknown key', () => {
    expect(stepFault({ op: 'field', name: 1 }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'field' }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'field', name: 'x', field: 'x' }).location).toContain(EXTRACT);
  });
});

describe('filter — keep items every constant predicate admits', () => {
  it('eq keeps a structurally equal value and drops the rest', () => {
    // Structural, not referential: `['a']` written in the declaration must match `['a']`
    // parsed from the world.
    const items = positioned([{ tags: ['a'] }, { tags: ['b'] }, { tags: ['a'] }, {}]);
    expect(run({ op: 'filter', when: [{ field: 'tags', eq: ['a'] }] }, items)).toEqual([
      { key: '0', value: { tags: ['a'] } },
      { key: '2', value: { tags: ['a'] } },
    ]);
  });

  it('ne drops the equal value and keeps the others in order', () => {
    const items = positioned([{ status: 'todo' }, { status: 'needs_spec' }, { status: 'done' }]);
    expect(run({ op: 'filter', when: [{ field: 'status', ne: 'needs_spec' }] }, items)).toEqual([
      { key: '0', value: { status: 'todo' } },
      { key: '2', value: { status: 'done' } },
    ]);
  });

  it('size compares an array length', () => {
    const items = positioned([{ va: [] }, { va: ['pnpm test'] }, { va: [] }]);
    expect(run({ op: 'filter', when: [{ field: 'va', size: 0 }] }, items)).toEqual([
      { key: '0', value: { va: [] } },
      { key: '2', value: { va: [] } },
    ]);
  });

  it('notIn drops listed values and keeps undefined when only null is listed', () => {
    // `undefined` is not `null`: an absent field survives `notIn [0, null]`.
    const items = positioned([{ retries: 0 }, { retries: null }, { retries: 5 }, {}]);
    expect(run({ op: 'filter', when: [{ field: 'retries', notIn: [0, null] }] }, items)).toEqual([
      { key: '2', value: { retries: 5 } },
      { key: '3', value: {} },
    ]);
  });

  it('lte keeps the bound itself and drops non-numbers', () => {
    // The bound is inclusive (`<=`, not `<`); a string that would coerce below the bound
    // is dropped rather than compared.
    const items = positioned([{ age: 600000 }, { age: 600001 }, { age: '1' }, { age: 0 }, {}]);
    expect(run({ op: 'filter', when: [{ field: 'age', lte: 600000 }] }, items)).toEqual([
      { key: '0', value: { age: 600000 } },
      { key: '3', value: { age: 0 } },
    ]);
  });

  it('gte keeps the bound itself and drops non-numbers', () => {
    const items = positioned([{ n: 10 }, { n: 9 }, { n: '11' }, { n: 11 }]);
    expect(run({ op: 'filter', when: [{ field: 'n', gte: 10 }] }, items)).toEqual([
      { key: '0', value: { n: 10 } },
      { key: '3', value: { n: 11 } },
    ]);
  });

  it('several predicates conjoin — an item must satisfy every one', () => {
    // `some` in place of `every` would keep the needs_spec task with empty actions.
    const items = positioned([
      { va: [], status: 'todo' },
      { va: [], status: 'needs_spec' },
      { va: ['x'], status: 'todo' },
    ]);
    const when = [
      { field: 'va', size: 0 },
      { field: 'status', ne: 'needs_spec' },
    ];
    expect(run({ op: 'filter', when }, items)).toEqual([
      { key: '0', value: { va: [], status: 'todo' } },
    ]);
  });

  it('rejects a non-array `when`, a predicate without a field, two operators, none, an unknown operator, and a non-number bound', () => {
    expect(stepFault({ op: 'filter', when: { field: 'n', eq: 1 } }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'filter', when: [{ eq: 1 }] }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'filter', when: [{ field: 'n', eq: 1, ne: 2 }] }).location).toContain(
      EXTRACT,
    );
    expect(stepFault({ op: 'filter', when: [{ field: 'n' }] }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'filter', when: [{ field: 'n', lt: 1 }] }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'filter', when: [{ field: 'n', lte: '1' }] }).location).toContain(
      EXTRACT,
    );
    expect(stepFault({ op: 'filter', when: [], path: 'x' }).location).toContain(EXTRACT);
  });
});

describe('flattenKeys — nested object to dot-path leaves', () => {
  const step: UnaryStep = { op: 'flattenKeys' };

  it('emits one item per leaf, keyed by dot path, in insertion order depth-first', () => {
    // The W2 parity cases read a leaf's dot path through `{value}` and sort by it, so the
    // path is both the key and the value of a flattened item.
    const nested = { common: { actions: { save: 'a', cancel: 'b' } }, login: { submit: 'c' } };
    expect(run(step, positioned([nested]))).toEqual([
      { key: 'common.actions.save', value: 'common.actions.save' },
      { key: 'common.actions.cancel', value: 'common.actions.cancel' },
      { key: 'login.submit', value: 'login.submit' },
    ]);
  });

  it('an empty object yields no items', () => {
    expect(run(step, positioned([{}]))).toEqual([]);
  });

  it('rejects any argument key — the step takes none', () => {
    expect(stepFault({ op: 'flattenKeys', path: 'a' }).location).toContain(EXTRACT);
  });
});

describe('sort — stable sort by value', () => {
  const step: UnaryStep = { op: 'sort' };

  it('sorts numbers numerically', () => {
    // A string comparison would put 100 before 9.
    expect(run(step, positioned([10, 9, 100]))).toEqual([
      { key: '1', value: 9 },
      { key: '0', value: 10 },
      { key: '2', value: 100 },
    ]);
  });

  it('sorts strings by code point', () => {
    // Locale collation would put 'a' before 'B'.
    expect(run(step, positioned(['b', 'a', 'B']))).toEqual([
      { key: '2', value: 'B' },
      { key: '1', value: 'a' },
      { key: '0', value: 'b' },
    ]);
  });

  it('sorts a mixed list by the stringified value', () => {
    expect(run(step, positioned([10, '9', 2]))).toEqual([
      { key: '0', value: 10 },
      { key: '2', value: 2 },
      { key: '1', value: '9' },
    ]);
  });

  it('keeps input order among equal values', () => {
    const items: Items = [
      { key: 'k1', value: 2 },
      { key: 'k2', value: 1 },
      { key: 'k3', value: 2 },
    ];
    expect(run(step, items)).toEqual([
      { key: 'k2', value: 1 },
      { key: 'k1', value: 2 },
      { key: 'k3', value: 2 },
    ]);
  });

  it('rejects any argument key — the step takes none', () => {
    expect(stepFault({ op: 'sort', by: 'value' }).location).toContain(EXTRACT);
  });
});

describe('lines — split a string into trimmed non-empty lines', () => {
  const step: UnaryStep = { op: 'lines' };

  it('trims each line, drops empty lines, and keys each by its 1-based source line', () => {
    // Keys are the original line numbers: a dropped blank line leaves its number unused,
    // so a renumbering step would read '1','2','3' where the source says '1','2','5'.
    const out = run(step, positioned(['a\n  b  \n\n \nc\n']));
    expect(out.map((item) => item.value)).toEqual(['a', 'b', 'c']);
    expect(out.map((item) => item.key)).toEqual(['1', '2', '5']);
  });

  it('an empty string yields no items', () => {
    expect(run(step, positioned(['']))).toEqual([]);
  });

  it('rejects any argument key — the step takes none', () => {
    expect(stepFault({ op: 'lines', trim: false }).location).toContain(EXTRACT);
  });
});

describe('matches — keep items whose value matches a constant regex', () => {
  it('keeps matching values in order and drops the rest', () => {
    const items = positioned(['// INVARIANT(1)', 'const INVARIANT_NAME', '# INVARIANT(2)']);
    expect(run({ op: 'matches', re: 'INVARIANT\\(' }, items)).toEqual([
      { key: '0', value: '// INVARIANT(1)' },
      { key: '2', value: '# INVARIANT(2)' },
    ]);
  });

  it('is case-sensitive without `i` and case-insensitive with it', () => {
    const items = positioned(['invariant(', 'INVARIANT(']);
    expect(run({ op: 'matches', re: 'INVARIANT\\(' }, items)).toEqual([
      { key: '1', value: 'INVARIANT(' },
    ]);
    expect(run({ op: 'matches', re: 'INVARIANT\\(', i: true }, items)).toEqual([
      { key: '0', value: 'invariant(' },
      { key: '1', value: 'INVARIANT(' },
    ]);
  });

  it('rejects a non-string `re`, a missing `re`, a non-boolean `i`, and an unknown key', () => {
    expect(stepFault({ op: 'matches', re: 1 }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'matches' }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'matches', re: 'x', i: 'yes' }).location).toContain(EXTRACT);
    expect(stepFault({ op: 'matches', re: 'x', g: true }).location).toContain(EXTRACT);
  });
});

describe('items — array to one item per element', () => {
  const step: UnaryStep = { op: 'items' };

  // Every fixture below with a non-empty input is shaped so that handing the input back
  // unchanged answers differently — a different item count or different keys — because
  // a flat list of scalars is exactly what a pass-through would leave intact.

  it('an empty input yields no items', () => {
    // An implementation that reads the first item before checking there is one throws here.
    expect(run(step, [])).toEqual([]);
  });

  it('spreads one array value into position-keyed items in array order', () => {
    // The parent key is not composed into the child key: 'list' does not become 'list.0'.
    // The elements are deliberately unsorted so a sorting step cannot hide behind them.
    expect(run(step, [{ key: 'list', value: ['b', 'c', 'a'] }])).toEqual([
      { key: '0', value: 'b' },
      { key: '1', value: 'c' },
      { key: '2', value: 'a' },
    ]);
  });

  it('an empty array yields no items', () => {
    // A pass-through keeps one item whose value is `[]`; the step keeps none.
    expect(run(step, positioned([[]]))).toEqual([]);
  });

  it('drops a string, a number, a plain object, an array-like, null, and undefined', () => {
    // A string is iterable, so a spread would split it into characters; a plain object
    // holding an array is what `select` reaches into, and this step must not follow it.
    // The `length`-bearing object separates a real array test from a duck-typed one:
    // `Array.from` and any `typeof value.length === 'number'` check unfold it.
    // A throw here would turn a malformed world into a crash instead of an empty extract.
    const arrayLike = { length: 2, 0: 'a', 1: 'b' };
    expect(run(step, positioned(['text', 7, { a: ['x'] }, arrayLike, null, undefined]))).toEqual(
      [],
    );
  });

  it('keeps falsy elements — an element is dropped for its position, never its value', () => {
    // A `filter(Boolean)` anywhere in the unfolding silently loses these four; the count
    // is what catches it, since every other fixture's elements are truthy.
    expect(run(step, positioned([[0, '', null, false]]))).toEqual([
      { key: '0', value: 0 },
      { key: '1', value: '' },
      { key: '2', value: null },
      { key: '3', value: false },
    ]);
  });

  it('unfolds one level — an element that is itself an array stays one item', () => {
    // The neighbouring `flattenKeys` recurses, so an implementation copied from it would
    // answer four items here. Depth is the axis: this step spreads the value it is given
    // and does not look inside what comes out.
    expect(run(step, positioned([[[1, 2], [3], 4]]))).toEqual([
      { key: '0', value: [1, 2] },
      { key: '1', value: [3] },
      { key: '2', value: 4 },
    ]);
  });

  it('unfolds only the items holding arrays, in input order, each keyed from zero', () => {
    // Keys restart at '0' for every array item — the same key space `select` uses — so a
    // renumbering across items ('0','1','2') or a dropped non-array position ('2') is wrong.
    expect(run(step, positioned([['a', 'b'], 'text', ['c']]))).toEqual([
      { key: '0', value: 'a' },
      { key: '1', value: 'b' },
      { key: '0', value: 'c' },
    ]);
  });

  it('after `source`, one item per element of a list the source kept whole', () => {
    // `source` seeds a list as one item under '0'; the step is what reaches its elements.
    // Compiling here also proves a bare `{ op: 'items' }` is admitted — the `run` cases
    // bypass validation, so an over-strict validator would pass every one of them.
    expect(extracted(SRC, EXTRACT, [step], ['src/a.ts', 'src/b.ts', 'README.md'])).toEqual([
      { key: '0', value: 'src/a.ts' },
      { key: '1', value: 'src/b.ts' },
      { key: '2', value: 'README.md' },
    ]);
  });

  it('rejects any argument key — the step takes none', () => {
    // Compilation refuses an unregistered name and a closed-key violation at the same
    // `location`, so the reason is the only thing that tells the two apart. Asserting the
    // location alone would pass while the step does not exist at all.
    const raised = stepFault({ op: 'items', of: 'x' });
    expect(raised.location).toContain(EXTRACT);
    expect(raised.reason).toContain("does not take the argument 'of'");
  });
});

describe('keyByPattern — re-key each item by capture group 1 of its value', () => {
  // The expressions below capture the stem before a suffix, so a key that still reads as a
  // position, as the whole match, or as the value itself is a different answer from the
  // capture. Two suffixes over one stem are what lets two pipelines fold onto one key.
  const step: UnaryStep = { op: 'keyByPattern', re: '^(.+)\\.src$' };

  it('an empty input yields no items', () => {
    // An implementation that reads the first item before checking there is one throws here.
    expect(run(step, [])).toEqual([]);
  });

  it('keys a matching item by the capture and keeps the value as it was', () => {
    // The value is the axis that separates re-keying from projection: a step that writes
    // the capture into the value answers `'a'` there, and a step that keys by the whole
    // match answers `'a.src'` in the key.
    expect(run(step, [{ key: '0', value: 'a.src' }])).toEqual([{ key: 'a', value: 'a.src' }]);
  });

  it('drops an item whose value does not match', () => {
    // A `matches`-style filter would keep 'b.txt' under its position; an unguarded
    // `exec(...)[1]` throws on the null it returns.
    expect(run(step, positioned(['b.txt']))).toEqual([]);
  });

  it('keeps every item in input order, including two that fold onto one key', () => {
    // The stems are deliberately unsorted so a sort cannot hide, and the repeated stem
    // catches a dedupe or a fold-into-array: three in, three out, keys b a b.
    const folding: UnaryStep = { op: 'keyByPattern', re: '^(.+)\\.(?:src|gen)$' };
    expect(run(folding, positioned(['b.src', 'a.src', 'b.gen']))).toEqual([
      { key: 'b', value: 'b.src' },
      { key: 'a', value: 'a.src' },
      { key: 'b', value: 'b.gen' },
    ]);
  });

  it('an empty capture is an empty-string key, not a dropped item', () => {
    // `keyBy` keeps an empty-string key, and this step follows it; a falsy check on the
    // capture would drop the item.
    expect(run({ op: 'keyByPattern', re: '^(.*)\\.md$' }, positioned(['.md']))).toEqual([
      { key: '', value: '.md' },
    ]);
  });

  it('matches a non-string value through String() and keeps the original value', () => {
    // A `typeof value === 'string'` gate drops the number; a stringifying step answers
    // `'42'` as the value where the input carried `42`.
    expect(run({ op: 'keyByPattern', re: '^(\\d+)$' }, positioned([42, null, true]))).toEqual([
      { key: '42', value: 42 },
    ]);
  });

  it('asks nothing of the value type: an array is keyed by its String() form', () => {
    // No type gate, unlike `keyBy`, which drops an object-valued key. `String()`
    // joins without a separator, so a one-element array is indistinguishable here from the
    // string it holds — the object stringifies to '[object Object]' and simply misses.
    expect(
      run({ op: 'keyByPattern', re: '^(.+)\\.src$' }, positioned([['a.src'], { a: 1 }])),
    ).toEqual([{ key: 'a', value: ['a.src'] }]);
  });

  it('is case-sensitive without `i` and case-insensitive with it', () => {
    // A step copied from `matches` that forgets the flag drops the lower-case value.
    const items = positioned(['a.SRC']);
    expect(run(step, items)).toEqual([]);
    expect(run({ op: 'keyByPattern', re: '^(.+)\\.src$', i: true }, items)).toEqual([
      { key: 'a', value: 'a.SRC' },
    ]);
  });

  it('uses capture group 1 alone when the expression has several', () => {
    // The last group or a join of all groups reads 'src' or 'a.src' into the key.
    expect(run({ op: 'keyByPattern', re: '^(.+)\\.(src|gen)$' }, positioned(['a.src']))).toEqual([
      { key: 'a', value: 'a.src' },
    ]);
  });

  it('admits a named group as a capture, and keys by position 1', () => {
    // A group counter written as a scan for '(' not followed by '?' reads `(?<n>…)` as
    // non-capturing and refuses a legal declaration. The refusal happens at compile time,
    // so this has to compile rather than run the entry: `run` reaches no validator.
    const named: UnaryStep = { op: 'keyByPattern', re: '^(?<stem>.+)\\.src$' };
    expect(
      compileDeclaration({
        discipline: 'probe',
        extract: { [EXTRACT]: [{ op: 'source', of: SRC }, named] },
        relate: [{ id: ENTRY, relation: { op: 'Empty', of: EXTRACT }, message: 'm' }],
      }),
    ).not.toSatisfy(isConfigFault);
    // The name is never read; the key comes from position 1 as it does for any group.
    expect(run(named, positioned(['a.src']))).toEqual([{ key: 'a', value: 'a.src' }]);
  });

  it('drops a matching item whose group 1 did not take part in the match', () => {
    // Group 1 can sit on an alternation branch the input does not take, or be optional,
    // and then `exec` matches with an unbound slot. Writing that slot into `key` produces
    // an item whose key is `undefined` despite the type, and every such item then folds
    // onto one shared key in any relation that compares keys — so a break is reported as
    // a pass. Like `keyBy` on a missing field, the step drops what it cannot key.
    expect(
      run({ op: 'keyByPattern', re: '^(?:(a)|(b))\\.src$' }, positioned(['b.src', 'a.src'])),
    ).toEqual([{ key: 'a', value: 'a.src' }]);
    expect(run({ op: 'keyByPattern', re: '^(x)?\\.src$' }, positioned(['.src']))).toEqual([]);
  });

  it('keeps input order when the dropped items are not all at the tail', () => {
    // Drops interleaved with keeps: an implementation that partitions instead of mapping,
    // or that keys by the surviving item's index, reorders or misnames these.
    expect(
      run(
        { op: 'keyByPattern', re: '^(.+)\\.src$' },
        positioned(['x.txt', 'b.src', 'y.txt', 'a.src']),
      ),
    ).toEqual([
      { key: 'b', value: 'b.src' },
      { key: 'a', value: 'a.src' },
    ]);
  });

  it('rejects a non-string `re` and a missing `re`', () => {
    // Compilation refuses an unregistered name and a bad argument at the same `location`,
    // so the reason is what tells the two apart — asserting the location alone would pass
    // while the step does not exist at all.
    const wrongType = stepFault({ op: 'keyByPattern', re: 1 });
    expect(wrongType.location).toContain(EXTRACT);
    expect(wrongType.reason).toContain("needs 're'");
    const missing = stepFault({ op: 'keyByPattern' });
    expect(missing.location).toContain(EXTRACT);
    expect(missing.reason).toContain("needs 're'");
  });

  it('rejects a non-boolean `i`', () => {
    const raised = stepFault({ op: 'keyByPattern', re: '^(.+)$', i: 'yes' });
    expect(raised.location).toContain(EXTRACT);
    expect(raised.reason).toContain("'i' as a boolean");
  });

  it('rejects an argument key outside `re` and `i`', () => {
    const raised = stepFault({ op: 'keyByPattern', re: '^(.+)$', field: 'x' });
    expect(raised.location).toContain(EXTRACT);
    expect(raised.reason).toContain("does not take the argument 'field'");
  });

  it('rejects an expression without a capture group at compile time', () => {
    // A re-keying step with nothing to key by is well-formed and empty of meaning; a
    // runtime drop would let the declaration compile and then silently produce no items.
    // The non-capturing group is the mutant: a `(`-counting check reads it as a group.
    for (const re of ['^.+\\.src$', '(?:x)']) {
      const raised = stepFault({ op: 'keyByPattern', re });
      expect(raised.location).toContain(EXTRACT);
      expect(raised.reason).toContain('capture group');
    }
  });

  it('rejects an expression that does not compile, as a fault rather than a throw', () => {
    // The capture-group count is measured by compiling the expression; measured before the
    // compile check, a bad expression throws out of validation instead of naming a location.
    const raised = stepFault({ op: 'keyByPattern', re: '(' });
    expect(raised.location).toContain(EXTRACT);
    expect(raised.reason).toContain('compile');
  });
});

describe('keyByPattern — two pipelines folded onto one key, related by Implies', () => {
  // `Implies` compares keys, and until this step the only keys were positions and object
  // fields, so two string values could never meet. The identifiers are arbitrary pairs of
  // suffixed names; the declaration's expressions, not the engine, decide what pairs with what.
  const RECORDS = 'records';
  const SOURCES = 'sources';
  const GENERATED = 'generated';
  const decl: AlgebraDeclaration = {
    discipline: 'probe',
    extract: {
      [SOURCES]: [
        { op: 'source', of: RECORDS },
        { op: 'items' },
        { op: 'keyByPattern', re: '^(.+)\\.src$' },
      ],
      [GENERATED]: [
        { op: 'source', of: RECORDS },
        { op: 'items' },
        { op: 'keyByPattern', re: '^(.+)\\.gen$' },
      ],
    },
    relate: [
      { id: ENTRY, relation: { op: 'Implies', of: SOURCES, requires: GENERATED }, message: 'm' },
    ],
  };

  it('names the antecedent without a counterpart as the witness, value intact', () => {
    // A pass-through in place of the step leaves both sides position-keyed and the relation
    // holds vacuously; a value-projecting step reports `'b'` as the witness value.
    // Compiling here also proves a well-formed step is admitted: the `run` cases bypass
    // validation, so an over-strict validator would pass every one of them.
    const verdict = judge(decl, { [RECORDS]: ['a.src', 'a.gen', 'b.src'] });
    expect(witnessesOf(verdict, ENTRY)).toEqual([{ key: 'b', value: 'b.src' }]);
  });
});
