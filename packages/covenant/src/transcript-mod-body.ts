/**
 * transcript-mod covenant CLI body (COVENANT-07c, PRD §2).
 *
 * The I/O shell around the pure {@link judgeTranscriptModification}: parse argv (one
 * `--transcript-path`, an optional `--home`, repeatable `--shell-tool` / `--command-arg` /
 * `--mutating-tool`), read stdin, run the core `parseInput`, judge, and exit. Config
 * fail-closed — an unknown flag, a flag missing its value, a repeated single-valued flag, or
 * zero valid (non-empty) entries in any required list exits 2, so a misassembled judge never
 * degrades into universal uphold. The read-only allowlist is not injectable here: reading a
 * session must never need a waiver, so it is always {@link DEFAULT_READ_ONLY_COMMANDS}.
 */

import { readFileSync } from 'node:fs';
import {
  type CovenantVerdict,
  EXIT_BREAK_BLOCKING,
  parseInput,
  verdictToExitCode,
} from '@polydeukes/core';
import { DEFAULT_READ_ONLY_COMMANDS } from './shell-mod.js';
import { judgeTranscriptModification } from './transcript-mod.js';

type ParsedArgv = {
  transcriptPath: string;
  home: string | undefined;
  shellToolNames: string[];
  commandArgNames: string[];
  mutatingToolNames: string[];
};

/** Parse the flag pairs; exit 2 on any misuse. */
function parseArgv(argv: string[]): ParsedArgv {
  let transcriptPath: string | undefined;
  let home: string | undefined;
  const shellToolNames: string[] = [];
  const commandArgNames: string[] = [];
  const mutatingToolNames: string[] = [];

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    // A '--'-prefixed token in a value position means a dropped value shifted the pair
    // grid — accepting it would judge flag tokens as paths/tools/args and silently degrade
    // into universal uphold, so it fails closed like a missing value.
    if (value === undefined || value.startsWith('--')) {
      process.exit(EXIT_BREAK_BLOCKING);
    }
    // The single-valued flags fall through to the else on a repeat: two transcripts (or two
    // homes) is a misassembly, never a judge that silently picks one.
    if (flag === '--transcript-path' && transcriptPath === undefined) {
      transcriptPath = value;
    } else if (flag === '--home' && home === undefined) {
      home = value;
    } else if (flag === '--shell-tool') {
      shellToolNames.push(value);
    } else if (flag === '--command-arg') {
      commandArgNames.push(value);
    } else if (flag === '--mutating-tool') {
      mutatingToolNames.push(value);
    } else {
      process.exit(EXIT_BREAK_BLOCKING);
    }
  }

  // No file to protect is not universal uphold — a body with nothing to judge is broken.
  if (transcriptPath === undefined || transcriptPath === '') {
    process.exit(EXIT_BREAK_BLOCKING);
  }
  return { transcriptPath, home, shellToolNames, commandArgNames, mutatingToolNames };
}

const { transcriptPath, home, shellToolNames, commandArgNames, mutatingToolNames } = parseArgv(
  process.argv.slice(2),
);

// Config fail-closed: zero valid entries in any surface list would leave that axis unjudged.
if (
  shellToolNames.filter((t) => t !== '').length === 0 ||
  commandArgNames.filter((a) => a !== '').length === 0 ||
  mutatingToolNames.filter((m) => m !== '').length === 0
) {
  process.exit(EXIT_BREAK_BLOCKING);
}

const parsed = parseInput(readFileSync(0, 'utf-8'));
if (!parsed.ok) {
  process.exit(parsed.exitCode);
}

let verdict: CovenantVerdict;
try {
  verdict = judgeTranscriptModification(parsed.value, {
    transcriptPath,
    home,
    shellToolNames,
    commandArgNames,
    mutatingToolNames,
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
  });
} catch {
  // Structurally unjudgeable input that passed parseInput (element shapes are an intended
  // CORE-01 boundary): cannot judge means block, never a crash exit code.
  process.exit(EXIT_BREAK_BLOCKING);
}
if (!verdict.upheld) {
  process.stderr.write(`${verdict.reason}\n`);
}
// Assign exitCode and let the process end naturally instead of process.exit(): an explicit
// exit can preempt the buffered stderr write on platforms with async pipes, dropping the
// break reason.
process.exitCode = verdictToExitCode(verdict);
