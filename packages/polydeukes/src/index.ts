/**
 * Polydeukes — a development discipline framework for building alongside an AI
 * coding partner.
 *
 * Pre-alpha. This package reserves the unscoped `polydeukes` name and is the future
 * umbrella / `pdks` CLI entry point. Its first real export is the config discovery
 * loader (CONFIG-03): find the data config in a given root, parse it, delegate
 * validation to core `defineConfig()`, and attach the config file to its own
 * protection surface. The covenant, ledger, memory, and verify modules live in
 * their own `@polydeukes/*` packages.
 * See https://github.com/huskyhoochu/polydeukes
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig } from '@polydeukes/core';
import { ConfigValidationError, defineConfig } from '@polydeukes/core';
import { parseDocument } from 'yaml';

export type { ResolvedConfig } from '@polydeukes/core';
export { type CovenantCheckSpec, runCovenantCheck } from './covenant-check.js';

/** The three accepted config filenames, checked directly under the given rootDir. */
const CONFIG_FILENAMES = [
  'polydeukes.config.yaml',
  'polydeukes.config.yml',
  'polydeukes.config.json',
] as const;

/**
 * `LoadedConfig` — the loader's return value (PRD §4.1).
 */
export type LoadedConfig = {
  /** defineConfig() resolution — protectedPaths already includes configPath */
  config: ResolvedConfig;
  /** rootDir-relative path of the discovered config file */
  configPath: string;
};

/**
 * Discover, parse, and validate the Polydeukes data config in `rootDir` (PRD §4.1).
 *
 * Discovery looks at exactly the three candidate filenames directly under `rootDir`
 * (no upward walk). Every failure branch throws — silent defaults are forbidden:
 * zero files found (message names all three candidates), two or more found (message
 * names the collisions), a parse error or unresolved custom tag (safe core schema —
 * config data is never executable), or a `ConfigValidationError` from core
 * `defineConfig()` (re-thrown with file-path context, keeping the error type).
 *
 * Before returning, the discovered `configPath` is appended to
 * `config.protectedPaths` unless already present — the config file itself joins the
 * protection surface (schema rule 6), guaranteed here so no assembler has to remember.
 */
export function loadConfig(rootDir: string): LoadedConfig {
  const found = CONFIG_FILENAMES.filter((name) => existsSync(join(rootDir, name)));
  if (found.length === 0) {
    throw new Error(
      `no Polydeukes config found in ${rootDir} — expected one of: ${CONFIG_FILENAMES.join(', ')}`,
    );
  }
  if (found.length > 1) {
    throw new Error(
      `ambiguous Polydeukes config in ${rootDir} — found ${found.join(' and ')}; keep exactly one`,
    );
  }

  const configPath = found[0];
  const source = readFileSync(join(rootDir, configPath), 'utf-8');

  // Default core schema — custom tags stay unresolved and surface as errors or
  // warnings depending on version; both escalate to a throw (config-as-data:
  // uncomputable, so it cannot lie).
  const document = parseDocument(source);
  const problems = [...document.errors, ...document.warnings];
  if (problems.length > 0) {
    throw new Error(`failed to parse ${configPath}: ${problems[0].message}`);
  }
  const parsed: unknown = document.toJS();

  // Strip the IDE `$schema` reference before delegating — the loader owns no
  // structural validation beyond this key removal.
  let input = parsed;
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const { $schema: _schema, ...rest } = parsed as Record<string, unknown>;
    input = rest;
  }

  let config: ResolvedConfig;
  try {
    config = defineConfig(input);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw new ConfigValidationError(`invalid config in ${configPath}: ${error.message}`);
    }
    throw error;
  }

  // Self-protection attach (idempotent) — the discovered config file is part of
  // the protection surface.
  const protectedPaths = config.protectedPaths ?? [];
  if (!protectedPaths.includes(configPath)) {
    config = { ...config, protectedPaths: [...protectedPaths, configPath] };
  }

  return { config, configPath };
}
