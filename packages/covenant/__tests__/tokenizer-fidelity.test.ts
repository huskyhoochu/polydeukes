import type { CovenantInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { extractMutations, tokenizeCommandLine } from '../src/bash-line.ts';
import { redirectWriteRule } from '../src/mutation-rules.ts';
import { deriveShellChanges } from '../src/shell-evidence.ts';
import {
  DEFAULT_READ_ONLY_COMMANDS,
  judgeShellModification,
  type ShellModificationSpec,
} from '../src/shell-mod.ts';

// Scanner fidelity against real bash. Every input below was measured against bash 5.3.9, which
// accepts and executes each one, so the expectations are that shell's answers rather than this
// package's. Each block also pins the opposite end of the axis it loosens: a correction that
// only widens is a regression waiting to be measured.

// A repository-shaped path for the cases where a token stands in for a protected path. The
// tokenizer has no notion of protection; the value only has to be recognizable, so a token
// the scanner silently drops shows up in the assertion.
const protectedPathFixture = 'packages/core/dist/index.js';

describe('escaped quotes inside a double-quoted string', () => {
  it('closes the string at the unescaped quote, keeping an escaped quote as content', () => {
    // Pairing the opening quote with the next `"` found by indexOf closes at the escaped `\"`,
    // pairs every quote after it one position off, and leaves a valid line unread.
    const result = tokenizeCommandLine('echo "say \\"hi\\""');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'say "hi"', opaque: false },
    ]);
  });

  it('keeps a pipe inside such a string out of the command split', () => {
    // Mis-paired quotes leave the `|` outside quote state, so this line splits into two
    // commands and `src/` lands in the wrong one. Asserting the word count and both ends pins
    // the pairing without pinning the pattern's own escapes.
    const result = tokenizeCommandLine('grep -rn "a\\|from \\"x\\"" src/');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    const texts = result.commands[0].words.map((w) => w.text);
    expect(texts).toHaveLength(4);
    expect(texts[0]).toBe('grep');
    expect(texts[3]).toBe('src/');
  });

  it('retains a backslash that quotes nothing, as bash does inside double quotes', () => {
    // The control for the loosening. Inside double quotes bash removes the backslash only
    // before $ ` " \ and newline — measured, `printf '[%s]' "a\|b"` prints `a\|b` — so
    // honouring `\` unconditionally strips one and silently rewrites the pattern above.
    const result = tokenizeCommandLine('echo "a\\|b"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: 'a\\|b', opaque: false });
  });

  it('still fails when the only closing quote on the line is an escaped one', () => {
    // Applying the escape rule while extracting the text but falling back to indexOf for the
    // failure decision lets `\"` close the string, so a line bash rejects for an unexpected
    // EOF tokenizes clean. The claim that this quote never closes is carried by a non-empty
    // `unread`; the judge-surface half of the case is below.
    const result = tokenizeCommandLine('echo "a\\"');

    expect(result.unread).toEqual([{ text: '"a\\"', reason: 'unclosed quote' }]);
  });
});

describe('a backslash-quoted heredoc delimiter', () => {
  it('reads `<<\\EOF` as a literal delimiter, so the body is not expanded', () => {
    // Measured: `cat <<\EOF` over a body of `$D` prints `$D`, exactly as `<<'EOF'` does, so
    // deciding the delimiter's quoting from `'` and `"` alone misreads it. Reporting
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
    // The opposite end: measured, a bare `<<EOF` body prints the VALUE of `$D`, so its text is
    // not what bash writes and flipping every delimiter to literal is wrong.
    const result = tokenizeCommandLine('cat <<EOF\n$D\nEOF');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: '$D\n', literal: false }]);
  });
});

describe('a heredoc delimiter is never expanded', () => {
  it('tokenizes `<<$DELIM` and ends the body at the literal delimiter text', () => {
    // Measured: `bash -n` accepts the line and execution terminates the body at the literal
    // `$DELIM` line, never at the variable's value, so the body end is statically decidable and
    // refusing an opaque delimiter models the shell wrongly.
    const result = tokenizeCommandLine('cat <<$DELIM\ninside\n$DELIM');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: 'inside\n', literal: false }]);
  });

  it('does not end a `<<$DELIM` body on the delimiter with its `$` stripped', () => {
    // Normalizing `$DELIM` to `DELIM` ends the body one line early and loses every command
    // after it: measured, bash reads a bare `DELIM` line as body text.
    const result = tokenizeCommandLine('cat <<$DELIM\nDELIM\n$DELIM');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: 'DELIM\n', literal: false }]);
  });

  it('tokenizes a command-substitution delimiter `<<$(x)` the same way', () => {
    // Measured identically: `bash -n` accepts `cat <<$(x)` and execution ends the body at the
    // literal `$(x)` line, so the same static decision holds for both spellings.
    const result = tokenizeCommandLine('cat <<$(x)\ninside\n$(x)');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: 'inside\n', literal: false }]);
  });
});

