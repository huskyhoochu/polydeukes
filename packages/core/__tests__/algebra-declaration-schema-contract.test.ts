import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAlgebraDeclaration } from '../src/index.ts';
import { validateAlgebra } from './helpers.ts';

// Schema ⟺ validateAlgebraDeclaration equivalence for the algebra declaration. For each
// VALID fixture the validator must accept AND ajv must validate; for each INVALID one the
// validator must throw AND ajv must reject. A one-sided verdict means the two have drifted —
// the equivalence IS the contract, and it holds only where a fixture exists, so every
// constraint the schema can express gets one below.
//
// Reference resolution, relate-entry id uniqueness, and cycle detection deliberately stay
// validator-only, in algebra-declaration.test.ts: a name that must exist elsewhere in the
// same document is outside what JSON Schema expresses.

/** Parse one declaration fixture from the algebra fixture directory. */
function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Extract and source names are fixture values; neither side reads what a name means.
const SOURCE_PRE = 'pre';
const SOURCE_POST = 'post';
const EXTRACT_A = 'preItems';
const EXTRACT_B = 'postItems';

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
  return { ...minimalDeclaration, relate: [{ id: 'probe-entry', relation, message: 'm' }] };
}

/** A declaration with one extra pipeline added to the minimal extract block. */
function withPipeline(name: string, steps: unknown): unknown {
  return { ...minimalDeclaration, extract: { ...minimalExtract, [name]: steps } };
}

const VALID_DECLARATIONS: readonly unknown[] = [
  // The four real declarations: every block, both combinator shapes, both message forms.
  loadFixture('i18n-key-parity'),
  loadFixture('invariant-comment-marker'),
  loadFixture('task-ledger-self-pardon'),
  loadFixture('tdd-agent-required'),
  // The smallest legal document — no optional block.
  minimalDeclaration,
  // An unknown unary op: the open vocabulary must be open on both sides.
  withPipeline('digest', [{ op: 'source', of: SOURCE_PRE }, { op: 'sha256' }]),
  // A unary step whose `of` is a string: not a combinator by shape.
  withPipeline('picked', [
    { op: 'source', of: SOURCE_PRE },
    { op: 'select', of: 'tasks' },
  ]),
  // Equal with a plain message — messageBySide is permitted on Equal, never required.
  withRelation({ op: 'Equal', of: [EXTRACT_A, EXTRACT_B] }),
  // Ordered with its optional flag present.
  withRelation({ op: 'Ordered', of: EXTRACT_A, strict: false }),
  // Ordered without its optional flag.
  withRelation({ op: 'Ordered', of: EXTRACT_A }),
  // Implies with both references resolving.
  withRelation({ op: 'Implies', of: EXTRACT_A, requires: EXTRACT_B }),
  // intersect as a first step, the third combinator outside the fixtures.
  {
    ...minimalDeclaration,
    extract: { ...minimalExtract, shared: [{ op: 'intersect', of: [EXTRACT_A, EXTRACT_B] }] },
    relate: [{ id: 'shared-nonempty', relation: { op: 'NonEmpty', of: 'shared' }, message: 'm' }],
  },
];

