import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMemory } from '../src/memory-command.ts';
import { writeConfigAt } from './helpers.ts';

// core ships the JSON Schema for `pdks memory search --json` as a language-neutral data
// contract, and nothing in core can import the memory package's TS type to pin it. The
// only place both the schema and the real producer are reachable is this package, so the
// contract is held here by running the real command and validating its bytes. A field
// renamed on the TS side fails (a); a field added on the TS side without a schema change
// fails (c), because `additionalProperties` stays open so a Rust host built against an
// older schema keeps parsing a newer CLI.

const SCHEMA_PATH = resolve(
  import.meta.dirname,
  '../../core/schema/memory-search-output.schema.json',
);
const CORE_MANIFEST_PATH = resolve(import.meta.dirname, '../../core/package.json');
const SCHEMA_EXPORT = './memory-search-output.schema.json';
const SCHEMA_EXPORT_TARGET = './schema/memory-search-output.schema.json';

/** Fixture values: one include glob, one document whose two sections share no word. */
const INCLUDE = ['notes/**/*.md'];
const DOC_REL = 'notes/alpha.md';
const HIT_WORD = 'shared-term';
const NO_HIT_WORD = 'zz-no-such-term-491';
const DOC_TEXT = `---\ntitle: Alpha\ntype: note\n---\n## One\n\n${HIT_WORD} here.\n\n## Two\n\nalpha only.\n`;

type SearchOutput = { ingestedAt: string; results: Record<string, unknown>[] };

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-memory-search-schema-'));
  const path = join(projectRoot, DOC_REL);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, DOC_TEXT);
  writeConfigAt(projectRoot, join(projectRoot, 'roi.log'), { memory: { include: INCLUDE } });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function loadSchema(): Record<string, unknown> {
  expect(existsSync(SCHEMA_PATH), `${SCHEMA_PATH} is missing`).toBe(true);
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>;
}

async function ingested(): Promise<void> {
  const outcome = await runMemory({ cwd: projectRoot, args: ['ingest'] });
  if (outcome.exitCode !== 0) throw new Error(`fixture ingest failed: ${outcome.text}`);
}

async function searchJson(word: string): Promise<SearchOutput> {
  const outcome = await runMemory({ cwd: projectRoot, args: ['search', word, '--json'] });
  expect(outcome.exitCode, outcome.text).toBe(0);
  return JSON.parse(outcome.text) as SearchOutput;
}

describe('memory-search-output schema ⟺ pdks memory search --json', () => {
  // A schema that spells a field differently from the TS type (`concept_id`, `docTitle`
  // renamed on either side), that closes an enum to the wrong members, or that types
  // `supersededBy` as a string rejects what the real command prints; a schema file that
  // ajv's strict mode refuses (an unknown keyword, a `$ref` beside siblings) fails before
  // any output is read.
  it('validates an output carrying hits under ajv strict 2020', async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(loadSchema());
    await ingested();

    const output = await searchJson(HIT_WORD);

    expect(output.results.length).toBeGreaterThan(0);
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
  });

  // A schema that writes `minItems: 1` on `results`, or marks the list optional and the
  // type-generator drops it, makes a no-hit answer parse as a failure on the Rust side —
  // the one value `Empty` must come from.
  it('validates an output whose results list is empty', async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(loadSchema());
    await ingested();

    const output = await searchJson(NO_HIT_WORD);

    expect(output.results).toEqual([]);
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
  });

  // `additionalProperties` is left open, so (a) stays green when the TS type gains a field
  // the schema does not know; this is the assertion that fails then. A schema that lists a
  // tenth property the command never prints fails from the other side.
  it('names exactly the keys every result carries under $defs.MemorySearchResult.properties', async () => {
    const schema = loadSchema();
    const defs = schema.$defs as Record<string, { properties: Record<string, unknown> }>;
    const declared = Object.keys(defs.MemorySearchResult?.properties ?? {}).sort();
    expect(declared.length).toBe(9);
    await ingested();

    const output = await searchJson(HIT_WORD);

    expect(Object.keys(output).sort()).toEqual(Object.keys(schema.properties as object).sort());
    expect(output.results.length).toBeGreaterThan(0);
    for (const result of output.results) {
      expect(Object.keys(result).sort()).toEqual(declared);
    }
  });

  // The root is what a code generator names the top-level type after, and `results` is
  // the one list the Rust verb reads; a root that nests the list under another key, or
  // names `$defs` differently, generates a type the mapping cannot read `results` from.
  it('declares the root title MemorySearchOutput with ingestedAt and results required', () => {
    const schema = loadSchema();

    expect(schema.title).toBe('MemorySearchOutput');
    expect((schema.required as string[]).sort()).toEqual(['ingestedAt', 'results']);
  });

  // The published path is what a consumer's import of
  // `@polydeukes/core/memory-search-output.schema.json` resolves through; a file that
  // exists but is not exported is unreachable from an installed package.
  it('core package.json exports the schema from the schema directory', () => {
    const manifest = JSON.parse(readFileSync(CORE_MANIFEST_PATH, 'utf8')) as {
      exports: Record<string, unknown>;
    };

    expect(manifest.exports[SCHEMA_EXPORT]).toBe(SCHEMA_EXPORT_TARGET);
  });
});
