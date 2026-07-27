/**
 * Shell-evidence derivation (COVENANT-10b §2-a) — one command line in, computed writes
 * plus a reasoned unjudgeable list out.
 *
 * Pure: no disk read, no spawn. `create`/`modify` discrimination and the append
 * composition need a pre-state, which belongs to the judged body (adapter `readPreState`
 * precedent); this layer answers only what the command text itself decides.
 *
 * The §2-a boundary table IS the contract — a form the table does not name is
 * unjudgeable, never a confident guess. An uncomputable write whose target is known
 * carries that path, so the compiler can route it to the discipline whose scope covers it;
 * a write whose target is unknowable carries none. A command with no mutation signal at
 * all leaves both lists empty: recording a line per read would drown the log it feeds.
 */

import {
  isNestedShellCommand,
  type RedirectToken,
  type SimpleCommand,
  tokenizeCommandLine,
} from './bash-line.js';
import { commandBasename, redirectWriteRule, sedInPlaceRule, teeRule } from './mutation-rules.js';
import { DEFAULT_READ_ONLY_COMMANDS } from './shell-mod.js';

/** A computed write: the target, the exact bytes written, and the redirect direction. */
export type ShellChange = {
  path: string;
  content: string;
  mode: 'truncate' | 'append';
};

/** A detected write that cannot be computed; `path` is present only when the target is known. */
export type ShellUnjudgeable = {
  path?: string;
  reason: string;
};

/** The derivation of one command line: computed writes and detected-but-uncomputable ones. */
export type ShellDerivation = {
  evidence: ShellChange[];
  unjudgeable: ShellUnjudgeable[];
};

/** A computed content, or the reason the table refuses to compute it. */
type Content = { content: string } | { reason: string };

/** A known target path, or the reason the target cannot be known. */
type Target = { path: string } | { reason: string };

// A command that moves the working directory makes every relative target on the line
// ambiguous — resolving it against a guessed base is the approximation §2-a refuses.
const DIRECTORY_CHANGE_COMMANDS = new Set(['cd', 'pushd']);

// Rules that detect a write with no redirect. The redirect rule is consulted separately,
// for its fd-reference boundary (`2>&1` is neither a write nor a signal).
const DETECTION_RULES = [teeRule, sedInPlaceRule];

/** True when the command's leading words match a read-only allowlist entry's sequence. */
function isReadOnlyHead(command: SimpleCommand): boolean {
  return DEFAULT_READ_ONLY_COMMANDS.some((entry) =>
    entry.split(' ').every((entryWord, k) => {
      const word = command.words[k];
      if (word === undefined || word.opaque) return false;
      // The first word is compared by basename (`/bin/cat` is still `cat`), later ones verbatim.
      return (k === 0 ? commandBasename(word) : word.text) === entryWord;
    }),
  );
}

/**
 * The write-direction redirects of a command. The redirect rule owns the fd-reference
 * boundary, so its detections are the SSOT for what counts as a write; an opaque target
 * keeps its redirect (the rule stays silent on unknowable values, but the write signal
 * is real).
 */
function writeRedirects(command: SimpleCommand): RedirectToken[] {
  const detected = new Set(redirectWriteRule.detect(command).map((target) => target.path));
  return command.redirects.filter(
    (redirect) =>
      redirect.operator.includes('>') &&
      (redirect.target.opaque || detected.has(redirect.target.text)),
  );
}

/** The path a target text names, or the reason this layer cannot know it (§2-a rows 10–11). */
function resolveTarget(text: string, opaque: boolean, movesDirectory: boolean): Target {
  if (opaque) return { reason: `write target ${text} is opaque` };
  // `~` is never expanded here — the same contract the path-notation judge keeps.
  if (text.startsWith('~')) return { reason: `write target ${text} is home-relative` };
  if (movesDirectory && !text.startsWith('/')) {
    return { reason: `relative write target ${text} beside a directory change` };
  }
  return { path: text };
}

/** File an unjudgeable entry for a target, carrying its path only when one is known. */
function fileTarget(target: Target, reason: string): ShellUnjudgeable {
  return 'path' in target ? { path: target.path, reason } : { reason: target.reason };
}

/** The bytes an `echo` writes: its arguments joined, plus the newline echo appends. */
function echoContent(command: SimpleCommand): Content {
  const args = command.words.slice(1);
  // Flag semantics (`-n`, `-e`) are not computed — the first argument decides, so a later
  // dash-argument is ordinary content.
  if (args[0]?.text.startsWith('-')) return { reason: 'echo flag semantics are not computed' };
  if (args.some((word) => word.opaque)) return { reason: 'an echo argument is opaque' };
  return { content: `${args.map((word) => word.text).join(' ')}\n` };
}

