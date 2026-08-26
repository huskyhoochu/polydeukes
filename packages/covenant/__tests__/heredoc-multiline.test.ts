import { describe, expect, it } from 'vitest';
import { extractMutations, tokenizeCommandLine } from '../src/bash-line.js';
import { redirectWriteRule } from '../src/mutation-rules.js';

describe('newline as command separator', () => {
  it('splits "echo a\\necho b > f" into two commands with only {path: f}', () => {
    // Folding the newline into a word glues "a\necho" together, losing the second command
    // and its write redirect.
    const result = extractMutations('echo a\necho b > f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('splits "echo a\\necho b > f" into exactly two simple commands', () => {
    // One glued command (no split) and three (a spurious empty one) both fail this.
    const result = tokenizeCommandLine('echo a\necho b > f');

    expect(result.unread).toEqual([]);
    expect(result.commands.map((c) => c.words.map((w) => w.text))).toEqual([
      ['echo', 'a'],
      ['echo', 'b'],
    ]);
  });

  it('fires the sed rule on the second line of "echo hi\\nsed -i s/x/y/ t"', () => {
    // With the newline still a word character, "hi\nsed" glues and the second command never
    // reaches the sed rule.
    const result = extractMutations('echo hi\nsed -i s/x/y/ t', [redirectWriteRule]);
    // sed-in-place.test.ts asserts the rule itself; this only proves the newline split
    // produced a distinct second command.
    const tokens = tokenizeCommandLine('echo hi\nsed -i s/x/y/ t');

    expect(result.mutations).toEqual([]);
    expect(tokens.unread).toEqual([]);
    expect(tokens.commands.map((c) => c.words.map((w) => w.text))).toEqual([
      ['echo', 'hi'],
      ['sed', '-i', 's/x/y/', 't'],
    ]);
  });

  it('keeps a newline inside a double-quoted string as word content, not a separator', () => {
    // A newline inside quotes is literal content, so it must not split the command.
    const result = tokenizeCommandLine('echo "a\nb"');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a\nb', opaque: false },
    ]);
  });
});

describe('heredoc recognition and body consumption', () => {
  it('tokenizes "cat > f <<EOF\\nhello\\nEOF" to one redirect-write mutation on f', () => {
    // Read naively, the second "<" of "<<EOF" scans an empty redirect target and fails the
    // whole line closed.
    const result = extractMutations('cat > f <<EOF\nhello\nEOF', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
    expect(result.indeterminate).toEqual([]);
  });

  it('detects the write target with a spaced "<< EOF" delimiter', () => {
    const result = extractMutations('cat > f << EOF\nhello\nEOF', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
    expect(result.indeterminate).toEqual([]);
  });

  it('detects the write target with a tab-stripping "<<-EOF" and tab-indented terminator', () => {
    // "<<-" must be its own operator, and the terminator line's leading tab must be stripped
    // or the body never terminates.
    const result = extractMutations('cat > f <<-EOF\n\thello\n\tEOF', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
    expect(result.indeterminate).toEqual([]);
  });

  it('detects the write target with a quoted "<<\'EOF\'" delimiter', () => {
    // Without stripping the quotes from the delimiter, the plain "EOF" terminator line never
    // matches and the body runs to the end of input.
    const result = extractMutations("cat > f <<'EOF'\nhello\nEOF", [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
    expect(result.indeterminate).toEqual([]);
  });

  it('does not parse heredoc body text as commands (no mutation from body writes)', () => {
    // The body is data: consuming it as ordinary lines lets "sed -i …" and "echo x > y"
    // inside it produce phantom mutations.
    const line = 'cat <<EOF\nsed -i s/a/b/ g\necho x > y\nEOF';
    const result = extractMutations(line, [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('consumes two heredocs on one line in order, then parses the following line', () => {
    // Bash consumes the bodies in appearance order; consuming only the first leaks the
    // second body's lines back as commands.
    const line = 'cat <<A <<B\nbody-a\nA\nbody-b\nB\necho done > f';
    const result = extractMutations(line, [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('handles an unterminated heredoc without throwing and still detects the redirect target', () => {
    // Bash ends the body at end of input, so there is no hidden command after it and silence
    // there is not a pass. The "> f" write is still detected.
    const line = 'cat > f <<EOF\nbody';

    expect(() => extractMutations(line, [redirectWriteRule])).not.toThrow();
    const result = extractMutations(line, [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('reports no mutation for a herestring "<<<" (read direction)', () => {
    // A herestring supplies stdin, so it is a read: neither the operator nor its value word
    // is a write target.
    const result = extractMutations('cmd <<< data', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('detects the write after a "cat <<$(x)" body — the delimiter is never expanded', () => {
    // Measured with bash 5.3.9: `bash -n` accepts the line, and execution ends the body at
    // the literal `$(x)` line — the delimiter is never expanded — so the body end is
    // statically decidable and the command after it runs.
    const result = extractMutations('cat <<$(x)\nbody\n$(x)\necho hi > f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
    expect(result.indeterminate).toEqual([]);
  });

  it('ends a "cat <<$(x)" body at its literal delimiter line, not at the input end', () => {
    // The same case at the tokenizer surface. Normalizing the delimiter's `$(x)`, or running
    // the body to end of input, loses the following command.
    const result = tokenizeCommandLine('cat <<$(x)\nbody\n$(x)\necho done');

    expect(result.unread).toEqual([]);
    expect(result.commands.map((c) => c.words.map((w) => w.text))).toEqual([
      ['cat'],
      ['echo', 'done'],
    ]);
  });
});

describe('fail-closed no-throw fuzz cases', () => {
  it('never throws on a lone "<<" heredoc operator with no delimiter', () => {
    expect(() => extractMutations('<<', [redirectWriteRule])).not.toThrow();
  });

  it('splits on a lone carriage return without stalling (every terminator is consumed)', () => {
    // scanWord terminates a word on `\r` while the main loop consumes only `\r\n` pairs; a
    // lone CR then produces empty words forever. A hang is what no fail-closed contract can
    // catch, so a regression here times the suite out rather than failing.
    const result = tokenizeCommandLine('echo a\recho b > f');

    expect(result.unread).toEqual([]);
    expect(result.commands.map((c) => c.words.map((w) => w.text))).toEqual([
      ['echo', 'a'],
      ['echo', 'b'],
    ]);
  });

  it('never throws on newlines-only input', () => {
    expect(() => extractMutations('\n\n\n', [redirectWriteRule])).not.toThrow();
    const result = extractMutations('\n\n\n', [redirectWriteRule]);

    expect(result).toEqual({ mutations: [], indeterminate: [] });
  });
});
