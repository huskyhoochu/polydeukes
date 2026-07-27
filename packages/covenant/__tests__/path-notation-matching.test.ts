import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mentionsPath, pathMatchesProtected } from '../src/mention.js';
import { inputWithArgs } from './helpers.js';

// ---------------------------------------------------------------------------
// COVENANT-07b §2 — potential matching. Every protected path below is an injected
// fixture value, and each is written in the shape the real surface carries it,
// because the shape is what the predicate treats differently (PRD §1): on a
// DIRECTORY-shaped path a trailing glob lands after the protected segments and they
// survive, on a FILE-shaped path the glob REPLACES the last protected segment and
// nothing survives. The transcript is absolute because assembly attaches it from the
// payload (COVENANT-13), which is the form `~` and `$HOME` are written against.
// ---------------------------------------------------------------------------

const PROTECTED_DIR = 'packages/core/dist';
const PROTECTED_FILE = 'lefthook.yml';
const PROTECTED_FILE_ALT = 'biome.json';
const PROTECTED_TRANSCRIPT = '/home/u/.claude/projects/-home-u-proj/session.jsonl';

describe('pathMatchesProtected — interior "." and ".." resolve before matching (PRD §3.1)', () => {
  it('an interior "." segment does not break the protected run', () => {
    // Mutation caught: normalization that only strips a LEADING "./" (the shipped
    // pathSegments) leaves "." as an ordinary segment, so the contiguous run splits and
    // `echo x >> packages/core/./dist/index.js` is never judged at all — not absolved by
    // a step, but never reaching one.
    expect(pathMatchesProtected('packages/core/./dist/index.js', PROTECTED_DIR)).toBe(true);
  });

  it('an interior ".." cancels the segment before it', () => {
    // Mutation caught: ".." dropped without cancelling its predecessor, which leaves
    // `src` sitting between `core` and `dist` and the run still broken — the measured
    // `sed -i … packages/core/src/../dist/index.js` form.
    expect(pathMatchesProtected('packages/core/src/../dist/index.js', PROTECTED_DIR)).toBe(true);
  });

  it('a trailing ".." still matches as the parent of the protected path', () => {
    // `rm -rf packages/core/dist/..` normalizes to the protected path's parent, which the
    // ancestor rule blocks today and must keep blocking (PRD §5). Mutation caught: a
    // cancellation that consumes past the start of the candidate, leaving zero segments —
    // which the zero-length arm answers false, so the parent operation goes unjudged.
    expect(pathMatchesProtected('packages/core/dist/..', PROTECTED_DIR)).toBe(true);
  });
});

