#!/usr/bin/env node
/**
 * Copy the shipped English documentation into the build output (DOCS-02 §3-a).
 *
 * `pdks docs` answers from the installed package, so the markdown has to travel inside the
 * tarball. npm's `files` whitelist cannot reach outside the package directory, which is why
 * the docs are copied into `dist/` — already whitelisted — rather than registered from the
 * repository root.
 *
 * The member list below is enumerated rather than swept from the directory. A sweep would
 * silently widen with every file added to `docs/` (the Korean mirrors, the whitepaper, the
 * build-in-public posts), and it would just as silently narrow if one were moved. What the
 * package promises to answer is a fixed set, so the set is written down.
 *
 * A missing source is fatal: `copyFileSync` throws ENOENT and this script exits non-zero,
 * failing the build. The alternative — skipping what is absent — ships a package whose
 * query exits 2 for one topic, and nothing on the consumer's side explains why.
 */

import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(packageRoot, '../..');

/** The §3-a bundle, as `docs/`-relative paths. English only — mirrors stay in the repository. */
const BUNDLED = [
  'installation.md',
  'configuration.md',
  'troubleshooting.md',
  'reference/polydeukes.md',
  'reference/core.md',
  'reference/covenant.md',
  'reference/adapter-claude-code.md',
  'reference/adapter-git.md',
];

// Cleared first so the output equals the list above by construction. Nothing else in the
// build removes anything from `dist`, and turbo restores the whole directory on a cache hit,
// so a member renamed or dropped from `BUNDLED` would otherwise leave its previous copy
// behind — and `pnpm pack` would ship a document this package no longer claims to carry.
rmSync(join(packageRoot, 'dist', 'docs'), { recursive: true, force: true });

for (const relative of BUNDLED) {
  const destination = join(packageRoot, 'dist', 'docs', relative);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(repoRoot, 'docs', relative), destination);
}
