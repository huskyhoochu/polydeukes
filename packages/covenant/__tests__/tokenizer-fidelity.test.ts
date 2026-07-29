import type { CovenantInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { extractMutations, tokenizeCommandLine } from '../src/bash-line.js';
import { redirectWriteRule } from '../src/mutation-rules.js';
import { deriveShellChanges } from '../src/shell-evidence.js';
import {
  DEFAULT_READ_ONLY_COMMANDS,
  judgeShellModification,
  type ShellModificationSpec,
} from '../src/shell-mod.js';

// COVENANT-18 part A (PRD §2-a) — the eight scanner corrections. Every input below was
// measured against bash 5.3.9: bash accepts and executes each one, so the expectations are
// that shell's own answers rather than ours. Each block also pins the opposite end of the
// axis it loosens — a correction that only widens is a regression waiting to be measured.

// A repository-shaped path for the cases where a token stands in for a protected path. The
// tokenizer has no notion of protection; the value only has to be recognizable, so a token
// the scanner silently drops shows up in the assertion.
const protectedPathFixture = 'packages/core/dist/index.js';

describe('A1 — escaped quotes inside a double-quoted string', () => {
  it('closes the string at the unescaped quote, keeping an escaped quote as content', () => {
    // Mutation caught: pairing the opening quote with the next `"` found by indexOf. That
    // closes at the escaped `\"`, every quote after it pairs one position off, and a valid
    // line ends up { ok: false } — the single defect behind most of the measured blind spot.
    const result = tokenizeCommandLine('echo "say \\"hi\\""');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'say "hi"', opaque: false },
    ]);
  });

  it('keeps a pipe inside such a string out of the command split', () => {
    // Mutation caught: mis-paired quotes leave the `|` outside quote state, so this real
    // corpus line splits into two commands and `src/` lands in the wrong one. Asserting the
    // word count and both ends pins the pairing without fixing the pattern's own escapes.
    const result = tokenizeCommandLine('grep -rn "a\\|from \\"x\\"" src/');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    const texts = result.commands[0].words.map((w) => w.text);
    expect(texts).toHaveLength(4);
    expect(texts[0]).toBe('grep');
    expect(texts[3]).toBe('src/');
  });

  it('retains a backslash that quotes nothing, as bash does inside double quotes', () => {
    // Control for the loosening. Mutation caught: honoring `\` by consuming the next
    // character unconditionally. Inside double quotes bash removes the backslash only
    // before $ ` " \ and newline — measured, `printf '[%s]' "a\|b"` prints `a\|b` — so a
    // stripped one silently rewrites the grep pattern above.
    const result = tokenizeCommandLine('echo "a\\|b"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: 'a\\|b', opaque: false });
  });

  it('still fails when the only closing quote on the line is an escaped one', () => {
    // Mutation caught: applying the escape rule while extracting the text but falling back
    // to indexOf for the failure decision — `\"` would close the string and a line bash
    // rejects for an unexpected EOF would tokenize clean. Restated in COVENANT-18 §2-b B2's
    // vocabulary: the failure is now a recorded span instead of a discarded line, so the
    // claim "this quote never closes" is carried by a non-empty `unread`. The judge-surface
    // half of this case is below — a protected path inside such a span still blocks.
    const result = tokenizeCommandLine('echo "a\\"');

    expect(result.unread).toEqual([{ text: '"a\\"', reason: 'unclosed quote' }]);
  });
});

describe('A2 — a backslash-quoted heredoc delimiter', () => {
  it('reads `<<\\EOF` as a literal delimiter, so the body is not expanded', () => {
    // Mutation caught: deciding the delimiter's quoting from `'` and `"` only. Measured:
    // `cat <<\EOF` over a body of `$D` prints `$D`, exactly as `<<'EOF'` does. Reporting
    // literal:false tells a consumer the body it sees is not the text bash writes.
    const result = tokenizeCommandLine('cat <<\\EOF\n$D\nEOF');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: '$D\n', literal: true }]);
  });

  it("keeps a single-quoted `<<'EOF'` delimiter literal", () => {
    const result = tokenizeCommandLine("cat <<'EOF'\n$D\nEOF");

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: '$D\n', literal: true }]);
  });

  it('keeps a bare `<<EOF` delimiter non-literal — an unquoted delimiter expands its body', () => {
    // Mutation caught: an A2 fix that flips every delimiter to literal. Measured: a bare
    // `<<EOF` body prints the value of `$D`, so its text is not what bash writes.
    const result = tokenizeCommandLine('cat <<EOF\n$D\nEOF');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: '$D\n', literal: false }]);
  });
});

