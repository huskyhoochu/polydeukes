// Data spans. `tokenizeCommandLine` reports, as `data`, the half-open spans of the ORIGINAL
// line that bash hands to stdin instead of executing: each heredoc body it consumed (the
// delimiter line excluded; a body that never meets its delimiter runs to end of input) and
// each herestring target word as written, quotes included. Spans come in source order and do
// not overlap; a line with no data carries `data: []`; a span the scanner could not finish
// reading is `unread`, never `data`. `executedText` deletes the spans, which is what the
// `command` source becomes, so every case here also checks it.
import { describe, expect, it } from 'vitest';
import { executedText, tokenizeCommandLine } from '../../src/covenant/bash-line.ts';

const NO_VERIFY = '--no-verify';
const FORCE = '--force';

/** The span `text` occupies in `line` — `text` must occur exactly once. */
function spanOf(line: string, text: string): { start: number; end: number } {
  const start = line.indexOf(text);
  if (start < 0 || line.indexOf(text, start + 1) >= 0) throw new Error(`not unique: ${text}`);
  return { start, end: start + text.length };
}

describe('tokenizeCommandLine — heredoc bodies as data spans', () => {
  it('reports the body of `python - <<EOF … EOF` as one span, delimiter line excluded', () => {
    // The live friction: `--no-verify` quoted in a script body. A span that stops before the
    // body's newline leaves an empty line; one that runs over the delimiter deletes `EOF`.
    const body = `run("git commit ${NO_VERIFY}")\n`;
    const line = `python - <<EOF\n${body}EOF\n`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).toEqual([]);
    expect(result.data).toEqual([spanOf(line, body)]);
    expect(line.slice(result.data[0].start, result.data[0].end)).toBe(body);
    expect(executedText(line)).toBe('python - <<EOF\nEOF\n');
    expect(executedText(line)).not.toContain(NO_VERIFY);
  });

  it("reports the body under a quoted delimiter `<<'EOF'`", () => {
    // A span keyed on the raw delimiter word (`'EOF'`) never finds the plain `EOF` line and
    // either reports nothing or runs to end of input.
    const body = `git commit ${NO_VERIFY}\n`;
    const line = `cat <<'EOF'\n${body}EOF`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).toEqual([]);
    expect(result.data).toEqual([spanOf(line, body)]);
    expect(executedText(line)).toBe("cat <<'EOF'\nEOF");
  });

  it('reports the body under a tab-stripping `<<-EOF` at its ORIGINAL offsets, tabs included', () => {
    // Positions must be measured on the line as written: a span computed over the
    // tab-stripped body is one column short per line and leaves the tab, or cuts into `EOF`.
    const body = `\tgit commit ${NO_VERIFY}\n`;
    const line = `cat <<-EOF\n${body}\tEOF`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).toEqual([]);
    expect(result.data).toEqual([spanOf(line, body)]);
    expect(line.slice(result.data[0].start, result.data[0].end)).toBe(body);
    expect(executedText(line)).toBe('cat <<-EOF\n\tEOF');
  });

  it('reports a body that never meets its delimiter as a span running to end of input', () => {
    // Bash ends the body at EOF, so it is still data. Reporting no span for an unterminated
    // body scans it as a command line again.
    const body = `git commit ${NO_VERIFY}`;
    const line = `cat <<EOF\n${body}`;
    const result = tokenizeCommandLine(line);

    expect(result.data).toEqual([spanOf(line, body)]);
    expect(result.data[0].end).toBe(line.length);
    expect(executedText(line)).toBe('cat <<EOF\n');
  });

  it('reports two bodies of `cat <<A <<B` as two spans in source order', () => {
    // Reporting only the first body leaks the second back to the command line; reversing
    // them makes a deletion by ascending offset cut the wrong bytes.
    const bodyA = `git push ${FORCE}\n`;
    const bodyB = `git commit ${NO_VERIFY}\n`;
    const line = `cat <<A <<B\n${bodyA}A\n${bodyB}B\necho done`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).toEqual([]);
    expect(result.data).toEqual([spanOf(line, bodyA), spanOf(line, bodyB)]);
    expect(result.data[0].end).toBeLessThanOrEqual(result.data[1].start);
    expect(executedText(line)).toBe('cat <<A <<B\nA\nB\necho done');
  });

  it('keeps an unquoted-delimiter body that carries `$(…)` on the command line', () => {
    // bash expands the body of an unquoted heredoc before handing it over, so the
    // substitution runs. Deleting it would pass a ban the command still breaks.
    const line = `cat <<EOF\n$(git push ${FORCE})\nEOF\n`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).toEqual([]);
    expect(result.data).toEqual([]);
    expect(executedText(line)).toContain(FORCE);
  });

  it('reports the same body as data under a quoted delimiter, where bash expands nothing', () => {
    // The quoted delimiter is what makes `$(…)` inert; the test above and this one differ only
    // in the quotes.
    const body = `$(git push ${FORCE})\n`;
    const line = `cat <<'EOF'\n${body}EOF\n`;
    const result = tokenizeCommandLine(line);

    expect(result.data).toEqual([spanOf(line, body)]);
    expect(executedText(line)).toBe("cat <<'EOF'\nEOF\n");
  });

  it('reports no span for an empty body', () => {
    // No bytes reach stdin, so there is nothing to delete; a zero-width span here would be
    // the one shape that can sit past the end of the line.
    expect(tokenizeCommandLine('cat <<EOF\nEOF\n').data).toEqual([]);
    expect(tokenizeCommandLine('cat <<A <<B\nA').data).toEqual([]);
  });
});

