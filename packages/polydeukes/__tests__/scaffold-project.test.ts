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
// The project-side scaffold layer, the half every distribution path shares. It creates the
// config and the telemetry ignore line and NOTHING else: registration artifacts belong to
// the session layer, which is what lets another distribution path reuse this function
// unchanged.
import { loadConfig } from '../src/load-config.ts';
import { scaffoldProject } from '../src/scaffold-project.ts';

// Each test builds a throwaway projectRoot under tmpdir, so no protected path of THIS
// repository is ever targeted — the scaffold never runs against this checkout.

/** The canonical config name the scaffold creates, and the sibling spellings it honors. */
const CONFIG_CANONICAL = 'polydeukes.config.yaml';
const CONFIG_YML = 'polydeukes.config.yml';
const CONFIG_JSON = 'polydeukes.config.json';
/** The telemetry-directory ignore line. */
const GITIGNORE_LINE = '.polydeukes/';
/**
 * The `$schema` line the generated config opens with. The value is a consumer-root-relative
 * FILE path because `$schema` is a static string an editor reads; a module specifier never
 * reaches a resolver from there.
 */
const SCHEMA_LINE =
  '# yaml-language-server: $schema=node_modules/polydeukes/dist/schema/polydeukes.schema.json';
/**
 * The minimum protection set for a generated config — the gate definitions the session
 * layer creates. A generated list ships as a minimum a consumer adds to, so an entry
 * belongs here only when editing that path removes a judgment rather than failing one.
 * `.grok/hooks` holds the Grok spawn registration; deleting it silences that host rather
 * than failing a call.
 */
const MINIMUM_PROTECTED_PATHS = ['.claude/hooks', '.claude/settings.json', '.grok/hooks'];
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

describe('scaffoldProject — the shared project-side layer', () => {
  it('creates the canonical config and the .polydeukes/ ignore line on an empty tree, reporting both as created', () => {
    // A consumer without a config fails closed on every call; without the ignore line
    // every consumer commits its own telemetry. The report must also agree with the disk —
    // the bin prints it, and a report that lies leaves the user unable to tell a run from
    // a no-op.
    const result = scaffoldProject(projectRoot);

    expect(existsSync(join(projectRoot, CONFIG_CANONICAL))).toBe(true);
    expect(read('.gitignore').split('\n')).toContain(GITIGNORE_LINE);
    expect([...result.created].sort()).toEqual(['.gitignore', CONFIG_CANONICAL].sort());
    expect(result.skipped).toEqual([]);
  });

  it('creates NO registration artifact — no hook file and no .claude/settings.json', () => {
    // A registration output moved back into this shared layer voids the reuse: another
    // distribution path calls this function for a case whose registration lives outside
    // the project, so a hook file written here would ship a second, unregistered
    // delegator with every install.
    scaffoldProject(projectRoot);

    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    expect(readdirSync(projectRoot).sort()).toEqual(['.gitignore', CONFIG_CANONICAL].sort());
  });
});

describe('generated config — valid by construction', () => {
  it('passes loadConfig and carries the minimum protectedPaths', () => {
    // loadConfig throwing here is the worst case: the session surface is fail-closed, so
    // an invalid generated config blocks every call right after install. Dropping the
    // languages placeholder makes validation reject the config; a missing resolution-path
    // entry lets a stub on the node_modules walk replace the judge, and every call then
    // passes with no telemetry row.
    scaffoldProject(projectRoot);

    const { config } = loadConfig({ rootDir: projectRoot });
    expect(config.protectedPaths).toEqual(expect.arrayContaining(MINIMUM_PROTECTED_PATHS));
  });

  it('carries a witness block — a valveless generated config makes the first block a lockout', () => {
    // The schema keeps witness optional, so the loadConfig pass above proves nothing about
    // it. Without the block no human can open ANY blocked verdict, and .claude/hooks is on
    // the protection list, so the first block would freeze the project for good.
    scaffoldProject(projectRoot);

    const { config } = loadConfig({ rootDir: projectRoot });
    expect(config.witness).toBeDefined();
  });
});