describe('globbing does not apply inside double quotes', () => {
  it('marks a double-quoted `*` glob as not opaque', () => {
    // Bash does not glob inside double quotes, so `"*.txt"` is a literal value: running the
    // opacity scan over the quoted fragment with unquoted rules calls a fully decided target
    // unknowable.
    const result = tokenizeCommandLine('echo "*.txt"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '*.txt', opaque: false });
  });

  it('marks a double-quoted `?` glob as not opaque', () => {
    // `?` is the other glob character the opacity scan reads, and it needs the same context.
    const result = tokenizeCommandLine('echo "a?b"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: 'a?b', opaque: false });
  });

  it('keeps a bare glob opaque', () => {
    // The opposite end: outside quotes `*` is a runtime expansion whose result no static
    // reading knows.
    const result = tokenizeCommandLine('echo *.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '*.txt', opaque: true });
  });

  it('keeps a parameter expansion inside double quotes opaque', () => {
    // The fail-open direction: `$X` still expands inside double quotes, so switching opacity
    // off wholesale there hands a judge the literal text `$X/dist` as a decided path.
    const result = tokenizeCommandLine('echo "$X/dist"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '$X/dist', opaque: true });
  });

  it('keeps a backtick command substitution inside double quotes opaque', () => {
    // The other live construct: command substitution runs inside double quotes too, so only
    // `*` and `?` may lose their opacity there.
    const result = tokenizeCommandLine('echo "`id`"');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '`id`', opaque: true });
  });
});

describe('a leading assignment does not occupy the command name', () => {
  it('reaches the nested-shell boundary through a leading `NAME=VALUE`', () => {
    // Reading the command name as words[0] reads the assignment, so the basename check never
    // sees `bash` and the line yields no mutation AND no indeterminate — a confident pass over
    // a shell that re-parses its own argument.
    const result = extractMutations('FOO=1 bash -c "echo x"', []);

    expect(result).toEqual({
      mutations: [],
      indeterminate: [{ reason: 'nested shell execution: bash' }],
    });
  });

  it('reaches it through more than one leading assignment', () => {
    // Bash accepts any number of assignments, so a single-step skip leaves `A=1 B=2 bash -c …`
    // outside the nested-shell boundary.
    const result = extractMutations('FOO=1 BAR=2 bash -c "x"', []);

    expect(result).toEqual({
      mutations: [],
      indeterminate: [{ reason: 'nested shell execution: bash' }],
    });
  });

  it('does not make an ordinary command indeterminate because it carries an assignment', () => {
    // The over-blocking end: an assignment prefix is not itself undecidable.
    const result = extractMutations('FOO=1 echo x', []);

    expect(result).toEqual({ mutations: [], indeterminate: [] });
  });

  it('handles an assignment with no command after it', () => {
    // The degenerate form: bash accepts a line that is only an assignment, so the command name
    // is read off an empty word list.
    expect(() => extractMutations('FOO=1', [])).not.toThrow();

    expect(extractMutations('FOO=1', [])).toEqual({ mutations: [], indeterminate: [] });
  });

  it('does not discard the assignment text from the tokenized command', () => {
    // Deleting leading assignments outright removes a protected path parked in an assignment
    // value from the token stream, and a mention judgment over those tokens then answers on a
    // line it can no longer see. The assertion is deliberately shape-free: the text may live
    // in any field.
    const result = tokenizeCommandLine(`FOO=${protectedPathFixture} bash -c "x"`);

    expect(result.unread).toEqual([]);
    expect(JSON.stringify(result.commands[0])).toContain(protectedPathFixture);
  });
});

describe('the noclobber-override write operator `>|`', () => {
  it('recognizes `>|` as one redirect operator with its target', () => {
    // Measured: `>|` truncates and writes even under `set -o noclobber`. Missing from the
    // operator table, `>` takes an empty target and the whole line fails.
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
    // The attached form matters too: matching `>|` only when whitespace follows misses it.
    const result = tokenizeCommandLine('echo x >|out.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>|', target: { text: 'out.txt', opaque: false } },
    ]);
  });

  it('grades a `>|` redirect as a write, same as `>`', () => {
    // Teaching the tokenizer `>|` while the write rule's operator list omits it makes the line
    // tokenize clean, produce no mutation target, and stop reaching the fallback that blocked
    // it — a loosening that opens a hole.
    const result = extractMutations(`echo x >| ${protectedPathFixture}`, [redirectWriteRule]);

    expect(result).toEqual({
      mutations: [{ path: protectedPathFixture, rule: 'redirect-write' }],
      indeterminate: [],
    });
  });

  it('still fails on `>|` with no target', () => {
    // The opposite end: the operator is subject to the same empty-target check as the others.
    // Exempting it yields a confident redirect carrying an empty target instead of a recorded
    // span, so both are asserted.
    const result = tokenizeCommandLine('echo x >|');

    expect(result.unread).toEqual([{ text: '>|', reason: 'missing redirect target' }]);
    expect(result.commands[0].redirects).toEqual([]);
  });
});