describe('A3 — a heredoc delimiter is never expanded', () => {
  it('tokenizes `<<$DELIM` and ends the body at the literal delimiter text', () => {
    // Mutation caught: the `opaque heredoc delimiter` failure. Measured: `bash -n` accepts
    // the line and execution terminates the body at the literal `$DELIM` line, never at the
    // variable's value — the body end is statically decidable, so the failure is a wrong model.
    const result = tokenizeCommandLine('cat <<$DELIM\ninside\n$DELIM');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: 'inside\n', literal: false }]);
  });

  it('does not end a `<<$DELIM` body on the delimiter with its `$` stripped', () => {
    // Mutation caught: dropping the failure branch but normalizing `$DELIM` to `DELIM`.
    // The body would end one line early and every command after it would be lost — measured,
    // bash reads a bare `DELIM` line as body text.
    const result = tokenizeCommandLine('cat <<$DELIM\nDELIM\n$DELIM');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: 'DELIM\n', literal: false }]);
  });

  it('tokenizes a command-substitution delimiter `<<$(x)` the same way', () => {
    // Mutation caught: narrowing the deleted failure branch to `$VAR` and keeping it for
    // `$(…)`. Measured identically — `bash -n` accepts `cat <<$(x)`, and execution ends the
    // body at the literal `$(x)` line, so the same static decision holds for both spellings.
    const result = tokenizeCommandLine('cat <<$(x)\ninside\n$(x)');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: 'inside\n', literal: false }]);
  });
});