describe('config existence looks at all three discovery candidates', () => {
  it('does not create the canonical name next to an existing .yml config', () => {
    // An existence check narrowed to the canonical filename writes .yaml next to a
    // project's .yml, which makes loadConfig throw on ambiguity, and the fail-closed
    // session surface then blocks every call: the scaffold itself would be what stopped
    // the project. The ignore line must still land — the skip is per artifact, never an
    // early return on the first existing one.
    writeFileSync(join(projectRoot, CONFIG_YML), VALID_SIBLING_YML);

    scaffoldProject(projectRoot);

    expect(existsSync(join(projectRoot, CONFIG_CANONICAL))).toBe(false);
    expect(loadConfig({ rootDir: projectRoot }).configPath).toBe(CONFIG_YML);
    expect(read('.gitignore').split('\n')).toContain(GITIGNORE_LINE);
  });

  it('does not create the canonical name next to an existing .json config', () => {
    // A candidate set covering the two YAML spellings but not .json misses the loader's
    // third discovery candidate — the same ambiguity as the .yml case, one spelling
    // over.
    writeFileSync(join(projectRoot, CONFIG_JSON), VALID_SIBLING_JSON);

    scaffoldProject(projectRoot);

    expect(existsSync(join(projectRoot, CONFIG_CANONICAL))).toBe(false);
    expect(loadConfig({ rootDir: projectRoot }).configPath).toBe(CONFIG_JSON);
  });
});

