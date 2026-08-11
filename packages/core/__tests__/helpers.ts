import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/**
 * The published JSON Schema, compiled once for the schema ⟺ `defineConfig` contract
 * suites. Every one of them asserts the same equivalence from a different angle, so they
 * loaded and compiled the schema identically four times over; the options here are the
 * shape all four used (`allErrors` to see every violation at once, `strict: false`
 * because the schema uses 2020-12 keywords ajv's strict mode rejects).
 */
const schemaPath = fileURLToPath(new URL('../schema/polydeukes.schema.json', import.meta.url));

/** The schema as parsed JSON — the object the contract suites assert structure against. */
export const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Arm format validation ('regex' etc.) so the schema's pattern fields are actually
// enforced on the schema side — without it a malformed pattern passes ajv while
// defineConfig throws, and the suites would read that drift as an equivalence.
addFormats(ajv);

/** Validate a config object against the published schema. */
export const validate = ajv.compile(schema);

/**
 * The minimal `languages` block every fixture needs (the key is required).
 *
 * `testCmd` is deliberately `fake-runner`, never a real runner name: core's own
 * literal-gate asserts zero `vitest`/`pytest`/`go test` occurrences in this package, and
 * a fixture spelling one out would trip the gate on the suite that guards it.
 */
export const validLanguages = {
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
};
