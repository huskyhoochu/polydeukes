import type { CanonicalTranscript, CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { type TokenizeResult, tokenizeCommandLine } from '../src/bash-line.js';
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.js';
import { type CovenantRegistration, matchRegistrations } from '../src/dispatch.js';
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
import { exitThunk } from './helpers.js';

// ---------------------------------------------------------------------------
// COVENANT-18 part B (PRD §2-b B1–B4) — the tokenizer stops discarding a line it could
// not finish reading. `TokenizeResult` becomes `{ commands, unread }`, the two judges
// narrow their mention fallback from the whole raw line down to the unread spans, and
// the other three consumers each get a decided disposition.
//
// The invariant that governs every case below is "it narrows, it does not weaken": a
// span we could not read keeps today's conservative treatment, and the read part gains
// precise judgment. Two directions therefore need pinning in every migration — what
// still breaks, and what deliberately passes.
//
// Every tool name, command-arg key and protected path is an injected fixture value,
// following the sibling suites; a source literal would reproduce the leak §7 of the
// shell-mod PRD names.
// ---------------------------------------------------------------------------

const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PROTECTED_DIST = 'packages/core/dist';
const PROTECTED_SETTINGS = '.claude/settings.json';
const PROTECTED_AMP = 'pkg/a&b/dist';
const UNPROTECTED = '/tmp/scratch.txt';
const HOME = '/home/u';
const TRANSCRIPT = `${HOME}/.claude/projects/-home-u-proj/session.jsonl`;
const MUTATING_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

/** The dot-notation spelling of the protected dist, derived so no path literal is repeated. */
const DOTTED_DIST = PROTECTED_DIST.replace(/\/([^/]+)$/, '/src/../$1');

/** The protected dist with a quote opened mid-segment: `pack'ages/core/dist`. */
const STRADDLING_DIST = `${PROTECTED_DIST.slice(0, 4)}'${PROTECTED_DIST.slice(4)}`;

const FALLBACK_MENTION_REASON = 'untokenizable command line mentions protected path';
const FALLBACK_TRANSCRIPT_REASON = 'untokenizable command line names the session transcript';

/**
 * Read the tokenizer through the contract part B gives it. No local shape and no cast: the
 * shipped `TokenizeResult` IS `{ commands, unread }` now, so declaring a private twin would
 * silence the type checker on the very contract this file exists to pin — a green suite
 * against a signature that had drifted.
 */
function tokenize(line: string): TokenizeResult {
  return tokenizeCommandLine(line);
}

/** A shell-tool call carrying `line` under the injected command-arg key. */
function shellCall(line: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: line } }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** Two protected paths, the shipped read-only allowlist. */
function shellSpec(): ShellModificationSpec {
  return {
    protectedPaths: [PROTECTED_DIST, PROTECTED_SETTINGS],
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
  };
}

/** The transcript spec with home injected so every spelling resolves. */
function transcriptSpec(): TranscriptModificationSpec {
  return {
    transcriptPath: TRANSCRIPT,
    home: HOME,
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    mutatingToolNames: MUTATING_TOOLS,
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
  };
}

// ===========================================================================
// B1/B2 — the return contract itself. Tokenizer-surface assertions are confined to
// this block; every behavioural claim below is made on a judge.
// ===========================================================================

