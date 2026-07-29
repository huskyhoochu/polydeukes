/**
 * Bash command-line tokenizer + mutation-target extraction core (COVENANT-04a).
 *
 * Pure functions only — zero I/O, spawn, or logging. A hand-rolled single-pass character
 * scanner recognizes quote state (`'`, `"`, `$'…'`, `\`), control operators
 * (`;` `&&` `||` `|` `&`), redirect operators (`>` `>>` `>|` `<` `2>` `&>`, attached `>f`),
 * and marks tokens opaque when their static value is unknowable (command substitution,
 * parameter expansion, globs).
 *
 * Fail-closed: no input ever throws. A construct the scanner cannot finish reading yields a
 * partial result — the commands it did read, plus one `unread` span per failure; in
 * {@link extractMutations} each span becomes one indeterminate entry. Block/allow
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

/**
 * One heredoc body a command declared, with its delimiter's quoting (COVENANT-10b §2-a).
 * `literal` means the delimiter was quoted, so the body is written verbatim; an unquoted
 * delimiter expands its body, which only a consumer can decide what to do about.
 */
export type HeredocBody = {
  body: string;
  literal: boolean;
};

/**
 * One simple command: its word tokens, any redirect operators, and the heredoc bodies it
 * declared (in declaration order — absent when it declared none).
 */
export type SimpleCommand = {
  words: WordToken[];
  redirects: RedirectToken[];
  heredocs?: HeredocBody[];
};

/**
 * A span of the line the scanner could not read, with the reason it stopped (COVENANT-18
 * §2-b B2). `reason` is a telemetry pass-through value: no consumer branches on it, and it
 * is deliberately not promoted to a discriminated union (§2-f C2).
 */
export type UnreadSpan = {
  text: string;
  reason: string;
};

/**
 * The tokenizer's result: the commands it read, plus one span per failure it hit. A failure
 * no longer discards the line — the read commands reach precise judgment and only the spans
 * fall to a consumer's conservative treatment (COVENANT-18 §2-b B2). An empty `unread` is
 * the "fully read" signal.
 */
export type TokenizeResult = {
  commands: SimpleCommand[];
  unread: UnreadSpan[];
};

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

/**
 * True when `commandName` (a command word's basename) re-parses its string arguments in a
 * nested shell — the reinterpretation boundary the tokenizer refuses to parse into. A judge
 * can consult this to refuse to treat such a command as provably read-only.
 */
export function isNestedShellCommand(commandName: string): boolean {
  return NESTED_SHELL_COMMANDS.has(commandName);
}

// A `NAME=VALUE` assignment word, the prefix bash allows (any number of them) before the
// command name.
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The word that names the command, skipping any leading assignments — undefined when the
 * command is nothing but assignments (COVENANT-18 §2-a A5).
 *
 * Read at the nested-shell boundary only. There an unskipped assignment hides `bash` behind
 * `FOO=1` and the line passes with confidence; for the read-only allowlist and precedent
 * evidence the same miss is the conservative direction, so those keep reading `words[0]`.
 */
export function commandNameWord(command: SimpleCommand): WordToken | undefined {
  let i = 0;
  while (i < command.words.length && ASSIGNMENT_WORD.test(command.words[i].text)) i += 1;
  return command.words[i];
}

/**
 * True if a double-quoted fragment carries a dynamic construct whose value is unknowable.
 * Only expansion and command substitution run inside double quotes — bash does not glob
 * there, so `*` and `?` are opacity grounds outside quotes only (COVENANT-18 §2-a A4).
 */
function quotedFragmentIsOpaque(fragment: string): boolean {
  return fragment.includes('$') || fragment.includes('`');
}

// Inside double quotes bash removes a backslash only before these characters; before
// anything else it stays literal content (`"a\|b"` is the four bytes `a\|b`). The same
// set decides the pairing, so an escaped `"` never closes the string (§2-a A1).
const DOUBLE_QUOTE_ESCAPES = new Set(['$', '`', '"', '\\']);

/**
 * A quoted span: the content bash would pass, where it ended, whether it ever closed, and
 * whether the content is fully decided. `decoded: false` means the scanner reproduced source
 * spelling it could not translate, so the text is NOT the bytes bash passes.
 */
type ScannedQuote = { text: string; next: number; closed: boolean; decoded: boolean };

