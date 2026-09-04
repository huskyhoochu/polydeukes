import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config.ts';
import { validate, validLanguages } from './helpers.ts';

// Schema ⟺ defineConfig equivalence for the context-family discipline entry
// (`requirePrecedent` + `when` + widened `in`/`except`). For each VALID fixture defineConfig
// must accept AND ajv must validate; for each INVALID one defineConfig must throw AND ajv
// must reject. A fixture rejected by only one side means the two have drifted — the
// equivalence IS the contract, and it holds only where a fixture exists, so every constraint
// of the schema node needs its own invalid fixture. Dummy commands are fake so the core's own
// covenants stay satisfied.

/** Attach one disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...validLanguages, disciplines };
}

const VALID_CONFIGS: readonly unknown[] = [
  // Full context-family entry: in/except/when plus the core-owned command evidence.
  withDisciplines([
    {
      id: 'dependency-needs-npm-view',
      why: 'measure the registry before trusting a trained version',
      in: 'package.json',
      except: 'fixtures/package.json',
      when: '^\\s*"[^"]+"\\s*:\\s*"[~^]?\\d',
      requirePrecedent: { command: 'npm view ' },
    },
  ]),
  // Minimal entry: `when` and `in` are both optional, and an absent `when` means every
  // in-scope change triggers.
  withDisciplines([{ id: 'minimal-context', requirePrecedent: { command: 'fake-probe ' } }]),
  // Adapter evidence is validated at the container only, its value kept verbatim. The value
  // here is deliberately one that would FAIL the core's regex probe: it must still pass both
  // sides, proving neither applies command-grade validation to adapter vocabulary.
  withDisciplines([{ id: 'opaque-adapter-value', in: 'src/**', requirePrecedent: { tool: '(' } }]),
];

const INVALID_CONFIGS: readonly unknown[] = [
  // command evidence (core-owned, fully validated)
  // Empty-string command (minLength boundary).
  withDisciplines([{ id: 'empty-command', requirePrecedent: { command: '' } }]),
  // Non-compilable command regex (format: regex boundary).
  withDisciplines([{ id: 'bad-command-re', requirePrecedent: { command: '(' } }]),
  // Non-string command (type boundary).
  withDisciplines([{ id: 'command-number', requirePrecedent: { command: 123 } }]),
  // evidence container: flat object, exactly one evidence key
  // Zero evidence keys (minProperties boundary).
  withDisciplines([{ id: 'no-evidence', requirePrecedent: {} }]),
  // Two evidence keys, command + adapter (maxProperties boundary).
  withDisciplines([
    { id: 'two-evidence-core', requirePrecedent: { command: 'fake-probe ', subagent: 'x' } },
  ]),
  // Two adapter keys: a count watching only the command key would admit this pair.
  withDisciplines([{ id: 'two-evidence-adapter', requirePrecedent: { subagent: 'x', tool: 'y' } }]),
  // Non-object requirePrecedent: array (typeof object but not a record).
  withDisciplines([{ id: 'evidence-array', requirePrecedent: ['fake-probe '] }]),
  // Non-object requirePrecedent: string shorthand is NOT a thing.
  withDisciplines([{ id: 'evidence-string', requirePrecedent: 'fake-probe ' }]),
  // Non-object requirePrecedent: null (JSON-representable, type: object excludes it).
  withDisciplines([{ id: 'evidence-null', requirePrecedent: null }]),
  // when: context-family-only trigger, itself a compilable regex string
  // `when` on a non-context entry. The schema rejects it outside the context branch through
  // one shared node, so a single non-context family stands for all three here; the
  // validator's per-family branches, which genuinely differ, are pinned in
  // config-disciplines-context-family.test.ts.
  withDisciplines([{ id: 'forbid-with-when', forbid: 'x', when: 'y' }]),
  // Non-string when.
  withDisciplines([{ id: 'when-number', when: 123, requirePrecedent: { command: 'fake-probe ' } }]),
  // Empty-string when: it compiles, so `format: regex` alone lets it through — only the
  // schema's minLength mirrors the validator's non-empty check.
  withDisciplines([{ id: 'empty-when', when: '', requirePrecedent: { command: 'fake-probe ' } }]),
  // Non-compilable when regex.
  withDisciplines([{ id: 'bad-when-re', when: '(', requirePrecedent: { command: 'fake-probe ' } }]),
  // exactly-one-predicate widened to 4 keys
  // requirePrecedent paired with a second predicate. The schema enforces exclusivity through
  // one oneOf, so a single pairing exercises that node for all three partners; the
  // validator's per-key branches live in config-disciplines-context-family.test.ts.
  withDisciplines([
    { id: 'context-plus-forbid', requirePrecedent: { command: 'fake-probe ' }, forbid: 'x' },
  ]),
  // in/except widening must not leak to the path/command families
  // These two pair each scope key with the family the shipped contract file does NOT cover
  // for it (that file pins except-on-forbidCommand and in-on-immutable), so between the two
  // files all four combinations are held.
  withDisciplines([{ id: 'command-with-in', forbidCommand: 'x', in: 'z/**' }]),
  withDisciplines([{ id: 'immutable-with-except', immutable: 'y/**', except: 'z/**' }]),
  // unknown keys on the new entry branch
  // The reserved `surfaces` key must be refused on a context-family entry too: the
  // unknown-key gate has to exist on this branch, not only on the other three families.
  withDisciplines([
    {
      id: 'context-with-surfaces',
      requirePrecedent: { command: 'fake-probe ' },
      surfaces: ['session'],
    },
  ]),
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

describe('context-family schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid context-family fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('context-family schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid context-family fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
