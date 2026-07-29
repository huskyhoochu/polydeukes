import type { CovenantInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_READ_ONLY_COMMANDS,
  judgeShellModification,
  type ShellModificationSpec,
} from '../src/shell-mod.js';
import {
  judgeTranscriptModification,
  type TranscriptModificationSpec,
} from '../src/transcript-mod.js';

// ---------------------------------------------------------------------------
// COVENANT-07d (audit B7) — an untokenizable line whose protected path is
// GLUED to a shell metacharacter must still fail closed. Every value below is
// an injected fixture value, never a source literal; the protected paths and
// the defect command lines replay the PRD §2-a probe rows, so the break cases
// here are the measured bypasses themselves.
// ---------------------------------------------------------------------------

const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PROTECTED_DIST = 'packages/core/dist';
const PROTECTED_SETTINGS = '.claude/settings.json';
const PROTECTED_PATHS = [PROTECTED_DIST, PROTECTED_SETTINGS];
const HOME = '/home/u';
const TRANSCRIPT_TAIL = '.claude/projects/-home-u-proj/session.jsonl';
const TRANSCRIPT = `${HOME}/${TRANSCRIPT_TAIL}`;
const MUTATING_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
const METACHARS = [';', '&', '|', '<', '>'];

const FALLBACK_MENTION_REASON = 'untokenizable command line mentions protected path';
const FALLBACK_TRANSCRIPT_REASON = 'untokenizable command line names the session transcript';

/** A shell-tool call carrying `line` under the injected command-arg key. */
function shellCall(line: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: line } }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** The PRD §2-a probe spec: two protected paths, default read-only allowlist. */
function shellSpec(): ShellModificationSpec {
  return {
    protectedPaths: PROTECTED_PATHS,
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
  };
}

/** The transcript spec with home injected so all three spellings resolve. */
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

describe('judgeShellModification — glued metachar mentions break (COVENANT-07d §2-a)', () => {
  it('a ">"-glued write into a protected descendant breaks', () => {
    // B7, write shape: `hi>…/dist/x.js` hides the descendant target inside one candidate,
    // so a forge into the judge executable rode an unclosed quote through.
    const verdict = judgeShellModification(
      shellCall(`echo hi>${PROTECTED_DIST}/x.js; echo 'oops`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(FALLBACK_MENTION_REASON);
      expect(verdict.reason).toContain(PROTECTED_DIST);
    }
  });

  it('an allowlisted head cannot vouch for a glued fragment', () => {
    // Mutation caught: the fallback decomposition re-tokenizing fragments and consulting
    // the read-only allowlist per fragment — an untokenizable line has no first token to
    // read, so `cat` must not absolve the glued mention.
    const verdict = judgeShellModification(shellCall(`cat ${PROTECTED_DIST};echo 'x`), shellSpec());

    expect(verdict.upheld).toBe(false);
  });
});

describe('judgeTranscriptModification — glued spellings break (COVENANT-07d §2-a)', () => {
  it('the "$HOME" and "~" spellings break when ";"-glued (all three spellings close)', () => {
    // PRD §3: all three spellings must block — a fix comparing only the absolute spelling
    // leaves the home-relative forgeries open.
    for (const spelling of [`$HOME/${TRANSCRIPT_TAIL}`, `~/${TRANSCRIPT_TAIL}`]) {
      const verdict = judgeTranscriptModification(
        shellCall(`rm ${spelling};echo 'x`),
        transcriptSpec(),
      );
      expect(verdict.upheld).toBe(false);
    }
  });

  it('an allowlisted head cannot vouch for a glued transcript fragment either', () => {
    // Mutation caught: the transcript branch applying the allowlist to re-tokenized
    // fragments — reading the session is free on a tokenizable line, but an untokenizable
    // one proves no head, so the glued `cat` must break.
    const verdict = judgeTranscriptModification(
      shellCall(`cat ${TRANSCRIPT};echo 'x`),
      transcriptSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });
});

describe('untokenizable fallback — metachar matrix, both directions (COVENANT-07d §3)', () => {
  it('each metachar glued AFTER the protected path breaks (shell axis)', () => {
    // Mutation caught: one separator missing from the fallback split set — each of the
    // five metacharacters reopens its own spelling of B7; every case must also keep the
    // fallback reason vocabulary and name the protected path it matched.
    for (const meta of METACHARS) {
      const verdict = judgeShellModification(
        shellCall(`rm -rf ${PROTECTED_DIST}${meta}echo 'x`),
        shellSpec(),
      );
      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(`${FALLBACK_MENTION_REASON} ${PROTECTED_DIST}`);
      }
    }
  });

  it('each metachar glued BEFORE the protected path breaks (shell axis)', () => {
    // Mutation caught: a decomposition that only trims operators off a candidate's tail —
    // the mirrored glue point must split the same way.
    for (const meta of METACHARS) {
      const verdict = judgeShellModification(
        shellCall(`true${meta}${PROTECTED_DIST} 'x`),
        shellSpec(),
      );
      expect(verdict.upheld).toBe(false);
    }
  });

  it('each metachar glued after the absolute transcript breaks (transcript axis)', () => {
    // Mutation caught: fixing the shell-mod branch alone — the transcript fallback is a
    // separate consumer, and left on whitespace-only candidates it keeps failing open;
    // every case must also keep the fragment-branch vocabulary and name the transcript.
    for (const meta of METACHARS) {
      const verdict = judgeTranscriptModification(
        shellCall(`rm ${TRANSCRIPT}${meta}echo 'x`),
        transcriptSpec(),
      );
      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(FALLBACK_TRANSCRIPT_REASON);
        expect(verdict.reason).toContain(TRANSCRIPT);
      }
    }
  });
});

