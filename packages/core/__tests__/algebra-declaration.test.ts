import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BINARY_COMBINATOR_NAMES,
  RELATION_NAMES,
  SUPPLY_POLICIES,
  validateAlgebraDeclaration,
} from '../src/algebra.ts';
import { ConfigValidationError } from '../src/config.ts';

// `validateAlgebraDeclaration(unknown, location?)` is the shape check for one algebra
// declaration: five blocks (scope, supply, extract, relate, witness), a relation position
// closed to seven names, a binary combinator position closed to three, and an open unary
// extraction vocabulary. Every violation throws ConfigValidationError with a message that
// starts at `location` and names the offending path. The validator reads no world value:
// it neither runs an extraction nor evaluates a relation.

/** Parse one declaration fixture from the algebra fixture directory. */
function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

const FIXTURE_NAMES = [
  'i18n-key-parity',
  'invariant-comment-marker',
  'task-ledger-self-pardon',
  'tdd-agent-required',
] as const;

// Extract names and source names below are fixture values: the validator only checks
// that references resolve, never what a name means.
const SOURCE_PRE = 'pre';
const SOURCE_POST = 'post';
const EXTRACT_A = 'preItems';
const EXTRACT_B = 'postItems';

/** The smallest declaration the contract admits: two source pipelines and one entry. */
const minimalExtract = {
  [EXTRACT_A]: [{ op: 'source', of: SOURCE_PRE }],
  [EXTRACT_B]: [{ op: 'source', of: SOURCE_POST }],
};

const minimalRule = { id: 'items-empty', relation: { op: 'Empty', of: EXTRACT_A }, message: 'm' };

const minimalDeclaration = {
  discipline: 'probe',
  extract: minimalExtract,
  relate: [minimalRule],
};

/** A declaration whose single entry carries the given relation. */
function withRelation(relation: unknown): unknown {
  return {
    ...minimalDeclaration,
    relate: [{ id: 'probe-entry', relation, message: 'm' }],
  };
}

/** A declaration whose extract block is replaced wholesale. */
function withExtract(extract: unknown): unknown {
  return { ...minimalDeclaration, extract };
}

