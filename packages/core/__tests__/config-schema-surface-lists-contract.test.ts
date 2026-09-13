import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config.ts';
import { schema, validate, validLanguages } from './helpers.ts';

// Schema ⟺ defineConfig equivalence for the two surface lists, `sessionDisciplines` and
// `changeSetDisciplines`. For each VALID fixture defineConfig must accept AND ajv must
// validate; for each INVALID one defineConfig must throw AND ajv must reject. The schema
// reuses `$defs/discipline` for both, so the item shape is the one the shared list already
// has; what the schema cannot express — which channels an entry reads — stays validator-only
// in config-surface-lists.test.ts.

const DISCIPLINE_REF = '#/$defs/discipline';

const commandEntry = {
  id: 'pnpm-only',
  declare: {
    mechanism: 'forbidden-command',
    scope: { source: 'command' },
    extract: {
      hits: [{ op: 'source', of: 'command' }, { op: 'lines' }, { op: 'matches', re: 'npm i' }],
    },
    relate: [{ id: 'no-hit', relation: { op: 'empty', of: 'hits' }, message: 'm' }],
  },
};

const changesEntry = {
  id: 'docs-stay-bilingual',
  declare: {
    mechanism: 'companion',
    scope: { source: 'target.path', include: ['\\.md$'] },
    extract: {
      en: [
        { op: 'source', of: 'target.path' },
        { op: 'keyByPattern', re: '^(.+?)(?<!\\.ko)\\.md$' },
      ],
      koChanged: [
        { op: 'source', of: 'changes' },
        { op: 'items' },
        { op: 'keyByPattern', re: '^(.+)\\.ko\\.md$' },
      ],
    },
    relate: [
      {
        id: 'ko-follows',
        relation: { op: 'implies', of: 'en', requires: 'koChanged' },
        message: 'm',
      },
    ],
  },
};

const fileEntry = {
  id: 'no-todo',
  declare: {
    mechanism: 'naming',
    scope: { source: 'target.path', include: ['\\.db$'] },
    extract: {
      outside: [
        { op: 'source', of: 'target.path' },
        { op: 'matches', re: '^(?!store/)' },
      ],
    },
    relate: [{ id: 'placed', relation: { op: 'empty', of: 'outside' }, message: 'm' }],
  },
};

const VALID_CONFIGS: readonly unknown[] = [
  // A session list alone.
  { ...validLanguages, sessionDisciplines: [commandEntry] },
  // All three lists together.
  {
    ...validLanguages,
    disciplines: [fileEntry],
    sessionDisciplines: [commandEntry],
    changeSetDisciplines: [changesEntry],
  },
  // Empty surface lists — presence without entries is a valid shape on both sides.
  { ...validLanguages, sessionDisciplines: [], changeSetDisciplines: [] },
];

const { id: _sessionId, ...commandEntryWithoutId } = commandEntry;

const INVALID_CONFIGS: readonly unknown[] = [
  // A non-array value (the type boundary).
  { ...validLanguages, sessionDisciplines: { id: 'x' } },
  // An item without an id (the `$defs/discipline` required boundary — a schema that
  // declares the property as a bare array passes this).
  { ...validLanguages, sessionDisciplines: [commandEntryWithoutId] },
];

/** True when defineConfig accepts the input (does not throw). */
function defineConfigAccepts(config: unknown): boolean {
  try {
    defineConfig(config);
    return true;
  } catch {
    return false;
  }
}

describe('the published schema carries both surface lists', () => {
  it.each(['sessionDisciplines', 'changeSetDisciplines'])(
    '%s is an array whose items $ref the shared discipline definition',
    (key) => {
      // A copy of the item schema instead of a $ref drifts the moment the shared entry
      // grammar gains a key; a bare array accepts an item the validator refuses.
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      expect(properties[key]).toBeDefined();
      expect(properties[key]?.type).toBe('array');
      expect(properties[key]?.items).toEqual({ $ref: DISCIPLINE_REF });
    },
  );
});

describe('surface-list schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(VALID_CONFIGS.map((config, index) => [index, config] as const))(
    'valid surface-list fixture #%i: defineConfig accepts AND ajv validates',
    (_index, config) => {
      expect(defineConfigAccepts(config)).toBe(true);
      expect(validate(config)).toBe(true);
    },
  );
});

describe('surface-list schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(INVALID_CONFIGS.map((config, index) => [index, config] as const))(
    'invalid surface-list fixture #%i: defineConfig throws AND ajv rejects',
    (_index, config) => {
      expect(defineConfigAccepts(config)).toBe(false);
      expect(validate(config)).toBe(false);
    },
  );
});
