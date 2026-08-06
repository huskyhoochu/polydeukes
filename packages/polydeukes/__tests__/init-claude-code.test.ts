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
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOPICS } from '../src/docs-query.ts';
// DIST-02 §3-a/§3-b/§3-g — the session-registration layer: preflight, then the shared
// scaffold (scaffold-project.test.ts owns that layer's own contract), then the generated
// hook and the .claude/settings.json merge.
//
// Contract asserted (the implementer matches this named export; NOT re-exported from the
// barrel — §5-d invariant 5, bin.ts reaches it directly):
//   initClaudeCode(spec: {
//     projectRoot: string;
//     resolvePolydeukes?: (projectRoot: string) => void;  // throws when unresolvable
//   }): { created: string[]; skipped: string[] }
//     - synchronous: nothing here spawns a judge; it proves resolution, writes files,
//       and reports them as projectRoot-relative paths (the §3-a stdout contract).
//     - resolvePolydeukes is the §3-g preflight seam. It is injectable because a fixture
//       tree cannot fake the install graph (foundation.dev-log.fixture-tree-cannot-fake-
//       the-install-graph); the DEFAULT resolver is still reachable from a fixture in the
//       failing direction, because `polydeukes` resolves from nowhere under tmpdir — the
//       no-seam case below leans on exactly that asymmetry. The default's succeeding
//       direction stays out of reach until DIST-03's clean-install measurement.
//     - a §3-g preflight failure AND an already-ambiguous config tree (§3-a third
//       disposition, AC-11) both throw BEFORE any write — zero files (§5-d invariant 2);
//       translating that into exit 2 plus the install message is the bin's job.
import { initClaudeCode } from '../src/init-claude-code.ts';

// ---------------------------------------------------------------------------
// Each test builds a throwaway projectRoot under tmpdir, so no protected path of THIS
// repository is ever targeted (§3-h: the installer never runs against this checkout).
// The generated-hook cases below judge the artifact's TEXT; spawning it against real
// payloads is AC-6's symlink-tree e2e, a later phase of this cycle.
// ---------------------------------------------------------------------------

/**
 * The five artifacts as projectRoot-relative paths — the report vocabulary: DIST-02
 * §3-a's four plus DOCS-02 §3-e's discovery file.
 */
const HOOK_REL = '.claude/hooks/covenant-pretooluse.mjs';
const SETTINGS_REL = '.claude/settings.json';
const CONFIG_REL = 'polydeukes.config.yaml';
const GITIGNORE_REL = '.gitignore';
const DISCOVERY_REL = '.claude/rules/polydeukes.md';
const ARTIFACTS = [HOOK_REL, SETTINGS_REL, CONFIG_REL, GITIGNORE_REL, DISCOVERY_REL];
/** The sibling config spelling used by the AC-11 already-ambiguous fixture. */
const CONFIG_YML_SIBLING = 'polydeukes.config.yml';
/** How OUR settings registration is recognized: its command names the delegator file. */
const HOOK_FILENAME = 'covenant-pretooluse.mjs';
/** A registration some other tool installed first — the merge must not disturb it. */
const FOREIGN_COMMAND = 'echo consumer-owned-pretooluse';
const FOREIGN_SETTINGS = {
  permissions: { allow: ['WebFetch'] },
  hooks: {
    PreToolUse: [{ matcher: 'WebFetch', hooks: [{ type: 'command', command: FOREIGN_COMMAND }] }],
  },
};

/** Preflight stub, success side — injected wherever the run must get past §3-g. */
const resolvesFine = (): void => undefined;
/**
 * Preflight stub, failure side. Its message deliberately does NOT name the package:
 * the AC-5 assertion below demands `polydeukes` in the thrown message, so it can only be
 * satisfied by an error the production code composed itself — never by echoing this stub.
 */
const resolutionFails = (): never => {
  throw new Error('resolution refused by fixture');
};

let projectRoot: string;

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf-8');
}

/**
 * The generated hook inherits the delegator's narrative comments (§3-b), and those
 * comments legitimately NAME what the code must never do — the delegator's own header
 * says `never process.cwd()` in prose — so every shape assertion below judges
 * comment-stripped text only. Good enough for an artifact this layer generates: no
 * string literal in the delegator carries comment markers.
 */
function executableText(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
}

type SettingsHook = { type?: string; command?: string };
type SettingsEntry = { matcher?: string; hooks?: SettingsHook[] };
type SettingsFile = { hooks?: { PreToolUse?: SettingsEntry[] } } & Record<string, unknown>;

