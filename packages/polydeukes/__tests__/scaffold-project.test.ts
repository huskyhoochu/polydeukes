import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// DIST-02 §3-i — the project-side scaffold layer, the half every distribution path shares
// (the plugin path of DIST-04 reuses this function and swaps only the registration layer).
//
// Contract asserted (the implementer matches this named export; it is reached directly,
// never through the barrel — the same convention as both composition roots):
//   scaffoldProject(projectRoot: string): { created: string[]; skipped: string[] }
//     - creates polydeukes.config.yaml and the .polydeukes/ .gitignore line, NOTHING
//       else: registration artifacts (hook file, .claude/settings.json) belong to the
//       session layer (§3-i), which is what lets DIST-04 reuse this function unchanged.
//     - never overwrites anything (§5-d invariant 1); created/skipped report per artifact
//       as projectRoot-relative paths (the bin prints them — the §3-a stdout contract).
//     - the config existence check looks at ALL THREE discovery candidates (§3-a):
//       creating the canonical name next to an existing sibling spelling would make
//       loadConfig throw on ambiguity, and the fail-closed session surface would then
//       block every call right after install. Existence is FILE PRESENCE, never parse
//       success (AC-11) — a broken config is the consumer's to fix, not ours to replace.
import { loadConfig } from '../src/load-config.ts';
import { scaffoldProject } from '../src/scaffold-project.ts';

// ---------------------------------------------------------------------------
// Each test builds a throwaway projectRoot under tmpdir, so no protected path of THIS
// repository is ever targeted (§3-h: the scaffold never runs against this checkout).
// ---------------------------------------------------------------------------

/** The canonical config name the scaffold creates, and the sibling spellings it honors. */
const CONFIG_CANONICAL = 'polydeukes.config.yaml';
const CONFIG_YML = 'polydeukes.config.yml';
const CONFIG_JSON = 'polydeukes.config.json';
/** The telemetry-directory ignore line (§3-a, carried over from core.prd.config-schema §4.3). */
const GITIGNORE_LINE = '.polydeukes/';
/**
 * §3-d minimum protection set for a generated config. The first three are the gate
 * definitions the session layer creates; the last two are the resolution-path entries
 * this ticket inherits — the generated hook resolves the judge by package NAME, so a
 * stub planted on Node's ancestor node_modules walk replaces the judge outright and
 * every call then passes with NO telemetry row at all (the defect class, blocker B7).
 *
 * `settings.local.json` earns its place by measurement, not symmetry: the host documents
 * `disableAllHooks` as settable there, and local settings override project ones, so one
 * line in a file nobody watched would switch the session surface off entirely.
 */
