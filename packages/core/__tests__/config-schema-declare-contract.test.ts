import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config.ts';
import { validate, validLanguages } from './helpers.ts';

// Schema ⟺ defineConfig equivalence for the `declare` discipline entry (the fifth predicate
// family, whose value is an algebra declaration body without `discipline`). For each VALID
// fixture defineConfig must accept AND ajv must validate; for each INVALID one defineConfig
// must throw AND ajv must reject. A fixture rejected by only one side means the two have
// drifted — the equivalence IS the contract, and it holds only where a fixture exists.
// Reference resolution inside the block stays validator-only (algebra-declaration.test.ts).

/** Attach one disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...validLanguages, disciplines };
}

const SOURCE_PATH = 'target.path';
const EXTRACT_OUTSIDE = 'outside';

const declareBlock = {
  // A path convention: `naming` admits `empty` on the change axis, scoped on target.path.
  mechanism: 'naming',
  scope: { source: SOURCE_PATH, include: ['\\.db$'] },
  extract: {
    [EXTRACT_OUTSIDE]: [
      { op: 'source', of: SOURCE_PATH },
      { op: 'matches', re: '^(?!memory/knowledge/)' },
    ],
  },
  relate: [
    {
      id: 'placed',
      relation: { op: 'empty', of: EXTRACT_OUTSIDE },
      message: '{value} is outside memory/knowledge/',
    },
  ],
};

const VALID_CONFIGS: readonly unknown[] = [
  // The declare entry with its prose: the shape every consumer's IDE schema must admit.
  withDisciplines([
    {
      id: 'db-only-under-knowledge',
      why: 'a *.db file may exist only under memory/knowledge/',
      declare: declareBlock,
    },
  ]),
  // The promoted rung: enforce is an entry-head key and applies to this family too.
  withDisciplines([
    {
      id: 'db-only-under-knowledge-block',
      why: 'a *.db file may exist only under memory/knowledge/',
      enforce: 'block',
      declare: declareBlock,
    },
  ]),
];

const INVALID_CONFIGS: readonly unknown[] = [
  // Entry-level scope key on a declare entry: scope lives inside the block.
  withDisciplines([{ id: 'declare-with-in', in: 'lib/**', declare: declareBlock }]),
  // Two predicates: declare must sit inside the exactly-one oneOf, not beside it.
  withDisciplines([{ id: 'declare-plus-forbid', forbid: 'x', declare: declareBlock }]),
  // The block naming itself: the entry id is the only name.
  withDisciplines([{ id: 'named-twice', declare: { ...declareBlock, discipline: 'named-twice' } }]),
  // A block without relate: the referenced declaration schema's required key must apply
  // through the $ref, not be lost by a looser inline copy.
  withDisciplines([
    {
      id: 'declare-no-relate',
      declare: { scope: declareBlock.scope, extract: declareBlock.extract },
    },
  ]),
  // The context trigger on a declare entry.
  withDisciplines([{ id: 'declare-with-when', when: '\\.db$', declare: declareBlock }]),
  // A block without mechanism: the catalogue name is required, and the IDE schema must
  // say so before the runtime validator does.
  withDisciplines([{ id: 'declare-no-mechanism', declare: withoutMechanism(declareBlock) }]),
  // A mechanism outside the catalogue: the schema enum mirrors the closed tuple.
  withDisciplines([
    { id: 'declare-unknown-mechanism', declare: { ...declareBlock, mechanism: 'pair parity' } },
  ]),
  // The removed axis key: derived from the sources now, never written.
  withDisciplines([{ id: 'declare-with-axis', declare: { ...declareBlock, axis: 'change' } }]),
];

/** The block with its mechanism key absent, not undefined — ajv's `required` sees the difference. */
function withoutMechanism(block: typeof declareBlock): Omit<typeof declareBlock, 'mechanism'> {
  const { mechanism: _mechanism, ...rest } = block;
  return rest;
}

/** True when defineConfig accepts the input (does not throw). */
function defineConfigAccepts(config: unknown): boolean {
  try {
    defineConfig(config);
    return true;
  } catch {
    return false;
  }
}

describe('declare schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid declare fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('declare schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid declare fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