describe('A4 — globbing does not apply inside double quotes', () => {
  it('marks a double-quoted `*` glob as not opaque', () => {
    // Mutation caught: running the opacity scan over the quoted fragment with the same rules
    // as an unquoted one. Bash does not glob inside double quotes, so `"*.txt"` is a literal
    // value and calling it unknowable blocks a call whose target is fully decided.
    const result = tokenizeCommandLine('echo "*.txt"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '*.txt', opaque: false });
  });

  it('marks a double-quoted `?` glob as not opaque', () => {
    // Mutation caught: correcting the context for `*` and forgetting `?`, the other
    // glob character the opacity scan reads.
    const result = tokenizeCommandLine('echo "a?b"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: 'a?b', opaque: false });
  });

  it('keeps a bare glob opaque', () => {
    // The opposite end: outside quotes `*` is a runtime expansion whose result no static
    // reading knows, and A4 must not reach it.
    const result = tokenizeCommandLine('echo *.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '*.txt', opaque: true });
  });

  it('keeps a parameter expansion inside double quotes opaque', () => {
    // The fail-open direction of A4: switching opacity off wholesale inside double quotes.
    // `$X` still expands there, so a confident answer would hand a judge the literal text
    // `$X/dist` as if it were a decided path.
    const result = tokenizeCommandLine('echo "$X/dist"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '$X/dist', opaque: true });
  });

  it('keeps a backtick command substitution inside double quotes opaque', () => {
    // Same fail-open direction, the other live construct: command substitution runs inside
    // double quotes too, so only `*` and `?` may lose their opacity there.
    const result = tokenizeCommandLine('echo "`id`"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '`id`', opaque: true });
  });
});

describe('A5 — a leading assignment does not occupy the command name', () => {
  it('reaches the nested-shell boundary through a leading `NAME=VALUE`', () => {
    // Mutation caught: the command name read as words[0], which is the assignment, so the
    // basename check never sees `bash`. The line then yields no mutation AND no
    // indeterminate — a confident pass over a shell that re-parses its own argument.
    const result = extractMutations('FOO=1 bash -c "echo x"', []);

    expect(result).toEqual({
      mutations: [],
      indeterminate: [{ reason: 'nested shell execution: bash' }],
    });
  });

  it('reaches it through more than one leading assignment', () => {
    // Mutation caught: skipping exactly one assignment. Bash accepts any number, so a
    // single-step skip leaves `A=1 B=2 bash -c …` outside the boundary.
    const result = extractMutations('FOO=1 BAR=2 bash -c "x"', []);

    expect(result).toEqual({
      mutations: [],
      indeterminate: [{ reason: 'nested shell execution: bash' }],
    });
  });

  it('does not make an ordinary command indeterminate because it carries an assignment', () => {
    // The over-blocking end: an assignment prefix is not itself undecidable. Mutation
    // caught: treating any line with a leading assignment as indeterminate.
    const result = extractMutations('FOO=1 echo x', []);

    expect(result).toEqual({ mutations: [], indeterminate: [] });
  });

  it('handles an assignment with no command after it', () => {
    // The degenerate form: bash accepts a line that is only an assignment. Mutation caught:
    // skipping the assignments and then reading the command name off an empty word list.
    expect(() => extractMutations('FOO=1', [])).not.toThrow();

    expect(extractMutations('FOO=1', [])).toEqual({ mutations: [], indeterminate: [] });
  });

  it('does not discard the assignment text from the tokenized command', () => {
    // Mutation caught: implementing A5 by deleting leading assignments outright. A protected
    // path parked in an assignment value would then be absent from the token stream and a
    // mention judgment over those tokens would answer on a line it can no longer see. The
    // assertion is deliberately shape-free — the text may live in any field.
    const result = tokenizeCommandLine(`FOO=${protectedPathFixture} bash -c "x"`);

    expect(result.unread).toEqual([]);
    expect(JSON.stringify(result.commands[0])).toContain(protectedPathFixture);
  });
});

describe('A6 — the noclobber-override write operator `>|`', () => {
  it('recognizes `>|` as one redirect operator with its target', () => {
    // Mutation caught: the operator table missing `>|`, so `>` takes an empty target and the
    // whole line fails. Measured: `>|` truncates and writes even under `set -o noclobber`.
    const result = tokenizeCommandLine('echo x >| out.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'x', opaque: false },
    ]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>|', target: { text: 'out.txt', opaque: false } },
    ]);
  });

  it('recognizes the attached form `>|out.txt`', () => {
    // Mutation caught: matching `>|` only when whitespace follows it.
    const result = tokenizeCommandLine('echo x >|out.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>|', target: { text: 'out.txt', opaque: false } },
    ]);
  });

  it('grades a `>|` redirect as a write, same as `>`', () => {
    // Mutation caught: teaching the tokenizer `>|` while the write rule's operator list
    // still omits it. The line would then tokenize clean, produce no mutation target, and
    // stop reaching the fallback that blocks it today — a loosening that opens a hole.
    const result = extractMutations(`echo x >| ${protectedPathFixture}`, [redirectWriteRule]);

    expect(result).toEqual({
      mutations: [{ path: protectedPathFixture, rule: 'redirect-write' }],
      indeterminate: [],
    });
  });

  it('still fails on `>|` with no target', () => {
    // The opposite end: the new operator must be subject to the empty-target check the old
    // ones are. Mutation caught: an operator added to the table but exempted from it — which
    // COVENANT-18 §2-b B2 would now show as a confident redirect carrying an empty target
    // instead of a recorded span, so both are asserted.
    const result = tokenizeCommandLine('echo x >|');

    expect(result.unread).toEqual([{ text: '>|', reason: 'missing redirect target' }]);
    expect(result.commands[0].redirects).toEqual([]);
  });
});

describe("A7 — ANSI-C quoting `$'…'`", () => {
  it("honors the escaped quote inside `$'…'` and yields a literal word", () => {
    // Mutation caught: treating `$'` as a bare `$` followed by an ordinary single quote, so
    // the `\'` closes the string early and the pairing collapses. The result is also not
    // opaque: ANSI-C quoting produces a string constant, not an expansion.
    const result = tokenizeCommandLine("echo $'Here\\'s Johnny'");

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: "Here's Johnny", opaque: false },
    ]);
  });

  it("reads an empty `$''` as an empty literal word", () => {
    // The degenerate form: ANSI-C quoting with nothing to quote. Bash still passes an empty
    // argument. Mutation caught: a scanner that requires content inside `$'…'` and falls
    // back to reading the `$` as an expansion, which marks a decided empty word unknowable.
    const result = tokenizeCommandLine("echo $''");

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: '', opaque: false },
    ]);
  });
});