const MINIMUM_PROTECTED_PATHS = [
  '.claude/hooks',
  '.claude/settings.json',
  '.claude/settings.local.json',
  'node_modules',
  '.claude/node_modules',
];
/** A minimal valid sibling config — languages is the schema's only required key. */
const VALID_SIBLING_YML = [
  'languages:',
  '  typescript:',
  "    productionGlob: 'lib/**/*.ts'",
  "    testCmd: 'echo {scope}'",
  '',
].join('\n');
const VALID_SIBLING_JSON = JSON.stringify({
  languages: { typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' } },
});

let projectRoot: string;

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf-8');
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-scaffold-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('DIST-02 §3-i / AC-9 scaffoldProject — the shared project-side layer', () => {
  it('creates the canonical config and the .polydeukes/ ignore line on an empty tree, reporting both as created', () => {
    // Mutation caught: either shared artifact dropped (a consumer without a config fails
    // closed on every call; without the ignore line every consumer commits its own
    // telemetry), or the created report disagreeing with the disk — the bin prints this
    // report, and a report that lies leaves the user unable to tell a run from a no-op.
    const result = scaffoldProject(projectRoot);

    expect(existsSync(join(projectRoot, CONFIG_CANONICAL))).toBe(true);
    expect(read('.gitignore').split('\n')).toContain(GITIGNORE_LINE);
    expect([...result.created].sort()).toEqual(['.gitignore', CONFIG_CANONICAL].sort());
    expect(result.skipped).toEqual([]);
  });

  it('creates NO registration artifact — no hook file and no .claude/settings.json (AC-9)', () => {
    // Mutation caught: a registration output moved back into the shared layer — the
    // change AC-9 names as the reuse-voiding one. DIST-04 calls this function for a path
    // whose registration lives outside the project, so a hook file written here would
    // ship a second, unregistered delegator with every plugin install.
    scaffoldProject(projectRoot);

    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    expect(readdirSync(projectRoot).sort()).toEqual(['.gitignore', CONFIG_CANONICAL].sort());
  });
});

describe('DIST-02 §3-d/§3-e / AC-4 generated config — valid by construction', () => {
  it('passes loadConfig and carries the §3-d minimum protectedPaths', () => {
    // loadConfig throwing here is §5-b's worst case: the session surface is fail-closed,
    // so an invalid generated config blocks every call right after install. Mutation
    // caught: the languages placeholder dropped (validation rejects the config), or a
    // resolution-path entry missing — a stub on the node_modules walk then replaces the
    // judge and every call passes with no telemetry row (the defect class).
    scaffoldProject(projectRoot);

    const { config } = loadConfig(projectRoot);
    expect(config.protectedPaths).toEqual(expect.arrayContaining(MINIMUM_PROTECTED_PATHS));
  });

  it('carries a witness block — a valveless generated config makes the first block a lockout (§3-e)', () => {
    // The schema keeps witness optional, so the loadConfig pass above proves nothing
    // about it — this assertion is the only thing between a generated config and §3-e's
    // lockout: without the block no human can open ANY blocked verdict, and .claude/hooks
    // is on the protection list, so the first block would freeze the project for good.
    // Mutation caught: the witness block omitted from the generated config.
    scaffoldProject(projectRoot);

    const { config } = loadConfig(projectRoot);
    expect(config.witness).toBeDefined();
  });
});

describe('DIST-02 §3-a / AC-10 config existence looks at all three discovery candidates', () => {
  it('does not create the canonical name next to an existing .yml config', () => {
    // Mutation caught: the existence check narrowed to the canonical filename — AC-10's
    // named mutant. Writing .yaml next to a project's .yml makes loadConfig throw on
    // ambiguity, and the fail-closed session surface then blocks every call: the scaffold
    // itself would be what bricks the project. The ignore line must still land — the skip
    // is per artifact, never an early return on the first existing one.
    writeFileSync(join(projectRoot, CONFIG_YML), VALID_SIBLING_YML);

    scaffoldProject(projectRoot);

    expect(existsSync(join(projectRoot, CONFIG_CANONICAL))).toBe(false);
    expect(loadConfig(projectRoot).configPath).toBe(CONFIG_YML);
    expect(read('.gitignore').split('\n')).toContain(GITIGNORE_LINE);
  });

  it('does not create the canonical name next to an existing .json config', () => {
    // Mutation caught: the candidate set covering the two YAML spellings but not .json —
    // the loader's third discovery candidate. Same ambiguity brick as the .yml case, one
    // spelling over.
    writeFileSync(join(projectRoot, CONFIG_JSON), VALID_SIBLING_JSON);

    scaffoldProject(projectRoot);

    expect(existsSync(join(projectRoot, CONFIG_CANONICAL))).toBe(false);
    expect(loadConfig(projectRoot).configPath).toBe(CONFIG_JSON);
  });
});

describe('DIST-02 §5-d invariant 1 — nothing existing is ever overwritten', () => {
  it('leaves an existing canonical config byte-identical and reports it skipped', () => {
    // Mutation caught: the shared layer regenerating an existing config. A regenerator
    // that emits identical bytes would survive a second-run byte comparison, so this
    // fixture deliberately differs from anything the scaffold would generate — an
    // overwrite here is a consumer's hand-tuned protection surface silently reset.
    const userConfig = '# hand-tuned by the consumer — not scaffold output\n';
    writeFileSync(join(projectRoot, CONFIG_CANONICAL), userConfig);

    const result = scaffoldProject(projectRoot);

    expect(read(CONFIG_CANONICAL)).toBe(userConfig);
    expect(result.skipped).toContain(CONFIG_CANONICAL);
    expect(result.created).not.toContain(CONFIG_CANONICAL);
  });

  it('leaves an unparseable config untouched — existence is file presence, not parse success (AC-11)', () => {
    // Mutation caught: the existence check implemented as a parse (or loadConfig)
    // attempt — AC-11's named mutant. A broken config would read as "absent" and be
    // overwritten, destroying the very file the consumer was midway through fixing.
    // The hand-tuned case above cannot catch the parse-level variant (its comment-only
    // fixture parses cleanly and fails only validation), so this fixture must fail at
    // PARSE: an unclosed YAML flow sequence.
    const broken = 'languages: [never closed\n';
    writeFileSync(join(projectRoot, CONFIG_CANONICAL), broken);

    const result = scaffoldProject(projectRoot);

    expect(read(CONFIG_CANONICAL)).toBe(broken);
    expect(result.skipped).toContain(CONFIG_CANONICAL);
    expect(result.created).not.toContain(CONFIG_CANONICAL);
  });

  it('appends the ignore line to an existing .gitignore without touching its other lines', () => {
    // Mutation caught: .gitignore rewritten wholesale — every ignore entry the consumer
    // already relies on vanishes, and their build output turns trackable on the very next
    // status. Append is the contract; the original lines must survive alongside ours.
    writeFileSync(join(projectRoot, '.gitignore'), 'dist/\ncoverage/\n');

    scaffoldProject(projectRoot);

    const lines = read('.gitignore').split('\n');
    expect(lines).toContain('dist/');
    expect(lines).toContain('coverage/');
    expect(lines).toContain(GITIGNORE_LINE);
  });

  it('appends the exact line to a .gitignore ending without a newline and carrying only near-spellings', () => {
    // Two boundary axes in one fixture. One: the file ends WITHOUT a newline — a bare
    // append corrupts the consumer's last line into 'coverage/.polydeukes/', breaking
    // their entry while never forming ours. Two: presence checked by substring instead
    // of whole line — every near-spelling here (commented out, slashless, root-anchored,
    // deeper path) contains '.polydeukes' and three contain '.polydeukes/', so a
    // substring check skips the append and the real line never lands: every consumer
    // commits its own telemetry. The near-spellings must also survive verbatim.
    const nearMisses = [
      '# .polydeukes/ (commented out)',
      '.polydeukes',
      '/.polydeukes/',
      '.polydeukes/roi.log',
      'coverage/',
    ].join('\n'); // deliberately no trailing newline
    writeFileSync(join(projectRoot, '.gitignore'), nearMisses);

    scaffoldProject(projectRoot);

    const lines = read('.gitignore').split('\n');
    expect(lines).toContain(GITIGNORE_LINE);
    expect(lines).toContain('coverage/');
    expect(lines).toContain('/.polydeukes/');
    expect(lines).toContain('.polydeukes/roi.log');
  });
});
