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

/** Parse the flag grid; exit 2 on any misuse (dropped values shift the pair grid). */
function parseArgv(argv: string[]): {
  disciplineJson: string;
  rootDir: string;
  shellTools: string[];
  commandArgs: string[];
} {
  let disciplineJson: string | undefined;
  let rootDir: string | undefined;
  const shellTools: string[] = [];
  const commandArgs: string[] = [];

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    // A '--'-prefixed token in a value position means a dropped value shifted the pair
    // grid (a serialized entry always starts with '{', a root dir with a path character).
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
  }

  if (disciplineJson === undefined || rootDir === undefined || rootDir === '') {
    process.exit(EXIT_BREAK_BLOCKING);
  }
  return { disciplineJson, rootDir, shellTools, commandArgs };
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
  const predicateCount = [entry.forbid, entry.immutable, entry.forbidCommand].filter(
    (predicate) => predicate !== undefined,
  ).length;
  if (predicateCount !== 1 || typeof entry.id !== 'string' || entry.id === '') {
    process.exit(EXIT_BREAK_BLOCKING);
  }
  return entry;
}

const { disciplineJson, rootDir, shellTools, commandArgs } = parseArgv(process.argv.slice(2));
const entry = parseEntry(disciplineJson);

// A command-family entry with no shell surface would uphold everything — fail closed.
if (entry.forbidCommand !== undefined && (shellTools.length === 0 || commandArgs.length === 0)) {
  process.exit(EXIT_BREAK_BLOCKING);
}

const parsed = parseInput(readFileSync(0, 'utf-8'));
if (!parsed.ok) {
  process.exit(parsed.exitCode);
}

let verdict: CovenantVerdict;
try {
  verdict = judgeDiscipline(entry, parsed.value, { rootDir, shellTools, commandArgs });
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
