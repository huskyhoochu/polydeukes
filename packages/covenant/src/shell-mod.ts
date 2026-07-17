/**
 * `judgeShellModification` — the shell-mod meta-covenant's pure judge (COVENANT-04d, zero I/O).
 *
 * Analyzes the command-line strings of *shell* tool calls (names and arg keys are injected
 * values, never source literals) per simple command: the fixed detection rules catch writes
 * to a protected path, undecidable structures (opaque mentions, opaque write targets) fail
 * closed, the read-only allowlist absolves proven reads, and every other protected-path
 * mention breaks — "mention + unproven = block". It judges only its own axis: a non-shell
 * tool call is upheld, since the tool axis belongs to the self-mod meta-covenant and
 * run-all co-existence depends on that boundary.
 */

import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import { isNestedShellCommand, type SimpleCommand, tokenizeCommandLine } from './bash-line.js';
import { mentionsPath } from './mention.js';
import { commandBasename, redirectWriteRule, sedInPlaceRule, teeRule } from './mutation-rules.js';

/**
 * `ShellModificationSpec` — the injected axes of the judge (PRD §4.1).
 *
 * `protectedPaths` are literal path strings; `shellToolNames` are the tool names whose
 * calls carry shell lines; `commandArgNames` are the `args` keys those lines live under;
 * `readOnlyCommands` are allowlist entries — space-separated word sequences (`'cat'`,
 * `'git diff'`). Empty-string entries in every list are ignored (an unguarded `''` would
 * match every path / tool / arg / command).
 */
export type ShellModificationSpec = {
  protectedPaths: string[];
  shellToolNames: string[];
  commandArgNames: string[];
  readOnlyCommands: string[];
};

/**
 * Commands proven read-only by shell semantics (PRD §4.3) — the default allowlist. An
 * entry is a leading word sequence; multi-word entries exist because a bare command name
 * (`git`) can front mutating subcommands. Omission errs toward friction, never a hole.
 *
 * An entry must have no way to write a file through its own arguments, since the allowlist
 * vouches for the command head while `matchesReadOnlyEntry` never inspects trailing argv.
 * That is why `git diff`/`git log`/`git show` are absent: all accept `--output=<file>`, a
 * redirect-free truncating write. `git status`/`git grep` reject `--output`, so they stay.
 */
export const DEFAULT_READ_ONLY_COMMANDS: string[] = [
  'cat',
  'head',
  'tail',
  'grep',
  'rg',
  'ls',
  'wc',
  'diff',
  'stat',
  'file',
  'echo',
  'printf',
  'git status',
  'git grep',
];

// The fixed rule set (PRD §4.2): rule-selection injection stays closed — dropping a rule
// from an assembly would be a detection hole, and no consumer needs a subset.
const MUTATION_RULES = [redirectWriteRule, teeRule, sedInPlaceRule];

/** True when the command's leading words match the allowlist entry's word sequence. */
function matchesReadOnlyEntry(command: SimpleCommand, entry: string[]): boolean {
  // An empty entry would match every command vacuously (`[].every()` is true) — reject it
  // locally so the covenant does not depend on a distant caller-side filter.
  if (entry.length === 0) return false;
  return entry.every((entryWord, k) => {
    const word = command.words[k];
    if (word === undefined || word.opaque) return false;
    // The first word is compared by basename (`/bin/cat` is still `cat`); later words verbatim.
    const text = k === 0 ? commandBasename(word) : word.text;
    return text === entryWord;
  });
}

/**
 * Judge one simple command (PRD §4.1(a)–(f), order normative). Returns the break reason,
 * or null when the command contributes to uphold.
 */
