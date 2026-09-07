/**
 * `judgeShellModification` — the shell-mod meta-covenant's pure judge (zero I/O).
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
import { isNestedShellCommand, type SimpleCommand, tokenizeCommandLine } from './bash-line.ts';
import type { CovenantRegistration, MetaCovenantRegistration } from './dispatch.ts';
import { mentionsPath, untokenizableLineCandidates } from './mention.ts';
import { commandBasename, redirectWriteRule, sedInPlaceRule, teeRule } from './mutation-rules.ts';
import { outcomeFromVerdict, UNJUDGEABLE_OUTCOME } from './run-covenant.ts';

/**
 * `ShellModificationSpec` — the injected axes of the judge.
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
 * Commands proven read-only by shell semantics — the default allowlist. An entry is a
 * leading word sequence; multi-word entries exist because a bare command name (`git`) can
 * front mutating subcommands. Omission errs toward friction, never a hole.
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

// The rule set is fixed, not injectable: dropping a rule from an assembly would be a
// detection hole, and no consumer needs a subset.
const MUTATION_RULES = [redirectWriteRule, teeRule, sedInPlaceRule];

/**
 * True when the command's leading words match the allowlist entry's word sequence. Exported
 * so the transcript judge's allowlist clause absolves reads by this exact comparison instead
 * of a fork that could drift from it.
 */
export function matchesReadOnlyEntry(command: SimpleCommand, entry: string[]): boolean {
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
 * Judge one simple command. Returns the break reason, or null when the command contributes
 * to uphold. The clause order below is normative: each clause exists to be reached before
 * the next one can absolve. `lineFullyRead` is false when the line carried a span the
 * tokenizer could not read, which withholds the allowlist clause.
 */
function judgeCommand(
  command: SimpleCommand,
  protectedPaths: string[],
  readOnlyEntries: string[][],
  lineFullyRead: boolean,
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
  // expansion, glob) is undecidable, so it breaks rather than passing.
  if (mentionIsOpaque) return `protected path ${mentioned} inside an opaque token`;

  // (d) An opaque write target could resolve to the protected path — unprovable, so it
  // breaks even for an allowlisted reader (order over (e) is the invariant).
  if (command.redirects.some((r) => r.operator.includes('>') && r.target.opaque)) {
    return `opaque redirect target alongside protected path ${mentioned}`;
  }

  // (e) Read-only allowlist: a proven read absolves the mention — but a nested shell
  // (`eval`/`sh -c …`) re-parses its string args, so it can never be proven read-only even
  // if it was injected into the allowlist. Its mention falls through to the backstop. A line
  // carrying an unread span is refused the same way: what the scanner never read could be
  // anything, so no head vouches for it.
  const first = command.words[0];
  const firstBasename = first !== undefined ? commandBasename(first) : '';
  if (
    lineFullyRead &&
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
 * into universal uphold). A span the tokenizer could not read breaks iff the dequoted span —
 * or one of its shell-metacharacter fragments — mentions a protected path, and is answered
 * before the commands so that a mention only the span can see is named as one. Non-shell
 * calls, `subagentSpawns`, and `userMessages` are never judged.
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
      const { commands, unread } = tokenizeCommandLine(line);
      // The conservative treatment applies to the span alone, not the whole line. The shell
      // would still remove quotes and backslash escapes, so a split target like `sr"c"` or
      // `sr\c` becomes `src` on execution — strip both before the segment-match, or the very
      // escaping that stopped the scan defeats the scan that replaces it. Removal may
      // over-join unrelated words, which only ever widens what breaks, never a hole. The
      // fallback-only decomposition then covers the metachar-glued forms (`…/dist;echo x`)
      // that no tokenizer was left to cut apart — narrowing the span must not narrow the
      // extraction.
      for (const span of unread) {
        const candidates = untokenizableLineCandidates(span.text.replace(/['"\\]/g, ''));
        const hit = protectedPaths.find((path) =>
          candidates.some((candidate) => mentionsPath(candidate, path)),
        );
        if (hit !== undefined) {
          return {
            upheld: false,
            reason: `untokenizable command line mentions protected path ${hit}`,
          };
        }
      }
      for (const command of commands) {
        const reason = judgeCommand(command, protectedPaths, readOnlyEntries, unread.length === 0);
        if (reason !== null) return { upheld: false, reason };
      }
    }
  }

  return { upheld: true };
}

/**
 * `ShellModRegistrationSpec` — the assembly values baked into the registration. The call
 * set is not among them: the dispatcher supplies it to the judge at call time.
 * `readOnlyCommands` REPLACES {@link DEFAULT_READ_ONLY_COMMANDS} when given — no merge,
 * since an assembly wanting to extend the default spreads the constant.
 */
export type ShellModRegistrationSpec = {
  protectedPaths: string[];
  shellTools: string[];
  /**
   * The `args` keys shell lines live under. ABSENT is the empty surface, which the thunk's
   * entry gate refuses — naming no command arg would otherwise uphold every call.
   */
  commandArgs?: string[];
  readOnlyCommands?: string[];
  witness?: CovenantRegistration['witness'];
};

/**
 * Build the shell-mod registration. Routing stays path mention; the judgment is the thunk.
 *
 * The misassembly gate lives at the thunk's entry: zero valid entries in any of the three
 * required lists would make {@link judgeShellModification} uphold every call, so it answers
 * the unjudgeable outcome instead, which no enforce level softens. The allowlist is exempt
 * — empty just means stricter.
 */
export function shellModRegistration(spec: ShellModRegistrationSpec): MetaCovenantRegistration {
  const judgeSpec: ShellModificationSpec = {
    protectedPaths: spec.protectedPaths,
    shellToolNames: spec.shellTools,
    commandArgNames: spec.commandArgs ?? [],
    readOnlyCommands: spec.readOnlyCommands ?? DEFAULT_READ_ONLY_COMMANDS,
  };
  return {
    label: 'shell-mod',
    protectedPaths: spec.protectedPaths,
    body: async (input) => {
      if (
        judgeSpec.protectedPaths.filter((path) => path !== '').length === 0 ||
        judgeSpec.shellToolNames.filter((name) => name !== '').length === 0 ||
        judgeSpec.commandArgNames.filter((arg) => arg !== '').length === 0
      ) {
        return UNJUDGEABLE_OUTCOME;
      }
      try {
        return outcomeFromVerdict(judgeShellModification(input, judgeSpec));
      } catch {
        // Structurally unjudgeable input that passed parseInput (which validates the
        // collection shapes, not the element ones): cannot judge means block.
        return UNJUDGEABLE_OUTCOME;
      }
    },
    ...(spec.witness !== undefined ? { witness: spec.witness } : {}),
  };
}