describe('A8 — process substitution in redirect-target position', () => {
  it('takes a spaced `>(…)` as the redirect target and marks it opaque', () => {
    // Mutation caught: looking for `>(`/`<(` only at word start, so after `> ` the target
    // scan stops at `(` and the line fails. The target must be opaque — its real path is a
    // /dev/fd entry only execution knows — and the inner `-c` must not leak as a word, or a
    // first-word allowlist would vouch for arguments it never saw.
    const result = tokenizeCommandLine('echo abc > >(wc -c)');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'abc', opaque: false },
    ]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>', target: { text: '>(wc -c)', opaque: true } },
    ]);
  });

  it('takes a spaced `<(…)` as the target of a read redirect', () => {
    // Mutation caught: fixing only the write direction. `cmd < <(…)` is the same shape and
    // is equally valid bash (measured), so a one-sided fix leaves half the form failing.
    const result = tokenizeCommandLine('wc -c < <(echo hi)');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '<', target: { text: '<(echo hi)', opaque: true } },
    ]);
  });

  it('reports the process-substitution target as indeterminate, never as a path', () => {
    // The fail-open this correction must not create: reading `>(wc -c)` as a decided target
    // would hand the write rule a literal path, and reading it as decided-and-harmless would
    // produce mutations:[] with indeterminate:[] — a confident pass over an unknowable write.
    const result = extractMutations('echo abc > >(wc -c)', [redirectWriteRule]);

    expect(result).toEqual({ mutations: [], indeterminate: [{ reason: 'opaque token' }] });
  });
});

// ===========================================================================
// Audit round (2026-07-29) — the half-fixes the first RED round would let pass.
// Each input here satisfies every test above while still getting bash wrong, so
// this block is what separates "the correction landed" from "one spelling of the
// correction landed". Measurements are bash 5.3.9, isolated with `bash -c` /
// `bash <file>` (the ambient shell is zsh and answers differently).
// ===========================================================================

describe('A1 (audit round) — the escaped backslash the pairing must survive', () => {
  it('closes at the quote after an escaped backslash and keeps one backslash', () => {
    // Mutation caught: the escape rule spelled "if the next character is a quote, skip
    // two". The first `\` is then not honored, the second one eats the real closing quote,
    // and this valid line becomes `unclosed quote` — A1's own defect in a new spelling.
    // Measured: `printf '[%s]' "a\\" b` prints `[a\][b]`, so the word ends at that quote
    // and bash reduces `\\` to a single backslash (the byte a fileChange would record).
    const result = tokenizeCommandLine('echo "a\\\\" b');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a\\', opaque: false },
      { text: 'b', opaque: false },
    ]);
  });
});

describe('A2 (audit round) — a quoting character anywhere in the delimiter word', () => {
  it('reads `<<E"O"F` as literal and still ends the body at a plain `EOF` line', () => {
    // Mutation caught: an A2 fix that adds `\` to the FIRST-character check. It passes
    // `<<\EOF`, `<<'EOF'` and `<<EOF` alike and still calls this body expandable. Measured:
    // `cat <<E"O"F` over a body of `$V` prints `$V` verbatim, and the terminator is the
    // dequoted `EOF` — so position is irrelevant and the quotes leave the delimiter text.
    const result = tokenizeCommandLine('cat <<E"O"F\n$D\nEOF');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: '$D\n', literal: true }]);
  });
});

describe('A6 (audit round) — the fd-prefixed noclobber-override forms', () => {
  it('recognizes `2>|` as one redirect operator with its target', () => {
    // Mutation caught: `>|` added to the plain-operator path only. The digit-prefix path is
    // separate, so `2>` would take `|` as the start of its target and the line would fail —
    // leaving a real write (measured: `2>| f` writes under `set -o noclobber`) in the
    // fallback, where no precise target and no fileChange evidence is ever computed.
    const result = tokenizeCommandLine('echo x 2>| err.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '2>|', target: { text: 'err.txt', opaque: false } },
    ]);
  });
});

