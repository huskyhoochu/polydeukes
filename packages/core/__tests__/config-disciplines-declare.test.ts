import { describe, expect, it } from 'vitest';
// The fifth predicate family: a `disciplines:` entry carrying `declare` holds an algebra
// declaration body (scope · supply · extract · relate · witness) whose name is the entry's
// own `id` — the body never carries `discipline`. A `declare` entry refuses `in`/`except`/
// `when` (its scope lives inside the block), and the block's own validation runs with the
// entry location prefixed so the author can find the failing entry. The stored value is
// carried verbatim; compiling it is the covenant package's job.
import { ConfigValidationError, defineConfig } from '../src/config.ts';

// testCmd bodies are deliberately fake (`fake-runner`): the core never runs the command.
// Source names, regexes, and relate ids are discipline data injected through fixtures.

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

const SOURCE_PATH = 'target.path';
const EXTRACT_OUTSIDE = 'outside';
const RELATE_ID = 'placed';
const ENTRY_ID = 'db-only-under-knowledge';

/** The declaration body under test — a path-only placement check. */
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
      id: RELATE_ID,
      relation: { op: 'empty', of: EXTRACT_OUTSIDE },
      message: '{value} is outside memory/knowledge/',
    },
  ],
};

const declareEntry = {
  id: ENTRY_ID,
  why: 'a *.db file may exist only under memory/knowledge/',
  declare: declareBlock,
};

describe('defineConfig disciplines — declare entries are accepted and carried verbatim', () => {
  it('accepts an entry whose only predicate is `declare` and stores the block unchanged', () => {
    // `declare` must count as the one predicate (not zero, which the cardinality gate
    // rejects) and the block must arrive byte-for-byte: a validator that injects the
    // entry id as `discipline` into the stored value, or normalizes the block, breaks
    // deep equality here.
    const resolved = defineConfig(withDisciplines([declareEntry]));

    expect(resolved.disciplines).toEqual([declareEntry]);
    expect(resolved.disciplines?.[0]?.declare).toEqual(declareBlock);
    expect(resolved.disciplines?.[0]?.declare).not.toHaveProperty('discipline');
  });

  it('does not fabricate an enforce key on a declare entry that omits it', () => {
    // Absent enforce means advise by posture; a default-fill of `enforce: 'advise'` would
    // make the stored entry differ from what the author wrote.
    const resolved = defineConfig(withDisciplines([declareEntry]));

    expect('enforce' in (resolved.disciplines?.[0] ?? {})).toBe(false);
  });
});

describe('defineConfig disciplines — declare joins the exactly-one-predicate set', () => {
  it('rejects `declare` beside `forbid`, and the cardinality message names declare', () => {
    // A declare that rides along with another family unnoticed is a second judgment the
    // author never chose; the message must list `declare` among the predicate keys so the
    // author learns it is one.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'declare-plus-forbid', forbid: 'x', declare: declareBlock }]),
    );

    expect(error.message).toContain('declare-plus-forbid');
    expect(error.message).toContain('exactly one');
    expect(error.message).toContain('declare');
  });
});

describe('defineConfig disciplines — declare refuses the entry-level scope and trigger keys', () => {
  it('rejects `in` on a declare entry, naming the key', () => {
    // Scope for a declaration lives in its own `scope` block; an entry-level `in` would be
    // dead data implying a narrowing that is never applied.
    const error = expectConfigValidationError(
      withDisciplines([{ ...declareEntry, id: 'declare-with-in', in: 'lib/**' }]),
    );

    expect(error.message).toContain('declare-with-in');
    expect(error.message).toContain('in');
  });

  it('rejects `when` on a declare entry', () => {
    // `when` is the context family's trigger and combines with nothing else.
    const error = expectConfigValidationError(
      withDisciplines([{ ...declareEntry, id: 'declare-with-when', when: '\\.db$' }]),
    );

    expect(error.message).toContain('declare-with-when');
  });
});

describe('defineConfig disciplines — the declaration name lives in the entry id only', () => {
  it('rejects a block carrying `discipline`, saying the entry id is the name', () => {
    // Two places for one name drift apart; the block must be refused rather than have the
    // entry id silently overwrite (or be overwritten by) the inner name.
    const error = expectConfigValidationError(
      withDisciplines([
        { ...declareEntry, id: 'named-twice', declare: { ...declareBlock, discipline: 'other' } },
      ]),
    );

    expect(error.message).toContain('named-twice');
    expect(error.message).toContain('discipline');
    expect(error.message).toContain('entry id is the name');
  });
});

describe('defineConfig disciplines — the block is validated with the entry location prefixed', () => {
  it('rejects a relate entry naming an extract that does not exist, prefixed with the entry location', () => {
    // The declaration validator runs on the block; without the location prefix a config
    // with many entries reports a failure the author cannot place.
    const error = expectConfigValidationError(
      withDisciplines([
        {
          ...declareEntry,
          id: 'dangling-extract',
          declare: {
            ...declareBlock,
            relate: [{ id: RELATE_ID, relation: { op: 'empty', of: 'missing' }, message: 'm' }],
          },
        },
      ]),
    );

    expect(error.message.startsWith("disciplines[0] ('dangling-extract') declare")).toBe(true);
  });

  it('rejects a relation op outside the closed list, prefixed with the entry location', () => {
    // `Within` is the removed relation; a config surface that skipped the block validator
    // would store it and hand the covenant compiler a name it cannot compile.
    const error = expectConfigValidationError(
      withDisciplines([
        {
          ...declareEntry,
          id: 'unknown-relation',
          declare: {
            ...declareBlock,
            relate: [
              {
                id: RELATE_ID,
                relation: { op: 'Within', of: EXTRACT_OUTSIDE, max: 1 },
                message: 'm',
              },
            ],
          },
        },
      ]),
    );

    expect(error.message.startsWith("disciplines[0] ('unknown-relation') declare")).toBe(true);
    expect(error.message).toContain('Within');
  });

  it('rejects a non-object declare value (string), naming the entry', () => {
    // A string is the plausible shorthand mistake; it must be refused, not coerced into an
    // empty block that declares nothing.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'declare-string', why: 'w', declare: 'scope: target.path' }]),
    );

    expect(error.message).toContain('declare-string');
  });
});

describe('defineConfig disciplines — algebra blocks still live only under declare', () => {
  it('rejects an `extract` block beside a forbid predicate, naming that key', () => {
    // Opening the `declare` key must not open the entry to the block's own keys: an
    // `extract` at entry level is still an unknown key, and the message names it.
    const error = expectConfigValidationError(
      withDisciplines([
        {
          id: 'forbid-with-extract',
          forbid: 'x',
          extract: { a: [{ op: 'source', of: SOURCE_PATH }] },
        },
      ]),
    );

    expect(error.message).toContain('extract');
  });
});

describe('defineConfig disciplines — drafts carry no declare', () => {
  it('rejects draft: true combined with declare, naming the entry', () => {
    // A draft is prose only; a draft that also declares is ambiguous about whether it
    // judges, and the covenant compiler never sees drafts.
    const error = expectConfigValidationError(
      withDisciplines([{ ...declareEntry, id: 'draft-with-declare', draft: true }]),
    );

    expect(error.message).toContain('draft-with-declare');
  });
});
