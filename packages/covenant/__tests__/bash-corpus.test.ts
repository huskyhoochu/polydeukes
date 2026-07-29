import type { CovenantInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { tokenizeCommandLine } from '../src/bash-line.js';
import { deriveShellChanges } from '../src/shell-evidence.js';
import {
  DEFAULT_READ_ONLY_COMMANDS,
  judgeShellModification,
  type ShellModificationSpec,
} from '../src/shell-mod.js';
import {
  judgeTranscriptModification,
  type TranscriptModificationSpec,
} from '../src/transcript-mod.js';

// ===========================================================================
// COVENANT-18 §2-e — the standing corpus ledger
// ===========================================================================
//
// WHAT THIS FILE IS. A permanent regression device for bash constructs this package's own
// suites never exercised. It is NOT a vendored corpus: a data dump re-measures nothing and
// grows a maintenance surface that nobody reads.
//
// HOW THE LIST WAS DERIVED. A coverage diff, run once (2026-07-29). Two corpora were compared
// against every string literal in `packages/covenant/__tests__/*.test.ts`:
//
//   - `tree-sitter-bash`'s own test corpus — 100 cases chosen by people who implemented bash
//     properly. Its whole value is that we did not write it.
//     https://github.com/tree-sitter/tree-sitter-bash — MIT licensed.
//   - 2,815 real Bash calls extracted from this project's session transcripts. Biased toward
//     how we work, but measured rather than imagined.
//
// TWELVE constructs occur in a corpus and in none of our suites. Each gets one minimal
// fixture below, in the order the diff reported them.
//
// PROVENANCE. All twelve occur in the `tree-sitter-bash` corpus, so the MIT attribution above
// covers the construct SELECTION for every block in this file. Nine of them also occur in our
// session transcripts. Three occur in the independent corpus alone — the brace range, the
// arithmetic command, and the until loop — and those three are the clearest evidence for
// PRD §2-e's claim that a self-authored corpus makes its own blind spot look nine times
// smaller. The fixture LINES are ours: minimal, path-injected, one construct each. Their
// expected parse trees are deliberately NOT imported (PRD §2-e) — the tree shape is not what
// a judge needs to be right about.
//
// TWO CONSTRUCTS GET NO FIXTURE. `|&` (pipe-both) and the named file descriptor `{fd}>` occur
// ZERO times in BOTH corpora. Neither the people who wrote bash's hardest test cases nor our
// own two thousand calls ever produced them, so a fixture here would assert against an input
// no measurement has seen — speculation wearing a test's clothes. If either shows up in a
// later corpus sweep, it earns its fixture then.
//
// THE TWO ASSERTION AXES (PRD §2-e).
//   ① A line bash accepts must tokenize with an empty `unread`. A construct that lands in
//      `unread` drops out of precise judgment into the mention-scan fallback, and that one
//      branch is where B7, the backslash defect, and the metachar-glue defect all came from.
//   ② A redirect- or heredoc-bearing case has its extracted mutation target pinned. This is
//      the axis `bash -n` cannot answer: a line whose grammar is fine but whose write target
//      we read wrong is the dangerous shape, and axis ① alone never sees it.
//
// NO SHELL IS SPAWNED HERE. Every bash verdict below was measured once against
// **bash 5.3.9** (2026-07-29) and baked into `CORPUS_LINES`. Calling `bash -n` at test time
// would make the suite depend on the runner's own shell and its shopt state.
//
// Fixture values (tool name, arg name, protected path, home, transcript) are injected, never
// source literals — the live measurements that produced these expectations used this
// repository's own protected paths, but nothing here may couple to them.
// ---------------------------------------------------------------------------

const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PROTECTED = 'sub/protected/dist';
const UNPROTECTED = 'sub/other/plain';
const HOME = '/home/u';
const TRANSCRIPT_TAIL = '.claude/projects/-home-u-proj/session.jsonl';
const TRANSCRIPT = `${HOME}/${TRANSCRIPT_TAIL}`;

/** A shell-tool call carrying `line` under the injected command-arg key. */
function shellCall(line: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: line } }],
    subagentSpawns: [],
    userMessages: [],
  };
}

