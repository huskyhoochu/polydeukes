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

// A line the scanner cannot finish reading, whose protected path is GLUED to a shell
// metacharacter, must still fail closed. The command lines below are the measured bypasses
// themselves.
//
// These lines tokenize as far as the unterminated quote, so a protected path in the read half
// reaches precise judgment and is answered with a precise reason; only material inside an
// unread span falls to the mention scan, which is asserted in partial-results.test.ts.

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

// The fallback vocabulary, kept as the reason a precisely judged line must NOT be answered
// with.
const FALLBACK_MENTION_REASON = 'untokenizable command line mentions protected path';

/** A shell-tool call carrying `line` under the injected command-arg key. */
function shellCall(line: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: line } }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** Two protected paths, default read-only allowlist. */
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

describe('judgeShellModification — glued metachar mentions break', () => {
  it('a ">"-glued write into a protected descendant breaks', () => {
    // `hi>…/dist/x.js` hides the descendant target inside one candidate, which is how a forge
    // into the judge executable once rode an unclosed quote through. The write now reaches the
    // precise rule and is answered with a real target rather than a mention; excluding the
    // fallback reason is what proves the read half was judged, since a regression back to the
    // fallback still blocks and only the reason tells the two apart.
    const verdict = judgeShellModification(
      shellCall(`echo hi>${PROTECTED_DIST}/x.js; echo 'oops`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('redirect-write');
      expect(verdict.reason).toContain(PROTECTED_DIST);
      expect(verdict.reason).not.toContain(FALLBACK_MENTION_REASON);
    }
  });

  it('an allowlisted head cannot vouch for a glued fragment', () => {
    // A fallback decomposition that re-tokenizes fragments and consults the read-only
    // allowlist per fragment lets `cat` absolve the glued mention, but a line nobody could
    // finish reading has no head to vouch for it.
    const verdict = judgeShellModification(shellCall(`cat ${PROTECTED_DIST};echo 'x`), shellSpec());

    expect(verdict.upheld).toBe(false);
  });
});

describe('judgeTranscriptModification — glued spellings break', () => {
  it('the "$HOME" and "~" spellings break when ";"-glued (all three spellings close)', () => {
    // All three spellings must block: comparing only the absolute one leaves the
    // home-relative forgeries open.
    for (const spelling of [`$HOME/${TRANSCRIPT_TAIL}`, `~/${TRANSCRIPT_TAIL}`]) {
      const verdict = judgeTranscriptModification(
        shellCall(`rm ${spelling};echo 'x`),
        transcriptSpec(),
      );
      expect(verdict.upheld).toBe(false);
    }
  });

  it('an allowlisted head cannot vouch for a glued transcript fragment either', () => {
    // Reading the session is free on a tokenizable line, but a line nobody could finish
    // reading proves no head, so the glued `cat` must break.
    const verdict = judgeTranscriptModification(
      shellCall(`cat ${TRANSCRIPT};echo 'x`),
      transcriptSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });
});

describe('untokenizable fallback — metachar matrix, both directions', () => {
  it('each metachar glued AFTER the protected path breaks (shell axis)', () => {
    // Each of the five metacharacters is its own spelling of the glue, and one missed as a
    // boundary reopens that spelling. The path stands in the read half, so the destroy is
    // named by the command head; asserting the precise vocabulary keeps a silent slide back
    // into the fallback visible.
    for (const meta of METACHARS) {
      const verdict = judgeShellModification(
        shellCall(`rm -rf ${PROTECTED_DIST}${meta}echo 'x`),
        shellSpec(),
      );
      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(`rm mentions protected path ${PROTECTED_DIST}`);
      }
    }
  });

  it('each metachar glued BEFORE the protected path breaks (shell axis)', () => {
    // A decomposition that only trims operators off a candidate's tail misses the mirrored
    // glue point.
    for (const meta of METACHARS) {
      const verdict = judgeShellModification(
        shellCall(`true${meta}${PROTECTED_DIST} 'x`),
        shellSpec(),
      );
      expect(verdict.upheld).toBe(false);
    }
  });

  it('each metachar glued after the absolute transcript breaks (transcript axis)', () => {
    // The transcript judge is a separate consumer with its own equality comparison, so fixing
    // the shell branch alone leaves it reading whitespace-cut candidates and failing open. The
    // forgery stands in the read half, so the precise ladder names the head, and the reason is
    // asserted so a regression into the fallback cannot hide behind the verdict.
    for (const meta of METACHARS) {
      const verdict = judgeTranscriptModification(
        shellCall(`rm ${TRANSCRIPT}${meta}echo 'x`),
        transcriptSpec(),
      );
      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(`rm names the session transcript ${TRANSCRIPT}`);
      }
    }
  });
});

