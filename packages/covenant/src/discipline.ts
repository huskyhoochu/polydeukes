/**
 * Discipline judgment layer + registration compiler (COVENANT-10 §4.5).
 *
 * `judgeDiscipline` decides one validated `DisciplineEntry` against a `CovenantInput`
 * across the three predicate families: delta (`forbid` — consumes the COVENANT-05
 * delta layer verbatim, zero reimplementation), path (`immutable`), and command
 * (`forbidCommand`). `compileDisciplineRegistrations` turns entries into dispatcher
 * registrations — one per entry, content-predicate routed (`matches`), body serialized
 * as CLI args. Glob matching is bought (picomatch, covenant-only dependency); absolute
 * paths are relativized against the repo root before matching (paths outside the root
 * never match — scope is a repo-relative declaration).
 */

import { isAbsolute, relative } from 'node:path';
import type { CovenantInput, CovenantVerdict, DisciplineEntry, FileChange } from '@polydeukes/core';
import picomatch from 'picomatch';
import { judgeAddedViolations } from './delta.js';
import type { CovenantRegistration } from './dispatch.js';

/**
 * `DisciplineJudgeOptions` — assembly values the judge needs beside the entry.
 *
 * `shellTools`/`commandArgs` name the shell surface (injected values, shell-mod
 * precedent — never core vocabulary); `rootDir` anchors glob relativization.
 */
export type DisciplineJudgeOptions = {
  rootDir: string;
  shellTools: string[];
  commandArgs: string[];
};

/**
 * `CompileDisciplinesSpec` — validated entries plus the assembly values baked into
 * each registration's body args and matches closure (COVENANT-10 §4.5).
 */
export type CompileDisciplinesSpec = {
  disciplines: DisciplineEntry[];
  rootDir: string;
  bodyCommand: string;
  bodyModulePath: string;
  shellTools: string[];
  commandArgs: string[];
  escapeHatch?: CovenantRegistration['escapeHatch'];
};

