import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// COVENANT-13 §4.1 (last item) — schema ⟺ defineConfig equivalence for the
// context-family discipline entry (`requirePrecedent` + `when` + widened
// `in`/`except`). Mirrors config-schema-contract.test.ts: for each VALID
// fixture, defineConfig must accept AND ajv must validate; for each INVALID
// fixture, defineConfig must throw AND ajv must reject. If a single fixture is
// rejected by only one side, the schema and validator have drifted. The
// equivalence IS the contract.
//
// Dev-log gate (core.dev-log.schema-equivalence-blind-without-fixture): every
// constraint of the NEW schema node gets its own invalid fixture — the
// equivalence is only enforced where a fixture exists (`why: 123` precedent).
// New fixtures live in this NEW file (adapters-contract precedent) because the
// RED phase must not modify existing test files. Dummy commands are FAKE
// (`fake-runner`/`fake-probe`) so the core grep gate stays satisfied.
// ---------------------------------------------------------------------------

const schemaPath = fileURLToPath(new URL('../schema/polydeukes.schema.json', import.meta.url));
const schemaSource = readFileSync(schemaPath, 'utf8');
const schema = JSON.parse(schemaSource) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Arm format validation ('regex' etc.) so the schema's pattern fields — including the new
// `command` and `when` — are actually enforced on the schema side.
addFormats(ajv);
const validate = ajv.compile(schema);

// A valid single-language config the discipline fixtures attach to.
const validLanguages = {
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
};

/** Attach one disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...validLanguages, disciplines };
}

const VALID_CONFIGS: readonly unknown[] = [
  // §4.1 — the PRD example shape: full context-family entry with in/except/when and the
  // core-owned command evidence.
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
  // §4.1 — minimal entry: `when` and `in` absent are both valid (absence of `when` means
  // every in-scope change triggers).
  withDisciplines([{ id: 'minimal-context', requirePrecedent: { command: 'fake-probe ' } }]),
  // §4.1 — adapter evidence vocabulary: container-only validation, value verbatim. This
  // fixture is the superset case — an adapter value that would FAIL the core regex probe
  // must still pass on both sides, so neither the validator nor the schema may apply
  // command-grade validation to adapter vocabulary (values are verbatim; adapters own them).
  withDisciplines([{ id: 'opaque-adapter-value', in: 'src/**', requirePrecedent: { tool: '(' } }]),
];

const INVALID_CONFIGS: readonly unknown[] = [
  // --- command evidence (core-owned, fully validated) ---
  // Empty-string command (minLength boundary).
  withDisciplines([{ id: 'empty-command', requirePrecedent: { command: '' } }]),
  // Non-compilable command regex (format: regex boundary).
  withDisciplines([{ id: 'bad-command-re', requirePrecedent: { command: '(' } }]),
  // Non-string command (type boundary).
  withDisciplines([{ id: 'command-number', requirePrecedent: { command: 123 } }]),
  // --- evidence container: flat object, exactly one evidence key ---
  // Zero evidence keys (minProperties boundary).
  withDisciplines([{ id: 'no-evidence', requirePrecedent: {} }]),
  // Two evidence keys, command + adapter (maxProperties boundary).
  withDisciplines([
    { id: 'two-evidence-core', requirePrecedent: { command: 'fake-probe ', subagent: 'x' } },
  ]),
  // Two evidence keys, adapter + adapter — a count watching only the command key would
  // admit this pair.
  withDisciplines([{ id: 'two-evidence-adapter', requirePrecedent: { subagent: 'x', tool: 'y' } }]),
  // Non-object requirePrecedent: array (typeof object but not a record).
  withDisciplines([{ id: 'evidence-array', requirePrecedent: ['fake-probe '] }]),
  // Non-object requirePrecedent: string shorthand is NOT a thing.
  withDisciplines([{ id: 'evidence-string', requirePrecedent: 'fake-probe ' }]),
  // Non-object requirePrecedent: null (JSON-representable, type: object excludes it).
  withDisciplines([{ id: 'evidence-null', requirePrecedent: null }]),
  // --- when: context-family-only trigger, itself a compilable regex string ---
  // when on a non-context (here: delta-family) entry. The schema rejects `when` outside
  // the context branch through one shared node, so one non-context family stands for all
  // three (the TS validator's per-family branches are pinned in
  // config-disciplines-context-family.test.ts, where the branches genuinely differ).
  withDisciplines([{ id: 'forbid-with-when', forbid: 'x', when: 'y' }]),
  // Non-string when.
  withDisciplines([{ id: 'when-number', when: 123, requirePrecedent: { command: 'fake-probe ' } }]),
  // Non-compilable when regex.
  withDisciplines([{ id: 'bad-when-re', when: '(', requirePrecedent: { command: 'fake-probe ' } }]),
  // --- exactly-one-predicate widened to 4 keys ---
  // requirePrecedent paired with a second predicate. The schema enforces exclusivity via
  // one oneOf, so a single pairing exercises that node for all three partners (the
  // validator's per-key branches live in config-disciplines-context-family.test.ts).
  withDisciplines([
    { id: 'context-plus-forbid', requirePrecedent: { command: 'fake-probe ' }, forbid: 'x' },
  ]),
  // --- in/except widening must not leak to the path/command families ---
  // `in` on a forbidCommand entry (the widening's new combination — the shipped contract
  // file pins except-on-forbidCommand and in-on-immutable).
  withDisciplines([{ id: 'command-with-in', forbidCommand: 'x', in: 'z/**' }]),
  // `except` on an immutable entry (the other new combination).
  withDisciplines([{ id: 'immutable-with-except', immutable: 'y/**', except: 'z/**' }]),
  // --- unknown keys on the new entry branch ---
  // The reserved `surfaces` key (PRD §2 exclusion) must be refused on a context-family
  // entry too — the unknown-key gate has to exist on the NEW schema branch, not only on
  // the three shipped families.
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

describe('§4.1 context-family schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid context-family fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    // Both sides must accept. If either side rejects a genuinely valid context-family
    // config, the schema and validator have drifted.
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('§4.1 context-family schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid context-family fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    // Both sides must reject. A one-sided rejection is exactly the `why: 123` blind spot
    // the dev-log gate exists to prevent.
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
