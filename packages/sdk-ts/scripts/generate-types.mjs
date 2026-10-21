import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const check = process.argv.includes('--check');
for (const [schemaName, outputName] of [
  ['covenant-input', 'ir'],
  ['memory-search-output', 'memory'],
]) {
  const schemaPath = new URL(`../../core/schema/${schemaName}.schema.json`, import.meta.url);
  const outputPath = new URL(`../src/${outputName}.ts`, import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const source = await compile(schema, schema.title, {
    cwd: fileURLToPath(new URL('../../core/schema/', import.meta.url)),
    bannerComment:
      '/** Generated from core JSON Schema. Run scripts/generate-types.mjs to regenerate. */',
    style: { singleQuote: true, tabWidth: 2, printWidth: 100 },
    unknownAny: true,
    unreachableDefinitions: true,
  });
  if (check) {
    if (readFileSync(outputPath, 'utf8') !== source) throw new Error(`${outputName}.ts is stale`);
  } else writeFileSync(outputPath, source);
}