function shellSpec(overrides: Partial<ShellModificationSpec> = {}): ShellModificationSpec {
  return {
    protectedPaths: [PROTECTED],
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
    ...overrides,
  };
}

function transcriptSpec(
  overrides: Partial<TranscriptModificationSpec> = {},
): TranscriptModificationSpec {
  return {
    transcriptPath: TRANSCRIPT,
    home: HOME,
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    mutatingToolNames: ['Edit', 'Write'],
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
    ...overrides,
  };
}

/**
 * The twelve constructs, one line each, with bash 5.3.9's own verdict baked in.
 *
 * `bash` is 'accepts' for a line `bash -n` reads with default options. The extglob entry is
 * the single exception in the set: `bash -n` REJECTS it unless `extglob` is already on when
 * the line is parsed (`shopt -s extglob` earlier in the same line does not help — bash parses
 * the whole line first). It stays in the ledger because a shell that has the option on — an
 * interactive one, or a persistent tool shell that ran `shopt` on an earlier call — executes
 * it, and that is exactly the shell our hook sits in front of.
 */
const CORPUS_LINES: ReadonlyArray<{
  construct: string;
  line: string;
  bash: 'accepts' | 'accepts only with shopt -s extglob';
}> = [
  {
    construct: 'parameter expansion operand',
    line: `rm -rf \${TARGET:-${PROTECTED}}`,
    bash: 'accepts',
  },
  {
    construct: 'variable assignment prefix',
    line: `FOO=1 echo x > ${PROTECTED}/a.js`,
    bash: 'accepts',
  },
  { construct: 'extglob', line: 'rm -r !(keep)', bash: 'accepts only with shopt -s extglob' },
  {
    construct: 'while loop with a process-substitution redirect',
    line: `while read l; do echo $l; done < <(cat ${PROTECTED}/x)`,
    bash: 'accepts',
  },
  { construct: 'arithmetic expansion', line: 'echo $((1 > 2)) > out', bash: 'accepts' },
  { construct: 'array subscript', line: `echo \${arr[0]} > out`, bash: 'accepts' },
  {
    construct: 'case statement',
    line: `case $x in a|b) rm -rf ${PROTECTED};; esac`,
    bash: 'accepts',
  },
  {
    construct: 'nested command substitution',
    line: `cat $(a $(b); cat ${PROTECTED}/x)`,
    bash: 'accepts',
  },
  { construct: 'array assignment', line: `a=(${PROTECTED} x)`, bash: 'accepts' },
  { construct: 'brace range', line: `rm -rf ${PROTECTED}/{1..9}`, bash: 'accepts' },
  { construct: 'arithmetic command', line: `((i++)) && rm -rf ${PROTECTED}`, bash: 'accepts' },
  {
    construct: 'until loop',
    line: `until [ -f f ]; do rm -rf ${PROTECTED}; done`,
    bash: 'accepts',
  },
];

// ===========================================================================
// Axis ① — the whole ledger is read, not handed to the fallback
// ===========================================================================

describe('COVENANT-18 §2-e axis ① — every corpus construct tokenizes cleanly', () => {
  it('leaves no unread span for any of the twelve constructs', () => {
    // Mutation caught: any scanner change that pushes one of these constructs back into
    // `unread`. That is not a cosmetic regression — an unread line skips precise judgment and
    // falls to the raw mention scan, the single branch that produced B7, the backslash defect,
    // and the metachar-glue defect. The count is asserted alongside so a truncated ledger
    // (someone deleting entries to make this green) fails instead of shrinking silently.
    expect(CORPUS_LINES).toHaveLength(12);

    // The shopt caveat is an escape hatch. Pinning exactly which entry holds it stops the hatch
    // from becoming a way to excuse a tokenizer regression by relabelling a line invalid bash.
    expect(CORPUS_LINES.filter((c) => c.bash !== 'accepts').map((c) => c.construct)).toEqual([
      'extglob',
    ]);

    for (const { construct, line } of CORPUS_LINES) {
      expect(tokenizeCommandLine(line).unread, construct).toEqual([]);
    }
  });
});