/** Normalize an optional glob field to an array (absent = empty). */
function toGlobs(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

/**
 * Relativize a file-change path against the root for glob matching (PRD §4.5).
 * A relative path passes through; an absolute path outside `rootDir` yields null
 * (never matches — discipline scope is declared repo-relative).
 */
function relativizeForScope(filePath: string, rootDir: string): string | null {
  if (!isAbsolute(filePath)) return filePath;
  const relativized = relative(rootDir, filePath);
  if (relativized.startsWith('..') || isAbsolute(relativized)) return null;
  return relativized;
}

/** In-scope file changes for the forbid family: `in` absent = all, `except` subtracts. */
function forbidScope(
  entry: DisciplineEntry,
  fileChanges: FileChange[],
  rootDir: string,
): { path: string; change: FileChange }[] {
  const inGlobs = toGlobs(entry.in);
  const isIn = inGlobs.length === 0 ? () => true : picomatch(inGlobs, { dot: true });
  const exceptGlobs = toGlobs(entry.except);
  const isExcept = exceptGlobs.length === 0 ? () => false : picomatch(exceptGlobs, { dot: true });

  const targets: { path: string; change: FileChange }[] = [];
  for (const change of fileChanges) {
    const scoped = relativizeForScope(change.path, rootDir);
    if (scoped === null || !isIn(scoped) || isExcept(scoped)) continue;
    targets.push({ path: scoped, change });
  }
  return targets;
}

/** File changes matching the immutable glob(s), with their relativized paths. */
function immutableScope(
  entry: DisciplineEntry,
  fileChanges: FileChange[],
  rootDir: string,
): { path: string; change: FileChange }[] {
  const matcher = picomatch(toGlobs(entry.immutable), { dot: true });
  const targets: { path: string; change: FileChange }[] = [];
  for (const change of fileChanges) {
    const scoped = relativizeForScope(change.path, rootDir);
    if (scoped === null || !matcher(scoped)) continue;
    targets.push({ path: scoped, change });
  }
  return targets;
}

/** The forbid pattern source — string shorthand is equivalent to `{ added }`. */
function forbidPatternSource(forbid: NonNullable<DisciplineEntry['forbid']>): string {
  return typeof forbid === 'string' ? forbid : forbid.added;
}

/** Shell command strings of the input: values of the named args on shell-tool calls. */
function shellCommands(input: CovenantInput, opts: DisciplineJudgeOptions): string[] {
  const commands: string[] = [];
  for (const call of input.toolCalls) {
    if (!opts.shellTools.includes(call.name)) continue;
    for (const argName of opts.commandArgs) {
      const value = call.args?.[argName];
      if (typeof value === 'string') commands.push(value);
    }
  }
  return commands;
}

/**
 * Judge one discipline entry against a covenant input (pure, COVENANT-10 §4.5).
 *
 * Delta family: in-scope file changes judged via {@link judgeAddedViolations} — the
 * reason names the discipline id and the added match text. Path family: a matching
 * change with `pre !== null` breaks (creation upholds). Command family: a shell-tool
 * command matching the pattern breaks. No file changes / no targets uphold (defensive
 * re-check of what routing would not have matched).
 */
export function judgeDiscipline(
  entry: DisciplineEntry,
  input: CovenantInput,
  opts: DisciplineJudgeOptions,
): CovenantVerdict {
  const fileChanges = input.fileChanges ?? [];

  if (entry.forbid !== undefined) {
    const pattern = new RegExp(forbidPatternSource(entry.forbid));
    for (const target of forbidScope(entry, fileChanges, opts.rootDir)) {
      const verdict = judgeAddedViolations(
        { pre: target.change.pre, post: target.change.post },
        pattern,
      );
      if (verdict.upheld === false) {
        return {
          upheld: false,
          reason: `discipline '${entry.id}' broken on ${target.path}: ${verdict.reason}`,
        };
      }
    }
    return { upheld: true };
  }

  if (entry.immutable !== undefined) {
    for (const target of immutableScope(entry, fileChanges, opts.rootDir)) {
      if (target.change.pre !== null) {
        return {
          upheld: false,
          reason: `discipline '${entry.id}' broken: immutable file ${target.path} modified`,
        };
      }
    }
    return { upheld: true };
  }

  if (entry.forbidCommand !== undefined) {
    const pattern = new RegExp(entry.forbidCommand);
    for (const command of shellCommands(input, opts)) {
      if (pattern.test(command)) {
        return {
          upheld: false,
          reason: `discipline '${entry.id}' broken: command matches forbidden pattern`,
        };
      }
    }
    return { upheld: true };
  }

  // Entries reach here only unvalidated; validated data always carries one predicate.
  return { upheld: true };
}

/** Build the family-specific routing predicate for one entry (PRD §4.4). */
function buildMatches(
  entry: DisciplineEntry,
  spec: CompileDisciplinesSpec,
): (input: CovenantInput) => string | null {
  const opts: DisciplineJudgeOptions = {
    rootDir: spec.rootDir,
    shellTools: spec.shellTools,
    commandArgs: spec.commandArgs,
  };
  if (entry.forbidCommand !== undefined) {
    const pattern = new RegExp(entry.forbidCommand);
    return (input) => (shellCommands(input, opts).some((c) => pattern.test(c)) ? '-' : null);
  }
  if (entry.immutable !== undefined) {
    return (input) => immutableScope(entry, input.fileChanges ?? [], spec.rootDir)[0]?.path ?? null;
  }
  return (input) => forbidScope(entry, input.fileChanges ?? [], spec.rootDir)[0]?.path ?? null;
}

/**
 * Compile validated discipline entries into dispatcher registrations (COVENANT-10 §4.5).
 *
 * One registration per entry: `label` = id (per-discipline telemetry), `protectedPaths`
 * = [] (routing is the matches closure, not path mention), `body` = the generic body
 * CLI with the serialized entry and assembly values as args. Structurally broken
 * entries (non-compilable regex) throw here — fail-fast assembly, never a registration
 * whose body would crash at judge time.
 */
export function compileDisciplineRegistrations(
  spec: CompileDisciplinesSpec,
): CovenantRegistration[] {
  return spec.disciplines.map((entry) => {
    // Fail-fast compilability probe — throws on a broken pattern.
    if (entry.forbid !== undefined) new RegExp(forbidPatternSource(entry.forbid));
    if (entry.forbidCommand !== undefined) new RegExp(entry.forbidCommand);

    return {
      label: entry.id,
      protectedPaths: [],
      body: {
        command: spec.bodyCommand,
        args: [
          spec.bodyModulePath,
          '--discipline',
          JSON.stringify(entry),
          '--root-dir',
          spec.rootDir,
          ...spec.shellTools.flatMap((tool) => ['--shell-tool', tool]),
          ...spec.commandArgs.flatMap((arg) => ['--command-arg', arg]),
        ],
      },
      matches: buildMatches(entry, spec),
      ...(spec.escapeHatch !== undefined && { escapeHatch: spec.escapeHatch }),
    };
  });
}
