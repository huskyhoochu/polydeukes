/**
 * Bash command-line tokenizer + mutation-target extraction core (COVENANT-04a).
 *
 * Pure functions only — zero I/O, spawn, or logging. A hand-rolled single-pass character
 * scanner recognizes quote state (`'`, `"`, `\`), control operators (`;` `&&` `||` `|` `&`),
 * redirect operators (`>` `>>` `<` `2>` `&>`, attached `>f`), and marks tokens opaque when
 * their static value is unknowable (command substitution, parameter expansion, globs).
 *
 * Fail-closed: no input ever throws. An unclosed quote yields `{ ok: false }`; in
 * {@link extractMutations} a tokenize failure becomes one indeterminate entry. Block/allow
 * decisions, read-only allowlists, and real detection rules live in COVENANT-04b/c/d.
 */

/** A single word token with a static-opacity flag (`opaque` = value not knowable). */
export type WordToken = {
  text: string;
  opaque: boolean;
};

/** A redirect operator paired with its target word (`>` `>>` `<` `2>` `&>`). */
export type RedirectToken = {
  operator: string;
  target: WordToken;
};

/** One simple command: its word tokens and any redirect operators. */
export type SimpleCommand = {
  words: WordToken[];
  redirects: RedirectToken[];
};

/** The tokenizer's discriminated result — fail-closed on unclosed quotes. */
export type TokenizeResult =
  | { ok: true; commands: SimpleCommand[] }
  | { ok: false; reason: string };

/** A detected mutation target (path) with the name of the rule that found it. */
export type MutationTarget = {
  path: string;
  rule: string;
};

/**
 * A detection rule seam (PRD §4.2). A pure function over a single simple command that
 * returns the mutation targets it detects. 04b/04c plug real rules in here; 04a ships none.
 */
export type MutationRule = {
  name: string;
  detect(command: SimpleCommand): MutationTarget[];
};

/** A structure that cannot be decided deterministically, with the reason why. */
export type Indeterminate = {
  reason: string;
};

/** The extraction result — detected mutations and undecidable structures, kept separate. */
export type MutationAnalysis = {
  mutations: MutationTarget[];
  indeterminate: Indeterminate[];
};

// Reinterpretation-boundary declaration, NOT a blocklist: a command whose first word is
// one of these re-parses its string arguments in a nested shell, so 04a honestly reports
// indeterminate rather than parsing into it. Kept a small explicit set on purpose; residual
// vectors (indirect path computation) are telemetry's concern in 04d, not blocking here.
const NESTED_SHELL_COMMANDS = new Set(['eval', 'bash', 'sh', 'zsh']);

/** True if a raw (unquoted) fragment carries a dynamic construct whose value is unknowable. */
function fragmentIsOpaque(fragment: string): boolean {
  return (
    fragment.includes('$') ||
    fragment.includes('`') ||
    fragment.includes('*') ||
    fragment.includes('?')
  );
}

type ScannedWord = { text: string; opaque: boolean };

/**
 * Scan one word starting at `i`, honoring quotes and escapes. Returns the assembled word
 * and the index just past it, or `null` on an unclosed quote (fail-closed signal).
 */
function scanWord(line: string, start: number): { word: ScannedWord; next: number } | null {
  let text = '';
  let opaque = false;
  let i = start;

  while (i < line.length) {
    const ch = line[i];

    // Whitespace and control/redirect operators terminate a word (outside quotes).
    if (ch === ' ' || ch === '\t') break;
    if (ch === ';' || ch === '|' || ch === '&' || ch === '<' || ch === '>') break;

    if (ch === '\\') {
      // Backslash escape: the next character is literal, never a separator or expansion.
      const nextCh = line[i + 1];
      if (nextCh !== undefined) {
        text += nextCh;
        i += 2;
        continue;
      }
      text += ch;
      i += 1;
      continue;
    }

    if (ch === "'") {
      // Single quotes: literal content, no expansion — never contributes opacity.
      const close = line.indexOf("'", i + 1);
      if (close === -1) return null;
      text += line.slice(i + 1, close);
      i = close + 1;
      continue;
    }

    if (ch === '"') {
      // Double quotes: expansions still apply, so scan for opacity within.
      const close = line.indexOf('"', i + 1);
      if (close === -1) return null;
      const inner = line.slice(i + 1, close);
      if (fragmentIsOpaque(inner)) opaque = true;
      text += inner;
      i = close + 1;
      continue;
    }

    if (ch === '$' && line[i + 1] === '(') {
      // Command substitution `$(…)` with nesting — consume to the matching close paren.
      const end = matchParen(line, i + 1);
      const chunk = line.slice(i, end);
      text += chunk;
      opaque = true;
      i = end;
      continue;
    }

    if (ch === '`') {
      // Backtick command substitution — consume to the closing backtick.
      const close = line.indexOf('`', i + 1);
      const end = close === -1 ? line.length : close + 1;
      text += line.slice(i, end);
      opaque = true;
      i = end;
      continue;
    }

    // Ordinary character. Mark opacity for parameter expansion / globs.
    if (ch === '$' || ch === '*' || ch === '?') opaque = true;
    text += ch;
    i += 1;
  }

  return { word: { text, opaque }, next: i };
}