describe('tokenizeCommandLine — herestring words as data spans', () => {
  it("reports the target word of `cat <<< 'git push --force'` as one span, quotes included", () => {
    // The `work-stays-recoverable` friction. A span over the unquoted word text leaves one
    // quote on each side; a span over the operator as well deletes `<<<`.
    const word = `'git push ${FORCE}'`;
    const line = `cat <<< ${word}`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).toEqual([]);
    expect(result.data).toEqual([spanOf(line, word)]);
    expect(line.slice(result.data[0].start, result.data[0].end)).toBe(word);
    expect(executedText(line)).toBe('cat <<< ');
    expect(executedText(line)).not.toContain(FORCE);
  });

  it('reports no span for a `<<<` with no target word', () => {
    // The degenerate herestring: with nothing to hand to stdin there is nothing to delete. An
    // empty or out-of-range span here would be deleted from the command line anyway.
    const result = tokenizeCommandLine('cat <<<');

    expect(result.data).toEqual([]);
  });

  it('keeps a herestring word bash expands — `$(…)`, a backtick, or a bare `(` — on the command line', () => {
    // An opaque word is text bash runs before anything reaches stdin. The bare `(` is a
    // syntax error in bash, but a span over its first fragment would leave a command line
    // no one wrote.
    for (const line of [
      `cat <<< $(git push ${FORCE})`,
      `cat <<< \`git push ${FORCE}\``,
      `cat <<< (git push ${FORCE})`,
    ]) {
      const result = tokenizeCommandLine(line);

      expect(result.data).toEqual([]);
      expect(executedText(line)).toBe(line);
    }
  });
});

describe('tokenizeCommandLine — what is not a data span', () => {
  it('reports `data: []` for a plain command line', () => {
    // A tokenizer that reports every word or every redirect target as data empties the
    // command source and passes every ban.
    const result = tokenizeCommandLine(`git commit ${NO_VERIFY} && echo done > f`);

    expect(result.unread).toEqual([]);
    expect(result.data).toEqual([]);
  });

  it('reports no span when an unterminated double quote swallows the heredoc opener', () => {
    // The scanner never read a heredoc here, so it does not know where the body ends: the
    // bytes stay `unread` and on the command line. A span reported from a half-read opener
    // would delete text the scanner never bounded.
    const line = `echo "oops <<EOF\ngit commit ${NO_VERIFY}\nEOF`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).not.toEqual([]);
    expect(result.data).toEqual([]);
    expect(executedText(line)).toContain(NO_VERIFY);
  });
});

describe('tokenizeCommandLine — a data span beside an unread span', () => {
  it('reports a completed heredoc body even when a later unclosed quote leaves `unread`', () => {
    // The two lists are independent: the body was fully bounded before the scanner stopped.
    // A tokenizer that empties `data` whenever `unread` is non-empty scans the body as a
    // command line again on every input with one bad quote after it.
    const body = `git push ${FORCE}\n`;
    const line = `cat <<A\n${body}A\necho "oops`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).not.toEqual([]);
    expect(result.data).toEqual([spanOf(line, body)]);
    expect(line.slice(result.data[0].start, result.data[0].end)).toBe(body);
    expect(executedText(line)).toBe('cat <<A\nA\necho "oops');
    expect(executedText(line)).not.toContain(FORCE);
  });
});