function judgeCommand(
  command: SimpleCommand,
  protectedPaths: string[],
  readOnlyEntries: string[][],
): string | null {
  // (a) Precise rules: a detected mutation whose target carries a protected path breaks.
  for (const rule of MUTATION_RULES) {
    for (const target of rule.detect(command)) {
      const hit = protectedPaths.find((path) => mentionsPath(target.path, path));
      if (hit !== undefined) return `${target.rule} targets protected path ${hit}`;
    }
  }

  // (b) Mention scan over word texts and redirect target texts (heredoc bodies are data —
  // the tokenizer never surfaces them as tokens). No mention: nothing left to judge.
  const tokens = [...command.words, ...command.redirects.map((redirect) => redirect.target)];
  let mentioned: string | undefined;
  let mentionIsOpaque = false;
  for (const token of tokens) {
    const hit = protectedPaths.find((path) => mentionsPath(token.text, path));
    if (hit === undefined) continue;
    mentioned ??= hit;
    if (token.opaque) mentionIsOpaque = true;
  }
  if (mentioned === undefined) return null;

  // (c) A mention inside an opaque token (command substitution, process substitution,
  // expansion, glob) is undecidable — the "protected path inside command substitution"
  // policy clause.
  if (mentionIsOpaque) return `protected path ${mentioned} inside an opaque token`;

  // (d) An opaque write target could resolve to the protected path — unprovable, so it
  // breaks even for an allowlisted reader (order over (e) is the invariant).
  if (command.redirects.some((r) => r.operator.includes('>') && r.target.opaque)) {
    return `opaque redirect target alongside protected path ${mentioned}`;
  }

  // (e) Read-only allowlist: a proven read absolves the mention — but a nested shell
  // (`eval`/`sh -c …`) re-parses its string args, so it can never be proven read-only even
  // if it was injected into the allowlist. Its mention falls through to the backstop.
  const first = command.words[0];
  const firstBasename = first !== undefined ? commandBasename(first) : '';
  if (
    !isNestedShellCommand(firstBasename) &&
    readOnlyEntries.some((entry) => matchesReadOnlyEntry(command, entry))
  ) {
    return null;
  }

  // (f) Backstop — mention + unproven = block.
  return `${first?.text ?? ''} mentions protected path ${mentioned} without read-only proof`;
}

/**
 * Judge a {@link CovenantInput} against the shell-mod spec (pure).
 *
 * For each `toolCalls[i]` whose `name` exactly equals a non-empty `shellToolNames` entry,
 * every string value under a non-empty `commandArgNames` key is analyzed as a shell line;
 * a shell call with zero such strings breaks (a misassembled arg name must not degrade
 * into universal uphold). A tokenize failure breaks iff the raw line mentions a protected
 * path. Non-shell calls, `subagentSpawns`, and `userMessages` are never judged.
 */
export function judgeShellModification(
  input: CovenantInput,
  spec: ShellModificationSpec,
): CovenantVerdict {
  const shellToolNames = spec.shellToolNames.filter((name) => name !== '');
  const commandArgNames = spec.commandArgNames.filter((name) => name !== '');
  const protectedPaths = spec.protectedPaths.filter((path) => path !== '');
  const readOnlyEntries = spec.readOnlyCommands
    .map((entry) => entry.split(/\s+/).filter((word) => word !== ''))
    .filter((entry) => entry.length > 0);

  for (const call of input.toolCalls) {
    if (!shellToolNames.includes(call.name)) {
      continue;
    }
    const lines = commandArgNames
      .map((name) => call.args?.[name])
      .filter((value): value is string => typeof value === 'string');
    if (lines.length === 0) {
      return {
        upheld: false,
        reason: `unjudgeable shell call ${call.name}: no command string under any command-arg name`,
      };
    }
    for (const line of lines) {
      const result = tokenizeCommandLine(line);
      if (!result.ok) {
        // Tokenize failed: fall back to a segment-match of the raw line (mentionsPath splits
        // it into candidates — no raw substring). A path named in the line fails closed.
        const hit = protectedPaths.find((path) => mentionsPath(line, path));
        if (hit !== undefined) {
          return {
            upheld: false,
            reason: `untokenizable command line mentions protected path ${hit}`,
          };
        }
        continue;
      }
      for (const command of result.commands) {
        const reason = judgeCommand(command, protectedPaths, readOnlyEntries);
        if (reason !== null) return { upheld: false, reason };
      }
    }
  }

  return { upheld: true };
}
