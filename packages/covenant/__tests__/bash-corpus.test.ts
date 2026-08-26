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

// A standing regression ledger for twelve bash constructs that occur in the
// `tree-sitter-bash` test corpus (https://github.com/tree-sitter/tree-sitter-bash, MIT) and in
// real session transcripts, but in none of this package's other suites. Two constructs found
// in neither corpus — `|&` and the named file descriptor `{fd}>` — deliberately get no
// fixture; asserting against an input no measurement has seen proves nothing.
//
// Two assertion axes:
//   ① A line bash accepts must tokenize with an empty `unread`. A construct that lands in
//      `unread` drops out of precise judgment into the mention-scan fallback, which is where
//      every glue defect in this package's history came from.
//   ② A redirect- or heredoc-bearing case has its extracted mutation target pinned — a line
//      whose grammar is fine but whose write target is read wrong is invisible to axis ①.
//
// No shell is spawned: every bash verdict was measured once against bash 5.3.9 and baked into
// `CORPUS_LINES`, so the suite does not depend on the runner's shell or its shopt state.

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
 * the single exception: `bash -n` rejects it unless `extglob` is already on when the line is
 * parsed (`shopt -s extglob` earlier on the same line does not help — bash parses the whole
 * line first). It stays because a shell with the option already on — an interactive one, or a
 * persistent tool shell — executes it, and that is the shell the hook sits in front of.
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

describe('COVENANT-18 §2-e axis ① — every corpus construct tokenizes cleanly', () => {
  it('leaves no unread span for any of the twelve constructs', () => {
    // The count is asserted so a truncated ledger fails instead of shrinking silently.
    expect(CORPUS_LINES).toHaveLength(12);

    // Pinning which entry holds the shopt caveat stops it becoming a way to excuse a tokenizer
    // regression by relabelling a line invalid bash.
    expect(CORPUS_LINES.filter((c) => c.bash !== 'accepts').map((c) => c.construct)).toEqual([
      'extglob',
    ]);

    for (const { construct, line } of CORPUS_LINES) {
      expect(tokenizeCommandLine(line).unread, construct).toEqual([]);
    }
  });
});

/** The six operand spellings measured to pass. Bash accepts every one (5.3.9). */
const OPERAND_SPELLINGS = [':-', ':=', ':+', ':?', '-', '/x/'] as const;

describe('COVENANT-07e tripwire — a protected path as a parameter-expansion operand', () => {
  it('lets every operand spelling through today, while the sibling $VAR-prefixed path blocks', () => {
    // TRIPWIRE — this pins a known open defect, not a decided behavior.
    //
    // `rm -rf ${TARGET:-<protected>}` upholds, and the line really does delete the path:
    // `bash -c 'unset TARGET; echo "${TARGET:-<path>}"'` prints it. The cause is that
    // `pathCandidates`' separator set carries no `{`, `}` or `:`, so the first segment comes
    // out as `${TARGET:-sub` and the last as `dist}` and the segment match never lines up.
    //
    // A fix makes this test RED. Rewrite it then to assert `upheld: false` for all six
    // spellings; do not delete it, or nothing records that the spellings were ever closed.
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
    // TRIPWIRE — the transcript axis of the same open defect above.
    //
    // `echo forged >> ${X:-<transcript>}` upholds. The transcript is the evidence file the TTL
    // witness reads to decide a human spoke, so a forged append there reopens the question of
    // protecting the evidence source that is closed for every other spelling. Rewrite this to
    // assert the block when the defect is fixed; never delete it.
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
    // What keeps the miss above a declared limit rather than a silent pass: these lines leave a
    // `skipped shell-unjudgeable` row. A fix that closes the verdict while dropping the row
    // would make the hole invisible to the next sweep, since the telemetry log is the only
    // place a sweep can look.
    for (const operand of OPERAND_SPELLINGS) {
      const line = `rm -rf \${TARGET${operand}${PROTECTED}}`;
      const derivation = deriveShellChanges(line);

      expect(derivation.evidence, operand).toEqual([]);
      expect(derivation.unjudgeable.length, operand).toBeGreaterThan(0);
    }

    expect(deriveShellChanges(`echo forged >> \${X:-${TRANSCRIPT}}`).unjudgeable).toHaveLength(1);
  });
});

