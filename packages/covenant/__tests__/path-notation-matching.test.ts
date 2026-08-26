import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mentionsPath, pathMatchesProtected, pathSegments } from '../src/mention.js';
import { inputWithArgs } from './helpers.js';

// Interior `.` and `..` are resolved as a UNION with the raw comparison, and every notation
// that cannot be resolved without running the shell or reading the disk is left undecidable on
// purpose. The fixtures are organised by the axes of that contract rather than by
// realistic-looking commands: every defect this predicate has shipped lived at an axis end no
// fixture had touched.
//
// Axes: where the dot sits (interior / trailing / nothing-to-cancel / cancels-past-root);
// which pass answers (raw / resolved); which direction (descendant / ancestor); how the
// candidate is rooted (relative / absolute); and whether the form is decidable at all.

const PROTECTED_DIR = 'packages/core/dist';
const PROTECTED_FILE = 'lefthook.yml';
const PROTECTED_FILE_ALT = 'biome.json';
const PROTECTED_HOOKS = '.claude/hooks';

describe('pathMatchesProtected — the raw pass still answers everything it used to', () => {
  it('a command that spells the protected path out loud is caught before any resolution', () => {
    // The load-bearing half of the union. `rm -rf .claude/hooks/../..` removes the whole
    // surface, and its RAW segments still contain the protected run, so it breaks with no rule
    // about roots or cancellation depth. Resolution that replaces the raw pass instead of
    // joining it turns a notation fix into a lost defence.
    expect(pathMatchesProtected('.claude/hooks/../..', PROTECTED_HOOKS)).toBe(true);
  });

  it('an ABSOLUTE candidate still matches a relative protected path', () => {
    // The tool axis sends `file_path` absolute, so the protected run must match at ANY offset:
    // an anchored descendant rule misses every one of them.
    expect(pathMatchesProtected('/home/u/proj/packages/core/dist/index.js', PROTECTED_DIR)).toBe(
      true,
    );
  });

  it('a relative parent operation still matches, and an unrelated namesake still does not', () => {
    // The asymmetry the two directions depend on: ancestor is root-anchored, descendant is
    // offset-free. Widening either to the other's rule over-blocks `vendor/packages`.
    expect(pathMatchesProtected('packages/core', PROTECTED_DIR)).toBe(true);
    expect(pathMatchesProtected('x/packages/core', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('vendor/packages', PROTECTED_DIR)).toBe(false);
  });

  it('the segment boundary stays exact', () => {
    // A prefix comparison creeping back in while the resolution pass is added matches this.
    expect(pathMatchesProtected('packages/core/dist-generated/x.js', PROTECTED_DIR)).toBe(false);
  });
});

describe('pathMatchesProtected — the resolved pass adds interior "." and ".."', () => {
  it('an interior "." no longer breaks the protected run', () => {
    // A measured bypass: leaving `.` an ordinary segment splits the run, so
    // `echo x >> packages/core/./dist/index.js` reaches no judge at all.
    expect(pathMatchesProtected('packages/core/./dist/index.js', PROTECTED_DIR)).toBe(true);
  });

  it('an interior ".." cancels the segment before it', () => {
    // A measured bypass, in the `sed -i … packages/core/src/../dist/index.js` form: dropping
    // `..` without cancelling leaves `src` wedged inside the run.
    expect(pathMatchesProtected('packages/core/src/../dist/index.js', PROTECTED_DIR)).toBe(true);
  });

  it('cancellation that lands mid-path and then descends again is resolved', () => {
    // A fixture set that only cancels at the END of a path leaves resolution that handles a
    // trailing cancellation alone looking correct, while `x/../packages` — the same directory
    // reached through a cancelling prefix — silently stops matching.
    expect(pathMatchesProtected('x/../packages', PROTECTED_DIR)).toBe(true);
    expect(pathMatchesProtected('tmp/../.claude/hooks', PROTECTED_HOOKS)).toBe(true);
  });

  it('a trailing ".." still names the protected path\'s parent', () => {
    // `rm -rf packages/core/dist/..` operates on the parent, which the ancestor rule blocks.
    expect(pathMatchesProtected('packages/core/dist/..', PROTECTED_DIR)).toBe(true);
  });

  it('a ".." with nothing to cancel is kept, so a sibling path stays free', () => {
    // Dropping an uncancellable `..` collapses `../packages` into `packages` and hands a
    // sibling checkout this repository's protection. Both spellings are ordinary commands in a
    // multi-checkout workspace.
    expect(pathMatchesProtected('../packages', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('../dist', PROTECTED_DIR)).toBe(false);
  });

  it('a bare ".." names nothing, so moving around the filesystem needs no witness', () => {
    // `cd ..`, `git -C .. status`, `mv notes.md ..`. Treating a lone `..` as an ancestor of
    // everything blocks all of them, and the only valve is a human-typed witness — an
    // over-block here is a gate people learn to switch off.
    expect(pathMatchesProtected('..', PROTECTED_HOOKS)).toBe(false);
    expect(pathMatchesProtected('..', PROTECTED_FILE)).toBe(false);
    expect(pathMatchesProtected('../..', PROTECTED_DIR)).toBe(false);
  });
});

describe('pathMatchesProtected — undecidable notations are left alone on purpose', () => {
  it('a glob is not read, whether or not it carries a literal', () => {
    // Expanding a glob needs the filesystem and this judge has none, so it does not guess.
    // Both ends are pinned because guessing in either direction was measured: a literal-free
    // `*` matched every protected path at once, blocking `ls`, `find` and markdown bullets,
    // while an anchored guess still cannot tell `lefthook.y*` from a file that does not exist.
    // The Bash axis answers these as opaque tokens and records them as skips.
    expect(pathMatchesProtected('*', PROTECTED_FILE)).toBe(false);
    expect(pathMatchesProtected('*.json', PROTECTED_FILE_ALT)).toBe(false);
    expect(pathMatchesProtected('lefthook.y*', PROTECTED_FILE)).toBe(false);
    expect(pathMatchesProtected('packages/*', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('packages/*/dist/index.js', PROTECTED_DIR)).toBe(false);
  });

  it('a variable expansion is not read either', () => {
    // Resolving `$PKG` needs the shell. Pinned next to the glob so the two cannot drift into
    // different answers for the same undecidability.
    expect(pathMatchesProtected('packages/$PKG/dist', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('$BUILD/dist', PROTECTED_DIR)).toBe(false);
  });

  it('a tilde is not expanded, so a home-relative path names nothing here', () => {
    // The judge stays ignorant of the environment: `~` is an ordinary segment and matches only
    // another `~`. A home-directory guess in this predicate matches `~/dist` against
    // `packages/core/dist`.
    //
    // The cost is that a home-relative spelling of any protected path is undefended here.
    // Registering the home-relative spellings was tried and withdrawn: a path deep under HOME
    // makes HOME a protected ancestor, which turns `echo $HOME` and any edit whose content
    // carries a bare `~` into blocks. The transcript judge owns the home spellings instead.
    expect(pathMatchesProtected('~/dist', PROTECTED_DIR)).toBe(false);
    expect(pathMatchesProtected('~/settings.json', '.claude/settings.json')).toBe(false);
    expect(
      pathMatchesProtected(
        '~/.claude/projects/-home-u-proj/x.jsonl',
        '/home/u/.claude/projects/-home-u-proj/x.jsonl',
      ),
    ).toBe(false);
  });
});

describe('pathSegments — the degenerate contract self-mod depends on is unchanged', () => {
  it('keeps a lone "." as a segment and yields nothing for the empty shapes', () => {
    // The self-mod evidence check reads this function to tell a path that names a file from
    // one that proves nothing, via `.some(s => s !== '.')`. Moving resolution into
    // `pathSegments` makes `'.'` yield zero segments and silently changes a judgment two
    // files away.
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
    // The tool axis delivers an ABSOLUTE file_path nested under args. Applying resolution at
    // one caller rather than in the shared primitive leaves whichever consumer was not edited
    // open.
    const args = inputWithArgs({
      file_path: '/home/u/proj/packages/core/./dist/index.js',
    }).toolCalls[0].args;

    expect(mentionsPath(args, PROTECTED_DIR)).toBe(true);
  });

  it('ordinary prose carrying a glob does not mention a protected path', () => {
    // The self-mod fallback branch scans a whole file body, so once a bare `*` matches
    // anything a markdown bullet list blocks writes to unprotected files.
    const args = inputWithArgs({ command: 'echo "* item" >> notes.md' }).toolCalls[0].args;

    expect(mentionsPath(args, PROTECTED_HOOKS)).toBe(false);
  });
});

describe('mention.ts stays a zero-I/O pure function', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/mention.ts', import.meta.url)),
    'utf-8',
  );

  it('reads a non-empty source — the gate cannot pass vacuously', () => {
    // A source-reading check whose file moved reports zero violations forever, and the
    // behavioural tests above stay green through that since they observe only answers.
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain('export function pathMatchesProtected');
  });

  it('imports nothing and reads no ambient state', () => {
    // The tempting shortcut for `..` is `node:path`, and for `~` it is `node:os`. Both make
    // the predicate answer differently depending on where the process started, which no
    // behavioural assertion can see: the two surfaces would disagree about the same command
    // while every test stayed green.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/process\s*\./);
  });
});
