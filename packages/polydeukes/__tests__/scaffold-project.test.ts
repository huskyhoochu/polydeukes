import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
 * DIST-05 AC-5 — the `$schema` line the generated config opens with. The value is a
 * consumer-root-relative FILE path because `$schema` is a static string an editor reads;
 * a module specifier never reaches a resolver from there (DIST-05 §3-b).
 */
const SCHEMA_LINE =
  '# yaml-language-server: $schema=node_modules/polydeukes/dist/schema/polydeukes.schema.json';
/**
 * §3-d minimum protection set for a generated config — the gate definitions the session
 * layer creates. A generated list ships as a minimum a consumer adds to, so an entry
 * belongs here only when editing that path removes a judgment rather than failing one.
 */
const MINIMUM_PROTECTED_PATHS = ['.claude/hooks', '.claude/settings.json'];
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

describe('DIST-05 AC-5 — the generated config points an editor at the shipped schema', () => {
  /** The schema as the directive's own value spells it, relative to the config's directory. */
  function installSchemaBeside(root: string): void {
    const dir = join(root, 'node_modules', 'polydeukes', 'dist', 'schema');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'polydeukes.schema.json'), '{}\n');
  }

  it('opens with the exact yaml-language-server $schema line', () => {
    // Mutation caught: any spelling drift in the value — the `@polydeukes/core` path the
    // docs carried before this ticket, a module specifier (`polydeukes/schema.json`), an
    // absolute path, or a GitHub raw URL. Every one of those is still a plausible-looking
    // comment that yaml-language-server silently ignores or fails to fetch, so nothing in
    // the consumer's editor reports the mistake: validation just never happens. The line
    // must also be FIRST — the directive is only honored at the head of the document, so
    // a line pushed below a banner comment is inert in the same silent way.
    installSchemaBeside(projectRoot);
    scaffoldProject(projectRoot);

    expect(read(CONFIG_CANONICAL).split('\n')[0]).toBe(SCHEMA_LINE);
  });

  it('omits the line when the path it would name does not exist', () => {
    // An editor resolves a relative `$schema` against the CONFIG FILE's own directory, and
    // the config is written wherever this command was invoked — so a run inside a monorepo
    // sub-package, where the install hoisted to the workspace root, would name a path that
    // is not there. Mutation caught: the directive emitted unconditionally. That line reads
    // as working configuration, and the failure is silent on both ends — the editor reports
    // no error for an unresolvable schema, and the user does not audit a line the tool wrote
    // for them. Writing nothing leaves an absence they can see and fix.
    scaffoldProject(projectRoot);

    expect(read(CONFIG_CANONICAL)).not.toContain('yaml-language-server');
  });

  it('still generates a loadable config when the line is omitted', () => {
    // The omission is one comment line, not a different artifact: everything the scaffold
    // promises has to survive it. Mutation caught: the conditional dropping the header
    // comment block with the directive, or emitting a config whose first line is now blank.
    scaffoldProject(projectRoot);

    expect(() => loadConfig(projectRoot)).not.toThrow();
    expect(read(CONFIG_CANONICAL).split('\n')[0]).toMatch(/^# Polydeukes protection policy/);
  });

  it('still passes loadConfig with the $schema line present', () => {
    // DIST-05 §5 invariant 4, asserted rather than assumed: the line is a YAML comment and
    // the loader must not see it. Mutation caught: the line emitted as a document KEY
    // (`$schema: node_modules/...`) instead of a comment — the schema forbids unknown
    // top-level properties, so validation would reject the config the scaffold itself just
    // wrote, and the fail-closed session surface would block every call right after
    // install. The header-line assertion above passes for a mapping key too, since the
    // comment marker is one character.
    installSchemaBeside(projectRoot);
    scaffoldProject(projectRoot);

    expect(() => loadConfig(projectRoot)).not.toThrow();
    expect(loadConfig(projectRoot).config.protectedPaths).toEqual(
      expect.arrayContaining(MINIMUM_PROTECTED_PATHS),
    );
  });
});

describe('POSTURE-01 AC-7 / §4.5 — the generated config shows the promotion ladder as comments', () => {
  /** The three rungs the commented example must spell, in the generated text. */
  const LADDER_RUNGS = [
    '#     draft: true',
    '#     enforce: advise',
    '#     enforce: block',
  ] as const;

  it('carries all three rungs in the text while loadConfig sees no disciplines', () => {
    // The ladder is narrative, not policy: a consumer reads draft → advise → block in
    // place, and the loaded config still carries no judging entry (DIST-02 §3-d minimum
    // set). Mutation caught: the example omitted or trimmed to fewer rungs, or written
    // as a live `disciplines:` key — the generated config would then judge with entries
    // nobody chose, and an id-less example would fail validation and lock the session.
    scaffoldProject(projectRoot);

    const text = read(CONFIG_CANONICAL);
    for (const rung of LADDER_RUNGS) {
      expect(text, rung).toContain(rung);
    }
    const { config } = loadConfig(projectRoot);
    expect(config.disciplines).toBeUndefined();
  });

  it('loads as three distinct disciplines once the ladder is uncommented as instructed', () => {
    // "Uncomment to start" is a promise the generated text must keep: a consumer who
    // strips the comment markers gets a config that loads, not one that locks every call
    // at assembly (a duplicate id or a missing key throws before any verdict, and the
    // valve is never consulted). Mutation caught: two rungs sharing an id, a rung missing
    // `why`, or the block indented so it no longer parses as a `disciplines:` list.
    scaffoldProject(projectRoot);
    const text = read(CONFIG_CANONICAL);
    const start = text.indexOf('# disciplines:');
    const ladder = text
      .slice(start)
      .split('\n')
      .filter((line) => line.startsWith('#'))
      .map((line) => line.replace(/^# ?/, ''))
      .join('\n');
    writeFileSync(join(projectRoot, CONFIG_CANONICAL), `${text.slice(0, start)}${ladder}\n`);

    const { config } = loadConfig(projectRoot);

    // Resolution splits drafts from judged entries (CONFIG-10), so the three rungs land
    // as one draft plus two judged entries.
    expect(config.drafts?.map((entry) => entry.id)).toEqual(['no-todo-in-shipped-code-draft']);
    expect(config.disciplines?.map((entry) => entry.id)).toEqual([
      'no-todo-in-shipped-code',
      'no-todo-in-shipped-code-blocking',
    ]);
  });
});
