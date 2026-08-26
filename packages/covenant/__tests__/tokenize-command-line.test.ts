import { describe, expect, it } from 'vitest';
import { tokenizeCommandLine } from '../src/bash-line.js';

describe('§5.1 quote preservation', () => {
  it('keeps a single-quoted string containing a command separator as one word', () => {
    // Splitting on `;` regardless of quote state produces more than one command and loses
    // the literal semicolon inside the word.
    const result = tokenizeCommandLine("echo 'a; b' > f");

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a; b', opaque: false },
    ]);
  });

  it('keeps a double-quoted string with an internal space as one word', () => {
    const result = tokenizeCommandLine('echo "x y"');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'x y', opaque: false },
    ]);
  });

  it('respects a backslash escape so the escaped separator does not split words', () => {
    const result = tokenizeCommandLine('echo a\\;b');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a;b', opaque: false },
    ]);
  });
});

describe('§5.1 command splitting on control operators', () => {
  it('splits "a && b | c; d" into four simple commands', () => {
    // Both an off-by-one in the split and a control operator read as a word fail this.
    const result = tokenizeCommandLine('a && b | c; d');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(4);
    expect(result.commands.map((c) => c.words.map((w) => w.text))).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
    ]);
  });

  it('treats a standalone "&" (background) as a command separator, not a word', () => {
    // A lexer handling only "&&"/"&>" folds a lone "&" into the neighbouring word and
    // corrupts the command boundaries.
    const result = tokenizeCommandLine('a & b');

    expect(result.unread).toEqual([]);
    expect(result.commands.map((c) => c.words.map((w) => w.text))).toEqual([['a'], ['b']]);
  });
});

describe('§5.1 redirect operator separation', () => {
  it('separates a spaced redirect operator (">") from its target word', () => {
    const result = tokenizeCommandLine('echo hi > f');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'hi', opaque: false },
    ]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>', target: { text: 'f', opaque: false } },
    ]);
  });

  it('recognizes the attached form ">f" (no space) as a redirect, not a word', () => {
    // Recognizing only redirects preceded by whitespace folds ">f" into a plain word instead
    // of an operator and target pair.
    const result = tokenizeCommandLine('echo hi >f');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>', target: { text: 'f', opaque: false } },
    ]);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'hi', opaque: false },
    ]);
  });

  it('recognizes the append operator ">>"', () => {
    const result = tokenizeCommandLine('echo hi >> f');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>>', target: { text: 'f', opaque: false } },
    ]);
  });

  it('recognizes the file-descriptor redirect "2>"', () => {
    const result = tokenizeCommandLine('cmd 2> err.log');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '2>', target: { text: 'err.log', opaque: false } },
    ]);
  });

  it('recognizes the combined stdout+stderr redirect "&>"', () => {
    const result = tokenizeCommandLine('cmd &> all.log');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '&>', target: { text: 'all.log', opaque: false } },
    ]);
  });

  it('recognizes the fd append form "2>>" as one operator, preserving append semantics', () => {
    // Greedy two-character matching splits "2>>" into "2>" with an empty target plus a
    // phantom ">" redirect, silently turning an append into a truncate.
    const result = tokenizeCommandLine('cmd 2>> err.log');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '2>>', target: { text: 'err.log', opaque: false } },
    ]);
  });

  it('recognizes the combined append form "&>>"', () => {
    const result = tokenizeCommandLine('cmd &>> all.log');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '&>>', target: { text: 'all.log', opaque: false } },
    ]);
  });

  it('folds a multi-digit fd prefix into the redirect ("12> f" leaves no "12" word)', () => {
    // Bash sends fd 12 to f and the command receives no "12" operand, so a single-digit fd
    // scan leaves a word the real command never gets.
    const result = tokenizeCommandLine('tee 12> f');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words).toEqual([{ text: 'tee', opaque: false }]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '12>', target: { text: 'f', opaque: false } },
    ]);
  });

  it('consumes a process substitution ">(…)" as one opaque word, not a redirect', () => {
    // Process substitution is a word-level filename token bash executes, not a redirect. If
    // `>` split it as one, the inner command's args leak as top-level words; the whole
    // `>(tee f)` must stay one opaque word so the inner write stays inside an opaque token.
    const result = tokenizeCommandLine('cmd >(tee f)');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([]);
    expect(result.commands[0].words).toEqual([
      { text: 'cmd', opaque: false },
      { text: '>(tee f)', opaque: true },
    ]);
  });

  it('consumes a process substitution "<(…)" as one opaque word — no inner-arg leak', () => {
    // If the inner `sed`, `-i` and the path leak as top-level words of the outer command, a
    // first-word allowlist absolves the whole line while bash runs the inner write.
    const result = tokenizeCommandLine('cat <(sed -i s/a/b/ p)');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].redirects).toEqual([]);
    expect(result.commands[0].words).toEqual([
      { text: 'cat', opaque: false },
      { text: '<(sed -i s/a/b/ p)', opaque: true },
    ]);
  });

  it('recognizes fd duplication "1>&2" as one command, not a phantom background split', () => {
    // Consuming the "&" inside ">&" as a control operator splits a bogus second command
    // ["2"] off a plain stderr redirect.
    const result = tokenizeCommandLine('cmd 1>&2');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([{ text: 'cmd', opaque: false }]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '1>&', target: { text: '2', opaque: false } },
    ]);
  });
});