/** Asserts the concrete error instance and returns it so callers can assert on the message. */
function expectRejection(input: unknown, location?: string): ConfigValidationError {
  try {
    validateAlgebraDeclaration(input, location);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('validateAlgebraDeclaration should have thrown');
}

describe('validateAlgebraDeclaration — accepted declarations', () => {
  it.each(FIXTURE_NAMES)('accepts the %s declaration and returns it verbatim', (name) => {
    // The four real declarations exercise every block and every combinator; returning the
    // input unchanged is the contract, so a validator that normalizes (drops `mechanism`,
    // reorders relate, fills `strict: false`) shows up here.
    const declaration = loadFixture(name);

    expect(validateAlgebraDeclaration(declaration)).toEqual(declaration);
  });

  it('accepts the minimal declaration: discipline, extract, relate, nothing else', () => {
    // scope, supply, witness, mechanism, axis are all optional — a validator requiring any
    // of them refuses the smallest legal document.
    expect(validateAlgebraDeclaration(minimalDeclaration)).toEqual(minimalDeclaration);
  });

  it('accepts an unknown unary op (open vocabulary)', () => {
    // Unary names are registered elsewhere; the validator must not carry its own list.
    const declaration = withExtract({
      ...minimalExtract,
      digest: [{ op: 'source', of: SOURCE_PRE }, { op: 'sha256' }],
    });

    expect(() => validateAlgebraDeclaration(declaration)).not.toThrow();
  });

  it('accepts a unary step with a string `of` argument beside its other args', () => {
    // `of` alone does not make a step a combinator: only an ARRAY `of` or a `notIn` does.
    // A shape check keyed on the presence of `of` would refuse every `source` step.
    const declaration = withExtract({
      ...minimalExtract,
      picked: [
        { op: 'source', of: SOURCE_PRE },
        { op: 'select', of: 'tasks', path: 'x' },
      ],
    });

    expect(() => validateAlgebraDeclaration(declaration)).not.toThrow();
  });

  it('accepts an Equal entry with a plain message', () => {
    // messageBySide is allowed on Equal, never required: Equal with `message` is legal.
    const declaration = withRelation({ op: 'Equal', of: [EXTRACT_A, EXTRACT_B] });

    expect(() => validateAlgebraDeclaration(declaration)).not.toThrow();
  });

  it('accepts Ordered with strict: true', () => {
    const declaration = withRelation({ op: 'Ordered', of: EXTRACT_A, strict: true });

    expect(() => validateAlgebraDeclaration(declaration)).not.toThrow();
  });

  it('accepts Ordered without strict', () => {
    // strict is optional; a validator requiring it refuses the plain monotone form.
    const declaration = withRelation({ op: 'Ordered', of: EXTRACT_A });

    expect(() => validateAlgebraDeclaration(declaration)).not.toThrow();
  });

  it('accepts Implies when both of and requires resolve', () => {
    // The only relation whose second reference is `requires`; a resolver that checks
    // `of`/`in` slots alone and then refuses the unfamiliar key rejects the legal form.
    const declaration = withRelation({ op: 'Implies', of: EXTRACT_A, requires: EXTRACT_B });

    expect(() => validateAlgebraDeclaration(declaration)).not.toThrow();
  });

  it('accepts intersect as the first step of a pipeline', () => {
    // The third combinator in a non-cyclic position: the fixtures carry union and onlyIn
    // only, so a list missing intersect would pass every other acceptance test.
    const declaration = {
      ...minimalDeclaration,
      extract: { ...minimalExtract, shared: [{ op: 'intersect', of: [EXTRACT_A, EXTRACT_B] }] },
      relate: [{ id: 'shared-nonempty', relation: { op: 'NonEmpty', of: 'shared' }, message: 'm' }],
    };

    expect(() => validateAlgebraDeclaration(declaration)).not.toThrow();
  });

  it('accepts a witness entry that references a body extract name', () => {
    // The witness's scope is its own extract PLUS the body's; a validator resolving witness
    // references against the witness block alone refuses the legal form.
    const declaration = {
      ...minimalDeclaration,
      witness: {
        relate: [
          { id: 'witnessed-skip', relation: { op: 'NonEmpty', of: EXTRACT_B }, message: 'w' },
        ],
      },
    };

    expect(() => validateAlgebraDeclaration(declaration)).not.toThrow();
  });
});

describe('validateAlgebraDeclaration — the relation position is closed to seven names', () => {
  it('rejects op: Within, naming the offending name and the closed list', () => {
    // Within was the one relation whose boundary was a declaration constant; a validator
    // that still admits it reopens that back door. The message must show the author what
    // IS allowed, so the closed list is part of the contract.
    const error = expectRejection(withRelation({ op: 'Within', of: EXTRACT_A, max: 600000 }));

    expect(error.message).toContain('Within');
    for (const name of RELATION_NAMES) {
      expect(error.message).toContain(name);
    }
  });

  it('rejects op: Contains', () => {
    // An arbitrary name outside the seven, so the check is the list and not a Within-only
    // denylist.
    const error = expectRejection(withRelation({ op: 'Contains', of: EXTRACT_A }));

    expect(error.message).toContain('Contains');
  });

  it('rejects a relation name in the wrong case (empty)', () => {
    // Discriminated unions match exactly; a case-folding comparison would admit it.
    expectRejection(withRelation({ op: 'empty', of: EXTRACT_A }));
  });

  it('rejects an entry whose relation is missing', () => {
    expectRejection({ ...minimalDeclaration, relate: [{ id: 'no-relation', message: 'm' }] });
  });
});

describe('validateAlgebraDeclaration — relation argument shapes', () => {
  it('rejects Equal.of with the same name twice', () => {
    // Equal of a list with itself is always satisfied — an entry that can never break.
    const error = expectRejection(withRelation({ op: 'Equal', of: [EXTRACT_A, EXTRACT_A] }));

    expect(error.message).toContain(EXTRACT_A);
  });

  it('rejects Equal.of with three names', () => {
    // Length is exactly two, not "at least two".
    expectRejection(withRelation({ op: 'Equal', of: [EXTRACT_A, EXTRACT_B, EXTRACT_A] }));
  });

  it('rejects Equal.of given as a single string', () => {
    // The single-name shape belongs to the unary relations; Equal needs both sides.
    expectRejection(withRelation({ op: 'Equal', of: EXTRACT_A }));
  });

  it('rejects Subset without `in`', () => {
    // Subset of nothing would have to default to something; there is no default.
    const error = expectRejection(withRelation({ op: 'Subset', of: EXTRACT_A }));

    expect(error.message).toContain('in');
  });

  it('rejects Implies without `requires`', () => {
    const error = expectRejection(withRelation({ op: 'Implies', of: EXTRACT_A }));

    expect(error.message).toContain('requires');
  });

  it('rejects Ordered with strict: "yes"', () => {
    // A truthy string under a truthiness check silently becomes strict ordering.
    expectRejection(withRelation({ op: 'Ordered', of: EXTRACT_A, strict: 'yes' }));
  });

  it('rejects Empty.of given as an array', () => {
    // The array shape is Equal's; on a unary relation it is two names where one is meant.
    expectRejection(withRelation({ op: 'Empty', of: [EXTRACT_A, EXTRACT_B] }));
  });

  it('rejects an unknown key on a relation', () => {
    // `max` is exactly the argument Within carried; a relation level open to extra keys
    // would let a Within-shaped NonEmpty pass with its boundary silently ignored.
    const error = expectRejection(withRelation({ op: 'NonEmpty', of: EXTRACT_A, max: 600000 }));

    expect(error.message).toContain('max');
  });
});

describe('validateAlgebraDeclaration — the combinator position is closed to three names', () => {
  it('rejects op: difference with of: [a, b] — not admitted as a unary step either', () => {
    // A step referencing two extractions is a combinator by shape; an implementation that
    // falls through to the open unary vocabulary lets a fourth combinator in by name.
    const error = expectRejection(
      withExtract({
        ...minimalExtract,
        onlyPre: [{ op: 'difference', of: [EXTRACT_A, EXTRACT_B] }],
      }),
    );

    expect(error.message).toContain('difference');
    for (const name of BINARY_COMBINATOR_NAMES) {
      expect(error.message).toContain(name);
    }
  });

  it('rejects op: difference with of + notIn — the second combinator shape', () => {
    // `notIn` is the other signal; a shape check reading only "is `of` an array" misses it.
    expectRejection(
      withExtract({
        ...minimalExtract,
        onlyPre: [{ op: 'difference', of: EXTRACT_A, notIn: EXTRACT_B }],
      }),
    );
  });

  it('rejects onlyIn with an array `of`', () => {
    // onlyIn takes of + notIn; the array form belongs to union/intersect.
    expectRejection(
      withExtract({
        ...minimalExtract,
        onlyPre: [{ op: 'onlyIn', of: [EXTRACT_A, EXTRACT_B] }],
      }),
    );
  });

  it.each([
    ['no arguments', { op: 'union' }],
    ['a single-string of', { op: 'union', of: EXTRACT_A }],
  ])('rejects union with %s — a combinator name is a combinator whatever its shape', (_label, step) => {
    // The three names are reserved: a step named `union` is never read as a unary step, so
    // one that lacks the two-name shape is an argument violation, not an open-vocabulary pass.
    expectRejection(withExtract({ ...minimalExtract, both: [step] }));
  });

  it('rejects an unknown key on a combinator step', () => {
    // Combinator args are closed; only unary args pass through.
    const error = expectRejection(
      withExtract({
        ...minimalExtract,
        both: [{ op: 'union', of: [EXTRACT_A, EXTRACT_B], limit: 3 }],
      }),
    );

    expect(error.message).toContain('limit');
  });
});

describe('validateAlgebraDeclaration — references resolve inside the declaration', () => {
  it('rejects an entry whose `of` names no extract', () => {
    const error = expectRejection(withRelation({ op: 'Empty', of: 'missing' }));

    expect(error.message).toContain('missing');
  });

  it('rejects Subset whose `in` names no extract', () => {
    // Each reference slot is checked, not only `of`.
    const error = expectRejection(withRelation({ op: 'Subset', of: EXTRACT_A, in: 'missing' }));

    expect(error.message).toContain('missing');
  });

  it('rejects Equal whose second name is dangling', () => {
    // Both positions of the pair are references; checking `of[0]` only leaves the second
    // unresolved.
    const error = expectRejection(withRelation({ op: 'Equal', of: [EXTRACT_A, 'missing'] }));

    expect(error.message).toContain('missing');
  });

  it('rejects a combinator whose `notIn` names no extract', () => {
    const error = expectRejection(
      withExtract({
        ...minimalExtract,
        onlyPre: [{ op: 'onlyIn', of: EXTRACT_A, notIn: 'missing' }],
      }),
    );

    expect(error.message).toContain('missing');
  });

  it('rejects a combinator that references its own pipeline', () => {
    // The name exists in the block, so a pure existence check passes it; the self-edge is
    // the shortest cycle.
    const error = expectRejection(
      withExtract({
        ...minimalExtract,
        loop: [{ op: 'union', of: ['loop', EXTRACT_A] }],
      }),
    );

    expect(error.message).toContain('loop');
  });

  it.each([
    ['onlyIn', { op: 'onlyIn', of: EXTRACT_A, notIn: EXTRACT_A }],
    ['union', { op: 'union', of: [EXTRACT_A, EXTRACT_A] }],
    ['intersect', { op: 'intersect', of: [EXTRACT_A, EXTRACT_A] }],
  ])('rejects %s naming the same extract on both sides, naming it', (_op, step) => {
    // The same vacuity Equal refuses one position over: a set against itself is a
    // constant (always empty, or the set itself), so the entry downstream can never break.
    const error = expectRejection(withExtract({ ...minimalExtract, same: [step] }));

    expect(error.message).toContain(EXTRACT_A);
    expect(error.message).toContain('both sides');
  });

  it('rejects a witness pipeline that shadows a body extract name, naming it', () => {
    // The two blocks share one namespace: a witness `preItems` would make every reference
    // to that name ambiguous, and a reachability walk misreads it as a cycle.
    const error = expectRejection({
      ...minimalDeclaration,
      witness: {
        extract: { [EXTRACT_A]: [{ op: 'union', of: [EXTRACT_A, EXTRACT_B] }] },
        relate: [
          { id: 'witnessed-skip', relation: { op: 'NonEmpty', of: EXTRACT_A }, message: 'w' },
        ],
      },
    });

    expect(error.message).toContain('shadows');
    expect(error.message).toContain(EXTRACT_A);
  });

  it('rejects a two-pipeline cycle', () => {
    // Both names exist and neither references itself; only a reachability walk finds it.
    expectRejection(
      withExtract({
        ...minimalExtract,
        left: [{ op: 'union', of: ['right', EXTRACT_A] }],
        right: [{ op: 'intersect', of: ['left', EXTRACT_B] }],
      }),
    );
  });

  it('rejects a combinator that is not the first step of its pipeline', () => {
    // Combining two lists is the start of a new value; a second-position combinator would
    // silently discard the pipeline's earlier result.
    const error = expectRejection(
      withExtract({
        ...minimalExtract,
        late: [
          { op: 'source', of: SOURCE_PRE },
          { op: 'union', of: [EXTRACT_A, EXTRACT_B] },
        ],
      }),
    );

    expect(error.message).toContain('late');
  });

  it('rejects a body entry that references a witness-only extract name', () => {
    // Resolution is directional: the witness sees the body's names, the body does not see the
    // witness's. Pooling both blocks into one name set would pass this.
    const declaration = {
      ...minimalDeclaration,
      relate: [{ id: 'body-entry', relation: { op: 'Empty', of: 'witnessOnly' }, message: 'm' }],
      witness: {
        extract: { witnessOnly: [{ op: 'source', of: SOURCE_PRE }] },
        relate: [
          { id: 'witnessed-skip', relation: { op: 'NonEmpty', of: 'witnessOnly' }, message: 'w' },
        ],
      },
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain('witnessOnly');
  });
});

describe('validateAlgebraDeclaration — entry messages', () => {
  it('rejects messageBySide on a Subset entry', () => {
    // Only Equal produces two-sided witnesses; a side-keyed message on any other relation
    // has a side that never exists.
    const declaration = {
      ...minimalDeclaration,
      relate: [
        {
          id: 'sided-subset',
          relation: { op: 'Subset', of: EXTRACT_A, in: EXTRACT_B },
          messageBySide: { left: 'l', right: 'r' },
        },
      ],
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain('sided-subset');
  });

  it('rejects an entry carrying both message and messageBySide', () => {
    // Two message sources leave the engine to pick one silently.
    expectRejection({
      ...minimalDeclaration,
      relate: [
        {
          id: 'both-messages',
          relation: { op: 'Equal', of: [EXTRACT_A, EXTRACT_B] },
          message: 'm',
          messageBySide: { left: 'l', right: 'r' },
        },
      ],
    });
  });

  it('rejects an entry carrying neither message nor messageBySide', () => {
    // An entry with no text breaks silently — the author gets an id and nothing to read.
    const error = expectRejection({
      ...minimalDeclaration,
      relate: [{ id: 'no-message', relation: { op: 'Empty', of: EXTRACT_A } }],
    });

    expect(error.message).toContain('no-message');
  });

  it('rejects messageBySide missing its right side', () => {
    // Both sides are required; a partial object would leave one witness side blank.
    expectRejection({
      ...minimalDeclaration,
      relate: [
        {
          id: 'half-sided',
          relation: { op: 'Equal', of: [EXTRACT_A, EXTRACT_B] },
          messageBySide: { left: 'l' },
        },
      ],
    });
  });

  it('rejects an empty-string message', () => {
    expectRejection({
      ...minimalDeclaration,
      relate: [{ id: 'blank', relation: { op: 'Empty', of: EXTRACT_A }, message: '' }],
    });
  });
});

describe('validateAlgebraDeclaration — entry ids', () => {
  it('rejects a duplicate id across body and witness, naming the id', () => {
    // Uniqueness runs over the whole declaration; a per-block scan passes this.
    const declaration = {
      ...minimalDeclaration,
      witness: {
        relate: [{ id: minimalRule.id, relation: { op: 'NonEmpty', of: EXTRACT_B }, message: 'w' }],
      },
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain(minimalRule.id);
  });

  it('rejects an empty-string id', () => {
    expectRejection({
      ...minimalDeclaration,
      relate: [{ id: '', relation: { op: 'Empty', of: EXTRACT_A }, message: 'm' }],
    });
  });
});

describe('validateAlgebraDeclaration — non-empty containers', () => {
  it('rejects an empty relate array', () => {
    // A declaration with no entry judges nothing while reading as a registered discipline.
    const error = expectRejection({ ...minimalDeclaration, relate: [] });

    expect(error.message).toContain('relate');
  });

  it('rejects an empty pipeline', () => {
    // An extract name bound to zero steps has no value; an entry on it can never break.
    const error = expectRejection(withExtract({ ...minimalExtract, hollow: [] }));

    expect(error.message).toContain('hollow');
  });

  it('rejects an empty witness.relate array', () => {
    // The witness block exists to open the body's relate; with no entry of its own it opens
    // them unconditionally.
    expectRejection({ ...minimalDeclaration, witness: { relate: [] } });
  });
});

describe('validateAlgebraDeclaration — top-level shape and closed key sets', () => {
  it('rejects an unknown top-level key, naming it', () => {
    // A misspelled block (`extracts`) would be silently ignored under an open key set.
    const error = expectRejection({ ...minimalDeclaration, extracts: {} });

    expect(error.message).toContain('extracts');
  });

  it('rejects an unknown key inside scope', () => {
    const error = expectRejection({
      ...minimalDeclaration,
      scope: { source: 'target.path', includes: ['.*'] },
    });

    expect(error.message).toContain('includes');
  });

  it('rejects an empty-string discipline', () => {
    expectRejection({ ...minimalDeclaration, discipline: '' });
  });

  it('rejects a missing extract block', () => {
    const { extract: _extract, ...withoutExtract } = minimalDeclaration;

    const error = expectRejection(withoutExtract);

    expect(error.message).toContain('extract');
  });

  it('rejects null and an array at the top level', () => {
    // Both are `typeof 'object'`; only a plain-object check separates them from a document.
    expectRejection(null);
    expectRejection([minimalDeclaration]);
  });

  it('rejects a step that is not an object, and a step without op', () => {
    expectRejection(withExtract({ ...minimalExtract, bad: ['source'] }));
    expectRejection(withExtract({ ...minimalExtract, bad: [{ of: SOURCE_PRE }] }));
  });

  it('rejects a unary step whose op is the empty string', () => {
    // Open vocabulary still requires a name; "" would match no registered extraction and
    // read as a typo that passed.
    expectRejection(withExtract({ ...minimalExtract, bad: [{ op: '' }] }));
  });
});

describe('validateAlgebraDeclaration — scope and supply values', () => {
  it('rejects a non-compilable include regex', () => {
    // Refused at declaration time so it never reaches the engine as a runtime throw.
    const error = expectRejection({
      ...minimalDeclaration,
      scope: { source: 'target.path', include: ['['] },
    });

    expect(error.message).toContain('include');
  });

  it('rejects a non-compilable exclude regex', () => {
    // Both lists are checked, not only include.
    const error = expectRejection({
      ...minimalDeclaration,
      scope: { source: 'target.path', exclude: ['('] },
    });

    expect(error.message).toContain('exclude');
  });

  it('rejects scope without source', () => {
    expectRejection({ ...minimalDeclaration, scope: { include: ['.*'] } });
  });

  it('rejects excludeIgnoreCase given as a string', () => {
    expectRejection({
      ...minimalDeclaration,
      scope: { source: 'target.path', excludeIgnoreCase: 'yes' },
    });
  });

  it('rejects the supply value "warn"', () => {
    // Two policies exist; a third would have to fail open on a missing source.
    const error = expectRejection({ ...minimalDeclaration, supply: { [SOURCE_PRE]: 'warn' } });

    expect(error.message).toContain('warn');
    for (const policy of SUPPLY_POLICIES) {
      expect(error.message).toContain(policy);
    }
  });
});

describe('validateAlgebraDeclaration — error location', () => {
  it('prefixes the message with the caller-supplied location', () => {
    // A caller validating many declarations needs to know which one failed.
    const error = expectRejection({ ...minimalDeclaration, relate: [] }, 'catalog/probe.json');

    expect(error.message.startsWith('catalog/probe.json')).toBe(true);
  });

  it('defaults the location to "declaration"', () => {
    const error = expectRejection({ ...minimalDeclaration, relate: [] });

    expect(error.message.startsWith('declaration')).toBe(true);
  });
});

describe('the core package carries no runtime dependency', () => {
  it('package.json has no `dependencies` key', () => {
    // The validator is hand-written; a schema library added for it would load on every
    // session call through the hook.
    const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;

    expect('dependencies' in manifest).toBe(false);
  });
});
