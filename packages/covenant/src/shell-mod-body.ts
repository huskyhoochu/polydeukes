/**
 * shell-mod meta-covenant CLI body (COVENANT-04d, PRD §4.4).
 *
 * The I/O shell around the pure {@link judgeShellModification}: parse argv (repeatable
 * `--protected-path` / `--shell-tool` / `--command-arg` pairs plus the optional
 * `--allow-read`), read stdin, run the core `parseInput`, judge, and exit. Config
 * fail-closed — an unknown flag, a flag missing its value, or zero valid (non-empty)
 * entries in any of the three required lists exits 2. `--allow-read` is exempt: zero
 * flags fall back to {@link DEFAULT_READ_ONLY_COMMANDS}, one or more REPLACE it.
 */

import { readFileSync } from 'node:fs';
import {
  type CovenantVerdict,
  EXIT_BREAK_BLOCKING,
  parseInput,
  verdictToExitCode,
} from '@polydeukes/core';
import { DEFAULT_READ_ONLY_COMMANDS, judgeShellModification } from './shell-mod.js';

type ParsedArgv = {
  protectedPaths: string[];
  shellToolNames: string[];
  commandArgNames: string[];
  allowRead: string[];
};

/** Parse the repeatable flag pairs; exit 2 on any misuse. */
function parseArgv(argv: string[]): ParsedArgv {
  const protectedPaths: string[] = [];
  const shellToolNames: string[] = [];
  const commandArgNames: string[] = [];
  const allowRead: string[] = [];

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    // A '--'-prefixed token in a value position means a dropped value shifted the pair
    // grid — accepting it would judge flag tokens as paths/tools/args and silently
    // degrade into universal uphold, so it fails closed like a missing value.
    if (value === undefined || value.startsWith('--')) {
      process.exit(EXIT_BREAK_BLOCKING);
    }
    if (flag === '--protected-path') {
      protectedPaths.push(value);
    } else if (flag === '--shell-tool') {
      shellToolNames.push(value);
    } else if (flag === '--command-arg') {
      commandArgNames.push(value);
    } else if (flag === '--allow-read') {
      allowRead.push(value);
    } else {
      process.exit(EXIT_BREAK_BLOCKING);
    }
  }

  return { protectedPaths, shellToolNames, commandArgNames, allowRead };
}

const { protectedPaths, shellToolNames, commandArgNames, allowRead } = parseArgv(
  process.argv.slice(2),
);

// Config fail-closed: zero valid entries in any required list must not become
// universal-uphold. The allowlist is exempt — empty just means stricter (§4.3).
if (
  protectedPaths.filter((p) => p !== '').length === 0 ||
  shellToolNames.filter((t) => t !== '').length === 0 ||
  commandArgNames.filter((a) => a !== '').length === 0
) {
  process.exit(EXIT_BREAK_BLOCKING);
}

// Zero --allow-read flags → the default allowlist; one or more → full replacement
// (no merge — an assembly wanting to extend the default spreads the constant).
const readOnlyCommands = allowRead.length === 0 ? DEFAULT_READ_ONLY_COMMANDS : allowRead;

const parsed = parseInput(readFileSync(0, 'utf-8'));
if (!parsed.ok) {
  process.exit(parsed.exitCode);
}

let verdict: CovenantVerdict;
try {
  verdict = judgeShellModification(parsed.value, {
    protectedPaths,
    shellToolNames,
    commandArgNames,
    readOnlyCommands,
  });
} catch {
  // Structurally unjudgeable input that passed parseInput (element shapes are an
  // intended CORE-01 boundary — same class dispatch.ts catches around its matching):
  // cannot judge means block, never a crash exit code.
  process.exit(EXIT_BREAK_BLOCKING);
}
if (!verdict.upheld) {
  process.stderr.write(`${verdict.reason}\n`);
}
// Assign exitCode and let the process end naturally instead of process.exit(): an
// explicit exit can preempt the buffered stderr write on platforms with async pipes,
// dropping the break reason.
process.exitCode = verdictToExitCode(verdict);