describe('pathMatchesProtected — a glob segment is a potential match, not a literal (PRD §3.1)', () => {
  it('a middle glob segment can stand in for the protected directory segment', () => {
    // Mutation caught: glob segments compared by string equality (the shipped
    // containsSegmentRun), so `rm packages/*/dist/index.js` removes every judge
    // executable on the surface with no verdict recorded against it.
    expect(pathMatchesProtected('packages/*/dist/index.js', PROTECTED_DIR)).toBe(true);
  });

  it('a trailing glob on a FILE-shaped protected path is a potential match', () => {
    // The half the PRD (§1) names as easy to miss: a directory-shaped protected path
    // keeps its segments in front of the glob, a file-shaped one does not. Mutation
    // caught: a fix that only widens the interior of the run, which leaves the two gate
    // files — the ones whose edit disarms a check rather than passing it — open.
    expect(pathMatchesProtected('lefthook.y*', PROTECTED_FILE)).toBe(true);
    expect(pathMatchesProtected('biome.js*', PROTECTED_FILE_ALT)).toBe(true);
  });

  it('a glob is constrained by its literal prefix, and a plain segment stays exact', () => {
    // Mutation caught, both directions of the same over-reach: "the segment contains a
    // glob character, so it matches anything", which promotes every sibling directory
    // into the protected surface; and prefix-comparing segments that carry no glob at
    // all, which is the COVENANT-07 `src-generated` boundary trap reopened.
    expect(pathMatchesProtected('packages/core-generated*/dist', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('packages/core/dist-generated/x.js', PROTECTED_DIR)).toBe(false);
  });

  it('a glob cannot bridge a definite segment that differs', () => {
    // Mutation caught: an unknown segment allowed to absorb the REST of the path rather
    // than the one position it occupies, which matches every ordinary source edit against
    // the dist protection and blocks the work this repository exists to do.
    expect(pathMatchesProtected('packages/*/src/index.ts', PROTECTED_DIR)).toBe(false);
  });
});

describe('pathMatchesProtected — "~" and "$HOME" judged without a home value (PRD §2-b)', () => {
  it('a tilde path whose definite tail is the protected transcript matches', () => {
    // The audit's B2: the transcript is the evidence source the TTL waiver reads, so an
    // append written in tilde notation forges a human utterance and opens a human-only
    // valve for an agent. Mutation caught: "~" compared as a literal segment. The
    // predicate must answer without learning the home value — the definite tail is the
    // whole comparison, which is what keeps it a zero-I/O pure function (§6).
    expect(
      pathMatchesProtected('~/.claude/projects/-home-u-proj/session.jsonl', PROTECTED_TRANSCRIPT),
    ).toBe(true);
  });

  it('a $HOME path matches on the same tail', () => {
    // Mutation caught: only "~" special-cased, leaving the variable-expansion form
    // (`chmod 000 $HOME/…`, separately measured) open on the same evidence source.
    expect(
      pathMatchesProtected(
        '$HOME/.claude/projects/-home-u-proj/session.jsonl',
        PROTECTED_TRANSCRIPT,
      ),
    ).toBe(true);
  });

  it('a tilde path whose definite part differs does NOT match', () => {
    // Mutation caught: an unknown leading segment absolving the rest of the comparison,
    // which blocks every home-directory command in the session — and blocks ANOTHER
    // project's transcript, where only the middle segment tells the two apart.
    expect(pathMatchesProtected('~/unrelated/session.jsonl', PROTECTED_TRANSCRIPT)).toBe(false);
    expect(
      pathMatchesProtected('~/.claude/projects/other-proj/session.jsonl', PROTECTED_TRANSCRIPT),
    ).toBe(false);
  });
});

describe('pathMatchesProtected — the ancestor direction is not widened (PRD §3.2)', () => {
  it('an unknown leading segment cannot root-anchor the ancestor match', () => {
    // The failure mode this ticket creates: "~" must absorb the segments a home path
    // expands to for the transcript case above, and if it is allowed to absorb ZERO the
    // candidate root-anchors and each of these becomes an ancestor of the protected path.
    // A dangling ".." is the same grade of unknown (PRD §2-a) and collapses the same way
    // if it is simply dropped instead of kept.
    expect(pathMatchesProtected('*/packages', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('~/packages', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('../packages', PROTECTED_DIR)).toBe(false);
  });
});

describe('mentionsPath — notation reaches the judges through real payload shapes', () => {
  it('an Edit payload carries its interior "." through the nested traversal', () => {
    // The tool axis delivers an ABSOLUTE file_path nested under args — the input shape
    // whose absence hid COVENANT-07's regression, so it is the shape this one is pinned
    // in. Mutation caught: normalization applied at a caller rather than in the shared
    // primitive, leaving whichever of the three consumers was not edited open.
    const args = inputWithArgs({
      file_path: '/home/u/proj/packages/core/./dist/index.js',
    }).toolCalls[0].args;

    expect(mentionsPath(args, PROTECTED_DIR)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD §3.6 — what the first implementation got wrong. Two directions were too wide
// and one was too narrow, and the suite above missed all three because every glob it
// pinned carried a literal anchor and every `..` it pinned had something left to cancel.
// ---------------------------------------------------------------------------

describe('pathMatchesProtected — a glob with no literal proves nothing (PRD §3.6)', () => {
  it('a segment of pure glob metacharacters cannot name a protected segment', () => {
    // Mutation caught: the shipped `^.*$` compilation, where a lone asterisk matched every
    // protected segment AND counted as proof — so a single `*` anywhere in a command named
    // all nine protected paths at once.
    expect(pathMatchesProtected('*', PROTECTED_FILE)).toBe(false);
    expect(pathMatchesProtected('**', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('?', PROTECTED_FILE)).toBe(false);
  });

  it('ordinary glob commands and markdown prose stay free', () => {
    // The measured over-block: these are the shapes that fired during the review session
    // itself. A bullet list is the tool-axis half — the self-mod fallback branch scans a
    // whole file body, so `* one` in prose blocked writes to unprotected files.
    expect(pathMatchesProtected('packages/*', PROTECTED_FILE)).toBe(false);
    expect(pathMatchesProtected('*.mjs', PROTECTED_FILE)).toBe(false);
    const args = inputWithArgs({ command: 'echo "* item" >> notes.md' }).toolCalls[0].args;
    expect(mentionsPath(args, PROTECTED_DIR)).toBe(false);
  });

  it('a glob that carries a literal still names, and still proves', () => {
    // The other half of the same rule: narrowing must not cost the seven measured forms.
    expect(pathMatchesProtected('lefthook.y*', PROTECTED_FILE)).toBe(true);
    expect(pathMatchesProtected('packages/*/dist/index.js', PROTECTED_DIR)).toBe(true);
  });

  it('a run of asterisks is judged without catastrophic backtracking', () => {
    // Measured at 32.6s for 24 asterisks before the fix, inside a hook that runs on every
    // tool call. Consecutive `.*` groups have to collapse, or a banner comment in a file
    // body freezes the session with no timeout anywhere in the judge.
    const started = Date.now();
    expect(pathMatchesProtected(`${'*'.repeat(24)}x`, PROTECTED_FILE)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe('pathMatchesProtected — cancelling past the root names the root (PRD §3.6)', () => {
  it('a candidate that cancels past its own start is an ancestor of every protected path', () => {
    // The one direction where the first implementation was NARROWER than main: `..`
    // cancellation emptied the segment list and the zero-length arm answered false, so a
    // command deleting the repository root routed to no judge and left no telemetry row.
    expect(pathMatchesProtected('.claude/hooks/../..', PROTECTED_DIR)).toBe(true);
    expect(pathMatchesProtected('packages/core/dist/../../..', PROTECTED_FILE)).toBe(true);
  });

  it('a degenerate path still names nothing', () => {
    // The contrast that keeps the arm above honest — self-mod's COVENANT-09 evidence check
    // reads `pathSegments` for exactly these inputs, and they must keep proving nothing.
    expect(pathMatchesProtected('.', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('/', PROTECTED_DIR)).toBe(false);
  });
});

describe('pathMatchesProtected — an unknown fills one place against a relative path (PRD §3.6)', () => {
  it('a home-relative or parent-relative path does not become a repo-relative one', () => {
    // A relative protected path is anchored at the repository root and `~` is anchored at
    // the home directory, so letting the unknown absorb `packages/core` turns a sibling
    // checkout's build output into the protected one. Measured: `rm -rf ../dist` blocked.
    expect(pathMatchesProtected('~/dist', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('../dist', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('$BUILD/dist', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('~/settings.json', '.claude/settings.json')).toBe(false);
  });

  it('an ABSOLUTE protected path still lets the unknown absorb its head', () => {
    // The transcript is the only absolute entry on the surface, and it is the case the
    // multi-segment absorption exists for. Mutation caught: narrowing the rule everywhere
    // and reopening B2 while fixing the over-block.
    expect(
      pathMatchesProtected('~/.claude/projects/-home-u-proj/session.jsonl', PROTECTED_TRANSCRIPT),
    ).toBe(true);
  });

  it('a repository under the home directory is reached without any absorption', () => {
    // Why one place is enough: the descendant rule is offset-free, so the protected run is
    // found by sliding the start, not by the tilde eating segments.
    expect(pathMatchesProtected('~/proj/packages/core/dist/index.js', PROTECTED_DIR)).toBe(true);
  });
});

describe('mention.ts stays a zero-I/O pure function (PRD §6)', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/mention.ts', import.meta.url)),
    'utf-8',
  );

  it('reads a non-empty source — the gate cannot pass vacuously', () => {
    // A gate whose file moved reports zero violations forever. The behavioural tests above
    // would stay green through that, since they only ever observe the predicate's answers.
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain('export function pathMatchesProtected');
  });

  it('resolves notation without importing a path or filesystem module', () => {
    // The tempting shortcut for interior "."/".." is `node:path`'s resolve/normalize, and
    // for `~` it is `node:os`'s homedir. Both make the predicate answer differently
    // depending on where the process was started, which no behavioural assertion here can
    // see — every test would pass while the judge silently became cwd-dependent.
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it('reads no ambient state, which an import ban alone would not cover', () => {
    // Mutation caught: the same values reached through globals instead of imports —
    // `process.cwd()` for a base directory, `process.env.HOME` for the tilde expansion
    // this ticket deliberately does not perform (PRD §2-b).
    expect(source).not.toMatch(/process\s*\./);
  });
});