/**
 * Scan a double-quoted string whose opening `"` sits at `open`. Returns the content bash
 * would pass and the index just past the closing quote; a string that never closes is read
 * to the end of input and reported `closed: false`, never discarded (§2-b B1).
 */
function scanDoubleQuoted(line: string, open: number): ScannedQuote {
  let text = '';
  let i = open + 1;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      const next = line[i + 1];
      // `\`+newline is a line continuation inside double quotes too — both characters go.
      if (next === '\n') {
        i += 2;
        continue;
      }
      if (next !== undefined && DOUBLE_QUOTE_ESCAPES.has(next)) {
        text += next;
        i += 2;
        continue;
      }
      text += ch;
      i += 1;
      continue;
    }
    // Always `decoded`: the escape set above IS bash's whole rule inside double quotes, so
    // the text is the bytes bash passes with nothing left untranslated.
    if (ch === '"') return { text, next: i + 1, closed: true, decoded: true };
    text += ch;
    i += 1;
  }

  return { text, next: line.length, closed: false, decoded: true };
}

// The ANSI-C escapes decoded inside `$'…'`. Deliberately not the whole table: an escape
// that is not listed keeps its backslash, which is bash's own answer for one it does not
// recognize (measured: `$'\q'` is the two bytes `\q`).
const ANSI_C_ESCAPES: Record<string, string> = { n: '\n', t: '\t', "'": "'", '\\': '\\' };

/**
 * Scan an ANSI-C quoted string (`$'…'`) whose opening `'` sits at `open`. Returns the
 * DECODED bytes and the index just past the closing quote; a string that never closes is
 * read to the end of input and reported `closed: false` (§2-b B1). Decoding is not
 * cosmetic: the word text becomes written-content evidence downstream, so handing back the
 * source spelling would record bytes bash never writes (§2-a A7).
 *
 * An escape the table does not carry sets `decoded: false`, and the caller turns that into
 * opacity. The alternative — keeping the source spelling and calling it decided — asserts
 * bytes bash never writes AS CONFIDENT EVIDENCE: `$'\x64ist'` would be filed as the literal
 * `\x64ist` while bash writes `dist`, so a judge reading written content compares a string
 * that never existed and answers uphold with no unjudgeable row. Completing the table is NOT
 * the fix — the next unlisted escape reproduces it. Declining to claim knowledge is.
 */
function scanAnsiCQuoted(line: string, open: number): ScannedQuote {
  let text = '';
  let decoded = true;
  let i = open + 1;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      const next = line[i + 1];
      if (next === undefined) break;
      const replacement = ANSI_C_ESCAPES[next];
      if (replacement === undefined) decoded = false;
      text += replacement ?? `\\${next}`;
      i += 2;
      continue;
    }
    if (ch === "'") return { text, next: i + 1, closed: true, decoded };
    text += ch;
    i += 1;
  }

  return { text, next: line.length, closed: false, decoded };
}

type ScannedWord = { text: string; opaque: boolean };

/** One scanned word, plus the span it could not read when a quote never closed. */
type ScanResult = { word: ScannedWord; next: number; unread?: UnreadSpan };

/**
 * Close a word on an unterminated quote whose opening character sits at `open`: the rest of
 * the input is consumed, the word is opaque (its value depends on bytes the shell never
 * received), and the raw span is reported. The backtick branch of {@link scanWord} has
 * always worked this way; §2-b B1 gives the three quote forms the same treatment.
 */
function unreadFrom(line: string, open: number, text: string): ScanResult {
  return {
    word: { text, opaque: true },
    next: line.length,
    unread: { text: line.slice(open), reason: 'unclosed quote' },
  };
}

/**
 * Scan one word starting at `i`, honoring quotes and escapes. Returns the assembled word
 * and the index just past it; an unclosed quote also returns the span it could not read.
 */