describe('untokenizable fallback — decomposition contract properties (COVENANT-07d §2-c)', () => {
  it('a metachar inside a protected segment still breaks (the raw line stays a candidate)', () => {
    // Mutation caught: a fragments-only replacement of the union — splitting at '&' shatters
    // the `a&b` segment, so only the raw dequoted line kept alongside the fragments matches.
    const ampPath = 'pkg/a&b/dist';
    const verdict = judgeShellModification(shellCall(`rm -rf ${ampPath} 'x`), {
      ...shellSpec(),
      protectedPaths: [ampPath],
    });

    expect(verdict.upheld).toBe(false);
  });

  it('a ">"-glued transcript write behind an earlier "/" token breaks (transcript axis)', () => {
    // Mutation caught: leaning on the redirect target re-read (pathForms) instead of the
    // fallback '>' split — `a/b` plants an earlier root marker, so the re-read yields
    // `/b>…`, never the transcript; only the fallback fragment surfaces it.
    const verdict = judgeTranscriptModification(
      shellCall(`cp a/b>${TRANSCRIPT} 'x`),
      transcriptSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a ";"-glued destroy of the second protected entry breaks and names it', () => {
    // Mutation caught: the fallback sweeping only protectedPaths[0] — the second entry must
    // break on its own, and the reason must name the entry actually hit.
    const verdict = judgeShellModification(
      shellCall(`rm -rf ${PROTECTED_SETTINGS};echo 'x`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED_SETTINGS);
    }
  });

  it('a ";"-glued dot-notation spelling of the protected dist breaks', () => {
    // Mutation caught: the fallback comparing fragments with a private equality instead of
    // delegating to the two-pass mention match — `src/../dist` only resolves through the
    // dot-resolving pass.
    const dottedDist = 'packages/core/src/../dist'; // resolves to PROTECTED_DIST
    const verdict = judgeShellModification(shellCall(`rm -rf ${dottedDist};echo 'x`), shellSpec());

    expect(verdict.upheld).toBe(false);
  });
});

describe('untokenizable fallback — escape-glued spellings break (COVENANT-07d review)', () => {
  // A backslash line continuation is erased by the shell before execution, so a path carrying
  // one is a real target — and the line it appears in is valid bash, not a typo.
  const CONTINUED = `rm -rf ${PROTECTED_DIST}\\\n;cat <<$D\nhi\n$D`;

  it('a backslash continuation between the path and the metachar breaks (shell axis)', () => {
    // Mutation caught: dequoting only quote characters — the fragment then ends in `dist\`
    // and matches nothing, which is B7 one escape character over.
    const verdict = judgeShellModification(shellCall(CONTINUED), shellSpec());

    expect(verdict.upheld).toBe(false);
  });

  it('a backslash planted inside a protected segment breaks (shell axis)', () => {
    // The shell removes the escape, so `di\st` executes as `dist`; the judge must read the
    // same path the shell will.
    const verdict = judgeShellModification(
      shellCall(`rm -rf packages/core/di\\st;echo 'x`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('the transcript closes the same escape spellings', () => {
    // Mutation caught: fixing the shell branch alone — the transcript dequote is its own site.
    // The second spelling escapes a character INSIDE the transcript path, which the shell
    // removes — under whole-path equality the judge must compare the same resolved path.
    const escapedInside = TRANSCRIPT.replace('.claude', '.cla\\ude');
    for (const line of [`rm ${TRANSCRIPT}\\\n;cat <<$D\nhi\n$D`, `rm ${escapedInside};echo 'x`]) {
      expect(judgeTranscriptModification(shellCall(line), transcriptSpec()).upheld).toBe(false);
    }
  });
});

describe('untokenizable fallback — the ancestor direction widens with the split (COVENANT-07d review)', () => {
  it('a bare ancestor segment exposed by a fragment boundary blocks', () => {
    // Decided behavior, not an accident: the fragment boundary exposes a bare `packages`,
    // which segmentsMatch accepts as a root-anchored ancestor. Narrowing it would also drop
    // the glued ancestor destroy below, so the block is accepted and pinned here.
    const verdict = judgeShellModification(
      shellCall(`curl https://example.com/a?x=1&packages=1 'y`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a glued ancestor destroy breaks — the defence that widening buys', () => {
    // Mutation caught: accepting fragment candidates only in the descendant direction. This
    // command deletes the protected dist by deleting its parent.
    const verdict = judgeShellModification(shellCall(`rm -rf packages/core;echo 'x`), shellSpec());

    expect(verdict.upheld).toBe(false);
  });

  it('an untokenizable read of the transcript blocks — the fallback has no allowlist', () => {
    // The tokenizable twin upholds (see the over-block block below). Pinned because it is a
    // verdict this ticket changed: the allowlist-free fallback owns every untokenizable line.
    const verdict = judgeTranscriptModification(
      shellCall(`cat ${TRANSCRIPT};echo 'x`),
      transcriptSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });
});

describe('untokenizable fallback — existing blocks stay blocked (COVENANT-07d §2-a pins)', () => {
  it('whitespace-separated mentions in untokenizable lines still break via the fallback', () => {
    // Mutation caught: the union dropping the raw-line candidates once fragments exist —
    // the spaced spellings blocked before this ticket and must keep verdict AND vocabulary.
    const spaced = judgeShellModification(
      shellCall(`rm -rf ${PROTECTED_DIST} ; echo 'x`),
      shellSpec(),
    );
    expect(spaced.upheld).toBe(false);
    if (!spaced.upheld) {
      expect(spaced.reason).toContain(`${FALLBACK_MENTION_REASON} ${PROTECTED_DIST}`);
    }

    const anded = judgeShellModification(
      shellCall(`rm -rf ${PROTECTED_DIST} && echo 'x`),
      shellSpec(),
    );
    expect(anded.upheld).toBe(false);
  });

  it('the transcript keeps its spaced fallback block', () => {
    // Mutation caught: the same regression on the evidence source — the spaced mention
    // blocked before this ticket and must keep verdict AND vocabulary.
    const spaced = judgeTranscriptModification(
      shellCall(`rm ${TRANSCRIPT} ; echo 'x`),
      transcriptSpec(),
    );
    expect(spaced.upheld).toBe(false);
    if (!spaced.upheld) {
      expect(spaced.reason).toContain(FALLBACK_TRANSCRIPT_REASON);
    }
  });
});

describe('untokenizable fallback — over-block regression zero (COVENANT-07d §3)', () => {
  it('a tokenizable allowlisted read under the protected dist upholds', () => {
    // Mutation caught: the wider decomposition applied to TOKENIZABLE lines — `cat` would
    // lose its allowlist absolution and every read of dist would need the witness.
    const verdict = judgeShellModification(
      shellCall(`cat ${PROTECTED_DIST}/index.js`),
      shellSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('a tokenizable allowlisted read of the transcript upholds', () => {
    // Mutation caught: the same leak on the transcript branch — reading the session must
    // never need a witness (COVENANT-07c's deliberate friction removal).
    const verdict = judgeTranscriptModification(
      shellCall(`tail -f ${TRANSCRIPT}`),
      transcriptSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('untokenizable lines with no protected mention keep upholding', () => {
    // Mutation caught: the fragment split manufacturing blocks out of mention-free lines —
    // the over-block direction. A URL query "&", a flag-joined path, and a PATH-style
    // colon list each carry a metachar plus an unclosed quote and name nothing protected.
    for (const line of [
      "curl https://example.com/download?a=1&b=2 'x",
      "--flag=unrelated/path;echo 'x",
      "PATH=/usr/bin:unrelated/bin;echo 'x",
    ]) {
      expect(judgeShellModification(shellCall(line), shellSpec())).toEqual({ upheld: true });
    }
  });

  it('a colon-joined list carrying the protected path upholds (":" stays out of the split)', () => {
    // Mutation caught: ':' added to the fallback separators — the URL over-block axis the
    // candidate primitive deliberately excludes stays excluded (PRD §2-c), so `dist:other`
    // remains one unmatched segment even in an untokenizable line.
    const verdict = judgeShellModification(
      shellCall(`PATH=${PROTECTED_DIST}:other;echo 'x`),
      shellSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });
});

describe('untokenizable fallback — conservative widening (COVENANT-07d §2-c)', () => {
  it('a URL embedding the protected run breaks once "&"-glued in an untokenizable line', () => {
    // The documented other end of the URL axis: the "&" fragment ends exactly on the
    // protected segment run, so the offset-free mention matches — a conservative block the
    // union decomposition accepts by design, not an over-block to fix later.
    const verdict = judgeShellModification(
      shellCall(`curl https://example.com/${PROTECTED_DIST}&x 'y`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a "--flag="-joined protected path breaks once ";"-glued in an untokenizable line', () => {
    // The other end of the flag axis: '=' is already a candidate separator, so the ";"
    // fragment exposes the exact protected path — passing it would keep B7 alive one
    // spelling over.
    const verdict = judgeShellModification(
      shellCall(`--flag=${PROTECTED_DIST};echo 'x`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });
});
