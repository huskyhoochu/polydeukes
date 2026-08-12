#!/usr/bin/env node
/**
 * Copy the config schema into the build output (DIST-05 §3-b/§3-c).
 *
 * A consumer's `$schema` line names a file inside this package, so the schema has to travel
 * inside the tarball. npm's `files` whitelist cannot reach outside the package directory, and
 * `packages/core/schema/` is outside it — copying into `dist/`, already whitelisted, is the
 * one way the file ships. `copy-docs.mjs` solves the same problem the same way.
 *
 * Core owns the single source (§5 invariant 2): this destination is build output, and the two
 * files may only differ by a build defect. The copy is byte-for-byte for that reason.
 *
 * A missing source is fatal: `copyFileSync` throws ENOENT and this script exits non-zero,
 * failing the build. The alternative — skipping what is absent — ships a package whose
 * `$schema` line points at nothing, and the consumer's editor reports no error either; the
 * line is a static string, so validation simply never happens.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../..');

/** §3-b's source and build-output rows. */
const SOURCE = join(repoRoot, 'packages', 'core', 'schema', 'polydeukes.schema.json');
const DESTINATION_DIR = join(packageRoot, 'dist', 'schema');

mkdirSync(DESTINATION_DIR, { recursive: true });
copyFileSync(SOURCE, join(DESTINATION_DIR, 'polydeukes.schema.json'));