// ===========================================================================
// 1. Parameter expansion operand — the COVENANT-07e tripwire
// ===========================================================================

/** The six operand spellings measured to pass. Bash accepts every one (5.3.9). */
const OPERAND_SPELLINGS = [':-', ':=', ':+', ':?', '-', '/x/'] as const;

describe('COVENANT-07e tripwire — a protected path as a parameter-expansion operand', () => {
  it('lets every operand spelling through today, while the sibling $VAR-prefixed path blocks', () => {
    // ***** TRIPWIRE — this pins a KNOWN DEFECT, not a decided behavior. *****
    //
    // `rm -rf ${TARGET:-<protected>}` upholds. It is not a theoretical hole: measured,
    // `bash -c 'unset TARGET; echo "${TARGET:-<path>}"'` prints the path, so the line really
    // deletes it. The cause is `pathCandidates`' separator set, which has no `{`, `}` or `:` —
    // the first segment comes out as `${TARGET:-sub` and the last as `dist}`, so the segment
    // match never lines up. It is the same pattern as COVENANT-07d (metachar glue) and
    // COVENANT-18 §2-g (backslash glue): a syntax character welded to a path's OUTER segment.
    //
    // OWNER: **COVENANT-07e** (roadmap §3-b'). It is a decidable miss — the path stands in the
    // text literally — so the "an undecidable axis is a declared limit" discipline does not
    // absolve it.
    //
    // WHEN 07e LANDS THIS TEST GOES RED. That is the point. Rewrite it then to assert
    // `upheld: false` for all six spellings. **Never delete it** — deleting it would retire the
    // only fixture that proves the six spellings were ever closed.
    //
    // The sibling assertion is the control: `$TARGET/<protected>` already blocks, so a green
    // result here cannot be blamed on the judge being switched off wholesale.
    for (const operand of OPERAND_SPELLINGS) {
      const line = `rm -rf \${TARGET${operand}${PROTECTED}}`;
      expect(judgeShellModification(shellCall(line), shellSpec()), operand).toEqual({
        upheld: true,
      });
    }

    const verdict = judgeShellModification(shellCall(`rm -rf $TARGET/${PROTECTED}`), shellSpec());
    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('lets a forged transcript append through the same operand, while the bare spelling blocks', () => {
    // ***** TRIPWIRE — the transcript axis of the SAME defect, same owner (COVENANT-07e). *****
    //
    // `echo forged >> ${X:-<transcript>}` upholds. The transcript is the evidence file the TTL
    // witness reads to decide a human spoke, so a forged append there re-opens EC5's
    // sub-question (protecting the evidence source) that COVENANT-07c closed for every other
    // spelling. The `~` form is included because 07c's audit B2 was precisely that form.
    //
    // Expected to go RED when 07e lands; rewrite to assert the block, never delete.
    for (const target of [`\${X:-${TRANSCRIPT}}`, `\${X:-~/${TRANSCRIPT_TAIL}}`]) {
      const line = `echo forged >> ${target}`;
      expect(judgeTranscriptModification(shellCall(line), transcriptSpec()), target).toEqual({
        upheld: true,
      });
    }

    // Control: the same forgery spelled without the expansion still breaks, so the pass above
    // is the operand's doing and not a dead judge.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ${TRANSCRIPT}`),
      transcriptSpec(),
    );
    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(TRANSCRIPT);
    }
  });

  it('records an unjudgeable row for every spelling it lets through', () => {
    // The line that keeps COVENANT-07e out of COVENANT-10b's class. A pass with NO telemetry
    // row is the B7 defect — a call judged by nobody and reported as fine. These lines DO leave
    // a row (`skipped shell-unjudgeable`), so what 07e owns is a decidable miss inside a
    // recorded call, not a silent one. Mutation caught: an 07e fix, or any opacity change, that
    // closes the verdict while dropping the row — the hole would then be invisible again on the
    // next sweep, since `roi.log` is the only place a sweep can look.
    for (const operand of OPERAND_SPELLINGS) {
      const line = `rm -rf \${TARGET${operand}${PROTECTED}}`;
      const derivation = deriveShellChanges(line);

      expect(derivation.evidence, operand).toEqual([]);
      expect(derivation.unjudgeable.length, operand).toBeGreaterThan(0);
    }

    expect(deriveShellChanges(`echo forged >> \${X:-${TRANSCRIPT}}`).unjudgeable).toHaveLength(1);
  });
});