describe('COVENANT-18 B2 — tokenizeCommandLine returns partial results, never a discarded line', () => {
  it('answers an empty unread list for a fully read line, with no ok discriminant left', () => {
    // Mutation caught: `ok` kept alongside `unread` for compatibility. The five consumers
    // all branch on `!ok` today, so a surviving discriminant lets every one of them keep its
    // old branch and part B silently does not happen — the whole ticket goes green and dead.
    // The empty list is the "fully read" signal (§2-b B2), so it must be a list, not absent.
    const result = tokenize('echo a > f');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect('ok' in tokenizeCommandLine('echo a > f')).toBe(false);
  });

  it('keeps the commands read before an unterminated quote, and scopes the span to the rest', () => {
    // Mutation caught: the `return null` that throws away commands already read (today's
    // behaviour) — the read `rm` never reaches precise judgment. The second half pins the
    // span's WIDTH: a span covering the whole line would leave B3's fallback exactly as wide
    // as today, so the narrowing would be a no-op wearing a new type.
    const result = tokenize(`rm -rf ${PROTECTED_DIST};echo 'x`);

    expect(result.commands.map((command) => command.words.map((word) => word.text))).toEqual([
      ['rm', '-rf', PROTECTED_DIST],
      ['echo', 'x'],
    ]);
    expect(result.unread).toHaveLength(1);
    expect(result.unread[0].reason).toBe('unclosed quote');
    expect(result.unread[0].text).toContain('x');
    expect(result.unread[0].text).not.toContain(PROTECTED_DIST);
  });

  it('leaves a span for all THREE quote forms, not just the single quote', () => {
    // Mutation caught: B1 applied to one branch. `scanWord` has three `return null` quote
    // exits (single, double, ANSI-C) and the backtick branch already shows the model; a fix
    // that migrates only the form the headline fixture uses leaves the other two discarding
    // the line, so the same defect survives one spelling over.
    for (const line of ["echo 'x", 'echo "x', "echo $'x"]) {
      const result = tokenize(line);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].words[0]).toEqual({ text: 'echo', opaque: false });
      expect(result.unread).toHaveLength(1);
      expect(result.unread[0].reason).toBe('unclosed quote');
    }
  });

  it('keeps the other failure reason verbatim and still leaves a span for it', () => {
    // Mutation caught: only the quote branches migrated, so a missing redirect target still
    // answers "no commands and no spans" — which reads as FULLY READ under the new contract
    // and hands every consumer a silent pass. §2-f C2 also binds the string itself: `reason`
    // is a telemetry pass-through, so promoting it to a kind union is out of scope here.
    const result = tokenize('echo a > f;echo x >');

    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.unread).toHaveLength(1);
    expect(result.unread[0].reason).toBe('missing redirect target');
  });

  it('rejoins a quote opened mid-word with the word it interrupted', () => {
    // The implementation choice the `['echo', 'x']` case above pins, stated from the side where
    // it decides a verdict: the span's content is dequoted and APPENDED to the word in progress.
    // Mutation caught: that content starting a NEW token instead — `pack'ages/core/dist` then
    // reads as a word `pack` plus a span `ages/core/dist`, and neither half matches the
    // protected path (each was measured inert on its own), so a destroy of the judge executable
    // passes with nothing in the suite pinning it.
    const result = tokenize(`rm -rf ${STRADDLING_DIST}`);

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words.map((word) => word.text)).toEqual([
      'rm',
      '-rf',
      PROTECTED_DIST,
    ]);
    expect(result.unread).toHaveLength(1);
  });

  it('keeps the read command when the unread span sits at the redirect-target position', () => {
    // The word scanner is reached from two places — the word position and the redirect-target
    // position — and each has its own failure return. Mutation caught: B1 applied to the word
    // site alone, so this line still discards everything it read. The verdict is a block either
    // way, so only the returned commands separate the two implementations.
    const result = tokenize("echo x > 'f");

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words.map((word) => word.text)).toEqual(['echo', 'x']);
    expect(result.unread).toHaveLength(1);
    expect(result.unread[0].reason).toBe('unclosed quote');
  });

  it('collects one span per failure, so a line that fails twice reports both', () => {
    // Mutation caught: the scanner bailing at the FIRST failure and lumping everything after it
    // into one span — the narrowing then stops at the first bad operator and B3 gets today's
    // whole-rest-of-line scan back wearing the new type. `unread` is a list, and this is the
    // input that proves it must be one: a broken redirect early, an unterminated quote late,
    // with a command read between them.
    const result = tokenize(`echo a > ;true;echo '${PROTECTED_DIST}`);

    expect(result.unread.map((span) => span.reason)).toEqual([
      'missing redirect target',
      'unclosed quote',
    ]);
    expect(result.unread[1].text).toContain(PROTECTED_DIST);
    expect(result.commands.flatMap((command) => command.words.map((word) => word.text))).toContain(
      'true',
    );
  });
});

// ===========================================================================
// B3 — judgeShellModification: the fallback narrows to the unread spans
// ===========================================================================

