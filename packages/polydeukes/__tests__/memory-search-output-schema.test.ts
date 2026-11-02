import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMemory } from '../src/memory-command.ts';
import { writeConfigAt } from './helpers.ts';

// core ships the JSON Schema for `pdks memory search --json` as a language-neutral data
// contract. This file compiles it under ajv strict and validates the bytes the TS command
// prints, so a field renamed on the TS side or an enum closed to the wrong members fails here.
// The key-for-key comparison against the shipped `pdks-memory` lives in that crate's tests.

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

type SearchOutput = { results: Record<string, unknown>[] };

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