describe('a leading NAME=VALUE assignment at the judge surface', () => {
  it('still reads the redirect target past the assignment, blocking the protected write', () => {
    // A scanner that stops at the first word containing `=`, or folds `FOO=1 echo` into one
    // word, never extracts the `> <protected>/a.js` target. The reason is asserted and not
    // just the verdict: a block from the mention backstop instead of the redirect rule would
    // mean the target was still lost.
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
    // A declared limit, not a defect. `cat <protected>` is absolved by the read-only
    // allowlist; `FOO=1 cat <protected>` is not, because this judge reads the head as
    // `words[0]` — the assignment. `extractMutations` disagrees: it skips assignments to find
    // the command name. Only the conservative side of that disagreement is safe untouched.
    //
    // If this turns red, someone taught the judge to skip assignment prefixes. That removes a
    // real over-block, but it must arrive with the allowlist-ordering cases re-measured,
    // because the head word is what the allowlist vouches for.
    const verdict = judgeShellModification(shellCall(`FOO=1 cat ${PROTECTED}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    expect(judgeShellModification(shellCall(`cat ${PROTECTED}`), shellSpec())).toEqual({
      upheld: true,
    });
  });
});

describe('a negated extglob `!(…)`', () => {
  it('inverts the mention judgment: the spelling that SPARES the path blocks, the ones that delete it pass', () => {
    // `!(pattern)` matches every name that does NOT match `pattern`, so the judgment is exactly
    // backwards here — a mention scan reads `!(x)` as "names x" when it means "names everything
    // but x":
    //
    //   `rm -r !(<protected>)`  spares the protected path, deletes everything else — BLOCKED
    //   `rm -r !(keep)`         deletes the protected path with everything else — PASSES
    //   `rm -r !()`             matches every non-empty name — PASSES
    //
    // Measured with bash 5.3.9 and extglob on: `rm -r !(keep)` in a directory holding `keep`,
    // `gone1` and `sub/` leaves exactly `keep`. Both directions are asserted because extglob
    // support that only teaches the tokenizer to keep `!(…)` as one word leaves this green
    // while the inversion survives. It stays a declared limit — see the row assertion below —
    // but it is the limit closest to a real fail-open in the ledger.
    const spared = judgeShellModification(shellCall(`rm -r !(${PROTECTED})`), shellSpec());
    expect(spared.upheld).toBe(false);

    for (const line of ['rm -r !(keep)', 'rm -r !()']) {
      expect(judgeShellModification(shellCall(line), shellSpec()), line).toEqual({ upheld: true });
    }
  });

  it('records an unjudgeable row for the extglob it lets through', () => {
    // What keeps the inversion above a declared limit. Glob expansion is a runtime operation,
    // so a judge cannot name this line's targets — but it must not report the call as judged
    // and fine. An opacity or word-scan change that makes `!(keep)` look like an ordinary
    // literal to the recording layer leaves a `passed` row and the next sweep sees nothing.
    const derivation = deriveShellChanges('rm -r !(keep)');

    expect(derivation.evidence).toEqual([]);
    expect(derivation.unjudgeable).toHaveLength(1);
    expect(derivation.unjudgeable[0].reason.length).toBeGreaterThan(0);
  });
});

describe('a `done < <(…)` process-substitution redirect', () => {
  it('attaches the substitution to `done` as a redirect target, kept whole and opaque', () => {
    // An operator scan that skips whitespace before matching reads `< <(` as the heredoc
    // operator `<<`, and the inner command disappears from the token stream entirely. The
    // target text is pinned whole because a substitution split at its inner spaces would leak
    // `cat` as a top-level word, and an allowlisted head absolves a line.
    const result = tokenizeCommandLine('while read l; do echo $l; done < <(cat f)');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(3);
    expect(result.commands[2].words).toEqual([{ text: 'done', opaque: false }]);
    expect(result.commands[2].redirects).toEqual([
      { operator: '<', target: { text: '<(cat f)', opaque: true } },
    ]);
  });

  it('blocks a protected path inside that substitution and upholds the clean twin', () => {
    // The whole protected path sits in the redirect target here, so a mention scan reading
    // only `words` passes the line. The clean twin is the over-block fence: a loop that reads
    // an ordinary file must not become unpassable because its redirect target is opaque.
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

describe('arithmetic expansion `$((…))`', () => {
  it('does not read the `>` inside it as a redirect, and still finds the real one after it', () => {
    // Scanning the `>` inside the arithmetic comparison as a redirect operator reports a
    // phantom write to `2))` AND loses the real target `out`: the judge then answers about a
    // file that does not exist while the actual write goes unexamined. Both halves are
    // asserted because either alone can look correct.
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
    // A `$((` scan that closes on the first `)` lets the arithmetic word consume the rest of
    // the line, so the real `> <protected>/a.js` write never reaches the redirect rule.
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

describe('an array subscript inside a brace expansion', () => {
  it('keeps the bracketed subscript inside the opaque word so a redirect after it is still read', () => {
    // `[` is a tempting word terminator — bash's `test` builtin is spelled `[` — but treating
    // it as one breaks the word into `${arr` and `0]}`, the brace scan never closes, and
    // everything after it including the write target is swallowed into an unterminated
    // expansion. The protected end proves the redirect survives as a real mutation target.
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

describe('a case statement whose pattern list contains `|`', () => {
  it('still judges the branch body, and upholds a harmless branch', () => {
    // The `|` in `a|b)` is a case pattern separator, not a pipeline; the tokenizer splits there
    // anyway, so the branch body ends up in a simple command headed by the word `b)`. The block
    // survives that misreading, which is what matters. Consuming `case … esac` as one unparsed
    // unit — the shape a "handle compound commands properly" change reaches for first — keeps
    // the body's `rm -rf <protected>` out of the per-command mention scan and passes the line.
    // The harmless branch is the over-block fence: a case statement is ordinary control flow.
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

describe('a nested command substitution `$(… $(…) …)`', () => {
  it('consumes the whole nesting as ONE opaque word, so an inner `;` cannot hand the rest to an allowlisted head', () => {
    // Closing the outer `$(` at the first `)` instead of tracking depth ends the word at the
    // inner substitution, makes the `;` a top-level separator, and turns the remainder
    // `cat <protected>/x)` into its own simple command headed by the allowlisted `cat` — the
    // line passes while bash runs the whole thing inside a substitution nobody inspected.
    // Asserting the word COUNT is what distinguishes the two readings: both block on the
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

describe('an array assignment `name=(…)`', () => {
  it('finds a protected path glued behind `name=(`', () => {
    // The tokenizer keeps `a=(<protected>` as ONE word, and only `pathCandidates` splitting at
    // `=` and `(` recovers the path from it. Dropping either separator from that set loses this
    // construct — a live risk, since closing the `${x:-…}` tripwire above means widening the
    // same set, and a rewrite is where a set loses members. The reason is asserted with the
    // glued word intact so the assertion shows the glue rather than merely the outcome.
    const verdict = judgeShellModification(shellCall(`a=(${PROTECTED} x)`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(`a=(${PROTECTED}`);
    }

    expect(judgeShellModification(shellCall('a=(x y)'), shellSpec())).toEqual({ upheld: true });
  });
});

describe('a brace range appended to a path', () => {
  it('still names the protected ancestor when `{1..9}` follows it', () => {
    // The trailing brace segment breaks the segment match under a whole-token comparison or a
    // candidate split that shatters the path. This also fences the separator-set widening the
    // `${x:-…}` tripwire above needs: adding `{` and `}` must not stop `<protected>/{1..9}`
    // from naming its protected ancestor. The clean twin keeps that honest in the other
    // direction — a brace range on an unrelated name is everyday shell.
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

describe('an arithmetic command `((…))`', () => {
  it('does not swallow the command that follows it', () => {
    // Scanning `((` as a subshell group consumed past the matching `))`, or folding the `&&`
    // into the arithmetic word, loses the second simple command and with it the only mutating
    // command on the line. The bare arithmetic is the over-block fence: a loop counter is not
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

describe('an until loop', () => {
  it('judges a protected mutation inside the loop body, and upholds a clean loop', () => {
    // Treating the loop keywords (`do`, `done`, `until`) as syntax to skip rather than as words
    // can drop the body's commands from the token stream, and the body is where the work
    // happens. Only the path is asserted, deliberately: the block is attributed to the keyword
    // `do` (the body's head word after the `;` split), and a change that finds the body's real
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
