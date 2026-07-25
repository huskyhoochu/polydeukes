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
import {
  allFileChanges,
  type CanonicalTranscript,
  type CovenantInput,
  type CovenantVerdict,
  type DisciplineEntry,
  type FileChange,
  noopTranscript,
} from '@polydeukes/core';
import picomatch from 'picomatch';
import { judgeAddedViolations } from './delta.js';
import type { CovenantRegistration } from './dispatch.js';

/**
 * `DisciplineJudgeOptions` — assembly values the judge needs beside the entry.
 *
 * `shellTools`/`commandArgs` name the shell surface (injected values, shell-mod
 * precedent — never core vocabulary); `rootDir` anchors glob relativization.
 * `precedentFound` is the context family's evidence verdict, evaluated at assembly
 * time and transported to the body as an argv flag (COVENANT-13 §4.4).
 */
export type DisciplineJudgeOptions = {
  rootDir: string;
  shellTools: string[];
  commandArgs: string[];
  precedentFound?: boolean;
};

/**
 * `CompileDisciplinesSpec` — validated entries plus the assembly values baked into
 * each registration's body args and matches closure (COVENANT-10 §4.5).
 *
 * `transcript` is the session history the context family's evidence is evaluated
 * against at assembly time (absent = no evidence); `evaluatePrecedent` is the seam an
 * adapter fills for its own evidence vocabulary — `undefined` from it means the key is
 * unrecognized and assembly halts (COVENANT-13 §4.4).
 */