function scanWord(line: string, start: number): ScanResult {
  let text = '';
  let opaque = false;
  let i = start;

  while (i < line.length) {
    const ch = line[i];

    // Whitespace and control/redirect operators terminate a word (outside quotes).
    // Newlines count too (04c): they separate commands, like `;`. Inside quotes they
    // remain word content — the quote branches below consume across them.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') break;
    if (ch === ';' || ch === '|' || ch === '&' || ch === '<' || ch === '>') break;

    if (ch === '\\') {
      // Backslash escape: the next character is literal, never a separator or expansion.
      const nextCh = line[i + 1];
      if (nextCh === '\n') {
        // `\`+newline is a shell line continuation: elide both characters (the word
        // continues on the next physical line) rather than inserting a literal newline.
        i += 2;
        continue;
      }
      if (nextCh === '\r' && line[i + 2] === '\n') {
        i += 3;
        continue;
      }
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
      // The dequoted content JOINS the word in progress rather than starting a new one:
      // `pack'ages/…` is one shell word, and splitting it leaves two halves that each
      // match nothing (§2-b B1).
      if (close === -1) return unreadFrom(line, i, text + line.slice(i + 1));
      text += line.slice(i + 1, close);
      i = close + 1;
      continue;
    }

    if (ch === '"') {
      // Double quotes: expansions still apply, so scan for opacity within.
      const quoted = scanDoubleQuoted(line, i);
      if (!quoted.closed) return unreadFrom(line, i, text + quoted.text);
      if (quotedFragmentIsOpaque(quoted.text)) opaque = true;
      text += quoted.text;
      i = quoted.next;
      continue;
    }

    if (ch === '$' && line[i + 1] === "'") {
      // ANSI-C quoting: bash decodes the escapes and passes a string constant, so a fully
      // decoded one is decided — an expansion it is not, and marking it opaque would be
      // wrong. An escape this scanner cannot translate is the opposite case: the text is
      // source spelling, not the bytes bash passes, so the word's value is NOT known and
      // saying otherwise files evidence for a string that never existed.
      const quoted = scanAnsiCQuoted(line, i + 1);
      if (!quoted.closed) return unreadFrom(line, i, text + quoted.text);
      if (!quoted.decoded) opaque = true;
      text += quoted.text;
      i = quoted.next;
      continue;
    }

    if (ch === '$' && line[i + 1] === '(') {
      // Command substitution `$(…)` with nesting — consume to the matching close paren. A
      // substitution that never closes has swallowed the rest of the line into this one
      // opaque word, so it reports an unread span exactly like an unterminated quote does:
      // without it the line would answer "fully read" and file no unjudgeable entry.
      const scan = matchParen(line, i + 1);
      const chunk = line.slice(i, scan.end);
      if (!scan.closed) return unreadFrom(line, i, text + chunk);
      text += chunk;
      opaque = true;
      i = scan.end;
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

/**
 * Where the substitution starting at the `(` position `open` ends, matching nesting, and
 * whether the scan ever reached that end.
 *
 * `closed: false` means the scan ran off the end of input — an unterminated quote inside the
 * substitution, or a `(` that never balances. Reporting it is not cosmetic: the caller
 * swallows everything from `open` to end of input into ONE opaque word, so without this flag
 * a line the scanner demonstrably could not finish reading answers `unread: []` — the
 * "fully read" signal — and files zero unjudgeable entries. That is a call passing with no
 * telemetry row at all, which is the defect class COVENANT-10b defines and blocker B7
 * measured (COVENANT-18 §2-b, top invariant).
 */
type ParenScan = { end: number; closed: boolean };

function matchParen(line: string, open: number): ParenScan {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];

    // Quoting suspends the count: a `)` inside `"[^)]+"` is regex content, not a close paren.
    // Counting it ends the substitution early and every quote after it pairs one position off
    // (COVENANT-18 §2-a A9) — the same context-blindness the `"` pairing had before A1.
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === "'") {
      const close = line.indexOf("'", i + 1);
      if (close === -1) return { end: line.length, closed: false };
      i = close;
      continue;
    }
    if (ch === '"') {
      const quoted = scanDoubleQuoted(line, i);
      if (!quoted.closed) return { end: line.length, closed: false };
      i = quoted.next - 1;
      continue;
    }

    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { end: i + 1, closed: true };
    }
  }
  // Ran off the end with the nesting still open — the same unread condition as an
  // unterminated quote above, reported the same way.
  return { end: line.length, closed: false };
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
    // `|` joins the tail set for `N>|`, which bash accepts as a write (`&>|` does not
    // exist — a syntax error — so the `&>` family below is left alone).
    const tail = line[digitEnd + 1];
    const end = tail === '>' || tail === '&' || tail === '|' ? digitEnd + 2 : digitEnd + 1;
    return { operator: line.slice(i, end), length: end - i };
  }
  if (three === '&>>') return { operator: '&>>', length: 3 };
  // `>|` truncates past `noclobber` — a write like `>`, and graded as one by the operator's
  // `>` (COVENANT-18 §2-a A6).
  // `<&` is the read-direction twin of `>&` and closes an fd as `<&-`; without it the `-`
  // never reads as a target and a valid line dies (COVENANT-18 §2-a A10).
  if (two === '>>' || two === '>|' || two === '&>' || two === '>&' || two === '<&') {
    return { operator: two, length: 2 };
  }
  if (ch === '>') return { operator: '>', length: 1 };
  // Heredoc family (04c): longest match first so `<<EOF` is never a lone `<` with an
  // empty (fail-closing) target — `<<<` herestring, `<<-` tab-stripping heredoc, `<<`.
  if (three === '<<<' || three === '<<-') return { operator: three, length: 3 };
  if (two === '<<') return { operator: '<<', length: 2 };
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
 * A heredoc opener awaiting its body: the terminator word, the `<<-` tab-strip mode, the
 * delimiter's quoting, and the command that declared it (bodies arrive after the command
 * is already closed, so the owner is carried rather than looked up).
 */