function readSettings(): SettingsFile {
  return JSON.parse(read(SETTINGS_REL)) as SettingsFile;
}

/** The settings file as written, for cases where it may not parse into the merged shape. */
function readSettingsText(): string {
  return read(SETTINGS_REL);
}

/** PreToolUse command entries referencing the generated delegator, counted. */
function delegatorRegistrations(): number {
  return (readSettings().hooks?.PreToolUse ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .filter((hook) => hook.command?.includes(HOOK_FILENAME)).length;
}

/** PreToolUse command entries carrying the pre-existing foreign command, counted. */
function foreignRegistrations(): number {
  return (readSettings().hooks?.PreToolUse ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .filter((hook) => hook.command === FOREIGN_COMMAND).length;
}

/** The happy-path invocation — preflight injected as succeeding. */
function init(): { created: string[]; skipped: string[] } {
  return initClaudeCode({ projectRoot, resolvePolydeukes: resolvesFine });
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-init-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('DIST-02 §3-a / AC-1 initClaudeCode — absent-project creation', () => {
  it('creates all five artifacts on an empty tree and reports each as created', () => {
    // Mutation caught: any §3-a artifact dropped. No hook file = nothing ever judges; no
    // settings registration = the hook exists but never spawns (zero verdicts, zero
    // rows); no config = fail-closed blocks every call; no ignore line = every consumer
    // commits its telemetry; no discovery file = the query surface ships but no agent
    // ever learns to call it (DOCS-02 §3-e). The registration count pins that the
    // created settings file actually carries our entry, not an empty object that merely
    // exists.
    const result = init();

    for (const rel of ARTIFACTS) {
      expect(existsSync(join(projectRoot, rel)), rel).toBe(true);
    }
    expect(delegatorRegistrations()).toBe(1);
    expect([...result.created].sort()).toEqual([...ARTIFACTS].sort());
    expect(result.skipped).toEqual([]);
  });

  it('generates a hook that imports the polydeukes/claude-code subpath, never the barrel', () => {
    // Mutation caught: the generated import reverted to the package barrel — AC-7's
    // named mutant. Barrel re-exports are eager, so every consumer session call would
    // load the commit surface and the git adapter with it, and a workspace missing only
    // that dist would kill the session hook with no telemetry row (the DIST-01 §3-d
    // limit this subpath exists to close). The dynamic import() form is itself part of
    // the contract: a static import failure lands before any catch can answer.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(/import\(\s*['"]polydeukes\/claude-code['"]\s*\)/);
    expect(hook).not.toMatch(/import\(\s*['"]polydeukes['"]\s*\)/);
  });

  it('generates a hook that derives repoRoot from its own location, never process.cwd()', () => {
    // Mutation caught: a cwd-anchored repoRoot (§3-b). A hook is spawned with whatever
    // working directory the agent happened to hold, so a cwd anchor makes config
    // discovery and the protection list resolve against the WRONG tree — the project the
    // hook was installed to defend goes unjudged while some unrelated directory fails
    // closed. Both `'..', '..'` and `'../..'` spellings of the two-level ascent pass,
    // and the negative assertion sees comment-stripped text only: the inherited §3-b
    // narrative names process.cwd() in prose while forbidding it in code.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(/fileURLToPath\(import\.meta\.url\)/);
    expect(hook).toMatch(/(['"])\.\.\1,\s*(['"])\.\.\2|(['"])\.\.\/\.\.\3/);
    expect(hook).not.toMatch(/process\.cwd\(\)/);
  });

  it('generates a hook whose failure path exits 2 from a catch (fail-closed)', () => {
    // Mutation caught: the catch dropped, or its exit code changed. An unresolvable or
    // unbuilt package would then crash the hook with node's exit 1, which the session
    // host reads as NON-blocking — every call passes unjudged with no row, the cheapest
    // bypass there is. The anchor demands the syntactic form `catch (` on
    // comment-stripped text: a bare /catch/ was satisfiable by one narrative comment.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(/\bcatch\s*\(/);
    expect(hook).toMatch(/process\.exit\(2\)/);
  });
});

describe('DIST-02 §3-a / AC-2 non-destructive idempotence', () => {
  it('leaves all five artifacts byte-identical on a second run and reports zero created', () => {
    // Mutation caught: any writer that appends or rewrites on re-run — the likeliest
    // being the ignore line appended unconditionally, growing .gitignore by one line per
    // run. The skipped report is the other half of the §3-a stdout contract: a silent
    // skip leaves the user unable to tell an idempotent no-op from a run that failed.
    init();
    const snapshot = new Map(ARTIFACTS.map((rel) => [rel, read(rel)]));

    const second = init();

    for (const rel of ARTIFACTS) {
      expect(read(rel), rel).toBe(snapshot.get(rel));
    }
    expect(second.created).toEqual([]);
    expect([...second.skipped].sort()).toEqual([...ARTIFACTS].sort());
  });

  it('keeps a user-edited config intact across a re-run (edits are never reverted)', () => {
    // Mutation caught: initClaudeCode writing the config itself instead of delegating to
    // the shared layer's exists-check. A regenerator that emits identical bytes passes
    // the byte-identity case above, so this fixture deliberately diverges from generated
    // output — reverting it would reset a consumer's hand-tuned protection surface on
    // every re-run of the installer.
    init();
    const edited = '# narrowed by the consumer after install\n';
    writeFileSync(join(projectRoot, CONFIG_REL), edited);

    init();

    expect(read(CONFIG_REL)).toBe(edited);
  });

  it('leaves a pre-existing hook file untouched while still creating the other artifacts', () => {
    // Mutation caught: the hook regenerated over an existing file (§3-a row one — a
    // consumer's pinned or customized delegator silently replaced), or the whole init
    // early-returning on the first existing artifact, leaving the project registered but
    // configless — which fail-closed turns into a block on every call.
    const custom = '// consumer-customized delegator\n';
    mkdirSync(join(projectRoot, dirname(HOOK_REL)), { recursive: true });
    writeFileSync(join(projectRoot, HOOK_REL), custom);

    const result = init();

    expect(read(HOOK_REL)).toBe(custom);
    expect(result.skipped).toContain(HOOK_REL);
    expect(existsSync(join(projectRoot, CONFIG_REL))).toBe(true);
    expect(delegatorRegistrations()).toBe(1);
  });
});

describe('DIST-02 §3-a / AC-3 .claude/settings.json merge', () => {
  it('preserves existing registrations and unrelated keys while adding ours exactly once', () => {
    // Mutation caught: the settings file replaced instead of merged. A consumer's
    // pre-existing PreToolUse entries and permissions are live configuration — wholesale
    // replacement disarms every other tool they wired, the exact damage class an
    // installer for a protection product must never cause.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, SETTINGS_REL), JSON.stringify(FOREIGN_SETTINGS, null, 2));

    init();

    expect(foreignRegistrations()).toBe(1);
    expect(delegatorRegistrations()).toBe(1);
    expect(readSettings().permissions).toEqual(FOREIGN_SETTINGS.permissions);
  });

  it('grafts the PreToolUse registration into settings carrying no hooks key at all', () => {
    // The commonest real consumer state — settings.json exists for permissions alone —
    // and the third merge branch: the hooks/PreToolUse nesting must be CREATED here, not
    // found. Mutation caught: a merge that assumes the array already exists. Whether
    // that mutant crashes or silently no-ops, the hook file sits on disk but never
    // spawns — zero verdicts, zero telemetry rows — while the from-scratch branch and
    // the existing-array branch both stay green. The unrelated key must survive.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, SETTINGS_REL),
      JSON.stringify({ permissions: FOREIGN_SETTINGS.permissions }, null, 2),
    );

    init();

    expect(delegatorRegistrations()).toBe(1);
    expect(readSettings().permissions).toEqual(FOREIGN_SETTINGS.permissions);
  });

  it('adds no duplicate on a re-run against merged settings (same command string, zero additions)', () => {
    // Mutation caught: the absence check keyed on anything but the command string (§3-a:
    // "the same command string already present" is the skip condition). An identity- or
    // matcher-keyed check re-adds our entry on every run, and the session host then
    // spawns the judge twice per call — every verdict and telemetry row doubled.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, SETTINGS_REL), JSON.stringify(FOREIGN_SETTINGS, null, 2));
    init();
    const merged = read(SETTINGS_REL);

    init();

    expect(read(SETTINGS_REL)).toBe(merged);
    expect(delegatorRegistrations()).toBe(1);
    expect(foreignRegistrations()).toBe(1);
  });
});

describe('DIST-02 §3-g / AC-5 preflight — resolution proven before any write', () => {
  it('throws an error naming polydeukes and creates ZERO files when the injected resolver fails', () => {
    // Mutation caught: any write ordered before the preflight (§5-d invariant 2). A
    // partial tree is the worst failure shape — a generated hook whose import can never
    // resolve blocks every call through its own catch, with no config and no valve to
    // open: the npx-installed brick §3-g exists to prevent. The message must name the
    // package (the stub's own message deliberately does not) so the bin's exit-2 output
    // can tell the user what to install.
    expect(() => initClaudeCode({ projectRoot, resolvePolydeukes: resolutionFails })).toThrow(
      /polydeukes/,
    );

    expect(readdirSync(projectRoot)).toEqual([]);
  });

  it('throws and creates ZERO files with NO injected resolver on a tree where polydeukes cannot resolve', () => {
    // The ONE case that runs the DEFAULT preflight resolver — no stub. The seam-argument
    // pin below cannot kill the wrong-anchor mutant, because injecting a stub replaces
    // the very resolver under observation; this call can. Anchored at the TARGET root,
    // resolution walks the tmpdir's ancestors, finds no `polydeukes`, and throws before
    // any write. Anchored at the installer's own module, it finds THIS repository's
    // dogfooding install of `polydeukes` and succeeds — a no-throw here IS that mutant,
    // shipping the npx brick. Only the throwaway tree is in play: every write this
    // function makes is projectRoot-relative, and the preflight lands first.
    expect(() => initClaudeCode({ projectRoot })).toThrow(/polydeukes/);

    expect(readdirSync(projectRoot)).toEqual([]);
  });

  it('hands the injected preflight seam the TARGET project root, exactly once', () => {
    // Pins the seam's calling contract: whatever resolver a caller provides is consulted
    // about the TARGET root, once — an installer probing some other directory (its cwd,
    // its module dir) with the caller's resolver would report resolution state for the
    // wrong tree, and a double consultation would run the probe's side effects twice.
    // The wrong-ANCHOR mutant in the DEFAULT resolver is out of this case's reach
    // (injecting a stub replaces the resolver under observation) — the no-seam case
    // above owns that kill.
    const seen: string[] = [];
    initClaudeCode({
      projectRoot,
      resolvePolydeukes: (from) => {
        seen.push(from);
      },
    });

    expect(seen).toEqual([projectRoot]);
  });
});

describe('DIST-02 §3-a / AC-11 already-ambiguous tree — a precondition failure, not a merge', () => {
  it('throws naming the config collision and creates ZERO new files when two configs coexist', () => {
    // Mutation caught: the third §3-a disposition folded into the second — "two or more
    // exist" treated as "one exists, skip and proceed". This tree is already stopped
    // (loadConfig throws on ambiguity), and scaffolding it anyway wires a hook whose
    // every call fails closed: a brick with fresh wiring. The readdir pin also kills any
    // registration artifact written before the config disposition runs — same shape as a
    // §3-g failure: zero files, and a human deletes one config to reopen.
    writeFileSync(join(projectRoot, CONFIG_REL), 'languages: {}\n');
    writeFileSync(join(projectRoot, CONFIG_YML_SIBLING), 'languages: {}\n');

    expect(() => init()).toThrow(/polydeukes\.config/);

    expect(readdirSync(projectRoot).sort()).toEqual([CONFIG_REL, CONFIG_YML_SIBLING].sort());
  });
});

describe('DIST-02 §3-a — the run never reports success without the registration', () => {
  it('throws when the written settings file does not carry the registration', () => {
    // The one outcome this installer must never produce is a successful-looking run whose
    // judge never spawns. The merge can drop the entry without failing: a settings file
    // whose root is an array takes the assignment as a non-index property and
    // JSON.stringify discards it, so before the read-back this exited 0 and reported all
    // four artifacts created (PR #48 review).
    //
    // The fixture is one witness, not an enumeration — the assertion is on the code path
    // (every write is read back), so it holds for whatever else arrives without this suite
    // having to guess at malformed shapes. What is NOT claimed: that such a run leaves zero
    // files. The check fires after the scaffold and the hook are on disk, and a partial tree
    // is the accepted cost of keeping the question finite.
    mkdirSync(join(projectRoot, dirname(SETTINGS_REL)), { recursive: true });
    writeFileSync(join(projectRoot, SETTINGS_REL), '[]\n');

    expect(() => init()).toThrow(/registration/);

    expect(readSettingsText()).not.toContain(HOOK_FILENAME);
  });
});

describe('DIST-02 §3-g — preflight proves the subpath the generated hook imports', () => {
  /** A fake install of `polydeukes` whose manifest carries the given exports map. */
  function installFake(exports: unknown): void {
    const dir = join(projectRoot, 'node_modules', 'polydeukes');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{"name":"probe","private":true}\n');
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'polydeukes', version: '0.0.0', exports }, null, 2)}\n`,
    );
  }

  it('refuses an installed package that does not expose the session subpath', () => {
    // findPackageJSON locates a package but does not apply its exports map, so a version
    // predating the subpath passes a bare-name check while the generated hook's own import
    // fails on every call. That tree cannot be opened with the witness token either: the
    // assembly crash lands before any verdict, so the valve is never consulted.
    installFake({ '.': { import: './dist/index.js' } });

    expect(() => initClaudeCode({ projectRoot })).toThrow(/claude-code/);

    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(false);
    expect(existsSync(join(projectRoot, CONFIG_REL))).toBe(false);
  });

  it('refuses an installed package whose subpath target was never built', () => {
    installFake({ './claude-code': { import: './dist/claude-code-hook.js' } });

    expect(() => initClaudeCode({ projectRoot })).toThrow(/claude-code/);

    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(false);
  });
});

describe('DIST-02 §3-a — an unreadable settings file is a precondition failure', () => {
  it('throws naming the settings file and writes NOTHING when it cannot be parsed', () => {
    // Everything that can fail on READING is settled before anything is written (§5-d
    // invariant 2). Parsing settings inside the merge — after the config, the ignore line
    // and the hook are already on disk — leaves a tree that is wired but unregistered: the
    // delegator exists and the host was never told to spawn it, so every call goes
    // unjudged with no telemetry row. That is the defect class, and it looks to the
    // consumer like a run that got most of the way there.
    //
    // The settings file itself is never repaired or replaced: a hand-edited file carrying
    // a comment is a consumer artifact, and fixing it is their job (§3-a, the same rule
    // the unparseable-config case fixes one layer down).
    mkdirSync(join(projectRoot, dirname(SETTINGS_REL)), { recursive: true });
    const handEdited = '{ "hooks": { /* left mid-edit */ }\n';
    writeFileSync(join(projectRoot, SETTINGS_REL), handEdited);
    const before = readdirSync(projectRoot).sort();

    expect(() => init()).toThrow(/settings\.json/);

    expect(readdirSync(projectRoot).sort()).toEqual(before);
    expect(existsSync(join(projectRoot, CONFIG_REL))).toBe(false);
    expect(existsSync(join(projectRoot, GITIGNORE_REL))).toBe(false);
    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(false);
    expect(read(SETTINGS_REL)).toBe(handEdited);
  });
});

describe('DOCS-02 §3-e / AC-8 the discovery file — the fifth artifact', () => {
  it('writes a discovery file whose command forms match the shipped query surface', () => {
    // Mutation caught: the template instructing a form that does not exist — §3-e names
    // the cost: one failed call and the agent never asks again. `pdks docs` is the
    // §3-b spelling, and every §3-c topic name must appear as itself (word-boundary:
    // `install`, not merely inside `installation`) so a topic rename cannot leave the
    // file pointing at a query that exits 2.
    init();

    const discovery = read(DISCOVERY_REL);
    expect(discovery).toContain('pdks docs');
    for (const topic of TOPICS) {
      expect(discovery, topic).toMatch(new RegExp(`\\b${topic}\\b`));
    }
  });

  it('carries paths frontmatter so the file loads contextually, never resident', () => {
    // Mutation caught: the frontmatter block dropped. Without `paths` the host loads
    // the file into EVERY session — §3-e chose a scoped discipline file over the
    // consumer's resident instructions exactly to avoid that standing context cost.
    init();

    const discovery = read(DISCOVERY_REL);
    expect(discovery.startsWith('---\n')).toBe(true);
    expect(discovery).toMatch(/(^|\n)paths:/);
  });

  it('leaves a pre-existing discovery file untouched and reports it skipped', () => {
    // Mutation caught: the fifth writer regenerating over a consumer-edited file. The
    // byte-identity re-run case above only proves an IDENTICAL regeneration, so this
    // fixture diverges from generated output — an unconditional rewrite breaks here
    // (the invariant-5 shape the hook and config cases pin for their own artifacts).
    const custom = '# consumer-tuned discovery text\n';
    mkdirSync(join(projectRoot, dirname(DISCOVERY_REL)), { recursive: true });
    writeFileSync(join(projectRoot, DISCOVERY_REL), custom);

    const result = init();

    expect(read(DISCOVERY_REL)).toBe(custom);
    expect(result.skipped).toContain(DISCOVERY_REL);
    expect(result.created).toContain(HOOK_REL);
  });
});
