/**
 * self-mod meta-covenant CLI body (COVENANT-03, PRD §4.2).
 *
 * The I/O shell around the pure {@link judgeSelfModification}: parse argv (repeatable
 * `--protected-path` / `--mutating-tool` pairs), read stdin, run the core `parseInput`,
 * judge, and exit. Config fail-closed — an unknown flag, a flag missing its value, or zero
 * valid (non-empty) entries in either list exits 2, so a misassembled meta-covenant never
 * silently degrades into universal-uphold.
 */

import { readFileSync } from 'node:fs';
import { EXIT_BREAK_BLOCKING, parseInput, verdictToExitCode } from '@polydeukes/core';
import { judgeSelfModification } from './self-mod.js';

/** Parse repeatable `--protected-path` / `--mutating-tool` pairs; exit 2 on any misuse. */
function parseArgv(argv: string[]): { protectedPaths: string[]; mutatingToolNames: string[] } {
  const protectedPaths: string[] = [];
  const mutatingToolNames: string[] = [];

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      process.exit(EXIT_BREAK_BLOCKING);
    }
    if (flag === '--protected-path') {
      protectedPaths.push(value);
    } else if (flag === '--mutating-tool') {
      mutatingToolNames.push(value);
    } else {
      process.exit(EXIT_BREAK_BLOCKING);
    }
  }

  return { protectedPaths, mutatingToolNames };
}

const { protectedPaths, mutatingToolNames } = parseArgv(process.argv.slice(2));

// Config fail-closed: zero valid entries in either list must not become universal-uphold.
if (
  protectedPaths.filter((p) => p !== '').length === 0 ||
  mutatingToolNames.filter((t) => t !== '').length === 0
) {
  process.exit(EXIT_BREAK_BLOCKING);
}

const parsed = parseInput(readFileSync(0, 'utf-8'));
if (!parsed.ok) {
  process.exit(parsed.exitCode);
}

const verdict = judgeSelfModification(parsed.value, { protectedPaths, mutatingToolNames });
if (!verdict.upheld) {
  process.stderr.write(`${verdict.reason}\n`);
}
process.exit(verdictToExitCode(verdict));