describe('§5.1 opacity detection', () => {
  it('marks a command-substitution token "$(echo f)" as opaque', () => {
    const result = tokenizeCommandLine('cat $(echo f)');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '$(echo f)', opaque: true });
  });

  it('marks a backtick command-substitution token as opaque', () => {
    const result = tokenizeCommandLine('cat `echo f`');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '`echo f`', opaque: true });
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional bash expansion fixture
  it('marks a braced parameter expansion "${FILE}" as opaque', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional bash expansion fixture
    const result = tokenizeCommandLine('cat ${FILE}');

    expect(result.unread).toEqual([]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional bash expansion fixture
    expect(result.commands[0].words[1]).toEqual({ text: '${FILE}', opaque: true });
  });

  it('marks a bare variable reference "$var" as opaque', () => {
    const result = tokenizeCommandLine('cat $var');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '$var', opaque: true });
  });

  it('marks a glob token containing "*" as opaque', () => {
    const result = tokenizeCommandLine('cat *.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '*.txt', opaque: true });
  });

  it('marks a plain literal token as not opaque', () => {
    const result = tokenizeCommandLine('cat plain.txt');

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: 'plain.txt', opaque: false });
  });

  it('does NOT mark a single-quoted "$var" as opaque (no expansion inside single quotes)', () => {
    // Scanning the raw source text, quote characters included, ignores single-quote's
    // no-expansion semantics.
    const result = tokenizeCommandLine("cat '$var'");

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words[1]).toEqual({ text: '$var', opaque: false });
  });
});

describe('§5.1 tokenization failure (fail-closed)', () => {
  // The claim each case makes is that the input is not read cleanly, and a non-empty `unread`
  // list is what carries it.
  it('reports an unread span for an unclosed single quote instead of throwing', () => {
    expect(() => tokenizeCommandLine("echo 'oops")).not.toThrow();
    const result = tokenizeCommandLine("echo 'oops");
    expect(result.unread).toHaveLength(1);
  });

  it('reports an unread span for an unclosed double quote instead of throwing', () => {
    expect(() => tokenizeCommandLine('echo "oops')).not.toThrow();
    const result = tokenizeCommandLine('echo "oops');
    expect(result.unread).toHaveLength(1);
  });

  it('reports an unread span for a redirect with no target (bash would syntax-error)', () => {
    // Emitting a confident, non-opaque empty-string target gives a clean-looking result for
    // a line whose parse never found a target.
    const result = tokenizeCommandLine('echo hi >');
    expect(result.unread).toHaveLength(1);
    expect(result.commands[0].redirects).toEqual([]);
  });
});