describe('A7 (audit round) — escape decoding, and the branch it must not reach', () => {
  it("decodes the escapes inside `$'…'` into the bytes bash passes", () => {
    // Mutation caught: an A7 fix that re-pairs the quotes and hands back the source text.
    // The shipped `$'Here\'s Johnny'` case only forces `\'` to lose its backslash, so an
    // implementation with a two-entry escape table passes it and still records `\n` as two
    // bytes. Measured: `printf '%s' $'a\nb' | od -c` prints `a \n b`, and that text is what
    // a downstream fileChange would carry as written content.
    const result = tokenizeCommandLine("echo $'a\\nb' $'a\\tb'");

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a\nb', opaque: false },
      { text: 'a\tb', opaque: false },
    ]);
  });

  it('leaves a plain single-quoted word escape-free, closing at the quote after a backslash', () => {
    // A7 introduces escape awareness in the adjacent quoting branch, so the risk is that it
    // spreads. Measured: `printf '[%s]' 'a\' b` prints `[a\][b]` — inside single quotes bash
    // gives `\` no meaning at all. Mutation caught: the new escape handling applied to the
    // plain single-quote branch, which would swallow the closing quote and drop this valid
    // line into the fallback, where an allowlisted head can no longer absolve anything.
    const result = tokenizeCommandLine("echo 'a\\' b");

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a\\', opaque: false },
      { text: 'b', opaque: false },
    ]);
  });
});