describe('nothing existing is ever overwritten', () => {
  it('leaves an existing canonical config byte-identical and reports it skipped', () => {
    // A regenerator that emits identical bytes would survive a second-run byte
    // comparison, so this fixture deliberately differs from anything the scaffold would
    // generate. An overwrite here is a consumer's hand-tuned protection surface silently
    // reset.
    const userConfig = '# hand-tuned by the consumer — not scaffold output\n';
    writeFileSync(join(projectRoot, CONFIG_CANONICAL), userConfig);

    const result = scaffoldProject(projectRoot);

    expect(read(CONFIG_CANONICAL)).toBe(userConfig);
    expect(result.skipped).toContain(CONFIG_CANONICAL);
    expect(result.created).not.toContain(CONFIG_CANONICAL);
  });

  it('leaves an unparseable config untouched — existence is file presence, not parse success', () => {
    // An existence check implemented as a parse or loadConfig attempt reads a broken
    // config as "absent" and overwrites it, destroying the very file the consumer was
    // midway through fixing. The hand-tuned case above cannot catch that variant — its
    // comment-only fixture parses cleanly and fails only validation — so this fixture must
    // fail at PARSE: an unclosed YAML flow sequence.
    const broken = 'languages: [never closed\n';
    writeFileSync(join(projectRoot, CONFIG_CANONICAL), broken);

    const result = scaffoldProject(projectRoot);

    expect(read(CONFIG_CANONICAL)).toBe(broken);
    expect(result.skipped).toContain(CONFIG_CANONICAL);
    expect(result.created).not.toContain(CONFIG_CANONICAL);
  });

  it('appends the ignore line to an existing .gitignore without touching its other lines', () => {
    // A .gitignore rewritten wholesale loses every entry the consumer already relies on,
    // and their build output turns trackable on the very next status. Append is the
    // contract; the original lines must survive alongside ours.
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

describe('the generated config points an editor at the shipped schema', () => {
  /** The schema as the directive's own value spells it, relative to the config's directory. */
  function installSchemaBeside(root: string): void {
    const dir = join(root, 'node_modules', 'polydeukes', 'dist', 'schema');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'polydeukes.schema.json'), '{}\n');
  }

  it('opens with the exact yaml-language-server $schema line', () => {
    // Any spelling drift in the value — a module specifier, an absolute path, a raw URL —
    // is still a plausible-looking comment that yaml-language-server silently ignores or
    // fails to fetch, so nothing in the consumer's editor reports the mistake: validation
    // just never happens. The line must also be FIRST: the directive is only honored at
    // the head of the document, so a line pushed below a banner comment is inert in the
    // same silent way.
    installSchemaBeside(projectRoot);
    scaffoldProject(projectRoot);

    expect(read(CONFIG_CANONICAL).split('\n')[0]).toBe(SCHEMA_LINE);
  });

  it('omits the line when the path it would name does not exist', () => {
    // An editor resolves a relative `$schema` against the CONFIG FILE's own directory, and
    // the config is written wherever this command was invoked — so a run inside a monorepo
    // sub-package, where the install hoisted to the workspace root, would name a path that
    // is not there. A directive emitted unconditionally reads as working configuration, and
    // the failure is silent on both ends: the editor reports no error for an unresolvable
    // schema, and the user does not audit a line the tool wrote for them. Writing nothing
    // leaves an absence they can see and fix.
    scaffoldProject(projectRoot);

    expect(read(CONFIG_CANONICAL)).not.toContain('yaml-language-server');
  });

  it('still generates a loadable config when the line is omitted', () => {
    // The omission is one comment line, not a different artifact: everything the scaffold
    // promises has to survive it, with no dropped header block and no leading blank line.
    scaffoldProject(projectRoot);

    expect(() => loadConfig({ rootDir: projectRoot })).not.toThrow();
    expect(read(CONFIG_CANONICAL).split('\n')[0]).toMatch(/^# Polydeukes protection policy/);
  });

  it('still passes loadConfig with the $schema line present', () => {
    // Asserted rather than assumed: the line is a YAML comment and the loader must not see
    // it. Emitted as a document KEY instead, it would hit the schema's ban on unknown
    // top-level properties, so validation would reject the config the scaffold itself just
    // wrote and the fail-closed session surface would block every call right after install.
    // The header-line assertion above passes for a mapping key too, since the comment
    // marker is one character.
    installSchemaBeside(projectRoot);
    scaffoldProject(projectRoot);

    expect(() => loadConfig({ rootDir: projectRoot })).not.toThrow();
    expect(loadConfig({ rootDir: projectRoot }).config.protectedPaths).toEqual(
      expect.arrayContaining(MINIMUM_PROTECTED_PATHS),
    );
  });
});

describe('the generated config shows the promotion ladder as comments', () => {
  /** The three rungs the commented example must spell, in the generated text. */
  const LADDER_RUNGS = [
    '#     draft: true',
    '#     enforce: advise',
    '#     enforce: block',
  ] as const;

  it('carries all three rungs in the text while loadConfig sees no disciplines', () => {
    // The ladder is narrative, not policy: a consumer reads draft, advise, block in place,
    // and the loaded config still carries no judging entry. Written as a live
    // `disciplines:` key instead, the generated config would judge with entries nobody
    // chose, and an id-less example would fail validation and lock the session.
    scaffoldProject(projectRoot);

    const text = read(CONFIG_CANONICAL);
    for (const rung of LADDER_RUNGS) {
      expect(text, rung).toContain(rung);
    }
    const { config } = loadConfig({ rootDir: projectRoot });
    expect(config.disciplines).toBeUndefined();
  });

  it('loads as three distinct disciplines once the ladder is uncommented as instructed', () => {
    // "Uncomment to start" is a promise the generated text must keep: a consumer who
    // strips the comment markers gets a config that loads, not one that locks every call
    // at assembly. A duplicate id, a rung missing `why`, or a block indented so it no
    // longer parses as a `disciplines:` list throws before any verdict, and the witness
    // valve is never consulted.
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

    const { config } = loadConfig({ rootDir: projectRoot });

    // Resolution splits drafts from judged entries, so the three rungs land as one draft
    // plus two judged entries.
    expect(config.drafts?.map((entry) => entry.id)).toEqual(['no-todo-in-shipped-code-draft']);
    expect(config.disciplines?.map((entry) => entry.id)).toEqual([
      'no-todo-in-shipped-code',
      'no-todo-in-shipped-code-blocking',
    ]);
  });
});