/** Index just past the substitution starting at the `(` position `open`, matching nesting. */
function matchParen(line: string, open: number): number {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === '(') depth += 1;
    else if (line[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return line.length;
}

/**
 * Recognize a redirect operator at `i`; returns the operator text and its length, or null.
 * Longest forms first within each family, and a single-digit fd prefix is folded into the
 * operator (`2>`, `2>>`, `2>&`) — it is only an fd when it starts a token, matching bash.
 */
function scanRedirect(line: string, i: number): { operator: string; length: number } | null {
  const three = line.slice(i, i + 3);
  const two = three.slice(0, 2);
  const ch = three[0];

  // Fd prefix: bash folds ANY all-digit run immediately before `>` into the redirect
  // (`12> f` sends fd 12 to f; tee receives no "12" operand), so the scan must too.
  let digitEnd = i;
  while (digitEnd < line.length && line[digitEnd] >= '0' && line[digitEnd] <= '9') digitEnd += 1;
  if (digitEnd > i && line[digitEnd] === '>') {
    const tail = line[digitEnd + 1];
    const end = tail === '>' || tail === '&' ? digitEnd + 2 : digitEnd + 1;
    return { operator: line.slice(i, end), length: end - i };
  }
  if (three === '&>>') return { operator: '&>>', length: 3 };
  if (two === '>>' || two === '&>' || two === '>&') return { operator: two, length: 2 };
  if (ch === '>') return { operator: '>', length: 1 };
  if (ch === '<') return { operator: '<', length: 1 };
  return null;
}

/** Recognize a control operator at `i`; returns its text, or null. */
function scanControl(line: string, i: number): string | null {
  const two = line.slice(i, i + 2);
  if (two === '&&') return '&&';
  if (two === '||') return '||';
  const ch = line[i];
  if (ch === ';' || ch === '|' || ch === '&') return ch;
  return null;
}

/**
 * Tokenize one shell line into simple commands (PRD §4.1). Fail-closed: an unclosed quote
 * returns `{ ok: false }` instead of throwing.
 */
export function tokenizeCommandLine(line: string): TokenizeResult {
  const commands: SimpleCommand[] = [];
  let current: SimpleCommand = { words: [], redirects: [] };
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }

    // Redirects are scanned before control operators so `&>` is not mistaken for a lone `&`.
    const redirect = scanRedirect(line, i);
    if (redirect !== null) {
      let j = i + redirect.length;
      while (line[j] === ' ' || line[j] === '\t') j += 1;
      const scanned = scanWord(line, j);
      if (scanned === null) return { ok: false, reason: 'unclosed quote' };
      // A redirect with no target is a bash syntax error — fail closed, never a confident
      // empty-string target.
      if (scanned.word.text === '') return { ok: false, reason: 'missing redirect target' };
      // Process substitution (`>(…)`/`<(…)`): the real path lives inside the substitution
      // and is not statically knowable — an opaque target, never a confident path.
      const target = scanned.word.text.startsWith('(')
        ? { ...scanned.word, opaque: true }
        : scanned.word;
      current.redirects.push({ operator: redirect.operator, target });
      i = scanned.next;
      continue;
    }

    const control = scanControl(line, i);
    if (control !== null) {
      commands.push(current);
      current = { words: [], redirects: [] };
      i += control.length;
      continue;
    }

    const scanned = scanWord(line, i);
    if (scanned === null) return { ok: false, reason: 'unclosed quote' };
    current.words.push(scanned.word);
    i = scanned.next;
  }

  commands.push(current);

  // Drop empty commands produced by leading/trailing/adjacent operators (e.g. ";;").
  const nonEmpty = commands.filter((c) => c.words.length > 0 || c.redirects.length > 0);
  return { ok: true, commands: nonEmpty };
}

/**
 * Extract mutation targets from a shell line via injected rules (PRD §4.2). A simple command
 * contributes an indeterminate entry when it is a nested-shell call OR contains any opaque
 * word (in which case its rules are still applied, but an undecidable structure is present);
 * a tokenize failure yields exactly one indeterminate entry. Never throws.
 */
export function extractMutations(line: string, rules: MutationRule[]): MutationAnalysis {
  const result = tokenizeCommandLine(line);
  if (!result.ok) {
    return { mutations: [], indeterminate: [{ reason: result.reason }] };
  }

  const mutations: MutationTarget[] = [];
  const indeterminate: Indeterminate[] = [];

  for (const command of result.commands) {
    const first = command.words[0];

    // Nested shell = reinterpretation boundary: report indeterminate, do not parse inside.
    if (first !== undefined && NESTED_SHELL_COMMANDS.has(first.text)) {
      indeterminate.push({ reason: `nested shell execution: ${first.text}` });
      continue;
    }

    // An opaque word or redirect target (command substitution, parameter expansion, glob)
    // has an unknowable value — honestly indeterminate rather than a confident pass.
    if (command.words.some((w) => w.opaque) || command.redirects.some((r) => r.target.opaque)) {
      indeterminate.push({ reason: 'opaque token' });
    }

    for (const rule of rules) {
      mutations.push(...rule.detect(command));
    }
  }

  return { mutations, indeterminate };
}
