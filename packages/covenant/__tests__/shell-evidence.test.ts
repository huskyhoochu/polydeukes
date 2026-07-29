import { describe, expect, it } from 'vitest';
// COVENANT-10b §2-a — the shell-evidence derivation module: one command string in,
// `{ evidence, unjudgeable }` out, pure (pre-state reading is the body's job, via an
// injected reader). The boundary table IS the contract: a judged row computes
// target + content + redirect mode, a per-item-skip row answers a path-bearing
// unjudgeable entry, a target-unknown row answers a pathless one, and a command with
// no mutation signal stays silent in BOTH arrays (the volume defence). The module
// does not exist yet, so this file is RED by construction (import failure).
import { deriveShellChanges } from '../src/shell-evidence.ts';

// ---------------------------------------------------------------------------
// Fixtures. Paths are arbitrary literals — derivation is scope-blind; scope
// matching belongs to the compiler's routing closures. Allowlist-sensitive
// fixtures use heads from the shipped DEFAULT_READ_ONLY_COMMANDS semantics
// (cat/ls/echo/printf are in; rm/tee/pnpm/python3/bash are out).
// ---------------------------------------------------------------------------

/** Join physical lines into the single command string a hook payload carries. */
function lines(...parts: string[]): string {
  return parts.join('\n');
}

// ===========================================================================
// §2-a judged rows — computable evidence
// ===========================================================================