type PendingHeredoc = {
  delimiter: string;
  stripTabs: boolean;
  literal: boolean;
  owner: SimpleCommand;
};

/**
 * Consume queued heredoc bodies starting at `start` (just past the opening newline), in
 * queue order. Body lines are data — never parsed as commands — until a line equals the
 * delimiter (`<<-` allows leading tabs), or end of input (bash ends at EOF too). Each body
 * is recorded on the command that declared it, in the bytes bash would write (tabs
 * stripped under `<<-`, the `\r` of CRLF dropped). Returns the index just past the last
 * consumed body.
 */
function consumeHeredocBodies(line: string, start: number, pending: PendingHeredoc[]): number {
  let i = start;
  for (const heredoc of pending) {
    let body = '';
    while (i < line.length) {
      let end = line.indexOf('\n', i);
      if (end === -1) end = line.length;
      let bodyLine = line.slice(i, end);
      if (bodyLine.endsWith('\r')) bodyLine = bodyLine.slice(0, -1);
      i = end + 1;
      const stripped = heredoc.stripTabs ? bodyLine.replace(/^\t+/, '') : bodyLine;
      if (stripped === heredoc.delimiter) break;
      body += `${stripped}\n`;
    }
    heredoc.owner.heredocs = [
      ...(heredoc.owner.heredocs ?? []),
      { body, literal: heredoc.literal },
    ];
  }
  return i;
}

/**
 * Tokenize one shell line into simple commands (PRD §4.1). Never throws, and never discards
 * what it read: a construct it cannot finish reading is recorded as an `unread` span and the
 * scan carries on (COVENANT-18 §2-b B2).
 */