const INVALID_DECLARATIONS: readonly unknown[] = [
  // relation op: closed to seven names
  // Within — the removed relation, first negative probe.
  withRelation({ op: 'Within', of: EXTRACT_A, max: 600000 }),
  // relation argument shapes
  // Equal.of with one name (minItems boundary).
  withRelation({ op: 'Equal', of: [EXTRACT_A] }),
  // Equal.of with three names (maxItems boundary).
  withRelation({ op: 'Equal', of: [EXTRACT_A, EXTRACT_B, EXTRACT_A] }),
  // Equal.of naming the same extract twice (uniqueItems).
  withRelation({ op: 'Equal', of: [EXTRACT_A, EXTRACT_A] }),
  // Subset without `in` (required key on that branch).
  withRelation({ op: 'Subset', of: EXTRACT_A }),
  // Implies without `requires`.
  withRelation({ op: 'Implies', of: EXTRACT_A }),
  // Ordered.strict as a truthy string.
  withRelation({ op: 'Ordered', of: EXTRACT_A, strict: 'yes' }),
  // Unknown key on a relation — `max` is the argument Within carried.
  withRelation({ op: 'NonEmpty', of: EXTRACT_A, max: 600000 }),
  // combinator op: closed to three names, discriminated by shape
  // A fourth combinator name with the array-`of` shape.
  withPipeline('onlyPre', [{ op: 'difference', of: [EXTRACT_A, EXTRACT_B] }]),
  // The same name with the of + notIn shape.
  withPipeline('onlyPre', [{ op: 'difference', of: EXTRACT_A, notIn: EXTRACT_B }]),
  // onlyIn with the wrong shape (array `of`).
  withPipeline('onlyPre', [{ op: 'onlyIn', of: [EXTRACT_A, EXTRACT_B] }]),
  // union naming the same extract twice (uniqueItems) — onlyIn's of≠notIn is validator-only.
  withPipeline('same', [{ op: 'union', of: [EXTRACT_A, EXTRACT_A] }]),
  // union with no arguments: a combinator name is read as a combinator whatever its shape.
  withPipeline('both', [{ op: 'union' }]),
  // union with a single-string `of`.
  withPipeline('both', [{ op: 'union', of: EXTRACT_A }]),
  // Unknown key on a combinator step (closed args).
  withPipeline('both', [{ op: 'union', of: [EXTRACT_A, EXTRACT_B], limit: 3 }]),
  // A combinator after the first step (prefixItems / items split).
  withPipeline('late', [
    { op: 'source', of: SOURCE_PRE },
    { op: 'union', of: [EXTRACT_A, EXTRACT_B] },
  ]),
  // pipeline steps
  // Empty pipeline (minItems).
  withPipeline('hollow', []),
  // A step without op.
  withPipeline('bad', [{ of: SOURCE_PRE }]),
  // A unary op that is the empty string (minLength).
  withPipeline('bad', [{ op: '' }]),
  // A step that is not an object.
  withPipeline('bad', ['source']),
  // entry messages
  // messageBySide on a non-Equal relation.
  {
    ...minimalDeclaration,
    relate: [
      {
        id: 'sided-subset',
        relation: { op: 'Subset', of: EXTRACT_A, in: EXTRACT_B },
        messageBySide: { left: 'l', right: 'r' },
      },
    ],
  },
  // Both message forms at once.
  {
    ...minimalDeclaration,
    relate: [
      {
        id: 'both-messages',
        relation: { op: 'Equal', of: [EXTRACT_A, EXTRACT_B] },
        message: 'm',
        messageBySide: { left: 'l', right: 'r' },
      },
    ],
  },
  // Neither message form.
  {
    ...minimalDeclaration,
    relate: [{ id: 'no-message', relation: { op: 'Empty', of: EXTRACT_A } }],
  },
  // messageBySide missing its right side.
  {
    ...minimalDeclaration,
    relate: [
      {
        id: 'half-sided',
        relation: { op: 'Equal', of: [EXTRACT_A, EXTRACT_B] },
        messageBySide: { left: 'l' },
      },
    ],
  },
  // Empty-string message (minLength).
  { ...minimalDeclaration, relate: [{ ...minimalRule, message: '' }] },
  // Empty-string id.
  { ...minimalDeclaration, relate: [{ ...minimalRule, id: '' }] },
  // Unknown key on an entry.
  { ...minimalDeclaration, relate: [{ ...minimalRule, enforce: 'block' }] },
  // non-empty containers
  // Empty relate (minItems).
  { ...minimalDeclaration, relate: [] },
  // Empty witness.relate.
  { ...minimalDeclaration, witness: { relate: [] } },
  // witness without relate (required key).
  { ...minimalDeclaration, witness: { extract: { w: [{ op: 'source', of: SOURCE_PRE }] } } },
  // top-level shape
  // Unknown top-level key.
  { ...minimalDeclaration, extracts: {} },
  // Empty-string discipline.
  { ...minimalDeclaration, discipline: '' },
  // discipline absent.
  { extract: minimalExtract, relate: [minimalRule] },
  // An array where a document is expected.
  [minimalDeclaration],
  // scope and supply
  // Unknown key inside scope.
  { ...minimalDeclaration, scope: { source: 'target.path', includes: ['.*'] } },
  // scope without source (required key).
  { ...minimalDeclaration, scope: { include: ['.*'] } },
  // A non-compilable include regex (format: regex).
  { ...minimalDeclaration, scope: { source: 'target.path', include: ['['] } },
  // A non-compilable exclude regex.
  { ...minimalDeclaration, scope: { source: 'target.path', exclude: ['('] } },
  // excludeIgnoreCase as a string.
  { ...minimalDeclaration, scope: { source: 'target.path', excludeIgnoreCase: 'yes' } },
  // include as a single string instead of a list.
  { ...minimalDeclaration, scope: { source: 'target.path', include: '.*' } },
  // A supply policy outside error | pass.
  { ...minimalDeclaration, supply: { [SOURCE_PRE]: 'warn' } },
  // Unknown key inside witness.
  { ...minimalDeclaration, witness: { relate: [{ ...minimalRule, id: 'w' }], scope: {} } },
];

/** True when the validator accepts the input (does not throw). */
function validatorAccepts(declaration: unknown): boolean {
  try {
    validateAlgebraDeclaration(declaration);
    return true;
  } catch {
    return false;
  }
}

describe('algebra schema ⟺ validateAlgebraDeclaration equivalence (VALID fixtures)', () => {
  it.each(
    VALID_DECLARATIONS.map((declaration, index) => [index, declaration] as const),
  )('valid declaration #%i: validator accepts AND ajv validates', (_index, declaration) => {
    // A validator-only acceptance leaves every consumer's IDE schema rejecting a legal
    // declaration; a schema-only acceptance validates documents the validator throws on.
    expect(validatorAccepts(declaration)).toBe(true);
    expect(validateAlgebra(declaration)).toBe(true);
  });
});

describe('algebra schema ⟺ validateAlgebraDeclaration equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_DECLARATIONS.map((declaration, index) => [index, declaration] as const),
  )('invalid declaration #%i: validator throws AND ajv rejects', (_index, declaration) => {
    expect(validatorAccepts(declaration)).toBe(false);
    expect(validateAlgebra(declaration)).toBe(false);
  });
});
