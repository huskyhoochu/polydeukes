import { describe, expect, it } from 'vitest';
import { extractMutations, tokenizeCommandLine } from '../src/bash-line.js';
import { redirectWriteRule } from '../src/mutation-rules.js';

// ---------------------------------------------------------------------------
// Tokenizer — newline as command separator (PRD §5.1). The current tokenizer
// treats a newline as a word character, gluing "a\necho" into one word; these
// tests pin the multi-line splitting the refinement adds.
// ---------------------------------------------------------------------------
describe('§5.1 newline as command separator', () => {
  it('splits "echo a\\necho b > f" into two commands with only {path: f}', () => {
    // Mutation caught: a tokenizer that folds the newline into a word glues
    // "a\necho" together, so the second command (and its write redirect) is lost.
    const result = extractMutations('echo a\necho b > f', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('splits "echo a\\necho b > f" into exactly two simple commands', () => {
    // Boundary on the command count: one glued command (no split) or three
    // (a spurious empty command) both fail this.
    const result = tokenizeCommandLine('echo a\necho b > f');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands.map((c) => c.words.map((w) => w.text))).toEqual([
      ['echo', 'a'],
      ['echo', 'b'],
    ]);
  });

  it('fires the sed rule on the second line of "echo hi\\nsed -i s/x/y/ t"', () => {
    // Mutation caught: the newline stays a word character, so "hi\nsed" glues and
    // the second command never reaches the sed rule — the §2 under-detection gap.
    const result = extractMutations('echo hi\nsed -i s/x/y/ t', [redirectWriteRule]);
    // The sed rule detection is asserted in sed-in-place.test.ts; here we only
    // prove the newline split produced a distinct second command.
    const tokens = tokenizeCommandLine('echo hi\nsed -i s/x/y/ t');

    expect(result.mutations).toEqual([]);
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;
    expect(tokens.commands.map((c) => c.words.map((w) => w.text))).toEqual([
      ['echo', 'hi'],
      ['sed', '-i', 's/x/y/', 't'],
    ]);
  });

  it('keeps a newline inside a double-quoted string as word content, not a separator', () => {
    // Boundary across the quote divide: a newline INSIDE quotes is literal content
    // (bash multi-line string), so it must not split the command.
    const result = tokenizeCommandLine('echo "a\nb"');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: 'a\nb', opaque: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tokenizer — heredoc recognition and body consumption (PRD §5.1). The goal is
// that "cat > f <<EOF" tokenizes so 04b's redirect-write fires on "> f".
// ---------------------------------------------------------------------------
describe('§5.1 heredoc recognition and body consumption', () => {
  it('tokenizes "cat > f <<EOF\\nhello\\nEOF" to one redirect-write mutation on f', () => {
    // Roadmap AC case: before the refinement the second "<" of "<<EOF" scanned an
    // empty redirect target and fail-closed the whole line.
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
    // Mutation caught: "<<-" not recognized as its own operator, or the leading tab
    // on the terminator line not stripped so the body never terminates.
    const result = extractMutations('cat > f <<-EOF\n\thello\n\tEOF', [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
    expect(result.indeterminate).toEqual([]);
  });

  it('detects the write target with a quoted "<<\'EOF\'" delimiter', () => {
    // Mutation caught: the quotes not stripped from the delimiter, so the plain
    // "EOF" terminator line never matches and the body runs to EOF.
    const result = extractMutations("cat > f <<'EOF'\nhello\nEOF", [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
    expect(result.indeterminate).toEqual([]);
  });

  it('does not parse heredoc body text as commands (no mutation from body writes)', () => {
    // Mutation caught: the body consumed as ordinary lines would let "sed -i …" and
    // "echo x > y" in the body produce phantom mutations — the body is data.
    const line = 'cat <<EOF\nsed -i s/a/b/ g\necho x > y\nEOF';
    const result = extractMutations(line, [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('consumes two heredocs on one line in order, then parses the following line', () => {
    // Mutation caught: only the first heredoc body consumed, so the second body's
    // lines leak back as commands — bash consumes them in appearance order.
    const line = 'cat <<A <<B\nbody-a\nA\nbody-b\nB\necho done > f';
    const result = extractMutations(line, [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('handles an unterminated heredoc without throwing and still detects the redirect target', () => {
    // Fail-closed no-throw: bash ends the body at EOF; there is no hidden command
    // after it, so silence there is not a pass. The "> f" write is still detected.
    const line = 'cat > f <<EOF\nbody';

    expect(() => extractMutations(line, [redirectWriteRule])).not.toThrow();
    const result = extractMutations(line, [redirectWriteRule]);

    expect(result.mutations).toEqual([{ path: 'f', rule: 'redirect-write' }]);
  });

  it('reports no mutation for a herestring "<<<" (read direction)', () => {
    // Mutation caught: "<<<" mistaken for a write, or its value word reported as a
    // path — a herestring supplies stdin, so it is a read.
    const result = extractMutations('cmd <<< data', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
  });

  it('fails closed on an opaque heredoc delimiter "cat <<$(x)" via one indeterminate', () => {
    // Fail-closed: an opaque delimiter makes the body end undecidable, so the whole
    // line is { ok: false } and extractMutations yields exactly one indeterminate.
    const result = extractMutations('cat <<$(x)', [redirectWriteRule]);

    expect(result.mutations).toEqual([]);
    expect(result.indeterminate).toHaveLength(1);
  });

  it('returns { ok: false } directly for an opaque heredoc delimiter', () => {
    // Same boundary at the tokenizer surface: an opaque delimiter is fail-closed,
    // equivalent to an unclosed quote.
    const result = tokenizeCommandLine('cat <<$(x)');

    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invariants — no-throw fuzz cases relevant to heredoc/newline (PRD §5.3).
// ---------------------------------------------------------------------------
describe('§5.3 fail-closed no-throw fuzz cases', () => {
  it('never throws on a lone "<<" heredoc operator with no delimiter', () => {
    expect(() => extractMutations('<<', [redirectWriteRule])).not.toThrow();
  });

  it('splits on a lone carriage return without stalling (every terminator is consumed)', () => {
    // Mutation caught: scanWord terminates a word on `\r` but the main loop only
    // consumed `\r\n` pairs — a lone CR then produced empty words forever (a hang,
    // which no fail-closed contract can catch). A regression here times out the suite.
    const result = tokenizeCommandLine('echo a\recho b > f');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
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