export function tokenizeCommandLine(line: string): TokenizeResult {
  const commands: SimpleCommand[] = [];
  const unread: UnreadSpan[] = [];
  let current: SimpleCommand = { words: [], redirects: [] };
  // Heredoc delimiters queued on the current line, consumed in order at the next newline.
  let pendingHeredocs: PendingHeredoc[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }

    // Newline (or CRLF, or a lone CR — every scanWord terminator needs a consuming
    // branch here, or the loop stalls) separates commands like `;`, then feeds any
    // queued heredocs their body lines.
    if (ch === '\n' || ch === '\r') {
      commands.push(current);
      current = { words: [], redirects: [] };
      i += ch === '\r' && line[i + 1] === '\n' ? 2 : 1;
      i = consumeHeredocBodies(line, i, pendingHeredocs);
      pendingHeredocs = [];
      continue;
    }

    // Process substitution `<(…)` / `>(…)` is a word-level filename token bash EXECUTES,
    // not a redirect. Consume the whole `(…)` (matching nested parens) as one opaque word,
    // scanned before the redirect operators would split on the leading `<`/`>` — otherwise
    // the inner command's args leak as top-level words and a first-word allowlist could
    // absolve them while the inner write runs.
    if ((ch === '<' || ch === '>') && line[i + 1] === '(') {
      const scan = matchParen(line, i + 1);
      current.words.push({ text: line.slice(i, scan.end), opaque: true });
      // A substitution that never closes swallowed the rest of the line into that one word,
      // so the span is recorded rather than left to read as fully parsed.
      if (!scan.closed) unread.push({ text: line.slice(i), reason: 'unclosed quote' });
      i = scan.end;
      continue;
    }

    // Redirects are scanned before control operators so `&>` is not mistaken for a lone `&`.
    const redirect = scanRedirect(line, i);
    if (redirect !== null) {
      let j = i + redirect.length;
      while (line[j] === ' ' || line[j] === '\t') j += 1;
      // A spaced process substitution is the redirect's target (`echo x > >(wc -c)` is
      // valid bash): consume the whole `(…)` as ONE opaque target, exactly as the attached
      // word-level branch above does — scanning it as an ordinary word would leak the inner
      // command's arguments to top level, where a first-word allowlist could absolve them.
      if ((line[j] === '<' || line[j] === '>') && line[j + 1] === '(') {
        const scan = matchParen(line, j + 1);
        current.redirects.push({
          operator: redirect.operator,
          target: { text: line.slice(j, scan.end), opaque: true },
        });
        if (!scan.closed) unread.push({ text: line.slice(j), reason: 'unclosed quote' });
        i = scan.end;
        continue;
      }
      const scanned = scanWord(line, j);
      if (scanned.unread !== undefined) {
        // The target position ran into an unterminated quote: record the span and drop the
        // redirect rather than claim a target nobody could read.
        unread.push(scanned.unread);
        i = scanned.next;
        continue;
      }
      // A redirect with no target is a bash syntax error, but a LOCAL one: everything past
      // the operator is still readable, so the span is recorded and the scan resumes there
      // instead of throwing the line away (§2-b B2).
      if (scanned.word.text === '') {
        unread.push({ text: line.slice(i, j), reason: 'missing redirect target' });
        i = j;
        continue;
      }
      if (redirect.operator === '<<' || redirect.operator === '<<-') {
        // bash never expands a heredoc delimiter, so the body's end is decidable from the
        // literal text even for `<<$D` — no fail-closed branch here (§2-a A3).
        pendingHeredocs.push({
          delimiter: scanned.word.text,
          stripTabs: redirect.operator === '<<-',
          // A quoting character ANYWHERE in the delimiter makes the body literal
          // (`<<E"O"F` and `<<\EOF` both stop expansion), and `scanWord` has already
          // removed those characters — so the raw span is the only place to read it.
          literal: /['"\\]/.test(line.slice(j, scanned.next)),
          owner: current,
        });
        i = scanned.next;
        continue;
      }
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
    if (scanned.unread !== undefined) unread.push(scanned.unread);
    current.words.push(scanned.word);
    i = scanned.next;
  }

  commands.push(current);

  // Drop empty commands produced by leading/trailing/adjacent operators (e.g. ";;").
  const nonEmpty = commands.filter((c) => c.words.length > 0 || c.redirects.length > 0);
  return { commands: nonEmpty, unread };
}

/**
 * Extract mutation targets from a shell line via injected rules (PRD §4.2). A simple command
 * contributes an indeterminate entry when it is a nested-shell call OR contains any opaque
 * word (in which case its rules are still applied, but an undecidable structure is present);
 * each unread span yields one more. Never throws.
 */
export function extractMutations(line: string, rules: MutationRule[]): MutationAnalysis {
  const result = tokenizeCommandLine(line);

  const mutations: MutationTarget[] = [];
  const indeterminate: Indeterminate[] = result.unread.map((span) => ({ reason: span.reason }));

  for (const command of result.commands) {
    // Nested shell = reinterpretation boundary: report indeterminate, do not parse inside.
    // Matched by command basename (`/bin/sh` → `sh`), the same boundary shell-mod's (e)
    // clause uses (SSOT), so a leading-path nested shell is not missed by a raw-text compare.
    const name = commandNameWord(command);
    const nameBasename = name !== undefined ? name.text.slice(name.text.lastIndexOf('/') + 1) : '';
    if (name !== undefined && isNestedShellCommand(nameBasename)) {
      indeterminate.push({ reason: `nested shell execution: ${name.text}` });
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
