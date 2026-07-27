import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mentionsPath, pathMatchesProtected, pathSegments } from '../src/mention.js';
import { inputWithArgs } from './helpers.js';

// ---------------------------------------------------------------------------
// COVENANT-07b — interior `.`/`..` closed as a UNION with the shipped comparison,
// and every notation that cannot be resolved without running the shell or reading the
// disk left undecidable on purpose. The fixtures below are organised by the axes of the
// contract rather than by realistic-looking commands, because the two rounds this design
// replaces both shipped defects whose only common trait was living at an axis end no
// fixture had touched.
//
// Axes: where the dot sits (interior / trailing / nothing-to-cancel / cancels-past-root);
// which pass answers (raw / resolved); which direction (descendant / ancestor); how the
// candidate is rooted (relative / absolute); and whether the form is decidable at all.
// ---------------------------------------------------------------------------

const PROTECTED_DIR = 'packages/core/dist';
const PROTECTED_FILE = 'lefthook.yml';
const PROTECTED_FILE_ALT = 'biome.json';
const PROTECTED_HOOKS = '.claude/hooks';

describe('pathMatchesProtected — the raw pass still answers everything it used to', () => {
  it('a command that spells the protected path out loud is caught before any resolution', () => {
    // The load-bearing half of the union. `rm -rf .claude/hooks/../..` removes the whole
    // surface, and its RAW segments still contain the protected run — so it breaks on the
    // shipped comparison, with no rule about roots or cancellation depth. Mutation caught:
    // resolution replacing the raw pass instead of joining it, which is precisely how the
    // two earlier attempts turned a notation fix into a lost defence.
    expect(pathMatchesProtected('.claude/hooks/../..', PROTECTED_HOOKS)).toBe(true);
  });

  it('an ABSOLUTE candidate still matches a relative protected path', () => {
    // Claude Code sends `file_path` absolute, so the protected run must match at ANY offset.
    // Mutation caught: the offset-free descendant rule traded for an anchored one.
    expect(pathMatchesProtected('/home/u/proj/packages/core/dist/index.js', PROTECTED_DIR)).toBe(
      true,
    );
  });

  it('a relative parent operation still matches, and an unrelated namesake still does not', () => {
    // COVENANT-07's asymmetry, which took that ticket two review rounds: ancestor is
    // root-anchored, descendant is offset-free. Mutation caught: either direction widened
    // to the other's rule, which reopens `vendor/packages` over-blocking.
    expect(pathMatchesProtected('packages/core', PROTECTED_DIR)).toBe(true);
    expect(pathMatchesProtected('x/packages/core', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('vendor/packages', PROTECTED_DIR)).toBe(false);
  });

  it('the segment boundary stays exact', () => {
    // Mutation caught: prefix comparison creeping back in while the resolution pass is added.
    expect(pathMatchesProtected('packages/core/dist-generated/x.js', PROTECTED_DIR)).toBe(false);
  });
});

describe('pathMatchesProtected — the resolved pass adds interior "." and ".." (PRD §3.1)', () => {
  it('an interior "." no longer breaks the protected run', () => {
    // Measured bypass 1. Mutation caught: `.` left as an ordinary segment, which splits the
    // run so `echo x >> packages/core/./dist/index.js` reaches no judge at all.
    expect(pathMatchesProtected('packages/core/./dist/index.js', PROTECTED_DIR)).toBe(true);
  });

  it('an interior ".." cancels the segment before it', () => {
    // Measured bypass 2 — the `sed -i … packages/core/src/../dist/index.js` form. Mutation
    // caught: `..` dropped without cancelling, which leaves `src` wedged inside the run.
    expect(pathMatchesProtected('packages/core/src/../dist/index.js', PROTECTED_DIR)).toBe(true);
  });

  it('cancellation that lands mid-path and then descends again is resolved', () => {
    // The axis end the previous attempt missed: every fixture it wrote cancelled at the END
    // of a path, so `x/../packages` — same directory, cancelling prefix — silently stopped
    // matching. Mutation caught: resolution that only handles a trailing cancellation.
    expect(pathMatchesProtected('x/../packages', PROTECTED_DIR)).toBe(true);
    expect(pathMatchesProtected('tmp/../.claude/hooks', PROTECTED_HOOKS)).toBe(true);
  });

  it('a trailing ".." still names the protected path\'s parent', () => {
    // `rm -rf packages/core/dist/..` operates on the parent, which the ancestor rule blocks
    // today and must keep blocking.
    expect(pathMatchesProtected('packages/core/dist/..', PROTECTED_DIR)).toBe(true);
  });

  it('a ".." with nothing to cancel is kept, so a sibling path stays free', () => {
    // Mutation caught: dropping an uncancellable `..`, which collapses `../packages` into
    // `packages` and hands a sibling checkout this repository's protection. Both of these
    // are ordinary commands in a multi-checkout workspace.
    expect(pathMatchesProtected('../packages', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('../dist', PROTECTED_DIR)).toBe(false);
  });

  it('a bare ".." names nothing, so moving around the filesystem needs no waiver', () => {
    // `cd ..`, `git -C .. status`, `mv notes.md ..`. An earlier attempt treated a lone `..`
    // as an ancestor of everything and blocked all of them; the only valve is a human-typed
    // waiver, so an over-block here is a gate people learn to switch off.
    expect(pathMatchesProtected('..', PROTECTED_HOOKS)).toBe(false);
    expect(pathMatchesProtected('..', PROTECTED_FILE)).toBe(false);
    expect(pathMatchesProtected('../..', PROTECTED_DIR)).toBe(false);
  });
});

describe('pathMatchesProtected — undecidable notations are left alone on purpose (PRD §2-d)', () => {
  it('a glob is not read, whether or not it carries a literal', () => {
    // Expanding a glob needs the filesystem and this judge has none, so it does not guess.
    // Both ends of the axis are pinned because guessing in either direction was measured:
    // a literal-free `*` matched every protected path at once (blocking `ls`, `find`, and
    // markdown bullets), and an anchored guess still cannot tell `lefthook.y*` from a file
    // that does not exist. The Bash axis answers these as opaque tokens; making them
    // *audible* rather than silent is COVENANT-10b's skip registration.
    expect(pathMatchesProtected('*', PROTECTED_FILE)).toBe(false);
    expect(pathMatchesProtected('*.json', PROTECTED_FILE_ALT)).toBe(false);
    expect(pathMatchesProtected('lefthook.y*', PROTECTED_FILE)).toBe(false);
    expect(pathMatchesProtected('packages/*', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('packages/*/dist/index.js', PROTECTED_DIR)).toBe(false);
  });

  it('a variable expansion is not read either', () => {
    // Resolving `$PKG` needs the shell. Same disposition as the glob, and pinned next to it
    // so the two cannot drift into different answers for the same undecidability.
    expect(pathMatchesProtected('packages/$PKG/dist', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('$BUILD/dist', PROTECTED_DIR)).toBe(false);
  });

  it('a tilde is not expanded — the layer that knows the home directory registers it', () => {
    // The judge stays ignorant of the environment (§6), so `~` names nothing here. The
    // session transcript is still defended, because assembly knows the home directory and
    // registers the `~` spelling as its own protected path — a fact, not an inference.
    // Mutation caught: a home-directory guess reappearing in the predicate, which matched
    // `~/dist` against `packages/core/dist` when it was last tried.
    expect(pathMatchesProtected('~/dist', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('~/settings.json', '.claude/settings.json')).toBe(false);
    // …and the registered spelling matches by ordinary literal comparison.
    expect(
      pathMatchesProtected(
        '~/.claude/projects/-home-u-proj/x.jsonl',
        '~/.claude/projects/-home-u-proj/x.jsonl',
      ),
    ).toBe(true);
  });
});

describe('pathSegments — the degenerate contract self-mod depends on is unchanged', () => {
  it('keeps a lone "." as a segment and yields nothing for the empty shapes', () => {
    // COVENANT-09's evidence check reads this function to tell a path that names a file from
    // one that proves nothing, and its predicate is `.some(s => s !== '.')`. Mutation caught:
    // resolution moved into `pathSegments`, which would make `'.'` yield zero segments and
    // silently change a judgement two files away.
    expect(pathSegments('.')).toEqual(['.']);
    expect(pathSegments('')).toEqual([]);
    expect(pathSegments('/')).toEqual([]);
    expect(pathSegments('./')).toEqual([]);
  });

  it('a degenerate candidate matches no protected path', () => {
    expect(pathMatchesProtected('.', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('/', PROTECTED_DIR)).toBe(false);
  });
});

describe('mentionsPath — notation reaches the judges through real payload shapes', () => {
  it('an Edit payload carries its interior "." through the nested traversal', () => {
    // The tool axis delivers an ABSOLUTE file_path nested under args — the input shape whose
    // absence hid COVENANT-07's regression. Mutation caught: resolution applied at one caller
    // rather than in the shared primitive, leaving whichever consumer was not edited open.
    const args = inputWithArgs({
      file_path: '/home/u/proj/packages/core/./dist/index.js',
    }).toolCalls[0].args;

    expect(mentionsPath(args, PROTECTED_DIR)).toBe(true);
  });

  it('ordinary prose carrying a glob does not mention a protected path', () => {
    // The self-mod fallback branch scans a whole file body, so a markdown bullet list used to
    // block writes to unprotected files once a bare `*` was taught to match anything.
    const args = inputWithArgs({ command: 'echo "* item" >> notes.md' }).toolCalls[0].args;

    expect(mentionsPath(args, PROTECTED_HOOKS)).toBe(false);
  });
});

describe('mention.ts stays a zero-I/O pure function (PRD §6)', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/mention.ts', import.meta.url)),
    'utf-8',
  );

  it('reads a non-empty source — the gate cannot pass vacuously', () => {
    // A gate whose file moved reports zero violations forever, and the behavioural tests
    // above would stay green through that since they only observe the predicate's answers.
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain('export function pathMatchesProtected');
  });

  it('imports nothing and reads no ambient state', () => {
    // The tempting shortcut for `..` is `node:path`, and for `~` it is `node:os`. Both make
    // the predicate answer differently depending on where the process started, which no
    // behavioural assertion here can see — the session hook and the commit gate would then
    // disagree about the same command while every test stayed green.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/process\s*\./);
  });
});
