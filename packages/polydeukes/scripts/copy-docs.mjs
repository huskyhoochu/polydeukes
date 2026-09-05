#!/usr/bin/env node
/**
 * Copy the bundled docs into the build output.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDocs } from '../src/docs-library.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const sourceRoot = join(repoRoot, 'docs');
const outputRoot = join(packageRoot, 'dist', 'docs');

if (!existsSync(sourceRoot)) {
  throw new Error(`missing docs source: ${sourceRoot}`);
}

buildDocs({ sourceRoot, outputRoot });
