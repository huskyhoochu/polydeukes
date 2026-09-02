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

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

// The tokenizer never discards a line it could not finish reading: `TokenizeResult` is
// `{ commands, unread }`, and the two judges narrow their mention fallback from the whole raw
// line down to the unread spans.
//
// The invariant governing every case here is that it narrows without weakening — a span nobody
// could read keeps the conservative treatment, and the read part gains precise judgment. Both
// directions are pinned throughout: what still breaks, and what deliberately passes.

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
 * Read the tokenizer through its shipped type. No local shape and no cast: declaring a private
 * twin would silence the type checker on the very contract this file exists to pin, leaving a
 * green suite against a signature that had drifted.
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

// The return contract itself. Tokenizer-surface assertions are confined to this block; every
// behavioural claim below is made on a judge.

describe('tokenizeCommandLine returns partial results, never a discarded line', () => {
  it('answers an empty unread list for a fully read line, with no ok discriminant left', () => {
    // An `ok` discriminant kept alongside `unread` lets every consumer keep branching on
    // `!ok`, so the narrowing silently does not happen while the suite stays green. The empty
    // list is the "fully read" signal, so it must be a list rather than absent.
    const result = tokenize('echo a > f');

    expect(result.unread).toEqual([]);
    expect(result.commands).toHaveLength(1);
    expect('ok' in tokenizeCommandLine('echo a > f')).toBe(false);
  });

  it('keeps the commands read before an unterminated quote, and scopes the span to the rest', () => {
    // Throwing away the commands already read keeps the `rm` out of precise judgment. The
    // second half pins the span's WIDTH: a span covering the whole line leaves the fallback
    // exactly as wide as before, so the narrowing becomes a no-op wearing a new type.
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
    // `scanWord` has three quote exits — single, double, ANSI-C — and migrating only the form
    // the headline fixture uses leaves the other two discarding the line, so the same defect
    // survives one spelling over.
    for (const line of ["echo 'x", 'echo "x', "echo $'x"]) {
      const result = tokenize(line);

      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].words[0]).toEqual({ text: 'echo', opaque: false });
      expect(result.unread).toHaveLength(1);
      expect(result.unread[0].reason).toBe('unclosed quote');
    }
  });

  it('keeps the other failure reason verbatim and still leaves a span for it', () => {
    // With only the quote branches migrated, a missing redirect target still answers "no
    // commands and no spans", which reads as FULLY READ and hands every consumer a silent
    // pass. `reason` is a telemetry pass-through and its exact string is part of the contract.
    const result = tokenize('echo a > f;echo x >');

    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.unread).toHaveLength(1);
    expect(result.unread[0].reason).toBe('missing redirect target');
  });

  it('rejoins a quote opened mid-word with the word it interrupted', () => {
    // The span's content is dequoted and APPENDED to the word in progress. If it starts a NEW
    // token instead, `pack'ages/core/dist` reads as a word `pack` plus a span
    // `ages/core/dist`; neither half matches the protected path, so a destroy of the judge
    // executable passes.
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
    // position — and each has its own failure return. Migrating the word site alone still
    // discards everything this line read; the verdict blocks either way, so only the returned
    // commands separate the two implementations.
    const result = tokenize("echo x > 'f");

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].words.map((word) => word.text)).toEqual(['echo', 'x']);
    expect(result.unread).toHaveLength(1);
    expect(result.unread[0].reason).toBe('unclosed quote');
  });

  it('collects one span per failure, so a line that fails twice reports both', () => {
    // A scanner that bails at the FIRST failure and lumps everything after it into one span
    // gets the whole-rest-of-line scan back wearing the new type. This input is why `unread` is
    // a list: a broken redirect early, an unterminated quote late, and a command read between.
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

describe('judgeShellModification judges the read half precisely', () => {
  it('answers a partially read protected write with the write rule, not the mention fallback', () => {
    // Keeping "any unread means scan the whole raw line" never judges the commands the
    // tokenizer returned, and the verdict alone cannot see that because the fallback blocks
    // this line too. The reason proves who answered: a precise target carries fileChange
    // evidence and the right telemetry subject, and the mention fallback carries neither.
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
    // The fail-open a naive narrowing creates: the read `cat` half reaches precise judgment,
    // the allowlist vouches for it, the unread `'x` names nothing, and a line that blocked
    // before now passes. A line nobody could finish reading cannot be proven read-only, so the
    // allowlist must not fire while `unread` is non-empty. The second expectation is both the
    // over-block fence and the vacuity control, pinning the break to the span rather than to a
    // broken allowlist.
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
    // The protected path lives INSIDE the unterminated quote glued to a `;`, so precise
    // judgment cannot see it — `a;packages/core/dist` is one candidate whose first segment
    // never matches — and only the metachar split does. Handing the narrowed span to the plain
    // candidate primitive instead of the fallback decomposition narrows the extraction too.
    const verdict = judgeShellModification(shellCall(`echo 'a;${PROTECTED_DIST}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(`${FALLBACK_MENTION_REASON} ${PROTECTED_DIST}`);
    }
  });

  it('stops blocking a heredoc body that the whole-line fallback used to scan', () => {
    // The over-blocking end, and the only place the narrowing shows up as a changed verdict.
    // A heredoc body is data and the tokenizable twin already upholds, but one stray quote
    // anywhere on the line otherwise hands the whole text, body included, to a mention scan
    // with no allowlist and no data/word distinction. Implementing the narrowing as "spans
    // PLUS the raw line" keeps this document blocked and pushes routine work at the witness.
    const body = `cat > ${UNPROTECTED} <<EOF\n${PROTECTED_DIST}\nEOF`;

    expect(judgeShellModification(shellCall(`${body}\necho 'y`), shellSpec())).toEqual({
      upheld: true,
    });
    expect(judgeShellModification(shellCall(body), shellSpec())).toEqual({ upheld: true });
  });

  it('blocks nothing on a degenerate span that carries no text at all', () => {
    // A line ending ON the opening quote leaves a span whose text is empty. Decomposed into
    // `['']`, that empty candidate matches every protected path and the predicate degenerates
    // into a universal blocker on both judges. A fixture set written around realistic spans
    // never produces this shape.
    expect(judgeShellModification(shellCall("echo x '"), shellSpec())).toEqual({ upheld: true });
    expect(judgeTranscriptModification(shellCall("echo x '"), transcriptSpec())).toEqual({
      upheld: true,
    });
  });

  it('blocks a protected path straddling the boundary between the read half and the span', () => {
    // `pack'ages/core/dist` is ONE shell word — bash strips the quote and deletes the judge
    // executable — but split into a `pack` token plus an `ages/core/dist` span, neither half
    // matches anything the spec protects and the call passes. The reason names the culprit:
    // the block must come from the read half, not from a fallback still holding the whole line
    // that would answer here for the wrong reason.
    const verdict = judgeShellModification(shellCall(`rm -rf ${STRADDLING_DIST}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED_DIST);
      expect(verdict.reason).not.toContain(FALLBACK_MENTION_REASON);
    }
  });

  it('withholds absolution for a missing redirect target too, not only for an unterminated quote', () => {
    // `reason` is a telemetry pass-through and nothing may branch on it. A suppression written
    // as `reason === 'unclosed quote'` lets a span from the other failure absolve the read
    // `cat` on the strength of a part nobody could finish reading.
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
    // Migrating the single-quote branch only leaves the other two forms discarding the line,
    // so the read `cat` never reaches judgment and the whole-line fallback answers instead.
    // Both block, so the reason is the only witness of which one ran.
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
    // The scan strips `'`, `"` and `\` before matching. A span that arrives still carrying its
    // opening quote leaves `"packages` as the first segment, which matches nothing — reachable
    // only through the quote forms the single-quote fixtures never run.
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
    // Every other fixture in this file leaves exactly one span, so a fallback reading
    // `unread[0]` alone passes the whole suite while failing open here: the broken redirect
    // takes the first slot and the protected path rides in the second.
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
    // Only the shared mention match's raw-plus-dot-resolved union reads `src/../dist` as the
    // protected dist. The span inherits that match rather than re-implementing it with a
    // private equality.
    const verdict = judgeShellModification(shellCall(`echo 'a;${DOTTED_DIST}`), shellSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED_DIST);
    }
  });

  it('still blocks the quoted spelling of a protected path whose own segment carries a metachar', () => {
    // The unquoted spelling passes: bash reads `rm -rf pkg/a&b/dist` as `rm -rf pkg/a`
    // backgrounded plus `b/dist`, so that file is never a target. The quoted spelling is the
    // one that does target it, and it tokenizes to a single word — carrying the fallback's
    // metachar decomposition into precise judgment shatters that word and leaves the only real
    // spelling of this path unjudged.
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

describe('judgeTranscriptModification narrows its own fallback', () => {
  it('answers a partially read transcript forgery with the write rule, not the fallback', () => {
    // The transcript branch is a separate site with its own fallback, so fixing shell-mod
    // alone leaves it behind. A forgery answered by a crude mention scan carries no target, so
    // nothing downstream knows which file the call was about.
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
    // The transcript's own copy of the allowlist fail-open. Reading the session is free by
    // design, so consulting the read allowlist regardless of `unread` lets
    // `cat <transcript>;echo 'x` through on the strength of a head that vouches only for the
    // part the scanner managed to read. The tokenizable twin is the over-block fence: reading
    // a session must never need a witness.
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
    // The transcript judge compares whole-path equality and never an ancestor, so
    // `a;<transcript>` matches nothing until the span is split at the metacharacter.
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
    // Keying the suppression on the single-quote span — as `reason === 'unclosed quote'`, or
    // by migrating one quote branch — leaves the read `cat` absolved on the strength of a part
    // nobody could finish reading. The reason is asserted because a fallback that blocks for
    // the wrong half looks identical from the verdict alone.
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
    // This judge's over-block fence with a span that carries text. A heredoc body naming the
    // session is data and the tokenizable twin already upholds; one stray quote elsewhere on
    // the line otherwise hands the whole document to a scan that compares every line of it for
    // equality, which blocks a routine `cat > file <<EOF` and sends anyone writing ABOUT the
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

describe('deriveShellChanges keeps the evidence AND the unjudgeable row', () => {
  it('files the read half as evidence while still recording the unread span', () => {
    // Two opposite failures on one line. An `if (!ok) return` throws the computed write away,
    // so a discipline that judges written bytes never sees them. Answering the partial success
    // with an empty `unjudgeable` deletes the `skipped shell-unjudgeable` row instead, and a
    // call that passes unrecorded is worse than a block, not a smaller version of one.
    const result = deriveShellChanges(`echo x > ${PROTECTED_DIST}/a.js;echo 'y`);

    expect(result.evidence).toEqual([
      { path: `${PROTECTED_DIST}/a.js`, content: 'x\n', mode: 'truncate' },
    ]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBeUndefined();
    expect(result.unjudgeable[0].reason.length).toBeGreaterThan(0);
  });

  it('records a degenerate empty span rather than reporting the line fully read', () => {
    // The content-free span at the recording surface. Filing the row behind a truthiness test
    // on the span text makes a line ending on its opening quote report zero spans, which is
    // indistinguishable from fully read. An empty `unread` means read; an empty-TEXT span does
    // not.
    const result = deriveShellChanges("echo x '");

    expect(result.evidence).toEqual([]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].path).toBeUndefined();
  });

  it('files the read half when the failure is a missing redirect target, not only a quote', () => {
    // The recording invariant's other failure reason. Partial-result handling written behind
    // `reason === 'unclosed quote'` throws the computed write away for every other failure.
    // Both directions are pinned at once: the evidence must arrive AND the span must keep its
    // row with its reason verbatim.
    const result = deriveShellChanges(`echo x > ${PROTECTED_DIST}/a.js;echo y >`);

    expect(result.evidence).toEqual([
      { path: `${PROTECTED_DIST}/a.js`, content: 'x\n', mode: 'truncate' },
    ]);
    expect(result.unjudgeable).toHaveLength(1);
    expect(result.unjudgeable[0].reason).toBe('missing redirect target');
  });
});

describe('matchRegistrations never narrows routing on a partial read', () => {
  function registration(protectedPaths: string[]): CovenantRegistration {
    return {
      label: 'shell-mod',
      protectedPaths,
      body: exitThunk(0),
    };
  }

  it('still routes a protected path that only the unread span carries', () => {
    // The glued path is invisible to the dispatcher's candidate extraction, which splits on
    // whitespace rather than on `;`, so the fail-closed flag is the ONLY thing routing this
    // call to a body. Clearing that flag once `commands` is non-empty leaves no registration
    // matching, no body spawning, and the call passing with zero telemetry.
    const reg = registration([PROTECTED_DIST]);
    const input = shellCall(`echo 'a;${PROTECTED_DIST}`);

    expect(matchRegistrations(input, [reg])).toEqual([
      { registration: reg, mentionedPath: PROTECTED_DIST },
    ]);
  });

  it('names the path the read commands actually mention, not the first registered one', () => {
    // With `collectPathCandidates` still bailing on a partial read, the line contributes no
    // candidates and routing falls back to `protectedPaths[0]`. Both spellings route to the
    // same body, so only the subject separates a verdict about the right protected path from
    // one about a path this call never touched.
    const reg = registration([PROTECTED_SETTINGS, PROTECTED_DIST]);
    const input = shellCall(`rm -rf ${PROTECTED_DIST};echo 'x`);

    expect(matchRegistrations(input, [reg])).toEqual([
      { registration: reg, mentionedPath: PROTECTED_DIST },
    ]);
  });
});

describe('precedent evidence refuses a partially read command line', () => {
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
      readPreState,
      transcript: transcriptWithToolCalls(calls),
    };
  }

  /**
   * What the assembly decided. The decision is bound INTO the judge thunk, so it is read from
   * the verdict the thunk answers against a triggering input: uphold means found, break means
   * missing.
   */
  async function precedentDecision(calls: ObservedCall[]): Promise<'found' | 'missing'> {
    const [registration] = compileDisciplineRegistrations(contextSpec(calls));
    const outcome = await registration?.body?.(triggeringInput);
    return outcome?.exitCode === 0 ? 'found' : 'missing';
  }

  it('refuses a line whose read half anchors the pattern, while its fully read twin qualifies', async () => {
    // The one consumer where accepting partial results OPENS a gate instead of closing one.
    // Missing evidence blocks, so the moment the anchor scan trusts the commands it managed to
    // read, a line nobody could finish reading becomes proof that a required command ran. The
    // refusal is therefore kept on purpose. The control proves this shape really can qualify,
    // pinning the refusal to the unread span rather than to an anchor that never matches.
    expect(await precedentDecision([observedCall(`npm view yaml;echo 'x`)])).toBe('missing');
    expect(await precedentDecision([observedCall('npm view yaml;echo x')])).toBe('found');
  });
});

describe('a scan that ran off the end says so', () => {
  it('records a span when a quote inside a command substitution never closes', () => {
    // `matchParen` has to report WHETHER it arrived, not only where it stopped. Its two quote
    // bail-outs run to end of input and the caller turns that into one opaque word covering
    // the rest of the line, so without the flag the line answers `unread: []` — the fully-read
    // signal — and files zero unjudgeable entries. The judge then skips its opaque-token
    // backstop because `echo` is allowlisted, and the call passes with no telemetry at all.
    const line = `echo $(cat 'a) rm -rf>${PROTECTED_DIST}`;
    const result = tokenizeCommandLine(line);

    expect(result.unread).toHaveLength(1);
    expect(deriveShellChanges(line).unjudgeable.length).toBeGreaterThan(0);
    expect(judgeShellModification(shellCall(line), shellSpec()).upheld).toBe(false);
  });

  it('records the same span for a double-quoted bail-out and for parens that never balance', () => {
    // `matchParen` has three ways to run off the end — the single-quote branch, the
    // double-quote branch, and the loop ending with depth still open — and each reaches the
    // same caller, so fixing one leaves its siblings.
    for (const line of [`echo $(cat "a) rm -rf>${PROTECTED_DIST}`, `echo $(cat a`]) {
      expect(tokenizeCommandLine(line).unread.length, line).toBeGreaterThan(0);
      expect(deriveShellChanges(line).unjudgeable.length, line).toBeGreaterThan(0);
    }
  });

  it('leaves the closed twin fully read, so the flag is not a blanket refusal', () => {
    // Over-block fence: a substitution that DOES close must stay `unread: []`, or every
    // command substitution in normal use reports as half-read. Only `unread` is asserted —
    // this line files an unjudgeable row for an unrelated reason, its parens reading as a
    // subshell marker, so pinning that count would be pinning a coincidence.
    expect(tokenizeCommandLine('echo $(cat a) done').unread).toEqual([]);
  });
});

describe('an escape the table cannot translate is not knowledge', () => {
  it('marks the word opaque instead of filing source spelling as written content', () => {
    // The word text becomes the `content` of CONFIDENT file-change evidence, so an ANSI-C
    // scanner returning the untranslated spelling while the word still reads as decided files
    // `$'\x64ist'` as the literal `\x64ist` while bash writes `dist`. A judge reading written
    // content then compares a string that never existed and upholds, with no unjudgeable row
    // to show the question was never answered.
    //
    // Completing the escape table is not the fix: the next unlisted escape reproduces this
    // exactly. Declining to claim knowledge closes it once.
    const derivation = deriveShellChanges(`echo $'\\x64ist' > ${UNPROTECTED}`);

    expect(derivation.evidence).toEqual([]);
    expect(derivation.unjudgeable.length).toBeGreaterThan(0);
  });

  it('still files real evidence for a string the table fully decodes', () => {
    // Opacity attaches to the untranslated escape, not to `$'…'` as a form: a fully decoded
    // constant is decided, and its DECODED bytes are what must reach the evidence axis.
    const derivation = deriveShellChanges(`echo $'a\\tb' > ${UNPROTECTED}`);

    expect(derivation.evidence).toEqual([
      { path: UNPROTECTED, content: 'a\tb\n', mode: 'truncate' },
    ]);
  });
});

describe('the evidence axis accepts what the judging axis does', () => {
  it('computes a >| write, on the plain and fd-prefixed spellings', () => {
    // `>|` has to reach `STDOUT_WRITE_OPERATORS`, not only `scanRedirect` and the detection
    // rules. The tokenizer emits it as a write operator and the rules grade it by the `>` it
    // contains, so an omission here files a fully computable write as one that carries no
    // stdout — a skip row standing in for a fact that was available all along.
    for (const line of [`echo x >| ${UNPROTECTED}`, `echo x 1>| ${UNPROTECTED}`]) {
      expect(deriveShellChanges(line).evidence, line).toEqual([
        { path: UNPROTECTED, content: 'x\n', mode: 'truncate' },
      ]);
    }
  });

  it('sees a directory change hidden behind a leading assignment', () => {
    // `FOO=1 cd sub` moves the directory exactly as `cd sub` does, so a directory-change check
    // reading `words[0]` while the command scan reads past assignments misses it. That is not
    // a silent skip: every relative target on the line is then resolved against the repo root
    // and filed as CONFIDENT evidence for a path never touched.
    const derivation = deriveShellChanges('FOO=1 cd sub && echo x > out.txt');

    expect(derivation.evidence).toEqual([]);
    expect(derivation.unjudgeable.length).toBeGreaterThan(0);
  });
});