describe('deriveShellChanges — computable evidence (§2-a judged rows)', () => {
  it('computes an echo append write with mode append', () => {
    // Mutation caught: `>>` collapsed into truncate — the body would then judge the
    // appended line as the whole file and forgive nothing / overwrite the pre baseline.
    expect(deriveShellChanges('echo a b >> f.ts')).toEqual({
      evidence: [{ path: 'f.ts', content: 'a b\n', mode: 'append' }],
      unjudgeable: [],
    });
  });

  it('joins tokenized words, preserving spaces inside a quoted arg', () => {
    // Mutation caught: content sliced from the raw command string (would keep the
    // quotes: "'a b' c\n") instead of joining the quote-aware token texts.
    expect(deriveShellChanges("echo 'a b' c > f.ts")).toEqual({
      evidence: [{ path: 'f.ts', content: 'a b c\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('only the FIRST arg starting with - refuses; a later dash-arg is plain content', () => {
    // §2-a row 1 boundary is "first arg". Mutation caught: any-arg dash scan — that
    // over-refusal turns a computable violation into a skip (recorded, never blocked).
    expect(deriveShellChanges('echo x -n > f.ts')).toEqual({
      evidence: [{ path: 'f.ts', content: 'x -n\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('captures a quoted-delimiter heredoc body verbatim as truncate content', () => {
    // §2-a row 2 / axis "heredoc delimiter" literal end. Mutation caught: heredoc
    // bodies still discarded (today's tokenizer behavior — the B3 hole itself).
    const command = lines("cat > f.ts <<'EOF'", 'line one', 'line two', 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'line one\nline two\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('keeps a $ inside a QUOTED-delimiter heredoc literal (no expansion, still judged)', () => {
    // The sharp pair with the unquoted+$ skip below: same body, quoting flips the
    // disposition. Mutation caught: opacity checked on the body regardless of the
    // delimiter quoting — every document containing $ would silently stop being judged.
    const command = lines("cat > f.ts <<'EOF'", 'value: $HOME', 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'value: $HOME\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('computes an empty quoted heredoc as empty content, not as no evidence', () => {
    // Degenerate form. Mutation caught: empty body treated as "nothing derived" — the
    // truncation of a scoped file would then leave no evidence and no skip row.
    const command = lines("cat > f.ts <<'EOF'", 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: '', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('judges an UNquoted-delimiter heredoc whose body is free of $ and backtick', () => {
    // §2-a row 2 second form. Mutation caught: unquoted delimiter refused wholesale —
    // the common <<EOF documentation idiom would all degrade into skip volume.
    const command = lines('cat > f.ts <<EOF', 'plain body', 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'plain body\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('computes a literal herestring as content plus the newline bash appends', () => {
    // §2-a row 3. Mutation caught: <<< treated as an unjudgeable read redirect, or the
    // herestring newline dropped (content would diff against disk one byte short).
    expect(deriveShellChanges("cat > f.ts <<< 'hi'")).toEqual({
      evidence: [{ path: 'f.ts', content: 'hi\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('computes a bare command-less truncate as empty content', () => {
    // §2-a row 4. Mutation caught: a command with zero words dropped before the
    // redirect is read — `> f` is the cheapest way to empty a scoped file silently.
    expect(deriveShellChanges('> f.ts')).toEqual({
      evidence: [{ path: 'f.ts', content: '', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('keeps an ABSOLUTE target computable under a cd prefix', () => {
    // §2-a row 10 parenthetical / axis "cwd" judged end. Mutation caught: any cd in
    // the line poisoning every command after it — the absolute-target write would
    // degrade from a judgeable violation into a mere skip row.
    expect(deriveShellChanges('cd d && echo x > /abs/f.ts')).toEqual({
      evidence: [{ path: '/abs/f.ts', content: 'x\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('derives one evidence entry per command, in command order', () => {
    // Axis "multi" two-commands end. Mutation caught: derivation stopping at the
    // first computable write (the second file's violation would vanish).
    expect(deriveShellChanges('echo a > f1.ts && echo b > f2.ts')).toEqual({
      evidence: [
        { path: 'f1.ts', content: 'a\n', mode: 'truncate' },
        { path: 'f2.ts', content: 'b\n', mode: 'truncate' },
      ],
      unjudgeable: [],
    });
  });

  it('keeps the computable and unjudgeable channels independent on one line', () => {
    // Mutation caught: one unjudgeable command aborting the whole line — the
    // computable violation in f1.ts would be lost with it (fail-open by association).
    const { evidence, unjudgeable } = deriveShellChanges('echo ok > f1.ts && sed -i s/a/b/ f2.ts');

    expect(evidence).toEqual([{ path: 'f1.ts', content: 'ok\n', mode: 'truncate' }]);
    expect(unjudgeable).toHaveLength(1);
    expect(unjudgeable[0].path).toBe('f2.ts');
  });
});

// ===========================================================================
// §2-a per-item skip rows — unjudgeable WITH a path (entry-scope routable)
// ===========================================================================

describe('deriveShellChanges — per-item unjudgeable, target known (§2-a skip rows)', () => {
  /** Assert the §2-a per-item shape: no evidence, one entry carrying the path. */
  function expectPathSkip(command: string, path: string): void {
    const result = deriveShellChanges(command);
    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBe(path);
  }

  it('refuses echo with a leading flag (echo -n) but keeps the target path', () => {
    // §2-a row 5: -n/-e semantics are not computed. Mutation caught: -n treated as
    // content (a confident wrong post — the exact approximation 07b forbade).
    expectPathSkip('echo -n x > f.ts', 'f.ts');
  });

  it('refuses printf format semantics but keeps the target path', () => {
    // §2-a row 5. Mutation caught: printf args joined like echo's — %s would be
    // judged as literal text and the real expansion never seen.
    expectPathSkip("printf '%s' x > f.ts", 'f.ts');
  });

  it('refuses an opaque echo arg ($V) while the target stays known', () => {
    // Axis "content" opaque end with a literal target. Mutation caught: opaque arg
    // texts joined verbatim ("$V\n" asserted as the written content).
    expectPathSkip('echo $V > f.ts', 'f.ts');
  });

  it('refuses an UNquoted heredoc whose body carries an expansion', () => {
    // §2-a row 6 / axis "heredoc delimiter" expanding end — $ and backtick both.
    // Mutation caught: unquoted bodies captured as literal (the expansion result
    // differs from the captured text, so the judged content would be fiction).
    for (const expansion of ['value: $HOME', 'value: `date`']) {
      const command = lines('cat > f.ts <<EOF', expansion, 'EOF');
      expectPathSkip(command, 'f.ts');
    }
  });

  it('refuses a transforming command redirect (grep x y > f)', () => {
    // §2-a row 7: output derives from a transform, not from the args. Mutation
    // caught: any redirect-bearing command judged via the echo arg-join row.
    expectPathSkip('grep x y.txt > out.ts', 'out.ts');
  });

  it('refuses cat reading a FILE into a redirect, even though heredoc-cat is judged', () => {
    // §2-a row 7 (`cat < in > f`): the content lives on disk, not in the command.
    // Mutation caught: "cat > target is always computable" over-generalized from the
    // heredoc rows — the copied file's content would be asserted as empty.
    expectPathSkip('cat < in.txt > out.ts', 'out.ts');
  });

  it('reports sed -i as detected-but-uncomputable with the file operand as path', () => {
    // §2-a row 8 — the per-entry-skip archetype (AC §3.2). Mutation caught: sed -i
    // dropped entirely (silent again — the B3 measurement this ticket exists to end).
    expectPathSkip('sed -i s/a/b/ notes.ts', 'notes.ts');
  });

  it('reports a tee target as detected-but-uncomputable', () => {
    // §2-a row 8: pipe content is not computed even when statically plausible — the
    // table is the boundary. Mutation caught: pipe payloads composed into evidence.
    expectPathSkip('echo x | tee f.ts', 'f.ts');
  });

  it('refuses a non-stdout redirect (2>) while keeping its target', () => {
    // §2-a row 9: stderr content is unknowable; an allowlisted head does not silence
    // a write-direction redirect. Mutation caught: `ls` head short-circuiting to
    // silence before redirects are examined.
    expectPathSkip('ls 2> err.ts', 'err.ts');
  });

  it('refuses a command with TWO write redirects, target(s) still named', () => {
    // §2-a row 9 / axis "multi" single-command end: bash truncates a.ts AND writes
    // b.ts — computing either alone is wrong. Mutation caught: last-redirect-wins
    // evidence for b.ts (a.ts's truncation would go unrecorded and unjudged).
    const result = deriveShellChanges('echo x > a.ts > b.ts');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable.length).toBeGreaterThan(0);
    expect(result.unjudgeable.some((entry) => entry.path === 'a.ts' || entry.path === 'b.ts')).toBe(
      true,
    );
  });
});

// ===========================================================================
// §2-a common skip rows — unjudgeable WITHOUT a path (target unknown)
// ===========================================================================

describe('deriveShellChanges — target unknown, no path carried (§2-a common rows)', () => {
  /** Assert the target-unknown shape: no evidence, pathless unjudgeable entries. */
  function expectPathlessSkip(command: string): void {
    const result = deriveShellChanges(command);
    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable.length).toBeGreaterThan(0);
    expect(result.unjudgeable.every((entry) => entry.path === undefined)).toBe(true);
  }

  it('an opaque redirect target ($F) is unjudgeable without a path', () => {
    // §2-a row 11. A path here would scope-route the skip to whatever entry the
    // unexpanded text happens to match. Mutation caught: '$F' carried as a path.
    expectPathlessSkip('echo x > $F');
  });

  it('a glob redirect target (*.ts) is unjudgeable without a path', () => {
    // §2-a row 11 — the 07b hand-off pin. Mutation caught: the glob text asserted
    // as a literal target path.
    expectPathlessSkip('> *.ts');
  });

  it('an opaque tee operand is unjudgeable without a path', () => {
    // §2-a row 11 (`tee $OUT`). Mutation caught: the opaque operand reported as a
    // per-item path (the tee rule itself stays silent on opaque words).
    expectPathlessSkip('echo x | tee $OUT');
  });

  it('a nested shell is a reinterpretation boundary — unjudgeable, no path', () => {
    // §2-a row 12 (04a already answers indeterminate). Mutation caught: x.sh taken
    // as the mutation target, or the nested command parsed into.
    expectPathlessSkip('bash x.sh');
  });

  it('an opaque token under a non-allowlisted head (rm glob) signals without a path', () => {
    // §2-a row 13 — the 07b silence this ticket turns into a recorded skip. Mutation
    // caught: the signal check requiring a detected mutation or redirect, so the rm
    // glob stays exactly as silent as it was measured to be.
    expectPathlessSkip('rm packages/*/dist/index.js');
  });

  it('a cd prefix makes a RELATIVE redirect target unjudgeable without a path', () => {
    // §2-a row 10: the base directory is unknown, so the textual rel.ts must NOT be
    // carried (it would scope-match the wrong entry). Mutation caught: rel.ts kept
    // as a confident path despite the cwd shift.
    expectPathlessSkip('cd d && echo x > rel.ts');
  });
});

// ===========================================================================
// §2-a last row — no mutation signal, silence in both arrays (volume defence)
// ===========================================================================

describe('deriveShellChanges — signal-free commands stay silent (§2-a volume defence)', () => {
  it('answers empty evidence AND empty unjudgeable for signal-free commands', () => {
    // §2-a last row verbatim: reads with globs, allowlisted heads over expansions,
    // and plain non-allowlisted runs carry no mutation signal. Mutation caught: the
    // opaque-token rule applied without the allowlist gate (every ls/cat/echo with a
    // glob or $ would flood the log — the volume failure 07b measured at 2,414).
    const silent = ['ls *.md', 'cat lefthook.y*', 'echo $HOME', 'pnpm build', 'python3 x.py'];

    for (const command of silent) {
      expect(deriveShellChanges(command)).toEqual({ evidence: [], unjudgeable: [] });
    }
  });
});

// ===========================================================================
// AC §3.2 — every unjudgeable entry names its reason
// ===========================================================================

describe('deriveShellChanges — no reasonless skip (AC §3.2)', () => {
  it('carries a non-empty reason on every unjudgeable entry across the corpus', () => {
    // AC §3.2 last bullet: zero reason-less skips. Mutation caught: a branch that
    // files the entry with an empty or missing reason — a skip row nobody can act on.
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

// ===========================================================================
// Audit-round gaps (2026-07-27) — §2-a inputs the first RED round never tried
// ===========================================================================

describe('deriveShellChanges — computable edge forms (audit G14/G3/G6/G8/G9/G16)', () => {
  it('computes zero-arg echo as a bare newline truncate', () => {
    // (audit G14) §2-a row 1 includes zero args, content '\n'. Mutation caught: the
    // first-arg dash check refusing (or silencing) an absent arg — the cheapest wipe.
    expect(deriveShellChanges('echo > f.ts')).toEqual({
      evidence: [{ path: 'f.ts', content: '\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('captures an APPEND heredoc body with mode append', () => {
    // (audit G3) §2-a row 2: heredoc literalness is direction-independent. Mutation
    // caught: heredoc capture wired to `>` only, or `>>` collapsed into truncate (the
    // pre baseline would be overwritten instead of composed).
    const command = lines("cat >> f.ts <<'EOF'", 'appended line', 'EOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'appended line\n', mode: 'append' }],
      unjudgeable: [],
    });
  });

  it('keeps a computable write computable beside an fd reference (2>&1)', () => {
    // (audit G6) §2-a row 9 exception: an fd reference is neither write nor signal.
    // Mutation caught: 2>&1 counted as a second write redirect — the two-write refusal
    // would demote this computable violation into a skip row.
    expect(deriveShellChanges('echo x > f.ts 2>&1')).toEqual({
      evidence: [{ path: 'f.ts', content: 'x\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('strips ALL leading tabs from a <<- heredoc body, byte-exact', () => {
    // (audit G8) The content contract is the bytes bash writes. Mutation caught: <<-
    // bodies captured with tabs intact, or only one leading tab of several stripped.
    const command = lines('cat > f.ts <<-EOF', '\tline one', '\t\tline two', '\tEOF');

    expect(deriveShellChanges(command)).toEqual({
      evidence: [{ path: 'f.ts', content: 'line one\nline two\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });

  it('feeds two heredocs on one line each to its own target, in order', () => {
    // (audit G8) Bash consumes pending heredoc bodies in redirect order. Mutation
    // caught: both bodies attributed to the first target, or the second write bodyless.
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
    // (audit G8) Mutation caught: derivation stopping at the heredoc terminator — a
    // write smuggled on the next physical line would be the quiet pass returning.
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
    // (audit G9) Axis "separator" far end. Mutation caught: derivation re-splitting on
    // && instead of consuming the tokenizer's command list — under every other
    // separator the second file's violation would vanish.
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
    // (audit G16) Pins the tokenizer's CRLF convention as derivation contract. Mutation
    // caught: \r kept in content (every judged diff one byte off), or `EOF\r` failing
    // to terminate the body (a spurious tokenize failure).
    expect(deriveShellChanges("cat > f.ts <<'EOF'\r\nbody line\r\nEOF\r\n")).toEqual({
      evidence: [{ path: 'f.ts', content: 'body line\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });
});

// ===========================================================================
// Audit-round gaps — per-item skips (path known) the first round never tried
// ===========================================================================

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
    // (audit G4) §2-a amended row: writer unknown, target known. Mutation caught: the
    // opaque head demoting this to the pathless common bucket — the entry-scope
    // attribution (and that label's skipped row) would be lost.
    expectPathSkip('$CMD > lit.ts', 'lit.ts');
  });

  it('an opaque herestring keeps its target path', () => {
    // (audit G15) The sharp pair with the judged literal herestring. Mutation caught:
    // "$V" captured as literal content — a fiction post judged as fact.
    expectPathSkip('cat > f.ts <<< "$V"', 'f.ts');
  });

  it('a non-stdout &> or &>> redirect keeps its target path', () => {
    // (audit G7) §2-a row 9 bold forms. Mutation caught: &> parsed as & plus a bare
    // command-less truncate — confident empty-content evidence for a stderr-carrying
    // stream (and &>> likewise as a bare append).
    for (const command of ['run &> f.ts', 'run &>> f.ts']) {
      expectPathSkip(command, 'f.ts');
    }
  });
});

// ===========================================================================
// Audit-round gaps — unread spans and target-unknown forms
// ===========================================================================

describe('deriveShellChanges — an unread span is a recorded common skip (audit G1)', () => {
  it('answers one pathless reasoned entry per unread form, never silence', () => {
    // (audit G1) §2-a row 14: the span the tokenizer could not read is exactly where a quiet
    // pass would hide. The title says "unread span" rather than "tokenize failure" since
    // COVENANT-18 §2-b B2 — the line is now read up to the span, and this form has nothing
    // readable left after it: the quote swallows the redirect operator, so `f.ts` is content
    // and no write exists to file. Mutation caught: the span answering empty/empty
    // (fail-open), or throwing out of the pure function instead of filing the reason.
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
    // Was a member of the G1 failing-forms list above. §2-a A8 makes the spaced `>(…)`
    // target readable, so the line reaches precise judgment — where the target is opaque
    // and its real path (a /dev/fd entry) is knowable only to execution. Mutation caught:
    // the readable target being taken for a literal filename, which files fiction as fact.
    const result = deriveShellChanges('echo x > >(tee f.ts)');

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBeUndefined();
    expect(result.unjudgeable[0].reason.length).toBeGreaterThan(0);
  });

  it('keeps the write target of a "<<$V" heredoc, now that the delimiter no longer fails', () => {
    // The same list's other migrated member. §2-a A3 deletes the opaque-delimiter refusal
    // (bash never expands a delimiter), so the `> f.ts` write is read and the entry gains
    // the path the common bucket could not carry — with no body, the content stays
    // uncomputed. Mutation caught: the migration turning a recorded skip into silence.
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
    // (audit G11) §2-a row 15 — the never-expand-~ contract of 07b, derivation-layer
    // edition. Mutation caught: '~/f.ts' carried textually (the skip row would
    // scope-route wrongly) or resolved against $HOME.
    expectPathlessSkip('echo x > ~/f.ts');
  });

  it('sed -i over an opaque operand keeps the signal but drops the path', () => {
    // (audit G12) §2-a row 16 bold form: the detector is silent on an opaque operand,
    // the signal is not. Mutation caught: detector-silence collapsing into
    // derivation-silence (the quiet pass), or '$F' carried as a per-item path.
    expectPathlessSkip('sed -i s/a/b/ $F');
  });

  it('a write BEFORE cd on the same line is refused all the same', () => {
    // (audit G10) §2-a row 10: cd presence is line-scoped, order-blind. Mutation
    // caught: an order-aware cd check confidently judging the pre-cd write.
    expectPathlessSkip('echo x > rel.ts && cd d');
  });

  it('an ABSOLUTE cd argument does not license resolving a relative target', () => {
    // (audit G10) §2-a row 10 parenthetical. Mutation caught: '/abs/rel.ts' composed
    // as confident evidence — base resolution is the approximation the table refuses.
    expectPathlessSkip('cd /abs && echo x > rel.ts');
  });
});

// ===========================================================================
// Review-round regressions (PR #36) — each fixture is a verifier's reproduction
// ===========================================================================

describe('deriveShellChanges — review-round regressions (PR #36)', () => {
  it('reports a tee operand even when a write redirect rides the same command', () => {
    // Review [1]: the early return on write redirects swallowed rule-detected
    // targets — a banned word landed in the tee file with no row of any kind.
    const { evidence, unjudgeable } = deriveShellChanges("echo 'x' | tee f2.ts > /dev/null");

    expect(evidence).toEqual([]);
    const paths = unjudgeable.map((entry) => entry.path);
    expect(paths).toContain('f2.ts');
    expect(paths).toContain('/dev/null');
  });

  it('reports a sed -i operand even when the same command redirects elsewhere', () => {
    // Review [1], sed edition: the operand and the redirect target each keep a row.
    const { evidence, unjudgeable } = deriveShellChanges('sed -i s/a/b/ f.ts > log.txt');

    expect(evidence).toEqual([]);
    const paths = unjudgeable.map((entry) => entry.path);
    expect(paths).toContain('f.ts');
    expect(paths).toContain('log.txt');
  });

  it('refuses an unquoted heredoc body carrying a backslash — a line continuation', () => {
    // Review [4]: bash joins a trailing-backslash line in an unquoted heredoc, so
    // captured bytes would be fiction; the form is unjudgeable, never confident.
    const command = lines('cat > f.ts <<EOF', 'line gu\\', 'ard', 'EOF');

    const { evidence, unjudgeable } = deriveShellChanges(command);

    expect(evidence).toEqual([]);
    expect(unjudgeable).toEqual([expect.objectContaining({ path: 'f.ts' })]);
  });

  it('a subshell group is a reinterpretation boundary, not a confident path or content', () => {
    // Review [5]: '(' as a word defeated the cd rule; ')' leaked into derived content.
    const { evidence, unjudgeable } = deriveShellChanges('( cd d && echo x > rel.ts )');

    expect(evidence).toEqual([]);
    expect(unjudgeable.length).toBeGreaterThan(0);
    expect(unjudgeable.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('popd moves the directory too — a following relative write is refused', () => {
    // Review [6]: the directory-change set named cd and pushd only.
    const { evidence, unjudgeable } = deriveShellChanges('popd && echo x > rel.ts');

    expect(evidence).toEqual([]);
    expect(unjudgeable.every((entry) => entry.path === undefined)).toBe(true);
    expect(unjudgeable.length).toBeGreaterThan(0);
  });

  it('1> and 1>> are stdout by spelling — computable like > and >>', () => {
    // Review [7]: the explicit fd-1 spellings were demoted to per-item skips.
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
    // Review [8]: detected.has('1') re-admitted 2>&1 and tripped the two-write refusal.
    expect(deriveShellChanges("echo 'x' > 1 2>&1")).toEqual({
      evidence: [{ path: '1', content: 'x\n', mode: 'truncate' }],
      unjudgeable: [],
    });
  });
});