/** The bytes a command copying its stdin writes (heredoc, herestring, or a file read). */
function stdinContent(command: SimpleCommand, reads: RedirectToken[]): Content {
  const first = command.words[0];
  // Only a bare `cat` copies stdin to the redirect verbatim; anything else transforms it.
  if (first === undefined || first.opaque || command.words.length > 1) {
    return { reason: 'stdin is transformed by the command, not copied verbatim' };
  }
  if (commandBasename(first) !== 'cat') {
    return { reason: `stdin of ${first.text} is not copied verbatim` };
  }
  const heredocs = command.heredocs ?? [];
  if (heredocs.length + reads.length > 1) return { reason: 'more than one stdin source' };

  const heredoc = heredocs[0];
  if (heredoc !== undefined) {
    if (!heredoc.literal && /[$`]/.test(heredoc.body)) {
      return { reason: 'an unquoted heredoc body carries an expansion' };
    }
    return { content: heredoc.body };
  }
  const read = reads[0];
  if (read === undefined) return { reason: 'no stdin source to read' };
  if (read.operator !== '<<<') return { reason: `stdin comes from file ${read.target.text}` };
  if (read.target.opaque) return { reason: 'the herestring is opaque' };
  return { content: `${read.target.text}\n` };
}

/** The bytes one command writes to its stdout redirect (§2-a rows 1–7). */
function computeContent(command: SimpleCommand): Content {
  // With no command word the redirection still runs and nothing writes into it.
  if (command.words.length === 0) return { content: '' };

  const reads = command.redirects.filter((redirect) => !redirect.operator.includes('>'));
  if (reads.length > 0 || (command.heredocs?.length ?? 0) > 0) {
    return stdinContent(command, reads);
  }

  const first = command.words[0];
  if (first === undefined || first.opaque) return { reason: 'the writing command is opaque' };
  if (commandBasename(first) !== 'echo') {
    return { reason: `the output of ${first.text} is not computable` };
  }
  return echoContent(command);
}

/** Derive one command's write redirects into evidence or unjudgeable entries. */
function deriveWrites(
  command: SimpleCommand,
  writes: RedirectToken[],
  movesDirectory: boolean,
  derivation: ShellDerivation,
): void {
  // Two writes on one command mean two results, and computing either alone is wrong.
  if (writes.length > 1) {
    for (const redirect of writes) {
      const target = resolveTarget(redirect.target.text, redirect.target.opaque, movesDirectory);
      derivation.unjudgeable.push(fileTarget(target, 'the command carries more than one write'));
    }
    return;
  }

  const redirect = writes[0];
  if (redirect === undefined) return;
  const target = resolveTarget(redirect.target.text, redirect.target.opaque, movesDirectory);
  if (!('path' in target)) {
    derivation.unjudgeable.push({ reason: target.reason });
    return;
  }
  // Only stdout carries the content this layer can compute; `2>`/`&>` carry streams it cannot.
  if (redirect.operator !== '>' && redirect.operator !== '>>') {
    derivation.unjudgeable.push({
      path: target.path,
      reason: `redirect ${redirect.operator} does not carry stdout`,
    });
    return;
  }

  const content = computeContent(command);
  if ('reason' in content) {
    derivation.unjudgeable.push({ path: target.path, reason: content.reason });
    return;
  }
  derivation.evidence.push({
    path: target.path,
    content: content.content,
    mode: redirect.operator === '>' ? 'truncate' : 'append',
  });
}

/** Derive one simple command (§2-a, top to bottom — the first matching row answers). */
function deriveCommand(
  command: SimpleCommand,
  movesDirectory: boolean,
  derivation: ShellDerivation,
): void {
  const first = command.words[0];
  // A nested shell re-parses its arguments: a reinterpretation boundary, never parsed into.
  if (first !== undefined && isNestedShellCommand(commandBasename(first))) {
    derivation.unjudgeable.push({ reason: `nested shell execution: ${first.text}` });
    return;
  }

  const writes = writeRedirects(command);
  if (writes.length > 0) {
    deriveWrites(command, writes, movesDirectory, derivation);
    return;
  }

  const detected = DETECTION_RULES.flatMap((rule) => rule.detect(command));
  if (detected.length > 0) {
    for (const mutation of detected) {
      const target = resolveTarget(mutation.path, false, movesDirectory);
      derivation.unjudgeable.push(
        fileTarget(target, `${mutation.rule} writes content this layer does not compute`),
      );
    }
    return;
  }

  // Nothing detected, but an opaque token under a command that is not proven read-only
  // could still write — the signal remains even where the rules stay silent. Without that
  // allowlist gate every read over a glob would file a line (the volume defence).
  if (command.words.some((word) => word.opaque) && !isReadOnlyHead(command)) {
    derivation.unjudgeable.push({
      reason: `opaque token under ${first?.text ?? 'a command'} that is not proven read-only`,
    });
  }
}

/**
 * Derive the file changes one shell command line proves (§2-a).
 *
 * Never throws: a line the tokenizer cannot parse is exactly where a quiet pass would
 * hide, so it answers one unjudgeable entry carrying the failure reason.
 */
export function deriveShellChanges(commandLine: string): ShellDerivation {
  const result = tokenizeCommandLine(commandLine);
  if (!result.ok) return { evidence: [], unjudgeable: [{ reason: result.reason }] };

  // A directory change is line-scoped and order-blind: a write before it is as ambiguous
  // as one after, since only execution decides which base each relative target resolves to.
  const movesDirectory = result.commands.some((command) => {
    const first = command.words[0];
    return (
      first !== undefined && !first.opaque && DIRECTORY_CHANGE_COMMANDS.has(commandBasename(first))
    );
  });

  const derivation: ShellDerivation = { evidence: [], unjudgeable: [] };
  for (const command of result.commands) deriveCommand(command, movesDirectory, derivation);
  return derivation;
}