describe("ANSI-C quoting `$'…'`", () => {
  it("honors the escaped quote inside `$'…'` and yields a literal word", () => {
    // Treating `$'` as a bare `$` followed by an ordinary single quote lets the `\'` close the
    // string early and collapses the pairing. The result is also not opaque: ANSI-C quoting
    // produces a string constant, not an expansion.
    const result = tokenizeCommandLine("echo $'Here\\'s Johnny'");

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: "Here's Johnny", opaque: false },
    ]);
  });

  it("reads an empty `$''` as an empty literal word", () => {
    // Bash still passes an empty argument here. A scanner requiring content inside `$'…'`
    // falls back to reading the `$` as an expansion and marks a decided empty word unknowable.
    const result = tokenizeCommandLine("echo $''");

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: '', opaque: false },
    ]);
  });
});

describe('process substitution in redirect-target position', () => {
  it('takes a spaced `>(…)` as the redirect target and marks it opaque', () => {
    // Looking for `>(`/`<(` only at word start stops the target scan at `(` after `> ` and
    // fails the line. The target must be opaque — its real path is a /dev/fd entry only
    // execution knows — and the inner `-c` must not leak as a word, or a first-word allowlist
    // vouches for arguments it never saw.
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
    // `cmd < <(…)` is the same shape and equally valid bash (measured), so fixing only the
    // write direction leaves half the form failing.
    const result = tokenizeCommandLine('wc -c < <(echo hi)');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '<', target: { text: '<(echo hi)', opaque: true } },
    ]);
  });

  it('reports the process-substitution target as indeterminate, never as a path', () => {
    // Reading `>(wc -c)` as a decided target hands the write rule a literal path; reading it
    // as decided and harmless produces mutations:[] with indeterminate:[], a confident pass
    // over an unknowable write.
    const result = extractMutations('echo abc > >(wc -c)', [redirectWriteRule]);

    expect(result).toEqual({ mutations: [], indeterminate: [{ reason: 'opaque token' }] });
  });
});

// Every input below satisfies each case above while still getting bash wrong, so this half of
// the file separates a correction that landed from one spelling of it that landed. Measurements
// are bash 5.3.9, isolated with `bash -c` or `bash <file>`: this project's ambient shell is zsh
// and answers differently.

