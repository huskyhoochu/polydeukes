/**
 * Generic discipline CLI body (COVENANT-10, PRD §4.5).
 *
 * The I/O shell around the pure {@link judgeDiscipline}: parse argv (`--discipline`
 * with the serialized entry, `--root-dir`, repeatable `--shell-tool` / `--command-arg`),
 * read stdin, run the core `parseInput`, judge, and exit. Config fail-closed — an
 * unknown flag, a flag missing its value, a malformed entry, or a shell surface a
 * command-family entry needs but did not receive exits 2, so a misassembled discipline
 * never silently degrades into universal-uphold (self-mod body precedent).
 */

import { readFileSync } from 'node:fs';
import {
  type CovenantVerdict,
  type DisciplineEntry,
  EXIT_BREAK_BLOCKING,
  failModeToExitCode,
  parseInput,
  resolveFailMode,
  verdictToExitCode,
} from '@polydeukes/core';
import { judgeDiscipline } from './discipline.js';

/**
 * Parse argv; exit 2 on any misuse (an unknown flag, or a dropped value).
 *
 * Valued flags consume the next token, boolean ones consume nothing, so the walk steps
 * one token at a time rather than assuming a fixed pair grid. A '--'-prefixed token in
 * a value position still means a dropped value (a serialized entry always starts with
 * '{', a root dir with a path character).
 */
function parseArgv(argv: string[]): {
  disciplineJson: string;
  rootDir: string;
  shellTools: string[];
  commandArgs: string[];
  precedentFound: boolean | undefined;
} {
  let disciplineJson: string | undefined;
  let rootDir: string | undefined;
  const shellTools: string[] = [];
  const commandArgs: string[] = [];
  let sawFound = false;
  let sawMissing = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--precedent-found') {
      sawFound = true;
      continue;
    }
    if (flag === '--precedent-missing') {
      sawMissing = true;
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      process.exit(EXIT_BREAK_BLOCKING);
    }
    if (flag === '--discipline' && disciplineJson === undefined) {
      disciplineJson = value;
    } else if (flag === '--root-dir' && rootDir === undefined) {
      rootDir = value;
    } else if (flag === '--shell-tool') {
      shellTools.push(value);
    } else if (flag === '--command-arg') {
      commandArgs.push(value);
    } else {
      process.exit(EXIT_BREAK_BLOCKING);
    }
    i += 1;
  }

  if (disciplineJson === undefined || rootDir === undefined || rootDir === '') {
    process.exit(EXIT_BREAK_BLOCKING);
  }
  // Contradictory evidence verdicts are unjudgeable — never silently pick one direction.
  if (sawFound && sawMissing) {
    process.exit(EXIT_BREAK_BLOCKING);
  }
  const precedentFound = sawFound ? true : sawMissing ? false : undefined;
  return { disciplineJson, rootDir, shellTools, commandArgs, precedentFound };
}

/**
 * Deserialize and structurally re-check the entry (a misassembly gate, not schema
 * re-validation — `defineConfig` owns that): a plain object carrying exactly one
 * predicate key. Anything else is a broken assembly, never a judgeable discipline.
 */
function parseEntry(json: string): DisciplineEntry {
  let candidate: unknown;
  try {
    candidate = JSON.parse(json);
  } catch {
    process.exit(EXIT_BREAK_BLOCKING);
  }
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    process.exit(EXIT_BREAK_BLOCKING);
  }
  const entry = candidate as DisciplineEntry;
  const predicateCount = [
    entry.forbid,
    entry.immutable,
    entry.forbidCommand,
    entry.requirePrecedent,
  ].filter((predicate) => predicate !== undefined).length;
  if (predicateCount !== 1 || typeof entry.id !== 'string' || entry.id === '') {
    process.exit(EXIT_BREAK_BLOCKING);
  }
  return entry;
}

const { disciplineJson, rootDir, shellTools, commandArgs, precedentFound } = parseArgv(
  process.argv.slice(2),
);
const entry = parseEntry(disciplineJson);

// A command-family entry with no shell surface would uphold everything — fail closed.
if (entry.forbidCommand !== undefined && (shellTools.length === 0 || commandArgs.length === 0)) {
  process.exit(EXIT_BREAK_BLOCKING);
}

// A context-family entry without its evidence verdict is unjudgeable — the assembly,
// not the input, is broken, so this is the misassembly exit and never a judged break.
if (entry.requirePrecedent !== undefined && precedentFound === undefined) {
  process.exit(EXIT_BREAK_BLOCKING);
}

const parsed = parseInput(readFileSync(0, 'utf-8'));
if (!parsed.ok) {
  process.exit(parsed.exitCode);
}

let verdict: CovenantVerdict;
try {
  verdict = judgeDiscipline(entry, parsed.value, {
    rootDir,
    shellTools,
    commandArgs,
    precedentFound,
  });
} catch {
  // A structurally unjudgeable input or a broken pattern that slipped past assembly:
  // cannot judge means block (CORE-03 policy table), never a crash exit code.
  process.exit(failModeToExitCode(resolveFailMode('undecidable-structure')));
}
if (!verdict.upheld) {
  process.stderr.write(`${verdict.reason}\n`);
}
// Assign exitCode and let the process end naturally instead of process.exit(): an
// explicit exit can preempt the buffered stderr write on platforms with async pipes,
// dropping the break reason.
process.exitCode = verdictToExitCode(verdict);
