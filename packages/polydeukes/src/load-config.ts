/**
 * Config discovery and loading — the one place allowed to read and parse the data config
 * file, so the core stays file-I/O-free.
 *
 * This lives in its own module rather than in the package barrel because ESM re-exports are
 * eager: importing `loadConfig` from the barrel would instantiate both composition roots,
 * putting the session adapter on the change-set surface's load path where it is never used. A
 * workspace missing only that dist would then kill `pdks covenant check` before its
 * fail-closed handler could record a row. Both composition roots import this module directly
 * for the same reason.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig } from '@polydeukes/core';
import { ConfigValidationError, defineConfig, isPlainObject } from '@polydeukes/core';
import { parseDocument } from 'yaml';
import { compileDeclaration } from './covenant/declaration-engine.ts';

/**
 * The three accepted config filenames, checked directly under the given rootDir. Exported
 * for the scaffold: its existence check has to see exactly what discovery sees, or it would
 * create a second spelling and make every later load ambiguous.
 */
export const CONFIG_FILENAMES = [
  'polydeukes.config.yaml',
  'polydeukes.config.yml',
  'polydeukes.config.json',
] as const;

/** {@link loadConfig} input — the directory the config is discovered in. */
export type LoadConfigSpec = { rootDir: string };

/** {@link discoverConfigPath} input — the directory the candidates are looked for in. */
export type DiscoverConfigPathSpec = { rootDir: string };

/** {@link parseConfigSource} input — the config text and the path it was discovered at. */
export type ParseConfigSourceSpec = {
  /** The config file's whole text. */
  source: string;
  /** rootDir-relative path the source came from — the self-protection entry and error context. */
  configPath: string;
};

/** `LoadedConfig` — the loader's return value. */
export type LoadedConfig = {
  /** defineConfig() resolution — protectedPaths already includes configPath */
  config: ResolvedConfig;
  /** rootDir-relative path of the discovered config file */
  configPath: string;
};

/**
 * Discover, parse, and validate the Polydeukes data config in `rootDir`.
 *
 * Discovery looks at exactly the three candidate filenames directly under `rootDir`
 * (no upward walk). Every failure branch throws — silent defaults are forbidden:
 * zero files found (message names all three candidates), two or more found (message
 * names the collisions), a parse error or unresolved custom tag (safe core schema —
 * config data is never executable; every problem the parser found is enumerated in the
 * one message), a `ConfigValidationError` from core `defineConfig()` (re-thrown with
 * file-path context, keeping the error type), or a `ConfigValidationError` naming every
 * declaration the judge cannot compile.
 *
 * Before returning, the discovered `configPath` is appended to
 * `config.protectedPaths` unless already present — the config file itself joins the
 * protection surface, guaranteed here so no assembler has to remember.
 */
export function loadConfig(spec: LoadConfigSpec): LoadedConfig {
  const configPath = discoverConfigPath({ rootDir: spec.rootDir });
  const source = readFileSync(join(spec.rootDir, configPath), 'utf-8');
  return parseConfigSource({ source, configPath });
}

/**
 * The discovery half: the rootDir-relative filename of the one candidate present, or the
 * throw that names the zero or the collision. Exported so a caller that has to know WHICH
 * file failed to load — the runner's config-repair branch — asks the same question the
 * loader does rather than a second spelling of it.
 */
export function discoverConfigPath(spec: DiscoverConfigPathSpec): string {
  const { rootDir } = spec;
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
  return found[0];
}

/**
 * The parse-and-validate half, over a text rather than a file: parse, `$schema` strip,
 * `defineConfig`, declaration compile, self-protection attach. Exported so the runner can ask
 * whether a text a call is about to write would load, without opening any file.
 */
export function parseConfigSource(spec: ParseConfigSourceSpec): LoadedConfig {
  const { source, configPath } = spec;

  // Default core schema — custom tags stay unresolved and surface as errors or
  // warnings depending on version; both escalate to a throw (config-as-data:
  // uncomputable, so it cannot lie).
  const document = parseDocument(source);
  const problems = [...document.errors, ...document.warnings];
  if (problems.length > 0) {
    // Every problem in one message: reporting only the first costs one fix-rerun loop
    // per hidden problem. Each parser message already carries its own position; a lone
    // problem keeps the direct message shape.
    throw new Error(
      `failed to parse ${configPath}: ${listProblems(problems.map((problem) => problem.message))}`,
    );
  }
  const parsed: unknown = document.toJS();

  // Strip the IDE `$schema` reference before delegating — the loader owns no
  // structural validation beyond this key removal.
  let input = parsed;
  if (isPlainObject(parsed)) {
    const { $schema: _schema, ...rest } = parsed;
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

  // Core validates a declaration's grammar only; the step vocabulary and the paired/single
  // discipline are the compiler's. An entry it cannot compile would judge nothing, so the
  // config does not load, every faulted entry named in the one message.
  const faults = [
    ...(config.disciplines ?? []),
    ...(config.sessionDisciplines ?? []),
    ...(config.changeSetDisciplines ?? []),
  ].flatMap((entry) => {
    const compiled = compileDeclaration({
      declaration: { discipline: entry.id, ...entry.declare },
    });
    return 'kind' in compiled ? [`${compiled.location}: ${compiled.reason}`] : [];
  });
  if (faults.length > 0) {
    throw new ConfigValidationError(`invalid config in ${configPath}: ${listProblems(faults)}`);
  }

  // Self-protection attach (idempotent) — the discovered config file is part of
  // the protection surface.
  const protectedPaths = config.protectedPaths ?? [];
  if (!protectedPaths.includes(configPath)) {
    config = { ...config, protectedPaths: [...protectedPaths, configPath] };
  }

  return { config, configPath };
}

/**
 * One problem as its own text; several as a count and one indented line each, so every hidden
 * problem is reported by the same run.
 */
function listProblems(problems: readonly string[]): string {
  return problems.length === 1
    ? problems[0]
    : `${problems.length} problems\n${problems.map((problem) => `  - ${problem}`).join('\n')}`;
}