describe('the escaped backslash the pairing must survive (re-measured)', () => {
  it('closes at the quote after an escaped backslash and keeps one backslash', () => {
    // An escape rule spelled "if the next character is a quote, skip two" leaves the first `\`
    // unhonoured, so the second eats the real closing quote and this valid line reads as an
    // unclosed one. Measured: `printf '[%s]' "a\\" b` prints `[a\][b]`, so the word ends at
    // that quote and bash reduces `\\` to a single backslash — the byte a fileChange records.
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

describe('a quoting character anywhere in the delimiter word (re-measured)', () => {
  it('reads `<<E"O"F` as literal and still ends the body at a plain `EOF` line', () => {
    // Adding `\` to a FIRST-character check passes `<<\EOF`, `<<'EOF'` and `<<EOF` alike and
    // still calls this body expandable. Measured: `cat <<E"O"F` over a body of `$V` prints `$V`
    // verbatim and the terminator is the dequoted `EOF`, so position is irrelevant and the
    // quotes leave the delimiter text.
    const result = tokenizeCommandLine('cat <<E"O"F\n$D\nEOF');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].heredocs).toEqual([{ body: '$D\n', literal: true }]);
  });
});

describe('the fd-prefixed noclobber-override forms (re-measured)', () => {
  it('recognizes `2>|` as one redirect operator with its target', () => {
    // The digit-prefix path is separate, so `>|` added to the plain-operator path only leaves
    // `2>` taking `|` as the start of its target and the line failing. That drops a real write
    // — measured, `2>| f` writes under `set -o noclobber` — into the fallback, where no precise
    // target and no fileChange evidence is ever computed.
    const result = tokenizeCommandLine('echo x 2>| err.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '2>|', target: { text: 'err.txt', opaque: false } },
    ]);
  });
});

describe('escape decoding, and the branch it must not reach (re-measured)', () => {
  it("decodes the escapes inside `$'…'` into the bytes bash passes", () => {
    // Re-pairing the quotes and handing back the source text passes the `$'Here\'s Johnny'`
    // case above — it only forces `\'` to lose its backslash — while still recording `\n` as
    // two bytes. Measured: `printf '%s' $'a\nb' | od -c` prints `a \n b`, and that text is
    // what a downstream fileChange carries as written content.
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
    // Escape awareness in the ANSI-C branch sits next to the plain single-quote branch, where
    // it must not spread. Measured: `printf '[%s]' 'a\' b` prints `[a\][b]` — inside single
    // quotes bash gives `\` no meaning at all — so escape handling applied here swallows the
    // closing quote and drops a valid line into the fallback, where no head can absolve it.
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

describe('the read-direction target must not leak its inner words (re-measured)', () => {
  it('consumes a spaced `< <(…)` whole, leaving no inner word at top level', () => {
    // The write direction pins `words` above; this is the same hazard where only `redirects`
    // is otherwise checked. Recognizing `<(` and then scanning the target as an ordinary word
    // lands `sed`, `-i` and the operand in `words` behind a leading `cat` the allowlist vouches
    // for.
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

// Judge-surface fixtures. Every correction above moves lines out of the mention fallback, where
// any mention blocks unconditionally, into precise judgment, where an allowlisted head can
// absolve — and tokenizer assertions cannot see that move at all. Each line is therefore pinned
// at both ends on the judges themselves.

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
    // The dangerous end of the move: making the line readable while the redirect target never
    // reaches the write rule takes it out of the fallback that blocked it and lets `echo`, an
    // allowlisted head, absolve it. The reason assertions prove who answered — without them
    // this stays green when the fallback blocks by accident.
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

  it('upholds an allowlisted read that only escape-aware pairing makes readable', () => {
    // The over-blocking end: the fallback has no allowlist, so this line blocks there. Once
    // it tokenizes, `grep` is a proven read and the shipped policy absolves
    // `grep x <protected>`. A fix that still lets the escaped quote end the string early
    // leaves the line in the fallback and the read blocked.
    expect(
      judgeShellModification(
        shellCall(`grep -rn "a\\|from \\"x\\"" ${protectedPathFixture}`),
        shellSpec(),
      ),
    ).toEqual({ upheld: true });
  });

  it('still breaks a `< <(…)` substitution that writes the protected path', () => {
    // The highest-stakes line here: once it reaches precise judgment the verdict depends
    // entirely on `<(…)` being consumed as ONE opaque target. Inner words leaking to top level
    // put the protected path outside any opaque token and leave the allowlisted `cat` to
    // absolve a command that writes the file. Excluding the fallback reason keeps the old
    // answer from masking the new one.
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

  it('still breaks a protected path standing inside the escaped-quote span', () => {
    // The judge-surface half of the case above whose only closing quote is escaped. Precise
    // judgment cannot answer here — the decoded word ends in the quote character, so its last
    // segment no longer matches — and the span's own conservative scan is what blocks.
    // Dropping the narrowed fallback once the tokenizer stopped failing turns this line from a
    // block into a silent pass.
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
    // Where reading the command name as words[0] is a fail-open rather than a blind spot: the
    // line answers empty evidence AND empty unjudgeable, so a nested shell runs with no
    // telemetry row of any kind. The reason must name the shell that actually spawns, not the
    // assignment in front of it.
    const result = deriveShellChanges('FOO=1 bash -c "x"');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBeUndefined();
    expect(result.unjudgeable[0].reason).toContain('bash');
    expect(result.unjudgeable[0].reason).not.toContain('FOO');
  });

  it('keeps an assignment carrying an opaque value recorded, never silent', () => {
    // The invariant that must survive narrowing the command-name read: no call passes
    // unrecorded. Implementing the skip by dropping the leading assignments before the scan
    // stops `$(id)` signalling and answers empty/empty. The reason text is left unpinned —
    // either the opaque value or the nested shell may claim it; only silence is forbidden.
    const result = deriveShellChanges('FOO=$(id) bash -c "x"');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable.length).toBeGreaterThan(0);
    for (const entry of result.unjudgeable) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('computes a `<<$V` heredoc write as evidence instead of refusing the whole line', () => {
    // The line leaves the common-skip bucket and becomes computed evidence with the heredoc
    // body as written content. The delimiter carries no quoting character, so the body is the
    // expanding kind, and it holds no `$` or backtick — which is what keeps it judged rather
    // than skipped. A derivation that keeps a refusal of its own records the write and never
    // judges it.
    expect(deriveShellChanges('cat > f.ts <<$V\nplain body\n$V')).toEqual({
      evidence: [{ path: 'f.ts', content: 'plain body\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('still refuses a `<<$V` body that carries an expansion, keeping the target path', () => {
    // The fail-open end of the same case. An unquoted delimiter leaves the body expanding —
    // measured, a `<<$V` body prints the VALUE of an inner `$V` — so the captured text is not
    // what bash writes. Treating a `$`-bearing delimiter as always computable records fiction
    // as fact.
    const result = deriveShellChanges('cat > f.ts <<$V\nvalue: $HOME\n$V');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBe('f.ts');
  });
});

// The two cases below were found only by re-measuring the corpora after every correction above
// had landed. One measurement round could not have reached them, which is why the corpus is a
// standing test rather than a one-off.

describe('paren matching honors quote state', () => {
  it('does not close a process substitution on a `)` inside a quoted regex', () => {
    // Counting parens without quote state closes the substitution early at `[^)]`, so the rest
    // of the line re-enters as top level and its quotes pair one position off until the word
    // scan reports an unclosed quote — the whole valid line is lost.
    const result = tokenizeCommandLine('diff <(grep -oE "https?://[^)]+" a.md | sort) b.md');

    expect(result.unread).toEqual([]);
    const texts = result.commands[0].words.map((w) => w.text);
    expect(texts[0]).toBe('diff');
    expect(texts[1]).toBe('<(grep -oE "https?://[^)]+" a.md | sort)');
    expect(texts[2]).toBe('b.md');
  });

  it('does not close a command substitution on a `)` inside a single-quoted word', () => {
    // The other quoting form, and the other caller of the paren matcher.
    const result = tokenizeCommandLine("echo $(grep -c 'x)y' f) done");

    expect(result.unread).toEqual([]);
    const words = result.commands[0].words;
    expect(words[1]).toEqual({ text: "$(grep -c 'x)y' f)", opaque: true });
    expect(words[2].text).toBe('done');
  });

  it('still ends a substitution at an unquoted `)`', () => {
    // The control for the loosening: suspending the count so broadly that a plain close paren
    // stops ending the substitution swallows the rest of the line into one opaque word and
    // hides any protected path standing after it.
    const result = tokenizeCommandLine('echo $(id) after');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '$(id)', opaque: true });
    expect(result.commands[0].words[2].text).toBe('after');
  });
});

describe('escaped quotes at the judge surface — the mention scan reads the bytes bash passes', () => {
  it('sees a protected path that a backslash escape used to hide inside double quotes', () => {
    // A token text that keeps the backslashes bash removes — `` \` `` is in the double-quote
    // escape set — leaves the segment match looking at `` \`packages/core `` and missing. The
    // failure path already strips quotes and backslashes; the success path has to decode too,
    // so a scanner that re-pairs the quotes and hands back the source text disagrees with
    // itself across the two paths.
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

describe('the read-direction `<&` operator', () => {
  it('reads `<&-` as one operator closing a descriptor', () => {
    // An operator table carrying `>&` without its twin degrades `<&-` to a lone `<` whose
    // target scan stops on `&`, so a valid line dies as a missing target.
    const result = tokenizeCommandLine('exec {FD[0]}<&- {FD[1]}>&-');

    expect(result.unread).toEqual([]);
    const ops = result.commands[0].redirects.map((r) => `${r.operator}${r.target.text}`);
    expect(ops).toEqual(['<&-', '>&-']);
  });

  it('does not grade an fd close as a write to a file named "-"', () => {
    // `<&` is a read and `>&-` closes rather than writes, so reporting either as a mutation
    // target puts a path named `-` into evidence for a line that touches no file.
    const result = extractMutations('exec {FD[0]}<&- {FD[1]}>&-', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });
});
