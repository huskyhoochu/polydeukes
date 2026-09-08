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
import { dirname, join, resolve } from 'node:path';
import { MECHANISM_NAMES, MECHANISM_SHAPES } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compileDeclaration,
  judgeDeclaration,
  type World,
} from '../../polydeukes/src/covenant/declaration-engine.ts';
import { loadConfig } from '../../polydeukes/src/load-config.ts';
import type { InitClaudeCodeSpec } from '../src/init.ts';
// The Claude Code installer: preflight, then the umbrella's agent-neutral scaffold spawned
// as `pdks init`, then the four registration artifacts — the delegator, the settings merge,
// the discovery file, the classification skill. Nothing here spawns a judge.
//
// Two seams. `resolvePolydeukes` is the preflight: injectable because a fixture tree cannot
// fake the install graph, while the DEFAULT resolver is still reachable in the FAILING
// direction, since `polydeukes` resolves from nowhere under tmpdir. `spawnScaffold` is the
// `pdks init` spawn: injected so no case here depends on a built umbrella; what it is handed
// and when it is called are the assertions.
import { initClaudeCode } from '../src/init.ts';

// Each test builds a throwaway projectRoot under tmpdir, so no protected path of THIS
// repository is ever targeted. The generated-artifact cases judge TEXT; spawning the
// delegator against real payloads is the symlink-tree e2e's job.

/** The generated artifacts as projectRoot-relative paths — the report vocabulary. */
const HOOK_REL = '.claude/hooks/covenant-pretooluse.mjs';
const SETTINGS_REL = '.claude/settings.json';
const DISCOVERY_REL = '.claude/rules/polydeukes.md';
const SKILL_REL = '.claude/skills/discipline-draft/SKILL.md';
const ARTIFACTS = [HOOK_REL, SETTINGS_REL, DISCOVERY_REL, SKILL_REL];
/** How OUR settings registration is recognized: its command names the delegator file. */
const HOOK_FILENAME = 'covenant-pretooluse.mjs';
/** The command string the settings entry must carry — the host substitutes the variable. */
const HOOK_COMMAND = `node "$CLAUDE_PROJECT_DIR"/${HOOK_REL}`;
/** The package the delegator loads `runHook` from. */
const ADAPTER_SPECIFIER = '@polydeukes/adapter-claude-code';
/** A registration some other tool installed first — the merge must not disturb it. */
const FOREIGN_COMMAND = 'echo consumer-owned-pretooluse';
const FOREIGN_SETTINGS = {
  permissions: { allow: ['WebFetch'] },
  hooks: {
    PreToolUse: [{ matcher: 'WebFetch', hooks: [{ type: 'command', command: FOREIGN_COMMAND }] }],
  },
};
/** The umbrella sources whose literals the generated discovery file must agree with. */
const UMBRELLA_SRC = resolve(import.meta.dirname, '../../polydeukes/src');

/** Preflight stub, success side — injected wherever the run must get past preflight. */
const resolvesFine = (): string => '/vouched/polydeukes/dist/bin.js';
/**
 * Preflight stub, failure side. Its message deliberately does NOT name the package: the
 * assertion below demands `polydeukes` in the thrown message, so it can only be satisfied
 * by an error the production code composed itself — never by echoing this stub.
 */
const resolutionFails = (): never => {
  throw new Error('resolution refused by fixture');
};

type ScaffoldCall = { command: string; args: string[]; cwd: string; treeAtCall: string[] };

let projectRoot: string;
let scaffoldCalls: ScaffoldCall[];

/** A recording scaffold seam answering `status`, noting what the tree held when it ran. */
function scaffoldAnswering(
  status: number | null,
): NonNullable<InitClaudeCodeSpec['spawnScaffold']> {
  return (spec) => {
    scaffoldCalls.push({
      command: spec.command,
      args: [...spec.args],
      cwd: spec.cwd,
      treeAtCall: readdirSync(projectRoot).sort(),
    });
    return { status };
  };
}

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf-8');
}