// ===========================================================================
// 2. Variable assignment prefix (session 145 / independent 21 — the most common of the twelve)
// ===========================================================================

describe('a leading NAME=VALUE assignment at the judge surface', () => {
  it('still reads the redirect target past the assignment, blocking the protected write', () => {
    // Axis ②. Mutation caught: a scanner that stops at the first word containing `=` (treating
    // it as the command and giving up on redirects), or one that folds `FOO=1 echo` into one
    // word — either way the `> <protected>/a.js` target is never extracted and the most common
    // construct in the whole corpus becomes a write the judge cannot see. The reason is
    // asserted, not just the verdict: a block from the mention backstop instead of the
    // redirect rule would mean the target was still lost.
    const verdict = judgeShellModification(
      shellCall(`FOO=1 echo x > ${PROTECTED}/a.js`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('redirect-write');
      expect(verdict.reason).toContain(PROTECTED);
    }

    // The over-block end: an assignment prefix is not itself suspicious.
    expect(judgeShellModification(shellCall('FOO=1 echo x > out'), shellSpec())).toEqual({
      upheld: true,
    });
  });

  it('refuses an assignment-prefixed READ of a protected path — a documented over-block', () => {
    // Pins a limit rather than a defect, in the same voice as COVENANT-13b's `FOO=1 npm view`
    // case. `cat <protected>` is absolved by the read-only allowlist; `FOO=1 cat <protected>`
    // is not, because this judge reads the head as `words[0]` — the assignment. Note the
    // asymmetry with `extractMutations`, which since COVENANT-18 A5 DOES skip assignments to
    // find the command name: the two layers disagree about what the head is, and only the
    // conservative side of that disagreement is safe to ship untouched.
    //
    // If this test turns red, someone taught the judge to skip assignment prefixes. That is a
    // defensible change — it removes a real over-block — but it must arrive with the
    // allowlist-ordering cases re-measured, because the head word is what the allowlist
    // vouches for. Say so in the PRD rather than editing this line.
    const verdict = judgeShellModification(shellCall(`FOO=1 cat ${PROTECTED}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    expect(judgeShellModification(shellCall(`cat ${PROTECTED}`), shellSpec())).toEqual({
      upheld: true,
    });
  });
});

// ===========================================================================
// 3. Extglob — the degenerate form is the dangerous one
// ===========================================================================

describe('a negated extglob `!(…)`', () => {
  it('inverts the mention judgment: the spelling that SPARES the path blocks, the ones that delete it pass', () => {
    // The finding this construct exists to record, and the reason a realistic fixture set never
    // produces it. `!(pattern)` matches every name that does NOT match `pattern`, so:
    //
    //   `rm -r !(<protected>)`  spares the protected path and deletes everything else — BLOCKED
    //   `rm -r !(keep)`         deletes the protected path along with everything else — PASSES
    //   `rm -r !()`             the degenerate form: matches every non-empty name — PASSES
    //
    // Measured with bash 5.3.9 and extglob on: `rm -r !(keep)` in a directory holding `keep`,
    // `gone1` and `sub/` leaves exactly `keep`. Our judgment is therefore exactly backwards on
    // this construct — a mention scan reads `!(x)` as "names x" when it means "names everything
    // but x". Mutation caught: a future "extglob support" that only teaches the tokenizer to
    // keep `!(…)` as one word would leave both ends of this test green while the inversion
    // survives; only an assertion that names both directions can tell the two apart.
    //
    // This is a declared limit rather than an open defect — see the row assertion below — but
    // it is the limit closest to a real fail-open in the whole ledger, and it is pinned so a
    // later reader finds it stated rather than rediscovers it.
    const spared = judgeShellModification(shellCall(`rm -r !(${PROTECTED})`), shellSpec());
    expect(spared.upheld).toBe(false);

    for (const line of ['rm -r !(keep)', 'rm -r !()']) {
      expect(judgeShellModification(shellCall(line), shellSpec()), line).toEqual({ upheld: true });
    }
  });

  it('records an unjudgeable row for the extglob it lets through', () => {
    // What keeps the inversion above inside the "declared limit" class instead of B7's. Glob
    // expansion is a runtime operation, so a judge cannot name this line's targets — but it
    // must not report the call as judged and fine. Mutation caught: an opacity or word-scan
    // change that makes `!(keep)` look like an ordinary literal to the recording layer, after
    // which the call passes with a `passed` row and the next corpus sweep sees nothing.
    const derivation = deriveShellChanges('rm -r !(keep)');

    expect(derivation.evidence).toEqual([]);
    expect(derivation.unjudgeable).toHaveLength(1);
    expect(derivation.unjudgeable[0].reason.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4. While loop whose `done` carries a process-substitution redirect
// ===========================================================================

describe('a `done < <(…)` process-substitution redirect', () => {
  it('attaches the substitution to `done` as a redirect target, kept whole and opaque', () => {
    // Axis ②. Mutation caught: an operator scan that skips whitespace before matching, reading
    // `< <(` as the heredoc operator `<<` — everything after it becomes a delimiter and the
    // rest of the input becomes a body, so the inner command disappears from the token stream
    // entirely. The target text is pinned whole because a substitution split at its inner
    // spaces would leak `cat` as a top-level word, and an allowlisted head absolves a line.
    const result = tokenizeCommandLine('while read l; do echo $l; done < <(cat f)');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(3);
    expect(result.commands[2].words).toEqual([{ text: 'done', opaque: false }]);
    expect(result.commands[2].redirects).toEqual([
      { operator: '<', target: { text: '<(cat f)', opaque: true } },
    ]);
  });

  it('blocks a protected path inside that substitution and upholds the clean twin', () => {
    // Mutation caught: the mention scan reading only `words`, never redirect TARGETS — the
    // whole protected path sits in the target here, so a words-only scan passes the line. The
    // clean twin is the over-block fence: a loop that reads an ordinary file must not become
    // unpassable just because the redirect target is opaque.
    const verdict = judgeShellModification(
      shellCall(`while read l; do echo $l; done < <(cat ${PROTECTED}/x)`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }

    expect(
      judgeShellModification(
        shellCall(`while read l; do echo $l; done < <(cat ${UNPROTECTED})`),
        shellSpec(),
      ),
    ).toEqual({ upheld: true });
  });
});

// ===========================================================================
// 5. Arithmetic expansion — a `>` that is not a redirect
// ===========================================================================

describe('arithmetic expansion `$((…))`', () => {
  it('does not read the `>` inside it as a redirect, and still finds the real one after it', () => {
    // Axis ②, and the sharpest mutation-target case in the ledger. Mutation caught: the `>`
    // inside the arithmetic comparison scanned as a redirect operator. The line then reports a
    // phantom write to `2))` AND loses the real target `out` — a judge comparing a phantom
    // path against the protected list answers about a file that does not exist while the actual
    // write goes unexamined. Both halves are asserted because either alone can look correct.
    const result = tokenizeCommandLine('echo $((1 > 2)) > out');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      { text: '$((1 > 2))', opaque: true },
    ]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>', target: { text: 'out', opaque: false } },
    ]);

    // No redirect at all when the arithmetic stands alone — the phantom has nowhere to hide.
    expect(tokenizeCommandLine('echo $((1 > 2))').commands[0].redirects).toEqual([]);
  });

  it('blocks when the redirect after the arithmetic targets the protected path', () => {
    // The judge-surface consequence of the pin above. Mutation caught: the arithmetic word
    // consuming the rest of the line (a `$((` scan that closes on the first `)`), so the real
    // `> <protected>/a.js` write never reaches the redirect rule.
    const verdict = judgeShellModification(
      shellCall(`echo $((1 > 2)) > ${PROTECTED}/a.js`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('redirect-write');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });
});

// ===========================================================================
// 6. Array subscript `${a[…]}`
// ===========================================================================

describe('an array subscript inside a brace expansion', () => {
  it('keeps the bracketed subscript inside the opaque word so a redirect after it is still read', () => {
    // Axis ②. Mutation caught: `[` treated as a word terminator (bash's `test` builtin is
    // spelled `[`, so it is a tempting terminator). The word would break into `${arr` and
    // `0]}`, the brace scan would never close, and everything after it — including the write
    // target — would be swallowed into an unterminated expansion. The protected end proves the
    // redirect survives as a real mutation target, not merely as a token.
    const result = tokenizeCommandLine(`echo \${arr[0]} > out`);

    expect(result.unread).toEqual([]);
    expect(result.commands[0].words).toEqual([
      { text: 'echo', opaque: false },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional bash expansion fixture
      { text: '${arr[0]}', opaque: true },
    ]);
    expect(result.commands[0].redirects).toEqual([
      { operator: '>', target: { text: 'out', opaque: false } },
    ]);

    const verdict = judgeShellModification(
      shellCall(`echo \${arr[0]} > ${PROTECTED}/a.js`),
      shellSpec(),
    );
    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('redirect-write');
    }
  });
});

// ===========================================================================
// 7. Case statement
// ===========================================================================

describe('a case statement whose pattern list contains `|`', () => {
  it('still judges the branch body, and upholds a harmless branch', () => {
    // The `|` in `a|b)` is a case pattern separator, not a pipeline — we split there anyway, so
    // the branch body ends up in a simple command headed by the word `b)`. The block survives
    // that misreading, which is what matters. Mutation caught: a `case … esac` consumed as one
    // unparsed unit (the shape a "handle compound commands properly" change reaches for first),
    // after which the branch body's `rm -rf <protected>` never reaches the per-command mention
    // scan at all and the line passes. The harmless branch is the over-block fence — a case
    // statement is ordinary control flow and must not become unusable.
    const verdict = judgeShellModification(
      shellCall(`case $x in a|b) rm -rf ${PROTECTED};; esac`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }

    expect(
      judgeShellModification(shellCall('case $x in a|b) echo hi;; esac'), shellSpec()),
    ).toEqual({ upheld: true });
  });
});

// ===========================================================================
// 8. Nested command substitution
// ===========================================================================

describe('a nested command substitution `$(… $(…) …)`', () => {
  it('consumes the whole nesting as ONE opaque word, so an inner `;` cannot hand the rest to an allowlisted head', () => {
    // The fail-open this construct hides. Mutation caught: closing the outer `$(` at the FIRST
    // `)` instead of tracking depth. The word then ends at the inner substitution, the `;`
    // becomes a top-level separator, and the remainder `cat <protected>/x)` becomes its own
    // simple command headed by `cat` — an allowlisted reader that absolves the mention. The
    // line passes while bash runs the whole thing inside a substitution nobody inspected.
    // Asserting the word COUNT is what distinguishes the two: both readings block on the
    // mention, only the correct one keeps a single opaque token.
    const result = tokenizeCommandLine(`cat $(a $(b); cat ${PROTECTED}/x)`);

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words).toEqual([
      { text: 'cat', opaque: false },
      { text: `$(a $(b); cat ${PROTECTED}/x)`, opaque: true },
    ]);

    const verdict = judgeShellModification(
      shellCall(`cat $(a $(b); cat ${PROTECTED}/x)`),
      shellSpec(),
    );
    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }

    // Over-block fence: nesting alone is not suspicious.
    expect(
      judgeShellModification(shellCall('echo $(dirname $(readlink -f f))'), shellSpec()),
    ).toEqual({ upheld: true });
  });
});

// ===========================================================================
// 9. Array assignment `a=(…)`
// ===========================================================================

describe('an array assignment `name=(…)`', () => {
  it('finds a protected path glued behind `name=(`', () => {
    // This is the candidate-extraction rule from
    // `covenant.dev-log.mentionspath-splits-tokens-itself.md` doing its job on a construct that
    // dev-log never named: the tokenizer keeps `a=(<protected>` as ONE word, and only
    // `pathCandidates` splitting at `=` and `(` recovers the path from it. Mutation caught:
    // either separator dropped from that set — which is a live risk, because COVENANT-07e must
    // WIDEN the same set to close `${x:-…}` and a rewrite is the moment a set loses members.
    // The reason is asserted with the glued word intact so the assertion shows the glue rather
    // than merely the outcome.
    const verdict = judgeShellModification(shellCall(`a=(${PROTECTED} x)`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(`a=(${PROTECTED}`);
    }

    expect(judgeShellModification(shellCall('a=(x y)'), shellSpec())).toEqual({ upheld: true });
  });
});

// ===========================================================================
// 10. Brace range `{1..9}` — independent corpus only (0 session occurrences)
// ===========================================================================

describe('a brace range appended to a path', () => {
  it('still names the protected ancestor when `{1..9}` follows it', () => {
    // Mutation caught: the segment match broken by the trailing brace segment — a whole-token
    // comparison, or a candidate split that shatters the path. Also a standing fence for
    // COVENANT-07e: that ticket must add `{` and `}` to the separator set, and this pins that
    // widening it must not stop `<protected>/{1..9}` from naming its protected ancestor. The
    // clean twin keeps the widening honest in the other direction — a brace range on an
    // unrelated name is everyday shell and must stay passable.
    const verdict = judgeShellModification(shellCall(`rm -rf ${PROTECTED}/{1..9}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }

    expect(judgeShellModification(shellCall('rm -rf f{1..9}'), shellSpec())).toEqual({
      upheld: true,
    });
  });
});

// ===========================================================================
// 11. Arithmetic command `((…))` — independent corpus only (0 session occurrences)
// ===========================================================================

describe('an arithmetic command `((…))`', () => {
  it('does not swallow the command that follows it', () => {
    // Mutation caught: `((` scanned as a subshell group and consumed to the matching `))` and
    // beyond, or the `&&` after it folded into the arithmetic word. Either loses the second
    // simple command, and with it the only mutating command on the line — the mention scan then
    // has nothing to find. The bare arithmetic is the over-block fence: a loop counter is not
    // a covenant matter.
    const verdict = judgeShellModification(
      shellCall(`((i++)) && rm -rf ${PROTECTED}`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }

    expect(judgeShellModification(shellCall('((i++))'), shellSpec())).toEqual({ upheld: true });
  });
});

// ===========================================================================
// 12. Until loop — independent corpus only (0 session occurrences)
// ===========================================================================

describe('an until loop', () => {
  it('judges a protected mutation inside the loop body, and upholds a clean loop', () => {
    // Mutation caught: loop keywords (`do`, `done`, `until`) treated as syntax to be skipped
    // rather than as words, in a way that drops the body's commands from the token stream —
    // the body is where the work happens, so losing it loses the judgment entirely. Only the
    // path is asserted, deliberately: today the block is attributed to the keyword `do`
    // (the body's head word after the `;` split), and a later change that finds the body's real
    // head would move the attribution without weakening anything. The clean loop is the
    // over-block fence — polling loops are routine.
    const verdict = judgeShellModification(
      shellCall(`until [ -f f ]; do rm -rf ${PROTECTED}; done`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }

    expect(
      judgeShellModification(shellCall('until [ -f f ]; do sleep 1; done'), shellSpec()),
    ).toEqual({ upheld: true });
  });
});