describe('untokenizable fallback — decomposition contract properties', () => {
  it('a metachar inside a protected segment still breaks (the raw line stays a candidate)', () => {
    // Splitting at '&' shatters the `a&b` segment, so only the whole candidate kept alongside
    // the fragments matches — a fragments-only decomposition loses this path. The fixture is
    // the QUOTED spelling because unquoted, bash reads `rm -rf pkg/a&b/dist` as `rm -rf pkg/a`
    // backgrounded plus `b/dist` and never targets that file at all.
    const ampPath = 'pkg/a&b/dist';
    const verdict = judgeShellModification(shellCall(`rm -rf '${ampPath}'`), {
      ...shellSpec(),
      protectedPaths: [ampPath],
    });

    expect(verdict.upheld).toBe(false);
  });

  it('a ">"-glued transcript write behind an earlier "/" token breaks (transcript axis)', () => {
    // `a/b` plants an earlier root marker, so a redirect-target re-read yields `/b>…` and
    // never the transcript; only the fallback's '>' split surfaces it.
    const verdict = judgeTranscriptModification(
      shellCall(`cp a/b>${TRANSCRIPT} 'x`),
      transcriptSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a ";"-glued destroy of the second protected entry breaks and names it', () => {
    // A fallback sweeping only protectedPaths[0] never reaches the second entry, and the
    // reason must name the entry actually hit.
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
    // `src/../dist` resolves only through the dot-resolving pass, so a fallback comparing
    // fragments with a private equality misses it.
    const dottedDist = 'packages/core/src/../dist'; // resolves to PROTECTED_DIST
    const verdict = judgeShellModification(shellCall(`rm -rf ${dottedDist};echo 'x`), shellSpec());

    expect(verdict.upheld).toBe(false);
  });
});

describe('untokenizable fallback — escape-glued spellings break', () => {
  // A backslash line continuation is erased by the shell before execution, so a path carrying
  // one is a real target — and the line it appears in is valid bash, not a typo.
  const CONTINUED = `rm -rf ${PROTECTED_DIST}\\\n;cat <<$D\nhi\n$D`;

  it('a backslash continuation between the path and the metachar breaks (shell axis)', () => {
    // Dequoting only quote characters leaves the fragment ending in `dist\`, which matches
    // nothing — the same glue one escape character over.
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
    // The transcript dequote is its own site. The second spelling escapes a character INSIDE
    // the transcript path, which the shell removes, so under whole-path equality the judge has
    // to compare the same resolved path.
    const escapedInside = TRANSCRIPT.replace('.claude', '.cla\\ude');
    for (const line of [`rm ${TRANSCRIPT}\\\n;cat <<$D\nhi\n$D`, `rm ${escapedInside};echo 'x`]) {
      expect(judgeTranscriptModification(shellCall(line), transcriptSpec()).upheld).toBe(false);
    }
  });
});

describe('untokenizable fallback — the ancestor direction widens with the split', () => {
  it('a bare ancestor segment exposed by a fragment boundary blocks', () => {
    // The fragment boundary exposes a bare `packages`, which the match accepts as a
    // root-anchored ancestor. Narrowing that would also drop the glued ancestor destroy below,
    // so the block is accepted and pinned rather than fixed.
    const verdict = judgeShellModification(
      shellCall(`curl https://example.com/a?x=1&packages=1 'y`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a glued ancestor destroy breaks — the defence that widening buys', () => {
    // Accepting fragment candidates only in the descendant direction passes this command,
    // which deletes the protected dist by deleting its parent.
    const verdict = judgeShellModification(shellCall(`rm -rf packages/core;echo 'x`), shellSpec());

    expect(verdict.upheld).toBe(false);
  });

  it('an untokenizable read of the transcript blocks — the fallback has no allowlist', () => {
    // The tokenizable twin upholds (see the over-block cases below): the allowlist-free
    // fallback owns every line the scanner could not finish.
    const verdict = judgeTranscriptModification(
      shellCall(`cat ${TRANSCRIPT};echo 'x`),
      transcriptSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });
});

describe('untokenizable fallback — existing blocks stay blocked', () => {
  it('whitespace-separated mentions in untokenizable lines still break via the fallback', () => {
    // The spaced spellings must keep their verdict through every change to the layer that
    // answers them. That layer is the precise ladder, so the precise vocabulary is asserted:
    // a case that fell back to the whole-line scan would still block, which is why the reason
    // and not just the verdict is pinned.
    const spaced = judgeShellModification(
      shellCall(`rm -rf ${PROTECTED_DIST} ; echo 'x`),
      shellSpec(),
    );
    expect(spaced.upheld).toBe(false);
    if (!spaced.upheld) {
      expect(spaced.reason).toContain(`rm mentions protected path ${PROTECTED_DIST}`);
    }

    const anded = judgeShellModification(
      shellCall(`rm -rf ${PROTECTED_DIST} && echo 'x`),
      shellSpec(),
    );
    expect(anded.upheld).toBe(false);
  });

  it('the transcript keeps its spaced fallback block', () => {
    // The same on the evidence source, and the reason is pinned for the same purpose as its
    // shell-axis twin above.
    const spaced = judgeTranscriptModification(
      shellCall(`rm ${TRANSCRIPT} ; echo 'x`),
      transcriptSpec(),
    );
    expect(spaced.upheld).toBe(false);
    if (!spaced.upheld) {
      expect(spaced.reason).toContain(`rm names the session transcript ${TRANSCRIPT}`);
    }
  });
});

describe('untokenizable fallback — over-block regression zero', () => {
  it('a tokenizable allowlisted read under the protected dist upholds', () => {
    // Applying the wider decomposition to TOKENIZABLE lines costs `cat` its allowlist
    // absolution, and every read of dist then needs a witness.
    const verdict = judgeShellModification(
      shellCall(`cat ${PROTECTED_DIST}/index.js`),
      shellSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('a tokenizable allowlisted read of the transcript upholds', () => {
    // The same on the transcript branch: reading the session must never need a witness.
    const verdict = judgeTranscriptModification(
      shellCall(`tail -f ${TRANSCRIPT}`),
      transcriptSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('untokenizable lines with no protected mention keep upholding', () => {
    // The over-block direction: a URL query "&", a flag-joined path, and a PATH-style colon
    // list each carry a metachar plus an unclosed quote and name nothing protected, so the
    // fragment split must not manufacture blocks out of them.
    for (const line of [
      "curl https://example.com/download?a=1&b=2 'x",
      "--flag=unrelated/path;echo 'x",
      "PATH=/usr/bin:unrelated/bin;echo 'x",
    ]) {
      expect(judgeShellModification(shellCall(line), shellSpec())).toEqual({ upheld: true });
    }
  });

  it('a colon-joined list carrying the protected path upholds (":" stays out of the split)', () => {
    // ':' stays out of the fallback separators, as it is out of the shared candidate
    // primitive, so `dist:other` remains one unmatched segment even here. Adding it would
    // over-block every URL and PATH-style list.
    const verdict = judgeShellModification(
      shellCall(`PATH=${PROTECTED_DIST}:other;echo 'x`),
      shellSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });
});

describe('untokenizable fallback — conservative widening', () => {
  it('a URL embedding the protected run breaks once "&"-glued in an untokenizable line', () => {
    // The other end of the URL axis: the "&" fragment ends exactly on the protected segment
    // run, so the offset-free mention matches. The union decomposition accepts that
    // conservative block by design.
    const verdict = judgeShellModification(
      shellCall(`curl https://example.com/${PROTECTED_DIST}&x 'y`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a "--flag="-joined protected path breaks once ";"-glued in an untokenizable line', () => {
    // The other end of the flag axis: '=' is already a candidate separator, so the ";"
    // fragment exposes the exact protected path.
    const verdict = judgeShellModification(
      shellCall(`--flag=${PROTECTED_DIST};echo 'x`),
      shellSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });
});