/**
 * The generated delegator's comments legitimately NAME what its code must never do, so every
 * shape assertion below judges comment-stripped text only. No string literal in the
 * delegator carries comment markers.
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

/** PreToolUse command entries referencing the generated delegator. */
function delegatorHooks(): SettingsHook[] {
  return (readSettings().hooks?.PreToolUse ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .filter((hook) => hook.command?.includes(HOOK_FILENAME));
}

/** The matcher this installer registered on its own delegator entry. */
function delegatorMatcher(): string | undefined {
  return (readSettings().hooks?.PreToolUse ?? []).find((entry) =>
    (entry.hooks ?? []).some((hook) => hook.command?.includes(HOOK_FILENAME)),
  )?.matcher;
}

/** PreToolUse command entries carrying the pre-existing foreign command, counted. */
function foreignRegistrations(): number {
  return (readSettings().hooks?.PreToolUse ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .filter((hook) => hook.command === FOREIGN_COMMAND).length;
}

/** The happy-path invocation — preflight injected as succeeding, scaffold answering 0. */
function init(): { created: string[]; skipped: string[] } {
  return initClaudeCode({
    projectRoot,
    resolvePolydeukes: resolvesFine,
    spawnScaffold: scaffoldAnswering(0),
  });
}

/** The literal members of an `as const` string tuple in an umbrella source file. */
function tupleLiterals(file: string, constName: string): string[] {
  const src = readFileSync(join(UMBRELLA_SRC, file), 'utf-8');
  const match = src.match(new RegExp(`${constName}\\s*=\\s*\\[([^\\]]*)\\]\\s*as const`));
  if (!match) throw new Error(`${constName} tuple not found in ${file}`);
  const members = [...(match[1] as string).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  if (members.length === 0) throw new Error(`${constName} tuple in ${file} is empty`);
  return members;
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-adapter-init-'));
  scaffoldCalls = [];
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('initClaudeCode — absent-project creation', () => {
  it('creates the four registration artifacts on an empty tree and reports each as created', () => {
    // Each artifact answers for a different failure: no delegator and nothing ever judges;
    // no settings registration and the delegator exists but never spawns; no discovery file
    // and the query surface ships with no agent ever learning to call it; no classification
    // skill and a problem description has no path into the config. The registration count
    // pins that the created settings file actually carries our entry.
    const result = init();

    for (const rel of ARTIFACTS) {
      expect(existsSync(join(projectRoot, rel)), rel).toBe(true);
    }
    expect(delegatorHooks()).toHaveLength(1);
    expect([...result.created].sort()).toEqual([...ARTIFACTS].sort());
    expect(result.skipped).toEqual([]);
  });

  it('registers the delegator under the exact command string and a matcher naming the mutating and shell tools', () => {
    // The host spawns exactly the string written here; a path spelled without the project
    // variable runs from whatever cwd the host holds. A matcher missing a tool name leaves
    // that tool judged by nobody, silently.
    init();

    expect(delegatorHooks()).toEqual([{ type: 'command', command: HOOK_COMMAND }]);
    const matcher = delegatorMatcher() ?? '';
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']) {
      expect(matcher.split('|'), tool).toContain(tool);
    }
  });
});

describe('the scaffold spawn — `pdks init` runs first, in the project', () => {
  it('spawns the scaffold exactly once, with node, args ending in `init`, cwd = projectRoot, before any write', () => {
    // The umbrella writes the config where it is invoked, so a cwd anywhere but the target
    // scaffolds some other directory; a spawn ordered after the artifacts leaves a
    // registered delegator behind when the scaffold refuses.
    init();

    expect(scaffoldCalls).toHaveLength(1);
    const call = scaffoldCalls[0] as ScaffoldCall;
    expect(call.command).toBe(process.execPath);
    expect(call.args.at(-1)).toBe('init');
    expect(call.args.at(-2)).toMatch(/bin\.js$/);
    expect(call.cwd).toBe(projectRoot);
    expect(call.treeAtCall).toEqual([]);
  });

  it('aborts with zero files when the scaffold exits 2', () => {
    // The umbrella exits 2 on an already-ambiguous config tree, and adding registration
    // artifacts to it wires a judge whose every call fails closed. Zero files is the
    // contract: a human deletes one config and re-runs.
    expect(() =>
      initClaudeCode({
        projectRoot,
        resolvePolydeukes: resolvesFine,
        spawnScaffold: scaffoldAnswering(2),
      }),
    ).toThrow();

    expect(readdirSync(projectRoot)).toEqual([]);
  });

  it('aborts with zero files when the scaffold crashes rather than exits', () => {
    // A status of 1 or null is not a scaffold that ran. Testing `status === 2` alone
    // registers the delegator in a tree with no config, which then blocks every call.
    expect(() =>
      initClaudeCode({
        projectRoot,
        resolvePolydeukes: resolvesFine,
        spawnScaffold: scaffoldAnswering(1),
      }),
    ).toThrow();

    expect(readdirSync(projectRoot)).toEqual([]);
  });
});

describe('the generated delegator', () => {
  it('imports this package dynamically and calls runHook — never the umbrella session subpath', () => {
    // The judge is reached through this package's `runHook`, which spawns `pdks`; a
    // delegator importing `polydeukes/claude-code` keeps the consumer on the in-process
    // path this installer exists to replace. The dynamic import() form is itself part of
    // the contract: a static import failure lands before any catch can answer.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(new RegExp(`import\\(\\s*['"]${ADAPTER_SPECIFIER}['"]\\s*\\)`));
    expect(hook).toMatch(/\brunHook\s*\(\s*\{\s*repoRoot\s*\}\s*\)/);
    expect(hook).not.toContain('polydeukes/claude-code');
    expect(hook).not.toContain('runClaudeCodeHook');
  });

  it('derives repoRoot from its own location, never process.cwd()', () => {
    // A hook is spawned with whatever working directory the agent happened to hold, so a
    // cwd-anchored repoRoot makes config discovery and the `polydeukes` lookup resolve
    // against the WRONG tree. Both `'..', '..'` and `'../..'` spellings of the two-level
    // ascent pass.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(/fileURLToPath\(import\.meta\.url\)/);
    expect(hook).toMatch(/(['"])\.\.\1,\s*(['"])\.\.\2|(['"])\.\.\/\.\.\3/);
    expect(hook).not.toMatch(/process\.cwd\(\)/);
  });

  it('settles exit code 2 from a catch and never calls process.exit()', () => {
    // Without the catch an unresolvable or unbuilt package crashes the hook at node's exit
    // 1, which the session host reads as NON-blocking. The code is ASSIGNED rather than
    // passed to process.exit(), so a buffered stderr write is never preempted.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(/\bcatch\s*\(/);
    expect(hook).toMatch(/process\.exitCode\s*=\s*2/);
    expect(hook).not.toMatch(/process\.exit\(/);
  });
});

describe('non-destructive idempotence', () => {
  it('leaves all four artifacts byte-identical on a second run, reports zero created, and spawns the scaffold again', () => {
    // Any writer that rewrites on re-run breaks here. The skipped report is the other half
    // of the stdout contract: a silent skip leaves the user unable to tell an idempotent
    // no-op from a run that failed. The scaffold's own idempotence is the umbrella's, so
    // the re-run must still spawn it rather than guess that it already ran.
    init();
    const snapshot = new Map(ARTIFACTS.map((rel) => [rel, read(rel)]));

    const second = init();

    for (const rel of ARTIFACTS) {
      expect(read(rel), rel).toBe(snapshot.get(rel));
    }
    expect(second.created).toEqual([]);
    expect([...second.skipped].sort()).toEqual([...ARTIFACTS].sort());
    expect(scaffoldCalls).toHaveLength(2);
  });

  it('leaves a pre-existing delegator untouched while still creating the other artifacts', () => {
    // A delegator regenerated over an existing file silently replaces a consumer's pinned
    // or customized one; an init early-returning on the first existing artifact leaves the
    // project unregistered.
    const custom = '// consumer-customized delegator\n';
    mkdirSync(join(projectRoot, dirname(HOOK_REL)), { recursive: true });
    writeFileSync(join(projectRoot, HOOK_REL), custom);

    const result = init();

    expect(read(HOOK_REL)).toBe(custom);
    expect(result.skipped).toContain(HOOK_REL);
    expect(delegatorHooks()).toHaveLength(1);
    expect(existsSync(join(projectRoot, SKILL_REL))).toBe(true);
  });
});

describe('.claude/settings.json merge', () => {
  it('preserves existing registrations and unrelated keys while adding ours exactly once', () => {
    // A consumer's pre-existing PreToolUse entries and permissions are live configuration,
    // so replacing the settings file instead of merging disarms every other tool they
    // wired.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, SETTINGS_REL), JSON.stringify(FOREIGN_SETTINGS, null, 2));

    init();

    expect(foreignRegistrations()).toBe(1);
    expect(delegatorHooks()).toHaveLength(1);
    expect(readSettings().permissions).toEqual(FOREIGN_SETTINGS.permissions);
  });

  it('grafts the PreToolUse registration into settings carrying no hooks key at all', () => {
    // The commonest real consumer state — settings.json exists for permissions alone. A
    // merge assuming the array already exists either crashes or silently no-ops, and either
    // way the delegator sits on disk but never spawns.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(projectRoot, SETTINGS_REL),
      JSON.stringify({ permissions: FOREIGN_SETTINGS.permissions }, null, 2),
    );

    init();

    expect(delegatorHooks()).toHaveLength(1);
    expect(readSettings().permissions).toEqual(FOREIGN_SETTINGS.permissions);
  });

  it('adds no duplicate on a re-run against merged settings (same command string, zero additions)', () => {
    // The skip condition is the same command string already being present. An absence check
    // keyed on anything else re-adds our entry on every run, and the host then spawns the
    // judge twice per call.
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(projectRoot, SETTINGS_REL), JSON.stringify(FOREIGN_SETTINGS, null, 2));
    init();
    const merged = read(SETTINGS_REL);

    init();

    expect(read(SETTINGS_REL)).toBe(merged);
    expect(delegatorHooks()).toHaveLength(1);
    expect(foreignRegistrations()).toBe(1);
  });
});

describe('preflight — resolution proven before any write or spawn', () => {
  it('throws an error naming polydeukes, spawns nothing, and creates ZERO files when the injected resolver fails', () => {
    // Any write or spawn ordered before the preflight leaves a partial tree: a generated
    // delegator whose import can never resolve blocks every call through its own catch. The
    // message must name the package — the stub's own message deliberately does not.
    expect(() =>
      initClaudeCode({
        projectRoot,
        resolvePolydeukes: resolutionFails,
        spawnScaffold: scaffoldAnswering(0),
      }),
    ).toThrow(/polydeukes/);

    expect(readdirSync(projectRoot)).toEqual([]);
    expect(scaffoldCalls).toEqual([]);
  });

  it('throws and creates ZERO files with NO injected resolver on a tree where polydeukes cannot resolve', () => {
    // The ONE case that runs the DEFAULT preflight resolver. Anchored at the TARGET root,
    // resolution walks the tmpdir's ancestors, finds no `polydeukes`, and throws before any
    // write. Anchored at the installer's own module, it would find THIS repository's own
    // install and succeed — a no-throw here IS that failure.
    expect(() => initClaudeCode({ projectRoot, spawnScaffold: scaffoldAnswering(0) })).toThrow(
      /polydeukes/,
    );

    expect(readdirSync(projectRoot)).toEqual([]);
    expect(scaffoldCalls).toEqual([]);
  });

  it('hands the injected preflight seam the TARGET project root, exactly once', () => {
    // Whatever resolver a caller provides is consulted about the TARGET root, once. An
    // installer probing some other directory with the caller's resolver would report
    // resolution state for the wrong tree.
    const seen: string[] = [];
    initClaudeCode({
      projectRoot,
      resolvePolydeukes: (from) => {
        seen.push(from);
        return resolvesFine();
      },
      spawnScaffold: scaffoldAnswering(0),
    });

    expect(seen).toEqual([projectRoot]);
  });
});

describe('a settings file whose root is not an object is a precondition failure', () => {
  it.each([
    ['an array', '[]\n'],
    ['null', 'null\n'],
  ])(
    'refuses %s before the scaffold and leaves the file and the tree untouched',
    (_shape, content) => {
      // An array root takes the merge's assignment as a non-index property that
      // JSON.stringify discards; a null root throws inside the merge. Either failure after the
      // scaffold spawn would leave the config, an orphan delegator, and an overwritten settings
      // file behind — so the shape is refused where the file is read.
      mkdirSync(join(projectRoot, dirname(SETTINGS_REL)), { recursive: true });
      writeFileSync(join(projectRoot, SETTINGS_REL), content);

      expect(() => init()).toThrow(/settings\.json/);

      expect(read(SETTINGS_REL)).toBe(content);
      expect(readdirSync(projectRoot)).toEqual(['.claude']);
      expect(scaffoldCalls).toEqual([]);
    },
  );
});

describe('an unreadable settings file is a precondition failure', () => {
  it('throws naming the settings file and writes none of the four artifacts when it cannot be parsed', () => {
    // Parsing settings inside the merge — after the delegator is already on disk — leaves
    // a tree that is wired but unregistered: every call goes unjudged with no telemetry row.
    // The settings file itself is never repaired or replaced: a hand-edited file carrying a
    // comment is a consumer artifact, and fixing it is their job.
    mkdirSync(join(projectRoot, dirname(SETTINGS_REL)), { recursive: true });
    const handEdited = '{ "hooks": { /* left mid-edit */ }\n';
    writeFileSync(join(projectRoot, SETTINGS_REL), handEdited);

    expect(() => init()).toThrow(/settings\.json/);

    for (const rel of [HOOK_REL, DISCOVERY_REL, SKILL_REL]) {
      expect(existsSync(join(projectRoot, rel)), rel).toBe(false);
    }
    expect(read(SETTINGS_REL)).toBe(handEdited);
  });
});

describe('the discovery file — literals that must agree with the umbrella', () => {
  it('names every shipped docs topic as a `pdks docs <topic>` form', () => {
    // The topic names are literals in this package; the query surface that answers them is
    // the umbrella's. A template instructing a form that does not exist costs one failed
    // call, after which the agent never asks again — so each umbrella topic must appear as
    // itself, word-boundary, and a rename on either side goes red here.
    init();

    const discovery = read(DISCOVERY_REL);
    const taught = [...discovery.matchAll(/`pdks docs ([a-z]+)`/g)].map((m) => m[1] as string);
    expect([...new Set(taught)].sort()).toEqual(
      [...tupleLiterals('docs-types.ts', 'DOCS_TOPICS')].sort(),
    );
  });

  it('lists every config filename the umbrella discovers in its paths frontmatter', () => {
    // The file loads when a config is in play, and which spellings count as a config is the
    // umbrella loader's list. A filename missing here leaves the file unloaded for projects
    // on that spelling; the frontmatter itself is what keeps the file out of every session.
    init();

    const discovery = read(DISCOVERY_REL);
    expect(discovery.startsWith('---\n')).toBe(true);
    const frontmatter = discovery.split('\n---')[0] ?? '';
    expect(frontmatter).toMatch(/(^|\n)paths:/);
    const listed = [...frontmatter.matchAll(/^ {2}- "([^"]+)"$/gm)].map((m) => m[1] as string);
    expect(listed.sort()).toEqual(
      [...tupleLiterals('load-config.ts', 'CONFIG_FILENAMES'), '.claude/**'].sort(),
    );
  });
});

/** The skill as generated into a fresh tree — the same bytes a consumer receives. */
function generatedSkill(): string {
  init();
  return read(SKILL_REL);
}

/** Every fenced yaml example in the skill body, fence markers stripped. */
function yamlFences(content: string): string[] {
  return [...content.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => match[1] as string);
}

/**
 * Validate one example the way a consumer's own tree would — a throwaway root per fence.
 * The fence is written as the whole config document, so a fence that is not one fails
 * loudly here instead of being papered over by test-side wrapping.
 */
function loadFenceAsConfig(fence: string): ReturnType<typeof loadConfig> {
  const root = mkdtempSync(join(tmpdir(), 'pdks-skill-fence-'));
  try {
    writeFileSync(join(root, 'polydeukes.config.yaml'), fence);
    return loadConfig({ rootDir: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('discipline classification skill — the embedded config examples are loadable', () => {
  it('validates every fenced yaml example through loadConfig without throwing', () => {
    // A skill instructing a shape loadConfig refuses costs the consumer one failed
    // registration per attempt. The count pin stops the assertion going vacuously green
    // over a body with no examples at all.
    const fences = yamlFences(generatedSkill());

    expect(fences.length).toBeGreaterThan(0);
    for (const fence of fences) {
      expect(() => loadFenceAsConfig(fence), fence).not.toThrow();
    }
  });

  it('carries a draft example that resolves into a validated draft entry', () => {
    // An example whose keys drift from the id/why/draft shape parses as prose but registers
    // nothing. Resolution through loadConfig proves the example IS a draft.
    const draftFences = yamlFences(generatedSkill()).filter((fence) => /draft:\s*true/.test(fence));

    expect(draftFences.length).toBeGreaterThan(0);
    for (const fence of draftFences) {
      const { config } = loadFenceAsConfig(fence);
      expect(config.drafts?.length, fence).toBeGreaterThan(0);
    }
  });

  it('carries a judged example landing at enforce: advise with a declare block', () => {
    const judged = yamlFences(generatedSkill()).filter((fence) =>
      /enforce:\s*advise\b/.test(fence),
    );

    expect(judged.length).toBeGreaterThan(0);
    expect(judged.some((fence) => /\bdeclare\s*:/.test(fence))).toBe(true);
  });

  it('captures every fence pair as yaml — no example escapes validation under another tag', () => {
    // An example fenced as ```yml, or with no tag at all, would ship unvalidated while every
    // assertion here stays green — so the pair count and the extracted count must agree.
    const skill = generatedSkill();
    const markers = skill.match(/```/g) ?? [];

    expect(yamlFences(skill).length).toBe(markers.length / 2);
  });

  it('never writes enforce: block inside any fenced example', () => {
    // Promotion to block is the user's explicit choice; an example carrying it makes the
    // skill promote on the user's behalf.
    for (const fence of yamlFences(generatedSkill())) {
      expect(fence, fence).not.toContain('enforce: block');
    }
  });
});

describe('discipline classification skill — current declaration capabilities', () => {
  function judgeExample(skill: string, id: string, world: World) {
    const entry = yamlFences(skill)
      .flatMap((fence) => loadFenceAsConfig(fence).config.disciplines ?? [])
      .find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`missing judged example: ${id}`);
    const compiled = compileDeclaration({
      declaration: { discipline: entry.id, ...entry.declare },
    });
    if ('kind' in compiled)
      throw new Error(`example failed compilation: ${JSON.stringify(compiled)}`);
    return judgeDeclaration({ compiled, world });
  }

  it('documents every mechanism with its admitted axes, relations, and structural conditions', () => {
    const section = generatedSkill().split('### 2.')[1]?.split('### 3.')[0] ?? '';
    const rows = new Map(
      [...section.matchAll(/^\| `([a-z-]+)` \| (.+)$/gm)].map((match) => [match[1], match[2]]),
    );
    expect([...rows.keys()].sort()).toEqual([...MECHANISM_NAMES].sort());
    for (const name of MECHANISM_NAMES) {
      const row = rows.get(name) ?? '';
      const shape = MECHANISM_SHAPES[name];
      if (shape.reserved) expect(row).toMatch(/reserved.*not accepted/i);
      for (const token of [...shape.axes, ...shape.relations])
        expect(row, name).toContain(`\`${token}\``);
      if (shape.requiresWitness) expect(row).toContain('`witness`');
      if (shape.scopeSource) expect(row).toContain(`\`${shape.scopeSource}\``);
    }
  });

  it('preserves the added-only example regex through TypeScript and YAML string decoding', () => {
    const skill = generatedSkill();
    const world = {
      'target.path': 'src/example.test.ts',
      pre: 'it("case", () => {});',
      post: 'it.only("case", () => {});',
    };
    expect(judgeExample(skill, 'no-focused-tests', world).kind).toBe('broken');
    expect(judgeExample(skill, 'no-focused-tests', { ...world, pre: world.post }).kind).toBe(
      'pass',
    );
  });

  it('matches the forbidden command flag but not a longer flag name', () => {
    const skill = generatedSkill();
    expect(judgeExample(skill, 'no-force-push', { command: 'git push --force' }).kind).toBe(
      'broken',
    );
    expect(
      judgeExample(skill, 'no-force-push', { command: 'git push --force-with-lease' }).kind,
    ).toBe('pass');
  });

  it('judges the locale pairing example on equal keys and names an unmatched key', () => {
    const skill = generatedSkill();
    const world = { 'target.path': 'locales/en.json', en: '{"home":"Home"}', ko: '{"home":"홈"}' };
    expect(judgeExample(skill, 'locale-key-parity', world).kind).toBe('pass');
    const verdict = judgeExample(skill, 'locale-key-parity', {
      ...world,
      en: '{"home":"Home","settings":"Settings"}',
    });
    expect(verdict).toMatchObject({
      kind: 'broken',
      breaks: [{ witnesses: [{ key: 'settings' }] }],
    });
  });

  it('judges the vocabulary example against the supplied allowed values', () => {
    const skill = generatedSkill();
    const world = {
      'target.path': 'statuses.json',
      post: '["ready"]',
      allowed: '["ready","done"]',
    };
    expect(judgeExample(skill, 'status-vocabulary', world).kind).toBe('pass');
    expect(
      judgeExample(skill, 'status-vocabulary', { ...world, post: '["queued"]' }),
    ).toMatchObject({
      kind: 'broken',
      breaks: [{ witnesses: [{ value: 'queued' }] }],
    });
  });

  it('distinguishes successful precedent, failed or absent calls, and unavailable history', () => {
    const skill = generatedSkill();
    const world = { 'target.path': 'package.json' };
    const session = { observedAtMs: 1000, userMessages: [], toolCalls: [] as unknown[] };
    const call = {
      index: 0,
      name: 'Bash',
      args: { command: 'npm view example version' },
      succeeded: true,
    };
    expect(
      judgeExample(skill, 'manifest-needs-npm-view', {
        ...world,
        session: { ...session, toolCalls: [call] },
      }).kind,
    ).toBe('pass');
    expect(judgeExample(skill, 'manifest-needs-npm-view', { ...world, session }).kind).toBe(
      'broken',
    );
    expect(
      judgeExample(skill, 'manifest-needs-npm-view', {
        ...world,
        session: { ...session, toolCalls: [{ ...call, succeeded: false }] },
      }).kind,
    ).toBe('broken');
    expect(judgeExample(skill, 'manifest-needs-npm-view', world)).toMatchObject({
      kind: 'not-applicable',
      reason: 'supply-pass',
    });
  });

  it('uses fresh benchmark execution as a draft rather than an already expressible pairing', () => {
    const skill = generatedSkill();
    const drafts = yamlFences(skill).flatMap(
      (fence) => loadFenceAsConfig(fence).config.drafts ?? [],
    );
    expect(drafts.map((entry) => entry.id)).toContain('benchmark-supports-performance-claim');
    expect(drafts.some((entry) => /locale|pairing/.test(entry.id))).toBe(false);
    expect(skill).toContain('pdks docs show write-disciplines');
  });
});

describe('discipline classification skill — vocabulary and commands match the shipped surface', () => {
  it('names the diff-piped judgment command that fires a new pattern for real', () => {
    const skill = generatedSkill();
    expect(skill).toContain('pdks covenant check --diff');
    expect(skill).toContain('git diff HEAD');
  });

  it('names the telemetry log default path and the config key that moves it', () => {
    // The session surface allows an advised call with exit 0 and its reason never reaches
    // the model at call time; the delivery is the agent consulting the log.
    const skill = generatedSkill();
    expect(skill).toContain('.polydeukes/roi.log');
    expect(skill).toContain('telemetry.logPath');
  });

  it('contains no wiki path and no ticket coordinate', () => {
    // The generated body ships to consumers who cannot open the wiki or resolve a ticket ID.
    const skill = generatedSkill();
    expect(skill).not.toContain('_docs');
    expect(skill).not.toMatch(
      /\b(?:CONFIG|COVENANT|DIAG|POSTURE|DISPATCH|ALGEBRA|CLI|DOCS|DIST|CORE|ADAPTER|MEMORY|LEDGER|MEASURE|VERIFY|TEMPLATE|STARLARK|LOCK|EXTRACT|SELF|KNOWLEDGE|SURFACE)-\d+\b/,
    );
  });
});
