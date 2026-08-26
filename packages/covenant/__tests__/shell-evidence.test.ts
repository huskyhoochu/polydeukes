import { describe, expect, it } from 'vitest';
// Shell-evidence derivation: one command string in, `{ evidence, unjudgeable }` out, pure —
// pre-state reading is the body's job, through an injected reader. Four dispositions exhaust
// the space: a judged row computes target, content and redirect mode; a per-item skip carries a
// path; a target-unknown skip carries none; and a command with no mutation signal at all stays
// silent in BOTH arrays, which is what keeps the log from filling with routine reads.
import { deriveShellChanges } from '../src/shell-evidence.ts';

// Paths are arbitrary literals: derivation is scope-blind, and scope matching belongs to the
// compiler's routing closures. Allowlist-sensitive fixtures use heads from the shipped
// read-only defaults — cat, ls, echo and printf are in; rm, tee, pnpm, python3 and bash are out.

/** Join physical lines into the single command string a hook payload carries. */
function lines(...parts: string[]): string {
  return parts.join('\n');
}

describe('deriveShellChanges — computable evidence (§2-a judged rows)', () => {
  it('computes an echo append write with mode append', () => {
    // Collapsing `>>` into truncate makes the body judge the appended line as the whole file,
    // overwriting the pre baseline.
    expect(deriveShellChanges('echo a b >> f.ts')).toEqual({
      evidence: [{ path: 'f.ts', content: 'a b\n', mode: 'append' }],
      unjudgeable: [],
    });
  });

  it('joins tokenized words, preserving spaces inside a quoted arg', () => {
    // Content sliced from the raw command string keeps the quotes ("'a b' c\n"); the token
    // texts have to be joined instead.
    expect(deriveShellChanges("echo 'a b' c > f.ts")).toEqual({
      evidence: [{ path: 'f.ts', content: 'a b c\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('only the FIRST arg starting with - refuses; a later dash-arg is plain content', () => {
    // Only the FIRST arg starting with `-` can carry echo's flag semantics. An any-arg dash
    // scan turns a computable violation into a skip — recorded, but never blocked.
    expect(deriveShellChanges('echo x -n > f.ts')).toEqual({
      evidence: [{ path: 'f.ts', content: 'x -n\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('captures a quoted-delimiter heredoc body verbatim as truncate content', () => {
    // A discarded heredoc body loses the whole written content of the commonest shell write.
    const command = lines("cat > f.ts <<'EOF'", 'line one', 'line two', 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'line one\nline two\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('keeps a $ inside a QUOTED-delimiter heredoc literal (no expansion, still judged)', () => {
    // The sharp pair with the unquoted-plus-$ skip below: same body, and the delimiter's
    // quoting flips the disposition. Checking opacity on the body regardless of that quoting
    // silently stops judging every document containing a `$`.
    const command = lines("cat > f.ts <<'EOF'", 'value: $HOME', 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'value: $HOME\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('computes an empty quoted heredoc as empty content, not as no evidence', () => {
    // Treating an empty body as nothing derived leaves the truncation of a scoped file with
    // neither evidence nor a skip row.
    const command = lines("cat > f.ts <<'EOF'", 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: '', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('judges an UNquoted-delimiter heredoc whose body is free of $ and backtick', () => {
    // Refusing every unquoted delimiter degrades the common `<<EOF` idiom into skip volume.
    const command = lines('cat > f.ts <<EOF', 'plain body', 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'plain body\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('computes a literal herestring as content plus the newline bash appends', () => {
    // Bash appends a newline to a herestring, so dropping it leaves the content one byte short
    // when it is diffed against disk.
    expect(deriveShellChanges("cat > f.ts <<< 'hi'")).toEqual({
      evidence: [{ path: 'f.ts', content: 'hi\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('computes a bare command-less truncate as empty content', () => {
    // `> f` is the cheapest way to empty a scoped file, and it is lost entirely if a command
    // with zero words is dropped before its redirect is read.
    expect(deriveShellChanges('> f.ts')).toEqual({
      evidence: [{ path: 'f.ts', content: '', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('keeps an ABSOLUTE target computable under a cd prefix', () => {
    // An absolute target needs no base directory, so a `cd` on the line must not poison it —
    // that would degrade a judgeable violation into a skip row.
    expect(deriveShellChanges('cd d && echo x > /abs/f.ts')).toEqual({
      evidence: [{ path: '/abs/f.ts', content: 'x\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('derives one evidence entry per command, in command order', () => {
    // Derivation stopping at the first computable write loses the second file's violation.
    expect(deriveShellChanges('echo a > f1.ts && echo b > f2.ts')).toEqual({
      evidence: [
        { path: 'f1.ts', content: 'a\n', mode: 'truncate' },
        { path: 'f2.ts', content: 'b\n', mode: 'truncate' },
      ],
      unjudgeable: [],
    });
  });

  it('keeps the computable and unjudgeable channels independent on one line', () => {
    // One unjudgeable command must not abort the whole line, or the computable violation in
    // f1.ts is lost along with it.
    const { evidence, unjudgeable } = deriveShellChanges('echo ok > f1.ts && sed -i s/a/b/ f2.ts');

    expect(evidence).toEqual([{ path: 'f1.ts', content: 'ok\n', mode: 'truncate' }]);
    expect(unjudgeable).toHaveLength(1);
    expect(unjudgeable[0].path).toBe('f2.ts');
  });
});

describe('deriveShellChanges — per-item unjudgeable, target known (§2-a skip rows)', () => {
  /** Assert the per-item shape: no evidence, one entry carrying the path. */
  function expectPathSkip(command: string, path: string): void {
    const result = deriveShellChanges(command);
    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBe(path);
  }

  it('refuses echo with a leading flag (echo -n) but keeps the target path', () => {
    // echo's -n/-e semantics are not computed, and treating -n as content files a confident
    // wrong post-state.
    expectPathSkip('echo -n x > f.ts', 'f.ts');
  });

  it('refuses printf format semantics but keeps the target path', () => {
    // Joining printf's args like echo's judges %s as literal text and never sees the real
    // expansion.
    expectPathSkip("printf '%s' x > f.ts", 'f.ts');
  });

  it('refuses an opaque echo arg ($V) while the target stays known', () => {
    // Joining opaque arg texts verbatim files "$V\n" as the written content.
    expectPathSkip('echo $V > f.ts', 'f.ts');
  });

  it('refuses an UNquoted heredoc whose body carries an expansion', () => {
    // The expansion result differs from the captured text, so capturing an unquoted body as
    // literal files fiction. Both `$` and backtick are checked.
    for (const expansion of ['value: $HOME', 'value: `date`']) {
      const command = lines('cat > f.ts <<EOF', expansion, 'EOF');
      expectPathSkip(command, 'f.ts');
    }
  });

  it('refuses a transforming command redirect (grep x y > f)', () => {
    // The output derives from a transform, not from the args, so the echo arg-join rule must
    // not reach every redirect-bearing command.
    expectPathSkip('grep x y.txt > out.ts', 'out.ts');
  });

  it('refuses cat reading a FILE into a redirect, even though heredoc-cat is judged', () => {
    // The content lives on disk, not in the command. Over-generalizing "cat > target is
    // computable" from the heredoc rows asserts the copied file's content as empty.
    expectPathSkip('cat < in.txt > out.ts', 'out.ts');
  });

  it('reports sed -i as detected-but-uncomputable with the file operand as path', () => {
    // The per-entry skip archetype: dropping `sed -i` entirely makes the write silent.
    expectPathSkip('sed -i s/a/b/ notes.ts', 'notes.ts');
  });

  it('reports a tee target as detected-but-uncomputable', () => {
    // Pipe content is not computed even when it looks statically plausible.
    expectPathSkip('echo x | tee f.ts', 'f.ts');
  });

  it('refuses a non-stdout redirect (2>) while keeping its target', () => {
    // Stderr content is unknowable, and an allowlisted head does not silence a write-direction
    // redirect: an `ls` head short-circuiting before redirects are examined loses this.
    expectPathSkip('ls 2> err.ts', 'err.ts');
  });

  it('refuses a command with TWO write redirects, target(s) still named', () => {
    // Bash truncates a.ts AND writes b.ts, so computing either alone is wrong:
    // last-redirect-wins evidence for b.ts leaves a.ts's truncation unrecorded.
    const result = deriveShellChanges('echo x > a.ts > b.ts');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable.length).toBeGreaterThan(0);
    expect(result.unjudgeable.some((entry) => entry.path === 'a.ts' || entry.path === 'b.ts')).toBe(
      true,
    );
  });
});

describe('deriveShellChanges — target unknown, no path carried (§2-a common rows)', () => {
  /** Assert the target-unknown shape: no evidence, pathless unjudgeable entries. */
  function expectPathlessSkip(command: string): void {
    const result = deriveShellChanges(command);
    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable.length).toBeGreaterThan(0);
    expect(result.unjudgeable.every((entry) => entry.path === undefined)).toBe(true);
  }

  it('an opaque redirect target ($F) is unjudgeable without a path', () => {
    // A path here would scope-route the skip to whatever entry the unexpanded text happens to
    // match.
    expectPathlessSkip('echo x > $F');
  });

  it('a glob redirect target (*.ts) is unjudgeable without a path', () => {
    // Asserting the glob text as a literal target path names a file that may not exist.
    expectPathlessSkip('> *.ts');
  });

  it('an opaque tee operand is unjudgeable without a path', () => {
    // The tee rule stays silent on opaque words, so reporting the operand as a per-item path
    // would invent one.
    expectPathlessSkip('echo x | tee $OUT');
  });

  it('a nested shell is a reinterpretation boundary — unjudgeable, no path', () => {
    // Taking x.sh as the mutation target names the script rather than what it writes.
    expectPathlessSkip('bash x.sh');
  });

  it('an opaque token under a non-allowlisted head (rm glob) signals without a path', () => {
    // A signal check requiring a detected mutation or redirect leaves this rm glob silent,
    // which is a destroy that passes with no row at all.
    expectPathlessSkip('rm packages/*/dist/index.js');
  });

  it('a cd prefix makes a RELATIVE redirect target unjudgeable without a path', () => {
    // The base directory is unknown, so the textual rel.ts must not be carried at all — it
    // would scope-match the wrong entry.
    expectPathlessSkip('cd d && echo x > rel.ts');
  });
});

describe('deriveShellChanges — signal-free commands stay silent (§2-a volume defence)', () => {
  it('answers empty evidence AND empty unjudgeable for signal-free commands', () => {
    // Reads with globs, allowlisted heads over expansions, and plain non-allowlisted runs
    // carry no mutation signal. Applying the opaque-token rule without the allowlist gate
    // floods the log with every ls, cat and echo that carries a glob or a `$`.
    const silent = ['ls *.md', 'cat lefthook.y*', 'echo $HOME', 'pnpm build', 'python3 x.py'];

    for (const command of silent) {
      expect(deriveShellChanges(command)).toEqual({ evidence: [], unjudgeable: [] });
    }
  });
});

describe('deriveShellChanges — no reasonless skip (AC §3.2)', () => {
  it('carries a non-empty reason on every unjudgeable entry across the corpus', () => {
    // A skip filed with an empty or missing reason is a row nobody can act on.
    const corpus = [
      'echo -n x > f.ts',
      "printf '%s' x > f.ts",
      'grep x y.txt > out.ts',
      'sed -i s/a/b/ notes.ts',
      'echo x | tee f.ts',
      'ls 2> err.ts',
      'echo x > a.ts > b.ts',
      'echo x > $F',
      '> *.ts',
      'bash x.sh',
      'rm packages/*/dist/index.js',
      'cd d && echo x > rel.ts',
      lines('cat > f.ts <<EOF', 'value: $HOME', 'EOF'),
    ];

    for (const command of corpus) {
      const { unjudgeable } = deriveShellChanges(command);
      expect(unjudgeable.length).toBeGreaterThan(0);
      for (const entry of unjudgeable) {
        expect(typeof entry.reason).toBe('string');
        expect(entry.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('deriveShellChanges — computable edge forms (audit G14/G3/G6/G8/G9/G16)', () => {
  it('computes zero-arg echo as a bare newline truncate', () => {
    // Zero args writes a bare newline, which is the cheapest wipe: a first-arg dash check
    // that refuses or silences an absent arg loses it.
    expect(deriveShellChanges('echo > f.ts')).toEqual({
      evidence: [{ path: 'f.ts', content: '\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('captures an APPEND heredoc body with mode append', () => {
    // Heredoc literalness is direction-independent: capture wired to `>` only misses this,
    // and `>>` collapsed into truncate overwrites the pre baseline instead of composing it.
    const command = lines("cat >> f.ts <<'EOF'", 'appended line', 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'appended line\n', mode: 'append' }],
      unjudgeable: [],
    });
  });

  it('keeps a computable write computable beside an fd reference (2>&1)', () => {
    // An fd reference is neither a write nor a signal: counting 2>&1 as a second write
    // redirect trips the two-write refusal and demotes a computable violation into a skip.
    expect(deriveShellChanges('echo x > f.ts 2>&1')).toEqual({
      evidence: [{ path: 'f.ts', content: 'x\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('strips ALL leading tabs from a <<- heredoc body, byte-exact', () => {
    // The content contract is the bytes bash writes, so every leading tab goes, not just one.
    const command = lines('cat > f.ts <<-EOF', '\tline one', '\t\tline two', '\tEOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'line one\nline two\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('feeds two heredocs on one line each to its own target, in order', () => {
    // Bash consumes pending heredoc bodies in redirect order.
    const command = lines(
      "cat > a.ts <<'A' && cat > b.ts <<'B'",
      'alpha body',
      'A',
      'beta body',
      'B',
    );

    expect(deriveShellChanges(command)).toEqual({
      evidence: [
        { path: 'a.ts', content: 'alpha body\n', mode: 'truncate' },
        { path: 'b.ts', content: 'beta body\n', mode: 'truncate' },
      ],
      unjudgeable: [],
    });
  });

  it('keeps deriving commands that follow a terminated heredoc body', () => {
    // Derivation stopping at the heredoc terminator lets a write on the next physical line
    // pass with no row.
    const command = lines("cat > a.ts <<'EOF'", 'body a', 'EOF', 'echo x > c.ts');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [
        { path: 'a.ts', content: 'body a\n', mode: 'truncate' },
        { path: 'c.ts', content: 'x\n', mode: 'truncate' },
      ],
      unjudgeable: [],
    });
  });

  it('derives per command across newline, ; and || separators alike', () => {
    // Derivation must consume the tokenizer's command list rather than re-split on `&&`, or
    // the second file's violation vanishes under every other separator.
    const forms = [
      lines('echo a > f1.ts', 'echo b > f2.ts'),
      'echo a > f1.ts; echo b > f2.ts',
      'echo a > f1.ts || echo b > f2.ts',
    ];

    for (const command of forms) {
      expect(deriveShellChanges(command)).toEqual({
        evidence: [
          { path: 'f1.ts', content: 'a\n', mode: 'truncate' },
          { path: 'f2.ts', content: 'b\n', mode: 'truncate' },
        ],
        unjudgeable: [],
      });
    }
  });

  it('strips the CR of CRLF heredoc body lines, byte-exact', () => {
    // A `\r` kept in content puts every judged diff one byte off, and an `EOF\r` that fails to
    // terminate the body produces a spurious tokenize failure.
    expect(deriveShellChanges("cat > f.ts <<'EOF'\r\nbody line\r\nEOF\r\n")).toEqual({
      evidence: [{ path: 'f.ts', content: 'body line\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });
});

describe('deriveShellChanges — per-item unjudgeable edge forms (audit G4/G15/G7)', () => {
  /** Assert the per-item shape: no evidence, one path-bearing reasoned entry. */
  function expectPathSkip(command: string, path: string): void {
    const result = deriveShellChanges(command);
    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBe(path);
    expect(result.unjudgeable[0].reason.length).toBeGreaterThan(0);
  }

  it('an opaque COMMAND writing to a literal target keeps the path', () => {
    // Writer unknown, target known. An opaque head demoting this to the pathless bucket loses
    // the entry-scope attribution and that label's skip row.
    expectPathSkip('$CMD > lit.ts', 'lit.ts');
  });

  it('an opaque herestring keeps its target path', () => {
    // The sharp pair with the judged literal herestring: capturing "$V" as literal content
    // files fiction as fact.
    expectPathSkip('cat > f.ts <<< "$V"', 'f.ts');
  });

  it('a non-stdout &> or &>> redirect keeps its target path', () => {
    // Parsing `&>` as `&` plus a bare command-less truncate files confident empty-content
    // evidence for a stderr-carrying stream, and `&>>` likewise as a bare append.
    for (const command of ['run &> f.ts', 'run &>> f.ts']) {
      expectPathSkip(command, 'f.ts');
    }
  });
});

describe('deriveShellChanges — an unread span is a recorded common skip (audit G1)', () => {
  it('answers one pathless reasoned entry per unread form, never silence', () => {
    // The span the tokenizer could not read is exactly where a call that passes with no row
    // would hide. This form has nothing readable after the span: the quote swallows the
    // redirect operator, so `f.ts` is content and no write exists to file. The failure
    // directions are the span answering empty/empty, and throwing out of the pure function
    // instead of filing the reason.
    const unread = [
      "echo 'x > f.ts", // unclosed quote, swallowing the operator behind it
    ];

    for (const command of unread) {
      const result = deriveShellChanges(command);
      expect(result.evidence).toEqual([]);
      expect(result.unjudgeable).toHaveLength(1);
      expect(result.unjudgeable[0].path).toBeUndefined();
      expect(result.unjudgeable[0].reason.length).toBeGreaterThan(0);
    }
  });
});

describe('deriveShellChanges — forms COVENANT-18 moved out of the tokenize-failure bucket', () => {
  it('files a pathless entry for a process-substitution target, now that it tokenizes', () => {
    // The spaced `>(…)` target is readable, so the line reaches precise judgment — where the
    // target is opaque and its real path, a /dev/fd entry, is knowable only to execution.
    // Taking the readable target for a literal filename files fiction as fact.
    const result = deriveShellChanges('echo x > >(tee f.ts)');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBeUndefined();
    expect(result.unjudgeable[0].reason.length).toBeGreaterThan(0);
  });

  it('keeps the write target of a "<<$V" heredoc, now that the delimiter no longer fails', () => {
    // Bash never expands a heredoc delimiter, so the `> f.ts` write is read and the entry
    // carries a path the pathless bucket could not. With no body, the content stays uncomputed
    // — the row must stay recorded rather than falling silent.
    const result = deriveShellChanges('cat > f.ts <<$V');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBe('f.ts');
    expect(result.unjudgeable[0].reason.length).toBeGreaterThan(0);
  });
});

describe('deriveShellChanges — target unknown edge forms (audit G11/G12/G10)', () => {
  /** Assert the target-unknown shape: no evidence, pathless reasoned entries. */
  function expectPathlessSkip(command: string): void {
    const result = deriveShellChanges(command);
    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable.length).toBeGreaterThan(0);
    for (const entry of result.unjudgeable) {
      expect(entry.path).toBeUndefined();
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  }

  it('a ~-prefixed target is neither expanded nor carried as a path', () => {
    // `~` is never expanded. Carrying '~/f.ts' textually scope-routes the skip row wrongly;
    // resolving it against $HOME makes the answer depend on the environment.
    expectPathlessSkip('echo x > ~/f.ts');
  });

  it('sed -i over an opaque operand keeps the signal but drops the path', () => {
    // The detector is silent on an opaque operand; the signal is not. Detector silence
    // collapsing into derivation silence gives a call with no row.
    expectPathlessSkip('sed -i s/a/b/ $F');
  });

  it('a write BEFORE cd on the same line is refused all the same', () => {
    // A `cd` on the line poisons relative targets regardless of position: an order-aware check
    // judges the pre-cd write confidently and gets the base directory wrong.
    expectPathlessSkip('echo x > rel.ts && cd d');
  });

  it('an ABSOLUTE cd argument does not license resolving a relative target', () => {
    // Composing '/abs/rel.ts' as confident evidence is base resolution, which is the
    // approximation this layer refuses.
    expectPathlessSkip('cd /abs && echo x > rel.ts');
  });
});

describe('deriveShellChanges — review-round regressions (PR #36)', () => {
  it('reports a tee operand even when a write redirect rides the same command', () => {
    // An early return on write redirects swallows rule-detected targets, and a banned word
    // then lands in the tee file with no row of any kind.
    const { evidence, unjudgeable } = deriveShellChanges("echo 'x' | tee f2.ts > /dev/null");

    expect(evidence).toEqual([]);
    const paths = unjudgeable.map((entry) => entry.path);
    expect(paths).toContain('f2.ts');
    expect(paths).toContain('/dev/null');
  });

  it('reports a sed -i operand even when the same command redirects elsewhere', () => {
    // The same for sed: the operand and the redirect target each keep a row.
    const { evidence, unjudgeable } = deriveShellChanges('sed -i s/a/b/ f.ts > log.txt');

    expect(evidence).toEqual([]);
    const paths = unjudgeable.map((entry) => entry.path);
    expect(paths).toContain('f.ts');
    expect(paths).toContain('log.txt');
  });

  it('refuses an unquoted heredoc body carrying a backslash — a line continuation', () => {
    // Bash joins a trailing-backslash line in an unquoted heredoc, so the captured bytes
    // would be fiction.
    const command = lines('cat > f.ts <<EOF', 'line gu\\', 'ard', 'EOF');

    const { evidence, unjudgeable } = deriveShellChanges(command);

    expect(evidence).toEqual([]);
    expect(unjudgeable).toEqual([expect.objectContaining({ path: 'f.ts' })]);
  });

  it('a subshell group is a reinterpretation boundary, not a confident path or content', () => {
    // Read as a word, '(' defeats the cd rule and ')' leaks into derived content.
    const { evidence, unjudgeable } = deriveShellChanges('( cd d && echo x > rel.ts )');

    expect(evidence).toEqual([]);
    expect(unjudgeable.length).toBeGreaterThan(0);
    expect(unjudgeable.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('popd moves the directory too — a following relative write is refused', () => {
    // popd belongs in the directory-change set alongside cd and pushd.
    const { evidence, unjudgeable } = deriveShellChanges('popd && echo x > rel.ts');

    expect(evidence).toEqual([]);
    expect(unjudgeable.every((entry) => entry.path === undefined)).toBe(true);
    expect(unjudgeable.length).toBeGreaterThan(0);
  });

  it('1> and 1>> are stdout by spelling — computable like > and >>', () => {
    // The explicit fd-1 spellings are stdout, so they compute like `>` and `>>`.
    expect(deriveShellChanges("echo 'x' 1> f.ts")).toEqual({
      evidence: [{ path: 'f.ts', content: 'x\n', mode: 'truncate' }],
      unjudgeable: [],
    });
    expect(deriveShellChanges("echo 'x' 1>> f.ts")).toEqual({
      evidence: [{ path: 'f.ts', content: 'x\n', mode: 'append' }],
      unjudgeable: [],
    });
  });

  it('an fd duplication whose digit equals another write target is not a second write', () => {
    // A duplication digit that equals another write target must not re-admit 2>&1 as a second
    // write and trip the two-write refusal.
    expect(deriveShellChanges("echo 'x' > 1 2>&1")).toEqual({
      evidence: [{ path: '1', content: 'x\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });
});
