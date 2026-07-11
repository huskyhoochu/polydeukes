import { describe, expect, it } from 'vitest';
// COVENANT-04a §4.1/§5.1. The module does not exist yet (RED phase) — this import
// must fail to resolve until bash-line.ts is implemented.
import { tokenizeCommandLine } from '../src/bash-line.js';

describe('§5.1 quote preservation', () => {
  it('keeps a single-quoted string containing a command separator as one word', () => {
    // Mutation caught: a tokenizer that splits on `;` regardless of quote state would
    // produce more than one command and lose the literal semicolon inside the word.
    const result = tokenizeCommandLine("echo 'a; b' > f");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a; b', opaque: false },
    ]);
  });

  it('keeps a double-quoted string with an internal space as one word', () => {
    const result = tokenizeCommandLine('echo "x y"');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'x y', opaque: false },
    ]);
  });

  it('respects a backslash escape so the escaped separator does not split words', () => {
    const result = tokenizeCommandLine('echo a\\;b');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a;b', opaque: false },
    ]);
  });
});

describe('§5.1 command splitting on control operators', () => {
  it('splits "a && b | c; d" into four simple commands', () => {
    // Mutation caught: an off-by-one in the split (3 or 5 commands), or a control
    // operator treated as a word instead of a separator.
    const result = tokenizeCommandLine('a && b | c; d');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands).toHaveLength(4);
    expect(result.commands.map((c) => c.words.map((w) => w.text))).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
    ]);
  });

  it('treats a standalone "&" (background) as a command separator, not a word', () => {
    // Mutation caught: a lexer that only handles "&&"/"&>" and folds a lone "&"
    // into the preceding or following word, corrupting command boundaries.
    const result = tokenizeCommandLine('a & b');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands.map((c) => c.words.map((w) => w.text))).toEqual([['a'], ['b']]);
  });
});

describe('§5.1 redirect operator separation', () => {
  it('separates a spaced redirect operator (">") from its target word', () => {
    const result = tokenizeCommandLine('echo hi > f');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
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
    // Mutation caught: a tokenizer that only recognizes redirects preceded by whitespace
    // would fold ">f" into a plain word instead of an operator + target pair.
    const result = tokenizeCommandLine('echo hi >f');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
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

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].redirects).toEqual([
      { operator: '>>', target: { text: 'f', opaque: false } },
    ]);
  });

  it('recognizes the file-descriptor redirect "2>"', () => {
    const result = tokenizeCommandLine('cmd 2> err.log');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].redirects).toEqual([
      { operator: '2>', target: { text: 'err.log', opaque: false } },
    ]);
  });

  it('recognizes the combined stdout+stderr redirect "&>"', () => {
    const result = tokenizeCommandLine('cmd &> all.log');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].redirects).toEqual([
      { operator: '&>', target: { text: 'all.log', opaque: false } },
    ]);
  });

  it('recognizes the fd append form "2>>" as one operator, preserving append semantics', () => {
    // Mutation caught: greedy 2-char matching that splits "2>>" into "2>" with an empty
    // target plus a phantom ">" redirect, silently turning an append into a truncate.
    const result = tokenizeCommandLine('cmd 2>> err.log');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].redirects).toEqual([
      { operator: '2>>', target: { text: 'err.log', opaque: false } },
    ]);
  });

  it('recognizes the combined append form "&>>"', () => {
    const result = tokenizeCommandLine('cmd &>> all.log');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].redirects).toEqual([
      { operator: '&>>', target: { text: 'all.log', opaque: false } },
    ]);
  });

  it('folds a multi-digit fd prefix into the redirect ("12> f" leaves no "12" word)', () => {
    // Mutation caught: a single-digit-only fd scan leaves "12" behind as a command
    // word — bash sends fd 12 to f, and the command receives no "12" operand.
    const result = tokenizeCommandLine('tee 12> f');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].words).toEqual([{ text: 'tee', opaque: false }]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '12>', target: { text: 'f', opaque: false } },
    ]);
  });

  it('marks a process-substitution redirect target ">(…)" opaque', () => {
    // Mutation caught: the real write path lives inside the substitution; a confident
    // mangled target like "(tee" would let the inner write escape without a signal.
    const result = tokenizeCommandLine('cmd >(tee f)');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].redirects[0].operator).toBe('>');
    expect(result.commands[0].redirects[0].target.opaque).toBe(true);
  });

  it('recognizes fd duplication "1>&2" as one command, not a phantom background split', () => {
    // Mutation caught: the "&" inside ">&" consumed as a control operator, splitting a
    // bogus second command ["2"] off a plain stderr redirect.
    const result = tokenizeCommandLine('cmd 1>&2');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
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

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].words[1]).toEqual({ text: '$(echo f)', opaque: true });
  });

  it('marks a backtick command-substitution token as opaque', () => {
    const result = tokenizeCommandLine('cat `echo f`');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].words[1]).toEqual({ text: '`echo f`', opaque: true });
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional bash expansion fixture
  it('marks a braced parameter expansion "${FILE}" as opaque', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional bash expansion fixture
    const result = tokenizeCommandLine('cat ${FILE}');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional bash expansion fixture
    expect(result.commands[0].words[1]).toEqual({ text: '${FILE}', opaque: true });
  });

  it('marks a bare variable reference "$var" as opaque', () => {
    const result = tokenizeCommandLine('cat $var');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].words[1]).toEqual({ text: '$var', opaque: true });
  });

  it('marks a glob token containing "*" as opaque', () => {
    const result = tokenizeCommandLine('cat *.txt');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].words[1]).toEqual({ text: '*.txt', opaque: true });
  });

  it('marks a plain literal token as not opaque', () => {
    const result = tokenizeCommandLine('cat plain.txt');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].words[1]).toEqual({ text: 'plain.txt', opaque: false });
  });

  it('does NOT mark a single-quoted "$var" as opaque (no expansion inside single quotes)', () => {
    // Mutation caught: opacity detection scanning the raw source text (including the
    // quote characters) instead of respecting single-quote's no-expansion semantics.
    const result = tokenizeCommandLine("cat '$var'");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands[0].words[1]).toEqual({ text: '$var', opaque: false });
  });
});

describe('§5.1 tokenization failure (fail-closed)', () => {
  it('returns { ok: false } for an unclosed single quote instead of throwing', () => {
    expect(() => tokenizeCommandLine("echo 'oops")).not.toThrow();
    const result = tokenizeCommandLine("echo 'oops");
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } for an unclosed double quote instead of throwing', () => {
    expect(() => tokenizeCommandLine('echo "oops')).not.toThrow();
    const result = tokenizeCommandLine('echo "oops');
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } for a redirect with no target (bash would syntax-error)', () => {
    // Mutation caught: emitting a confident, non-opaque empty-string target — a clean-looking
    // result for a line whose parse actually failed to find a target.
    const result = tokenizeCommandLine('echo hi >');
    expect(result.ok).toBe(false);
  });
});