export type CompileDisciplinesSpec = {
  disciplines: DisciplineEntry[];
  rootDir: string;
  bodyCommand: string;
  bodyModulePath: string;
  shellTools: string[];
  commandArgs: string[];
  escapeHatch?: CovenantRegistration['escapeHatch'];
  transcript?: CanonicalTranscript;
  evaluatePrecedent?: (
    evidence: Record<string, unknown>,
    transcript: CanonicalTranscript,
  ) => boolean | undefined;
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

/**
 * Added-direction verdict for one change, exhaustive over the CORE-06 evidence union.
 * One definition shared by the delta family's judge and the context family's trigger,
 * so the two can never disagree on what a change kind means. A deletion upholds —
 * it adds no content, so the added direction has no violation to find.
 */
function judgeAddedForChange(change: FileChange, pattern: RegExp): CovenantVerdict {
  switch (change.kind) {
    case 'create':
      return judgeAddedViolations({ pre: null, post: change.post }, pattern);
    case 'modify':
      return judgeAddedViolations({ pre: change.pre, post: change.post }, pattern);
    case 'delete':
      return { upheld: true };
    default: {
      // Compiler-enforced exhaustiveness stays (the never assignment breaks the build
      // if a variant goes unhandled); at runtime an unrecognized kind is unjudgeable —
      // throw a legible reason and let the judged body fail closed (exit 2).
      const unhandled: never = change;
      throw new Error(
        `unjudgeable evidence kind ${JSON.stringify(unhandled)} — a stale adapter dist? rebuild with pnpm build`,
      );
    }
  }
}

/** The one shell-surface filter: named args of shell-tool calls, whatever the source. */
function filterShellCommands(
  calls: readonly { name: string; args?: Record<string, unknown> }[],
  shellTools: string[],
  commandArgs: string[],
): string[] {
  const commands: string[] = [];
  for (const call of calls) {
    if (!shellTools.includes(call.name)) continue;
    for (const argName of commandArgs) {
      const value = call.args?.[argName];
      if (typeof value === 'string') commands.push(value);
    }
  }
  return commands;
}

/** Shell command strings of the input: values of the named args on shell-tool calls. */
function shellCommands(input: CovenantInput, opts: DisciplineJudgeOptions): string[] {
  return filterShellCommands(input.toolCalls, opts.shellTools, opts.commandArgs);
}

/**
 * The relativized path of the first change triggering a context entry, or null
 * (COVENANT-13 §4.4). One trigger definition, shared by the judge and by routing.
 *
 * With `when`, the trigger is the added direction of the delta layer verbatim, so a
 * `delete` never triggers (deletion adds no content). Without `when`, every in-scope
 * mutation triggers — deletion included, since erasing a covered file without precedent
 * is exactly what such an entry demands evidence for.
 */
function precedentTrigger(
  entry: DisciplineEntry,
  input: CovenantInput,
  rootDir: string,
): string | null {
  const pattern = entry.when === undefined ? null : new RegExp(entry.when);
  for (const target of forbidScope(entry, allFileChanges(input), rootDir)) {
    if (pattern === null) return target.path;
    if (judgeAddedForChange(target.change, pattern).upheld === false) return target.path;
  }
  return null;
}

/** Describe the evidence an entry requires, for the break reason. */
function describePrecedent(requirePrecedent: Record<string, unknown>): string {
  return Object.entries(requirePrecedent)
    .map(([key, value]) => `${key} ${JSON.stringify(value)}`)
    .join(', ');
}

/**
 * Judge one discipline entry against a covenant input (pure, COVENANT-10 §4.5).
 *
 * Delta family: in-scope file changes judged via {@link judgeAddedViolations} — the
 * reason names the discipline id and the added match text, and a deletion short-circuits
 * to uphold (CORE-06 §4.3: deletion adds no content). Path family: a matching change of
 * any kind but `create` breaks (an immutable file can be neither modified nor deleted;
 * first authoring upholds). Command family: a shell-tool command matching the pattern
 * breaks. No file changes / no targets uphold (defensive re-check of what routing would
 * not have matched).
 */
export function judgeDiscipline(
  entry: DisciplineEntry,
  input: CovenantInput,
  opts: DisciplineJudgeOptions,
): CovenantVerdict {
  const fileChanges = allFileChanges(input);

  if (entry.forbid !== undefined) {
    const pattern = new RegExp(forbidPatternSource(entry.forbid));
    for (const target of forbidScope(entry, fileChanges, opts.rootDir)) {
      const verdict = judgeAddedForChange(target.change, pattern);
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
      if (target.change.kind !== 'create') {
        return {
          upheld: false,
          reason: `discipline '${entry.id}' broken: immutable file ${target.path} mutated`,
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

  if (entry.requirePrecedent !== undefined) {
    const triggered = precedentTrigger(entry, input, opts.rootDir);
    // Absent evidence is missing evidence: only an explicit true opens the gate.
    if (triggered !== null && opts.precedentFound !== true) {
      return {
        upheld: false,
        reason: `discipline '${entry.id}' broken on ${triggered}: requires prior session evidence (${describePrecedent(entry.requirePrecedent)})`,
      };
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
    return (input) => immutableScope(entry, allFileChanges(input), spec.rootDir)[0]?.path ?? null;
  }
  if (entry.requirePrecedent !== undefined) {
    // Routing is evidence-blind: a trigger with evidence still spawns the body and
    // records `passed` — "the gate checked, and the evidence was there" is the context
    // family's measurement value, not spawn waste (COVENANT-13 §4.4).
    return (input) => precedentTrigger(entry, input, spec.rootDir);
  }
  // Deletions can never break the added direction, so they must not route a body spawn
  // (COVENANT-10: routing adds no spawn waste); the judge still short-circuits them
  // defensively when a mixed input arrives.
  return (input) =>
    forbidScope(entry, allFileChanges(input), spec.rootDir).find(
      (target) => target.change.kind !== 'delete',
    )?.path ?? null;
}

/**
 * Evaluate a context entry's evidence against the session at assembly time
 * (COVENANT-13 §4.4) — the body is a spawned CLI and cannot hold a transcript.
 *
 * Vocabulary is layered: `command` is the core's own, evaluated here against the shell
 * surface with the same filter the command family judges by; every other key is adapter
 * vocabulary delegated to the injected seam. An unrecognized key (`undefined` from the
 * seam) or a missing seam halts assembly rather than guessing a direction.
 */
function evaluateEvidence(entry: DisciplineEntry, spec: CompileDisciplinesSpec): boolean {
  const evidence = entry.requirePrecedent as Record<string, unknown>;
  const command = evidence.command;

  if (typeof command === 'string') {
    // Fail-fast compilability probe — throws on a broken pattern, like the other families.
    const pattern = new RegExp(command);
    if (spec.transcript === undefined) return false;
    // A transcript with no shell surface can never satisfy command evidence: that is a
    // misassembly, and guessing "missing" would turn the entry into a silent universal
    // block with no legitimate pass path (the command family's body gate, moved up here).
    if (spec.shellTools.length === 0 || spec.commandArgs.length === 0) {
      throw new Error(
        `discipline '${entry.id}': command evidence needs a shell surface (shellTools/commandArgs)`,
      );
    }
    const calls = spec.transcript.findToolCalls();
    return filterShellCommands(calls, spec.shellTools, spec.commandArgs).some((c) =>
      pattern.test(c),
    );
  }

  if (spec.evaluatePrecedent === undefined) {
    throw new Error(
      `discipline '${entry.id}': no precedent evaluator injected for evidence ${JSON.stringify(evidence)}`,
    );
  }
  const answer = spec.evaluatePrecedent(evidence, spec.transcript ?? noopTranscript);
  if (answer === undefined) {
    throw new Error(
      `discipline '${entry.id}': unrecognized precedent evidence ${JSON.stringify(evidence)}`,
    );
  }
  return answer;
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
    if (entry.when !== undefined) new RegExp(entry.when);
    const precedentCommand = entry.requirePrecedent?.command;
    if (typeof precedentCommand === 'string') new RegExp(precedentCommand);

    // Context family only: the other three would hit the body's misassembly gate.
    const precedentFlag =
      entry.requirePrecedent === undefined
        ? []
        : [evaluateEvidence(entry, spec) ? '--precedent-found' : '--precedent-missing'];

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
          ...precedentFlag,
        ],
      },
      matches: buildMatches(entry, spec),
      ...(spec.escapeHatch !== undefined && { escapeHatch: spec.escapeHatch }),
    };
  });
}