describe('COVENANT-18 B3 — judgeShellModification judges the read half precisely', () => {
  it('answers a partially read protected write with the write rule, not the mention fallback', () => {
    // Mutation caught: shell-mod keeping "any unread ⇒ scan the whole raw line" and never
    // judging the commands it now has. The verdict alone cannot see that — the fallback
    // blocks this line today too. The reason is what proves WHO answered: a precise target
    // is what carries `fileChange` evidence and the right telemetry subject, and the
    // mention fallback carries neither.
    const verdict = judgeShellModification(
      shellCall(`echo hi > ${PROTECTED_DIST}/x.js;echo 'oops`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('redirect-write');
      expect(verdict.reason).toContain(PROTECTED_DIST);
      expect(verdict.reason).not.toContain(FALLBACK_MENTION_REASON);
    }
  });

  it('withholds allowlist absolution while a span is unread, and grants it once nothing is', () => {
    // The fail-open this ticket creates if B3 is implemented naively: the read `cat` half
    // reaches precise judgment, clause (e) vouches for it, the unread `'x` names nothing,
    // and a line that blocks today passes. A line we could not finish reading cannot be
    // proven read-only, so (e) must not fire while `unread` is non-empty and the backstop
    // must answer instead. The second expectation is the over-block fence AND the vacuity
    // control: it pins the break to the unread span rather than to a broken allowlist.
    const partial = judgeShellModification(shellCall(`cat ${PROTECTED_DIST};echo 'x`), shellSpec());

    expect(partial.upheld).toBe(false);
    if (!partial.upheld) {
      expect(partial.reason).toContain(`cat mentions protected path ${PROTECTED_DIST}`);
    }

    expect(judgeShellModification(shellCall(`cat ${PROTECTED_DIST}`), shellSpec())).toEqual({
      upheld: true,
    });
  });

  it('keeps the metachar decomposition inside the span it narrowed to', () => {
    // Mutation caught: the narrowed span handed to the plain `pathCandidates` primitive
    // instead of the fallback decomposition (COVENANT-07d). Here the protected path lives
    // INSIDE the unterminated quote glued to a `;`, so precise judgment cannot see it —
    // `a;packages/core/dist` is one candidate whose first segment never matches — and only
    // the span's own metachar split does. Narrowing the span must not narrow the extraction.
    const verdict = judgeShellModification(shellCall(`echo 'a;${PROTECTED_DIST}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(`${FALLBACK_MENTION_REASON} ${PROTECTED_DIST}`);
    }
  });

  it('stops blocking a heredoc body that the whole-line fallback used to scan', () => {
    // The over-blocking end, and the only place the narrowing is observable as a verdict
    // change. A heredoc body is data — the shipped judge already upholds the tokenizable
    // twin — but today one stray quote anywhere on the line hands the whole text, body
    // included, to a mention scan with no allowlist and no data/word distinction. Mutation
    // caught: B3 implemented as "spans PLUS the raw line", which keeps this document
    // blocked and pushes routine work at the witness valve.
    const body = `cat > ${UNPROTECTED} <<EOF\n${PROTECTED_DIST}\nEOF`;

    expect(judgeShellModification(shellCall(`${body}\necho 'y`), shellSpec())).toEqual({
      upheld: true,
    });
    expect(judgeShellModification(shellCall(body), shellSpec())).toEqual({ upheld: true });
  });

  it('blocks nothing on a degenerate span that carries no text at all', () => {
    // The content-free form of the new kind of thing: a line ending ON the opening quote
    // leaves a span whose text is empty. Mutation caught: the span decomposed into `['']`
    // and an empty candidate matching every protected path — the predicate degenerates into
    // a universal blocker and every command with a trailing quote dies, on both judges.
    // A fixture set written around realistic spans never produces this one.
    expect(judgeShellModification(shellCall("echo x '"), shellSpec())).toEqual({ upheld: true });
    expect(judgeTranscriptModification(shellCall("echo x '"), transcriptSpec())).toEqual({
      upheld: true,
    });
  });

  it('blocks a protected path straddling the boundary between the read half and the span', () => {
    // The fail-open the word-join choice decides. `pack'ages/core/dist` is ONE shell word — bash
    // strips the quote and deletes the judge executable — but split into a `pack` token plus an
    // `ages/core/dist` span, neither half matches anything the spec protects and the call
    // passes. Mutation caught: the span content treated as a new token. The reason is what names
    // the culprit: the block must come from the read half, not from a fallback that still holds
    // the whole line and would answer here for the wrong reason.
    const verdict = judgeShellModification(shellCall(`rm -rf ${STRADDLING_DIST}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED_DIST);
      expect(verdict.reason).not.toContain(FALLBACK_MENTION_REASON);
    }
  });

  it('withholds absolution for a missing redirect target too, not only for an unterminated quote', () => {
    // Mutation caught: the suppression written as `reason === 'unclosed quote'`. §2-f C2 keeps
    // `reason` a telemetry pass-through and forbids branching on it, and this is the fail-open
    // that rule prevents — a span from the OTHER failure would let clause (e) vouch for the read
    // `cat` on the strength of a part nobody could finish reading, and a line that blocks today
    // would pass.
    const verdict = judgeShellModification(
      shellCall(`cat ${PROTECTED_DIST};echo x >`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(`cat mentions protected path ${PROTECTED_DIST}`);
    }
  });

  it('reaches precise judgment behind the double-quoted and ANSI-C spans, not just the single one', () => {
    // The three-form migration observed where it decides WHO answers. Mutation caught: B1 applied
    // to the single-quote branch only — the other two forms keep discarding the line, the read
    // `cat` never reaches judgment, and the whole-line fallback answers instead. The verdict is a
    // block in both implementations, so the reason is the only witness of which one ran.
    for (const tail of ['echo "x', "echo $'x"]) {
      const verdict = judgeShellModification(
        shellCall(`cat ${PROTECTED_DIST};${tail}`),
        shellSpec(),
      );

      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(`cat mentions protected path ${PROTECTED_DIST}`);
      }
    }
  });

  it('decomposes a double-quoted and an ANSI-C span at the metachar as well', () => {
    // Mutation caught: the narrowed scan dropping the dequote the whole-line fallback performs
    // today (it strips `'`, `"` and `\` before scanning). A span that arrives still carrying its
    // opening quote leaves `"packages` as the first segment, which matches nothing — fail-open,
    // and reachable only through the quote forms the single-quote fixtures never run.
    for (const opening of ['"', "$'"]) {
      const verdict = judgeShellModification(
        shellCall(`echo ${opening}a;${PROTECTED_DIST}`),
        shellSpec(),
      );

      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(`${FALLBACK_MENTION_REASON} ${PROTECTED_DIST}`);
      }
    }
  });

  it('blocks a protected path carried only by the SECOND unread span', () => {
    // Mutation caught: the fallback reading `unread[0]` instead of every span. Every other
    // fixture in this file leaves exactly one span, so a first-entry-only fallback passes the
    // whole suite while failing open here — the broken redirect takes the first slot and the
    // protected path rides in the second.
    const verdict = judgeShellModification(
      shellCall(`echo a > ;true;echo '${PROTECTED_DIST}`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(`${FALLBACK_MENTION_REASON} ${PROTECTED_DIST}`);
    }
  });

  it('keeps the dot-resolved pass inside the narrowed span', () => {
    // Mutation caught: the narrowed fallback comparing span fragments with a private equality
    // instead of delegating to the shared mention match, whose raw + dot-resolved union is the
    // only thing that reads `src/../dist` as the protected dist. COVENANT-07d held this axis on
    // the whole line; the span inherits it, it does not re-implement it.
    const verdict = judgeShellModification(shellCall(`echo 'a;${DOTTED_DIST}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED_DIST);
    }
  });

  it('still blocks the quoted spelling of a protected path whose own segment carries a metachar', () => {
    // The unquoted spelling is accepted as a PASS from here on: bash reads `rm -rf pkg/a&b/dist`
    // as `rm -rf pkg/a` backgrounded plus `b/dist`, so that file is never a target. The quoted
    // spelling is the one that does target it, and it tokenizes to a single word. Mutation
    // caught: part B carrying the fallback's metachar decomposition into precise judgment, which
    // shatters the read word and leaves the only real spelling of this path unjudged.
    const verdict = judgeShellModification(shellCall(`rm -rf '${PROTECTED_AMP}'`), {
      ...shellSpec(),
      protectedPaths: [PROTECTED_AMP],
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED_AMP);
    }
  });
});

// ===========================================================================
// B3 — judgeTranscriptModification: the same change at the second consumer
// ===========================================================================

describe('COVENANT-18 B3 — judgeTranscriptModification narrows its own fallback', () => {
  it('answers a partially read transcript forgery with the write rule, not the fallback', () => {
    // Mutation caught: fixing shell-mod alone. The transcript branch is a separate site with
    // its own fallback, and the evidence source is what makes the witness valve unforgeable
    // (COVENANT-07c) — a forgery answered by a crude mention scan carries no target, so
    // nothing downstream knows WHICH file the call was about.
    const verdict = judgeTranscriptModification(
      shellCall(`echo x > ${TRANSCRIPT};echo 'y`),
      transcriptSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('redirect-write');
      expect(verdict.reason).toContain(TRANSCRIPT);
      expect(verdict.reason).not.toContain(FALLBACK_TRANSCRIPT_REASON);
    }
  });

  it('withholds its read absolution while a span is unread, and grants it once nothing is', () => {
    // The transcript's own copy of the clause-(e) fail-open. Reading the session is free by
    // design, so a naive B3 lets `cat <transcript>;echo 'x` through on the strength of a
    // head that only vouches for the part we managed to read. Mutation caught: the read
    // allowlist consulted regardless of `unread`. The tokenizable twin is the over-block
    // fence — COVENANT-07c removed that friction deliberately and it must stay removed.
    const partial = judgeTranscriptModification(
      shellCall(`cat ${TRANSCRIPT};echo 'x`),
      transcriptSpec(),
    );

    expect(partial.upheld).toBe(false);
    if (!partial.upheld) {
      expect(partial.reason).toContain(`cat names the session transcript ${TRANSCRIPT}`);
    }

    expect(judgeTranscriptModification(shellCall(`cat ${TRANSCRIPT}`), transcriptSpec())).toEqual({
      upheld: true,
    });
  });

  it('keeps the metachar decomposition inside its narrowed span too', () => {
    // Mutation caught: the transcript span scanned with whole-path equality only. The
    // transcript judge compares equality, never an ancestor, so `a;<transcript>` matches
    // nothing until the span is split at the metacharacter — B7's spelling, one layer in.
    const verdict = judgeTranscriptModification(
      shellCall(`echo 'a;${TRANSCRIPT}`),
      transcriptSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(FALLBACK_TRANSCRIPT_REASON);
      expect(verdict.reason).toContain(TRANSCRIPT);
    }
  });

  it('withholds its read absolution for the other failure reason and the other quote forms too', () => {
    // Mutation caught: the transcript branch keying its suppression on the single-quote span it
    // was written against — either as `reason === 'unclosed quote'` (which §2-f C2 forbids) or as
    // a B1 migration of one quote branch. Both leave the read `cat` absolved on the strength of a
    // part nobody could finish reading, which is the fail-open this whole ticket must not create.
    // The reason is asserted because a fallback that blocks for the wrong half looks identical
    // from the verdict alone.
    for (const tail of ['echo x >', 'echo "y', "echo $'y"]) {
      const verdict = judgeTranscriptModification(
        shellCall(`cat ${TRANSCRIPT};${tail}`),
        transcriptSpec(),
      );

      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(`cat names the session transcript ${TRANSCRIPT}`);
      }
    }
  });

  it('stops blocking a heredoc body that merely names the transcript', () => {
    // This judge's over-block fence, with a span that carries text — until now its only
    // intentional pass here was the content-free span, which is a weaker fence than shell-mod's.
    // A heredoc body naming the session is data, and the tokenizable twin already upholds; one
    // stray quote elsewhere on the line is what hands the whole document to a scan that compares
    // every line of it for equality. Mutation caught: B3 implemented as "spans PLUS the raw
    // line", which keeps a routine `cat > file <<EOF` blocked and sends anyone writing ABOUT the
    // transcript to the witness valve.
    const body = `cat > ${UNPROTECTED} <<EOF\n${TRANSCRIPT}\nEOF`;

    expect(judgeTranscriptModification(shellCall(`${body}\necho 'y`), transcriptSpec())).toEqual({
      upheld: true,
    });
    expect(judgeTranscriptModification(shellCall(body), transcriptSpec())).toEqual({
      upheld: true,
    });
  });
});

// ===========================================================================
// B4 — deriveShellChanges: the recording invariant, and the evidence it must stop losing
// ===========================================================================

describe('COVENANT-18 B4 — deriveShellChanges keeps the evidence AND the unjudgeable row', () => {
  it('files the read half as evidence while still recording the unread span', () => {
    // Two mutations, opposite directions, one line. (1) Today's `if (!ok) return` throws the
    // computed write away, so a discipline that judges written bytes never sees them —
    // that is the loss part B exists to stop. (2) Answering the partial success with an
    // empty `unjudgeable` deletes the `skipped shell-unjudgeable` telemetry row, which is
    // the contract .claude/rules/dogfooding-axes.md states for this axis: a call that
    // passes unrecorded is the COVENANT-10b defect class, not a smaller version of a block.
    const result = deriveShellChanges(`echo x > ${PROTECTED_DIST}/a.js;echo 'y`);

    expect(result.evidence).toEqual([
      { path: `${PROTECTED_DIST}/a.js`, content: 'x\n', mode: 'truncate' },
    ]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBeUndefined();
    expect(result.unjudgeable[0].reason.length).toBeGreaterThan(0);
  });

  it('records a degenerate empty span rather than reporting the line fully read', () => {
    // The content-free span at the recording surface. Mutation caught: the row filed behind
    // a truthiness test on the span text (`if (span.text)`), so a line that ends on its
    // opening quote reports zero spans — indistinguishable from fully read, and the call
    // passes with no row at all. Empty `unread` means read; an empty-TEXT span does not.
    const result = deriveShellChanges("echo x '");

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBeUndefined();
  });

  it('files the read half when the failure is a missing redirect target, not only a quote', () => {
    // The recording invariant's other failure reason, and the same §2-f C2 violation the judges
    // are pinned against. Mutation caught: the partial-result handling written behind
    // `reason === 'unclosed quote'`, so every other failure still throws the computed write away
    // and a discipline that judges written bytes sees nothing. Both directions are pinned at
    // once: the evidence must arrive AND the span must keep its telemetry row with its reason
    // verbatim.
    const result = deriveShellChanges(`echo x > ${PROTECTED_DIST}/a.js;echo y >`);

    expect(result.evidence).toEqual([
      { path: `${PROTECTED_DIST}/a.js`, content: 'x\n', mode: 'truncate' },
    ]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].reason).toBe('missing redirect target');
  });
});

// ===========================================================================
// B4 — matchRegistrations: routing may gain precision, never narrow
// ===========================================================================

describe('COVENANT-18 B4 — matchRegistrations never narrows routing on a partial read', () => {
  function registration(protectedPaths: string[]): CovenantRegistration {
    return {
      label: 'shell-mod',
      protectedPaths,
      body: exitThunk(0),
    };
  }

  it('still routes a protected path that only the unread span carries', () => {
    // The fail-open a "we have partial results now, drop the flag" refactor produces. The
    // glued path is invisible to the dispatcher's candidate extraction (it splits on
    // whitespace, not on `;`), so the fail-closed `failed` flag is the ONLY thing routing
    // this call to a body. Mutation caught: `failed` cleared once `commands` is non-empty —
    // no registration matches, no body spawns, and the call passes with zero telemetry.
    const reg = registration([PROTECTED_DIST]);
    const input = shellCall(`echo 'a;${PROTECTED_DIST}`);

    expect(matchRegistrations(input, [reg])).toEqual([
      { registration: reg, mentionedPath: PROTECTED_DIST },
    ]);
  });

  it('names the path the read commands actually mention, not the first registered one', () => {
    // Mutation caught: `collectPathCandidates` left on its `if (!ok) return` branch, so a
    // partially read line contributes no candidates and routing falls back to
    // `protectedPaths[0]`. Both spellings route to the same body, so only the subject tells
    // them apart — and the subject is what separates a verdict about the right protected
    // path from one about a path this call never touched.
    const reg = registration([PROTECTED_SETTINGS, PROTECTED_DIST]);
    const input = shellCall(`rm -rf ${PROTECTED_DIST};echo 'x`);

    expect(matchRegistrations(input, [reg])).toEqual([
      { registration: reg, mentionedPath: PROTECTED_DIST },
    ]);
  });
});

// ===========================================================================
// B4 — commandAnchors: partial results are refused, and the refusal is a decision
// ===========================================================================

describe('COVENANT-18 B4 — precedent evidence refuses a partially read command line', () => {
  const ROOT = '/repo';
  const PRECEDENT_COMMAND = 'npm view ';

  type ObservedCall = { name: string; args: Record<string, unknown>; succeeded?: boolean };

  /** A shell tool call the transcript seam saw succeed. */
  function observedCall(command: string): ObservedCall {
    return { name: SHELL_TOOL, args: { [COMMAND_ARG]: command }, succeeded: true };
  }

  /** Stub the canonical-transcript seam with a fixed tool-call history. */
  function transcriptWithToolCalls(calls: ObservedCall[]): CanonicalTranscript {
    return {
      findSubagentInvocations: () => [],
      findUserMessages: () => [],
      findToolCalls: (name?: string) =>
        name === undefined ? calls : calls.filter((call) => call.name === name),
    } as unknown as CanonicalTranscript;
  }

  const entry: DisciplineEntry = {
    id: 'dep-needs-view',
    in: ['pkg/**'],
    when: 'needs-precedent',
    requirePrecedent: { command: PRECEDENT_COMMAND },
  };

  /** A change in the entry's scope whose added content fires its `when` trigger. */
  const triggeringInput: CovenantInput = {
    toolCalls: [
      {
        name: 'Write',
        fileChange: { kind: 'create', path: 'pkg/dep.json', post: 'needs-precedent\n' },
      },
    ],
    subagentSpawns: [],
    userMessages: [],
  };

  function contextSpec(calls: ObservedCall[]): CompileDisciplinesSpec {
    return {
      disciplines: [entry],
      rootDir: ROOT,
      shellTools: [SHELL_TOOL],
      commandArgs: [COMMAND_ARG],
      transcript: transcriptWithToolCalls(calls),
    };
  }

  /**
   * What the assembly decided. Since DISPATCH-01 the decision is bound INTO the judge
   * thunk instead of serialized as an argv flag, so it is read from the verdict the thunk
   * answers against a triggering input: uphold means found, break means missing.
   */
  async function precedentDecision(calls: ObservedCall[]): Promise<'found' | 'missing'> {
    const [registration] = compileDisciplineRegistrations(contextSpec(calls));
    const outcome = await registration?.body?.(triggeringInput);
    return outcome?.exitCode === 0 ? 'found' : 'missing';
  }

  it('refuses a line whose read half anchors the pattern, while its fully read twin qualifies', async () => {
    // The one consumer where accepting partial results OPENS a gate instead of closing one.
    // `false` here means "evidence missing", which blocks; so the moment `commandAnchors`
    // starts trusting the commands it managed to read, a line nobody could finish reading
    // becomes proof that a required command ran. That direction is fail-open, and it is why
    // today's refusal is kept on purpose rather than left behind by the migration. The
    // control proves this shape really can qualify, so the refusal is pinned to the unread
    // span and not to an anchor that never matches. Mutation caught: `commandAnchors`
    // reading `commands` and ignoring `unread`.
    expect(await precedentDecision([observedCall(`npm view yaml;echo 'x`)])).toBe('missing');
    expect(await precedentDecision([observedCall('npm view yaml;echo x')])).toBe('found');
  });
});

// ---------------------------------------------------------------------------
// Review round (PR #44) — two shortfalls against the invariants §2-b enumerated for
// ITSELF. Neither is a spelling brought in from outside the ticket's declared set: the
// first breaks "a line with an unread span yields at least one unjudgeable entry", the
// second files evidence for bytes the scanner never computed.
// ---------------------------------------------------------------------------

describe('COVENANT-18 §2-b top invariant — a scan that ran off the end says so', () => {
  it('records a span when a quote inside a command substitution never closes', () => {
    // Mutation caught: `matchParen` reporting only WHERE it stopped and not WHETHER it
    // arrived. Its two quote bail-outs run to end of input, and the caller turns that into
    // one opaque word covering the rest of the line — so without the flag the line answers
    // `unread: []`, the fully-read signal, and files zero unjudgeable entries. The judge
    // then skips its opaque-token backstop too, because `echo` is allowlisted, and the call
    // passes with NO telemetry row at all. That is COVENANT-10b's defect class, the one
    // blocker B7 measured, reintroduced by A9's own quote-awareness.
    const line = `echo $(cat 'a) rm -rf>${PROTECTED_DIST}`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).toHaveLength(1);
    expect(deriveShellChanges(line).unjudgeable.length).toBeGreaterThan(0);
    expect(judgeShellModification(shellCall(line), shellSpec()).upheld).toBe(false);
  });

  it('records the same span for a double-quoted bail-out and for parens that never balance', () => {
    // Mutation caught: fixing one bail-out and leaving its siblings. `matchParen` has three
    // ways to run off the end — the single-quote branch, the double-quote branch, and the
    // loop simply ending with depth still open — and each reaches the same caller.
    for (const line of [`echo $(cat "a) rm -rf>${PROTECTED_DIST}`, `echo $(cat a`]) {
      expect(tokenizeCommandLine(line).unread.length, line).toBeGreaterThan(0);
      expect(deriveShellChanges(line).unjudgeable.length, line).toBeGreaterThan(0);
    }
  });

  it('leaves the closed twin fully read, so the flag is not a blanket refusal', () => {
    // Over-block fence: a substitution that DOES close must stay `unread: []`, or every
    // command substitution in normal use would report as half-read. Only `unread` is
    // asserted — this line does file an unjudgeable row, but for an unrelated reason
    // (its parens read as a subshell marker), so pinning that count here would be pinning
    // a coincidence.
    expect(tokenizeCommandLine('echo $(cat a) done').unread).toEqual([]);
  });
});

describe('COVENANT-18 §2-a A7 — an escape the table cannot translate is not knowledge', () => {
  it('marks the word opaque instead of filing source spelling as written content', () => {
    // Mutation caught: `scanAnsiCQuoted` returning the untranslated spelling while the word
    // still reads as decided. The word text becomes the `content` of CONFIDENT file-change
    // evidence, so `$'\x64ist'` would be filed as the literal `\x64ist` while bash writes
    // `dist` — a judge reading written content then compares a string that never existed and
    // upholds, with no unjudgeable row to show the question was never answered.
    //
    // Completing the escape table is NOT the fix and must not become one: the next unlisted
    // escape reproduces this exactly. Declining to claim knowledge closes it once.
    const derivation = deriveShellChanges(`echo $'\\x64ist' > ${UNPROTECTED}`);

    expect(derivation.evidence).toEqual([]);
    expect(derivation.unjudgeable.length).toBeGreaterThan(0);
  });

  it('still files real evidence for a string the table fully decodes', () => {
    // Over-block fence and the other end: opacity must attach to the untranslated escape,
    // not to `$'…'` as a form. A fully decoded constant is decided, and A7 exists precisely
    // so that its DECODED bytes reach the evidence axis.
    const derivation = deriveShellChanges(`echo $'a\\tb' > ${UNPROTECTED}`);

    expect(derivation.evidence).toEqual([
      { path: UNPROTECTED, content: 'a\tb\n', mode: 'truncate' },
    ]);
  });
});

describe('COVENANT-18 §2-a A6/A5 — the evidence axis accepts what the judging axis does', () => {
  it('computes a >| write, on the plain and fd-prefixed spellings', () => {
    // Mutation caught: A6 landing in `scanRedirect` and the detection rules but not in
    // `STDOUT_WRITE_OPERATORS`. The tokenizer emits `>|` as a write operator and the rules
    // grade it by the `>` it contains, so an omission here files a fully computable write as
    // `does not carry stdout` — the evidence axis refusing what the judging axis accepted,
    // which is a skip row standing in for a fact that was available all along.
    for (const line of [`echo x >| ${UNPROTECTED}`, `echo x 1>| ${UNPROTECTED}`]) {
      expect(deriveShellChanges(line).evidence, line).toEqual([
        { path: UNPROTECTED, content: 'x\n', mode: 'truncate' },
      ]);
    }
  });

  it('sees a directory change hidden behind a leading assignment', () => {
    // Mutation caught: `movesDirectory` reading `words[0]` while `deriveCommand` reads past
    // assignments. `FOO=1 cd sub` moves the directory exactly as `cd sub` does, and missing
    // it is not a silent skip — every relative target on the line would then be resolved
    // against the repo root and filed as CONFIDENT evidence for a path never touched.
    const derivation = deriveShellChanges('FOO=1 cd sub && echo x > out.txt');

    expect(derivation.evidence).toEqual([]);
    expect(derivation.unjudgeable.length).toBeGreaterThan(0);
  });
});
