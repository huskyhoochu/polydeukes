import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/**
 * The published JSON Schema, compiled once for the schema ⟺ `defineConfig` contract suites.
 * `allErrors` surfaces every violation at once; `strict: false` is required because the
 * schema uses 2020-12 keywords ajv's strict mode rejects.
 */
const schemaPath = fileURLToPath(new URL('../schema/polydeukes.schema.json', import.meta.url));

/** The schema as parsed JSON — the object the contract suites assert structure against. */
export const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Arms format validation ('regex' etc.). Without it a malformed pattern passes ajv while
// defineConfig throws, and the suites would read that drift as an equivalence.
addFormats(ajv);

/** Validate a config object against the published schema. */
export const validate = ajv.compile(schema);

/**
 * The minimal `languages` block every fixture needs (the key is required).
 *
 * `testCmd` is deliberately `fake-runner`, never a real runner name: the core stores the
 * command and never runs it, so a real name would imply a coupling that does not exist.
 */
export const validLanguages = {
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
};

/**
 * The algebra declaration schema, compiled on first use rather than at import: the config
 * contract suites above share this module and must not fail when only this file is absent.
 */
const algebraSchemaPath = fileURLToPath(
  new URL('../schema/algebra-declaration.schema.json', import.meta.url),
);

let compiledAlgebra: ((input: unknown) => boolean) | undefined;

/** Validate an algebra declaration against its published schema. */
export function validateAlgebra(input: unknown): boolean {
  if (compiledAlgebra === undefined) {
    const algebraSchema = JSON.parse(readFileSync(algebraSchemaPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const compiled = ajv.compile(algebraSchema);
    compiledAlgebra = (candidate: unknown) => compiled(candidate) === true;
  }
  return compiledAlgebra(input);
}