describe('A8 (audit round) — the read-direction target must not leak its inner words', () => {
  it('consumes a spaced `< <(…)` whole, leaving no inner word at top level', () => {
    // The write direction already pins `words`; this is the same hazard in the direction the
    // shipped case only checks `redirects` for. Mutation caught: a read-direction fix that
    // recognizes `<(` and then scans the target as an ordinary word, so `sed`, `-i` and the
    // operand land in `words` behind a leading `cat` the allowlist would vouch for.
    const result = tokenizeCommandLine(`cat < <(sed -i s/a/b/ ${protectedPathFixture})`);

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([{ text: 'cat', opaque: false }]);
    expect(result.commands[0].redirects).toEqual([
      {
        operator: '<',
        target: { text: `<(sed -i s/a/b/ ${protectedPathFixture})`, opaque: true },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Judge-surface fixtures (PRD §3: the migrating lines are pinned at both ends on
// the judges themselves). Part A's effect is that lines MIGRATE out of the
// regex-mention fallback, where any mention blocks unconditionally, into precise
// judgment, where an allowlisted head can absolve. Tokenizer assertions cannot
// see that move at all. The tool name, command-arg key and protected path are
// injected fixture values, following the sibling suites.
// ---------------------------------------------------------------------------

const shellToolFixture = 'Bash';
const commandArgFixture = 'command';
const fallbackMentionReason = 'untokenizable command line mentions protected path';

/** A shell-tool call carrying `line` under the injected command-arg key. */
function shellCall(line: string): CovenantInput {
  return {
    toolCalls: [{ name: shellToolFixture, args: { [commandArgFixture]: line } }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** One protected path, the shipped read-only allowlist. */
function shellSpec(): ShellModificationSpec {
  return {
    protectedPaths: [protectedPathFixture],
    shellToolNames: [shellToolFixture],
    commandArgNames: [commandArgFixture],
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
  };
}

describe('judgeShellModification — lines migrating out of the untokenizable fallback', () => {
  it('still breaks an escaped-quote write, and answers with the precise write reason', () => {
    // The dangerous end of the migration. Mutation caught: A1 making the line readable
    // while the redirect target never reaches the write rule — the line leaves the fallback
    // that blocks it today and `echo`, an allowlisted head, absolves it. The reason
    // assertions are what prove WHO answered: without them this test stays green when the
    // fallback blocks by accident, which is not the same verdict at all.
    const verdict = judgeShellModification(
      shellCall(`echo "say \\"hi" > ${protectedPathFixture}`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('redirect-write');
      expect(verdict.reason).toContain(protectedPathFixture);
      expect(verdict.reason).not.toContain(fallbackMentionReason);
    }
  });

  it('upholds an allowlisted read that only A1 makes readable — an intended change', () => {
    // A deliberate behaviour change, and the over-blocking end this ticket exists to fix:
    // today the same line is blocked because the fallback has no allowlist. Once it
    // tokenizes, `grep` is a proven read and the shipped policy already absolves
    // `grep x <protected>`. Mutation caught: an A1 fix that keeps the escaped quote ending
    // the string early — the line stays in the fallback and the read stays blocked.
    expect(
      judgeShellModification(
        shellCall(`grep -rn "a\\|from \\"x\\"" ${protectedPathFixture}`),
        shellSpec(),
      ),
    ).toEqual({ upheld: true });
  });

  it('still breaks a `< <(…)` substitution that writes the protected path', () => {
    // The highest-stakes line in this ticket. Today tokenization fails and the fallback
    // blocks it; A8 hands it to precise judgment, where the verdict depends entirely on
    // `<(…)` being consumed as ONE opaque target. Mutation caught: the inner words leaking
    // to top level, which puts the protected path outside any opaque token and leaves the
    // allowlisted `cat` to absolve a command that writes the file — a protected write
    // passing. Excluding the fallback reason keeps the old answer from masking the new one.
    const verdict = judgeShellModification(
      shellCall(`cat < <(sed -i s/a/b/ ${protectedPathFixture})`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(protectedPathFixture);
      expect(verdict.reason).not.toContain(fallbackMentionReason);
    }
  });

  it('still breaks a protected path standing inside the escaped-quote span A1 leaves', () => {
    // The judge-surface half of the A1 case that keeps failing (the line whose only closing
    // quote is escaped). The span is what COVENANT-18 §2-b B2 hands back instead of a
    // discarded line, so this is where "the new shape did not weaken the old verdict" is
    // decided. Precise judgment cannot answer here — the decoded word ends in the quote
    // character, so its last segment no longer matches — and the span's own conservative
    // scan is what blocks. Mutation caught: the narrowed fallback dropped once the tokenizer
    // stopped failing, which turns this line from a block into a silent pass.
    const verdict = judgeShellModification(
      shellCall(`echo "${protectedPathFixture}\\"`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(`${fallbackMentionReason} ${protectedPathFixture}`);
    }
  });
});

describe('deriveShellChanges — the recording surface part A moves lines across', () => {
  it('files a nested-shell entry for a shell reached through a leading assignment', () => {
    // A5 where its absence is a fail-open rather than a mere blind spot: today this line
    // answers empty evidence AND empty unjudgeable, so a nested shell runs with no
    // telemetry row of any kind — the "passes unrecorded" defect class. Mutation caught:
    // the command name still read as words[0], so the basename check never sees `bash`;
    // the reason must name the shell that actually spawns, not the assignment in front.
    const result = deriveShellChanges('FOO=1 bash -c "x"');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBeUndefined();
    expect(result.unjudgeable[0].reason).toContain('bash');
    expect(result.unjudgeable[0].reason).not.toContain('FOO');
  });

  it('keeps an assignment carrying an opaque value recorded, never silent', () => {
    // The invariant A5 must not break while narrowing the command-name read: no call passes
    // unrecorded. Mutation caught: implementing the skip by dropping the leading assignments
    // before the scan, so `$(id)` stops signalling and the line answers empty/empty. The
    // reason text is left unpinned — either the opaque value or the nested shell may claim
    // it; what may not happen is silence.
    const result = deriveShellChanges('FOO=$(id) bash -c "x"');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable.length).toBeGreaterThan(0);
    for (const entry of result.unjudgeable) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('computes a `<<$V` heredoc write as evidence instead of refusing the whole line', () => {
    // A3 at the surface the PRD names as the clearest sign of what part A does: the line
    // leaves the common-skip bucket and becomes computed evidence, with the heredoc body as
    // written content. The delimiter carries no quoting character, so the body is the
    // expanding kind — this one holds no `$` or backtick, which is what keeps it judged
    // rather than skipped. Mutation caught: A3 landing in the tokenizer while the derivation
    // keeps a refusal of its own, so the write is recorded but never judged.
    expect(deriveShellChanges('cat > f.ts <<$V\nplain body\n$V')).toEqual({
      evidence: [{ path: 'f.ts', content: 'plain body\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('still refuses a `<<$V` body that carries an expansion, keeping the target path', () => {
    // The fail-open end of the same migration, and the reason A3 is a deletion of a
    // fail-closed branch. An unquoted delimiter leaves the body expanding (measured: a
    // `<<$V` body prints the VALUE of an inner `$V`), so the captured text is not what bash
    // writes. Mutation caught: A3 implemented as "a `$`-bearing delimiter is now always
    // computable", which would record fiction as fact — a confident wrong post-state.
    const result = deriveShellChanges('cat > f.ts <<$V\nvalue: $HOME\n$V');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBe('f.ts');
  });
});

// A9/A10 were found by re-measuring the corpora AFTER A1–A8 landed: the blind set fell to
// 2/2814 and 1/98, and those three lines had two causes left. One measurement could not have
// reached them, which is why §2-e makes the corpus a standing test rather than a one-off.

describe('A9 — paren matching honors quote state', () => {
  it('does not close a process substitution on a `)` inside a quoted regex', () => {
    // Mutation caught: counting parens without quote state. `[^)]` closes the substitution
    // early, the rest of the line re-enters as top level, and its quotes pair one position
    // off until the word scan reports `unclosed quote` — the whole valid line is lost. This
    // is the residual A1 class: a scanning primitive that ignores context.
    const result = tokenizeCommandLine('diff <(grep -oE "https?://[^)]+" a.md | sort) b.md');

    expect(result.unread).toEqual([]);
    const texts = result.commands[0].words.map((w) => w.text);
    expect(texts[0]).toBe('diff');
    expect(texts[1]).toBe('<(grep -oE "https?://[^)]+" a.md | sort)');
    expect(texts[2]).toBe('b.md');
  });

  it('does not close a command substitution on a `)` inside a single-quoted word', () => {
    // The other quoting form, and the other matchParen caller. Mutation caught: honoring
    // double quotes only.
    const result = tokenizeCommandLine("echo $(grep -c 'x)y' f) done");

    expect(result.unread).toEqual([]);
    const words = result.commands[0].words;
    expect(words[1]).toEqual({ text: "$(grep -c 'x)y' f)", opaque: true });
    expect(words[2].text).toBe('done');
  });

  it('still ends a substitution at an unquoted `)`', () => {
    // The control for the loosening. Mutation caught: suspending the count so broadly that
    // a plain close paren stops ending the substitution, which would swallow the rest of the
    // line into one opaque word and hide any protected path standing after it.
    const result = tokenizeCommandLine('echo $(id) after');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '$(id)', opaque: true });
    expect(result.commands[0].words[2].text).toBe('after');
  });
});

describe('A1 at the judge surface — the mention scan now reads the bytes bash passes', () => {
  it('sees a protected path that a backslash escape used to hide inside double quotes', () => {
    // Measured on the real corpus: this verdict flipped from PASS to BLOCK when A1 landed,
    // and it is the only line in 2,815 whose verdict direction changed. Before A1 the token
    // text kept the backslashes bash removes (`\`` is in the double-quote escape set), so the
    // segment match saw `\`packages/core` and missed. COVENANT-07d closed exactly this glue
    // on the tokenize-FAILURE path by stripping quotes and backslashes; the tokenize-SUCCESS
    // path kept reading bytes the shell would never pass. Mutation caught: an A1 that re-pairs
    // the quotes but hands back the source text instead of the decoded content.
    const spec: ShellModificationSpec = {
      protectedPaths: [protectedPathFixture.slice(0, protectedPathFixture.lastIndexOf('/'))],
      shellToolNames: ['Bash'],
      commandArgNames: ['command'],
      readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
    };
    const call = (command: string): CovenantInput => ({
      toolCalls: [{ name: 'Bash', args: { command } }],
      subagentSpawns: [],
      userMessages: [],
    });

    // `\`` decodes to a bare backtick, leaving the path as its own segment run again.
    const escaped = judgeShellModification(
      call('gh pr create --body "touches \\`packages/core/dist\\` today"'),
      spec,
    );
    expect(escaped.upheld).toBe(false);

    // The same sentence without the escapes was already blocked — the two spellings must not
    // disagree, which is the whole point of decoding before the scan.
    const plain = judgeShellModification(
      call('gh pr create --body "touches packages/core/dist today"'),
      spec,
    );
    expect(plain.upheld).toBe(false);
  });
});

describe('A10 — the read-direction `<&` operator', () => {
  it('reads `<&-` as one operator closing a descriptor', () => {
    // Mutation caught: an operator table carrying `>&` without its twin. `<&-` degrades to a
    // lone `<` whose target scan stops on `&`, so a valid line dies as a missing target.
    const result = tokenizeCommandLine('exec {FD[0]}<&- {FD[1]}>&-');

    expect(result.unread).toEqual([]);
    const ops = result.commands[0].redirects.map((r) => `${r.operator}${r.target.text}`);
    expect(ops).toEqual(['<&-', '>&-']);
  });

  it('does not grade an fd close as a write to a file named "-"', () => {
    // The direction that matters for judging: `<&` is a read, and `>&-` closes rather than
    // writes. Mutation caught: either one reported as a mutation target, which would put a
    // path named `-` into evidence for a line that touches no file.
    const result = extractMutations('exec {FD[0]}<&- {FD[1]}>&-', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });
});
