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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initCodex } from '../src/init.ts';

// The Codex installer: preflight, then the umbrella's agent-neutral scaffold spawned as
// `pdks init`, then the two registration artifacts — the delegator and `.codex/hooks.json`.
// Nothing here spawns a judge.
//
// Codex trusts a hook by the hash of its definition, so the command string this installer
// writes is a contract: a re-run that changes one character silences the judge until a
// human re-approves it in `/hooks`. And `.codex/hooks.json` is a file the user may already
// own, so it is merged rather than written.

/** Injected fixture values — Codex-native tool names and the generated artifacts. */
const APPLY_PATCH = 'apply_patch';
const BASH = 'Bash';
const MATCHER = `${BASH}|${APPLY_PATCH}`;
const LIFECYCLE_EVENTS = ['PreToolUse', 'UserPromptSubmit', 'PostToolUse', 'SessionEnd'] as const;
const HOOK_REL = '.codex/hooks/covenant-pretooluse.mjs';
const JSON_REL = '.codex/hooks.json';
const LEGACY_COMMAND = `node ${HOOK_REL}`;
const ARTIFACTS = [HOOK_REL, JSON_REL];
const ADAPTER_SPECIFIER = '@polydeukes/adapter-codex';
const VOUCHED_BIN = '/vouched/polydeukes/dist/bin.js';
const CHECKOUT_ROOT = resolve(import.meta.dirname, '../../..');
const USER_MATCHER = 'WebSearch';
const USER_SIBLING_COMMAND = 'echo sibling';

/** Preflight stub, success side — injected wherever the run must get past preflight. */
const resolvesFine = (): string => VOUCHED_BIN;
/** Preflight stub, failure side — its message deliberately does NOT name the package. */
const resolutionFails = (): never => {
  throw new Error('resolution refused by fixture');
};

type ScaffoldCall = { command: string; args: string[]; cwd: string; treeAtCall: string[] };

let projectRoot: string;
let scaffoldCalls: ScaffoldCall[];

/** A recording scaffold seam answering `status`, noting what the tree held when it ran. */
function scaffoldAnswering(
  status: number | null,
): (spec: { command: string; args: string[]; cwd: string }) => { status: number | null } {
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

function read(rel: string, root = projectRoot): string {
  return readFileSync(join(root, rel), 'utf-8');
}

/** The delegator's comments may NAME what its code must never do; judge executable text only. */
function executableText(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
}

type CommandHook = { type?: string; command?: string; timeout?: number };
type MatcherEntry = { matcher?: string; hooks?: CommandHook[] };
type HooksFile = Record<string, unknown> & {
  hooks?: Record<string, MatcherEntry[] | undefined>;
};

function readHooksJson(root = projectRoot): HooksFile {
  return JSON.parse(read(JSON_REL, root)) as HooksFile;
}

/** Every event entry carrying this installer's generated delegator command. */
function ownEntries(
  root = projectRoot,
  event: (typeof LIFECYCLE_EVENTS)[number] = 'PreToolUse',
): MatcherEntry[] {
  return (readHooksJson(root).hooks?.[event] ?? []).filter((entry) =>
    entry.hooks?.some((hook) => hook.command?.includes(HOOK_REL)),
  );
}

function ownCommand(root = projectRoot): string | undefined {
  return ownEntries(root)[0]?.hooks?.[0]?.command;
}

/** The happy-path invocation — preflight injected as succeeding, scaffold answering 0. */
function init(root = projectRoot): { created: string[]; skipped: string[] } {
  return initCodex({
    projectRoot: root,
    resolvePolydeukes: resolvesFine,
    spawnScaffold: scaffoldAnswering(0),
  });
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-codex-init-'));
  scaffoldCalls = [];
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('initCodex — absent-project creation', () => {
  it('creates the delegator and hooks.json on an empty tree, reports each as created, and writes no sibling-host files', () => {
    // No delegator and nothing ever judges; no JSON and the delegator exists but the host
    // never spawns it. A `.claude/` or `.grok/` file written here is a surface this
    // installer does not own.
    const result = init();

    for (const rel of ARTIFACTS) {
      expect(existsSync(join(projectRoot, rel)), rel).toBe(true);
    }
    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    expect(existsSync(join(projectRoot, '.grok'))).toBe(false);
    expect([...result.created].sort()).toEqual([...ARTIFACTS].sort());
    expect(result.skipped).toEqual([]);
  });

  it('registers one generated-command entry for each of the four lifecycle events', () => {
    // Missing UserPromptSubmit leaves no witness provenance, missing PostToolUse fabricates
    // empty precedent, and missing SessionEnd retains prompts indefinitely. Matcherless
    // lifecycle events must omit matcher rather than carrying a wildcard the host may not
    // accept; SessionEnd has the host's three-second ceiling.
    init();

    const file = readHooksJson();
    expect(Object.keys(file.hooks ?? {})).toEqual(LIFECYCLE_EVENTS);
    for (const event of LIFECYCLE_EVENTS) expect(ownEntries(projectRoot, event)).toHaveLength(1);
    expect(ownEntries(projectRoot, 'PreToolUse')[0]?.matcher).toBe(MATCHER);
    expect(ownEntries(projectRoot, 'PostToolUse')[0]?.matcher).toBe(MATCHER);
    expect(ownEntries(projectRoot, 'UserPromptSubmit')[0]).not.toHaveProperty('matcher');
    expect(ownEntries(projectRoot, 'SessionEnd')[0]).not.toHaveProperty('matcher');
    expect(ownEntries(projectRoot, 'PreToolUse')[0]?.hooks).toEqual([
      { type: 'command', command: expect.any(String), timeout: 60 },
    ]);
    expect(ownEntries(projectRoot, 'SessionEnd')[0]?.hooks).toEqual([
      { type: 'command', command: ownCommand(), timeout: 3 },
    ]);
    const commands = LIFECYCLE_EVENTS.map(
      (event) => ownEntries(projectRoot, event)[0]?.hooks?.[0]?.command,
    );
    expect(new Set(commands)).toEqual(new Set([ownCommand()]));
  });

  it('writes a command that names the delegator relative to the project, never by absolute path', () => {
    // The trust hash covers the command string. An absolute path bakes THIS checkout's
    // location into it, so a clone at any other path — or the same tree moved — carries a
    // definition the user never approved, and the judge is skipped there silently.
    init();

    const command = ownCommand() ?? '';
    expect(command).toContain(HOOK_REL);
    expect(command).not.toContain(projectRoot);
  });
});

describe('initCodex — the command string is stable across runs and trees', () => {
  it('writes the same command string on a second run, and hooks.json is byte-identical', () => {
    // Behaviour, not a grep of the template: the file after run two must equal the file
    // after run one. A writer that reorders keys, appends a second entry, or stamps a
    // date changes the hash and the host stops running the hook until re-approved.
    init();
    const first = read(JSON_REL);
    const firstCommand = ownCommand();

    const second = init();

    expect(read(JSON_REL)).toBe(first);
    expect(ownCommand()).toBe(firstCommand);
    expect(ownEntries()).toHaveLength(1);
    expect(second.created).toEqual([]);
  });

  it('writes the same command string into two different project roots', () => {
    // The other end of the stability axis: two users of the same package version, on two
    // machines, must approve one definition. A command carrying anything tree-specific
    // fails here.
    const otherRoot = mkdtempSync(join(tmpdir(), 'pdks-codex-init-other-'));
    try {
      init();
      init(otherRoot);

      expect(ownCommand(otherRoot)).toBe(ownCommand());
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('matches this repository dogfooding hooks.json byte for byte', () => {
    // A hand-maintained dogfood definition can look equivalent while carrying a different
    // trust hash or missing a lifecycle event. The repository artifact must be init output,
    // not a separately maintained approximation.
    init();

    expect(read(JSON_REL)).toBe(readFileSync(join(CHECKOUT_ROOT, JSON_REL), 'utf-8'));
  });
});

describe('initCodex — merging into an existing hooks.json', () => {
  it('replaces the previous relative command in all four events without claiming sibling handlers', () => {
    const userEntries = Object.fromEntries(
      LIFECYCLE_EVENTS.map((event) => [
        event,
        { hooks: [{ type: 'command', command: `echo user-${event}`, timeout: 5 }] },
      ]),
    );
    const existing = {
      note: 'user-owned',
      hooks: Object.fromEntries(
        LIFECYCLE_EVENTS.map((event) => [
          event,
          [
            {
              ...(event === 'PreToolUse' ? { matcher: USER_MATCHER } : {}),
              hooks: [
                { type: 'command', command: LEGACY_COMMAND, timeout: 60 },
                ...(event === 'PreToolUse'
                  ? [{ type: 'command', command: USER_SIBLING_COMMAND, timeout: 7 }]
                  : []),
              ],
            },
            userEntries[event],
          ],
        ]),
      ),
    };
    mkdirSync(join(projectRoot, dirname(JSON_REL)), { recursive: true });
    writeFileSync(join(projectRoot, JSON_REL), `${JSON.stringify(existing, null, 2)}\n`);

    const first = init();
    const updated = readHooksJson();
    const installedCommands: string[] = [];
    for (const event of LIFECYCLE_EVENTS) {
      const entries = updated.hooks?.[event] ?? [];
      const commands = entries.flatMap((entry) => entry.hooks?.map((hook) => hook.command) ?? []);
      expect(commands).not.toContain(LEGACY_COMMAND);
      const owned = commands.filter(
        (command) => command !== USER_SIBLING_COMMAND && !command?.startsWith('echo user-'),
      );
      expect(owned).toHaveLength(1);
      installedCommands.push(owned[0] as string);
      expect(entries).toContainEqual(userEntries[event]);
    }
    expect(new Set(installedCommands).size).toBe(1);
    expect(installedCommands[0]).not.toBe(LEGACY_COMMAND);
    const sibling = updated.hooks?.PreToolUse?.find((entry) =>
      entry.hooks?.some((hook) => hook.command === USER_SIBLING_COMMAND),
    );
    expect(sibling?.matcher).toBe(USER_MATCHER);
    expect(sibling?.hooks).toEqual([
      { type: 'command', command: USER_SIBLING_COMMAND, timeout: 7 },
    ]);
    expect(updated.note).toBe('user-owned');
    expect(first.created).toContain(JSON_REL);

    const firstBytes = read(JSON_REL);
    const second = init();
    expect(read(JSON_REL)).toBe(firstBytes);
    expect(second.skipped).toContain(JSON_REL);
    expect(second.created).not.toContain(JSON_REL);
  });

  it('keeps matcherless user entries, sibling handlers, and unknown keys while adding each own entry once', () => {
    // Identifying ownership by absent matcher deletes the user's lifecycle entries. Replacing
    // an entry that merely contains another handler discards that handler, and replacing the
    // hooks object or top level deletes unrelated host state.
    const existing = {
      hooks: {
        PreToolUse: [
          { matcher: 'WebSearch', hooks: [{ type: 'command', command: 'echo pre', timeout: 5 }] },
        ],
        PostToolUse: [
          { matcher: BASH, hooks: [{ type: 'command', command: 'echo post', timeout: 5 }] },
        ],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo prompt', timeout: 5 }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: 'echo end', timeout: 3 }] }],
      },
      note: 'user-owned',
    };
    mkdirSync(join(projectRoot, dirname(JSON_REL)), { recursive: true });
    writeFileSync(join(projectRoot, JSON_REL), `${JSON.stringify(existing, null, 2)}\n`);

    const result = init();

    const file = readHooksJson();
    expect(file.note).toBe('user-owned');
    expect(file.hooks?.PreToolUse?.[0]).toEqual(existing.hooks.PreToolUse[0]);
    expect(file.hooks?.PreToolUse).toHaveLength(2);
    expect(file.hooks?.PostToolUse?.[0]).toEqual(existing.hooks.PostToolUse[0]);
    expect(file.hooks?.UserPromptSubmit?.[0]).toEqual(existing.hooks.UserPromptSubmit[0]);
    expect(file.hooks?.SessionEnd?.[0]).toEqual(existing.hooks.SessionEnd[0]);
    for (const event of LIFECYCLE_EVENTS) expect(ownEntries(projectRoot, event)).toHaveLength(1);
    expect(ownEntries()[0]?.hooks?.[0]).toMatchObject({ type: 'command', timeout: 60 });
    // A merge that appended this entry changed the file, and with it the trust hash the
    // host approved. Reported as skipped, it reads as "nothing to approve" while the hook
    // sits unapproved and judges nothing.
    expect(result.created).toContain(JSON_REL);
    expect(result.skipped).not.toContain(JSON_REL);
  });

  it('leaves a merged hooks.json byte-identical on a second run', () => {
    // The re-run over a file the user already owned: a writer that finds its own entry by
    // identity rather than by matcher appends a second one, and one that re-serialises the
    // user's entries changes the hash of a definition they approved.
    const existing = {
      hooks: {
        PostToolUse: [{ matcher: BASH, hooks: [{ type: 'command', command: 'echo post' }] }],
      },
    };
    mkdirSync(join(projectRoot, dirname(JSON_REL)), { recursive: true });
    writeFileSync(join(projectRoot, JSON_REL), `${JSON.stringify(existing, null, 2)}\n`);
    init();
    const merged = read(JSON_REL);

    const second = init();

    expect(read(JSON_REL)).toBe(merged);
    for (const event of LIFECYCLE_EVENTS) expect(ownEntries(projectRoot, event)).toHaveLength(1);
    expect(readHooksJson().hooks?.PostToolUse?.[0]).toEqual(existing.hooks.PostToolUse[0]);
    // Unchanged this time, so nothing needs approving again — the other side of the report.
    expect(second.skipped).toContain(JSON_REL);
    expect(second.created).not.toContain(JSON_REL);
  });

  it('recognizes its entry by generated command and preserves a sibling handler in that entry', () => {
    // Matching only on matcher misses the matcherless events, while replacing an owned
    // entry wholesale drops a user handler that happens to share the entry. Command-handler
    // identity permits updating the owned definition without claiming its siblings.
    init();
    const file = readHooksJson();
    const promptEntry = file.hooks?.UserPromptSubmit?.find((entry) =>
      entry.hooks?.some((hook) => hook.command?.includes(HOOK_REL)),
    );
    promptEntry?.hooks?.push({ type: 'command', command: 'echo sibling', timeout: 7 });
    writeFileSync(join(projectRoot, JSON_REL), `${JSON.stringify(file, null, 2)}\n`);

    init();

    const entries = readHooksJson().hooks?.UserPromptSubmit ?? [];
    expect(ownEntries(projectRoot, 'UserPromptSubmit')).toHaveLength(1);
    expect(entries.flatMap((entry) => entry.hooks ?? [])).toContainEqual({
      type: 'command',
      command: 'echo sibling',
      timeout: 7,
    });
  });

  it('splits a refreshed owned handler from a user sibling so the sibling keeps its matcher', () => {
    // Replacing the matcher on a shared entry silently widens the sibling handler from the
    // user's event subset to this adapter's mutation roster. The generated command may
    // move to a fresh owned entry; the sibling must remain under its original matcher.
    init();
    const file = readHooksJson();
    const sharedEntry = file.hooks?.PreToolUse?.find((entry) =>
      entry.hooks?.some((hook) => hook.command?.includes(HOOK_REL)),
    );
    if (sharedEntry === undefined) throw new Error('fixture has no generated PreToolUse entry');
    sharedEntry.matcher = USER_MATCHER;
    sharedEntry.hooks?.push({ type: 'command', command: USER_SIBLING_COMMAND, timeout: 7 });
    writeFileSync(join(projectRoot, JSON_REL), `${JSON.stringify(file, null, 2)}\n`);

    init();

    const entries = readHooksJson().hooks?.PreToolUse ?? [];
    const owned = ownEntries();
    expect(owned).toHaveLength(1);
    expect(owned[0]?.matcher).toBe(MATCHER);
    expect(owned[0]?.hooks).toEqual([{ type: 'command', command: ownCommand(), timeout: 60 }]);
    const siblingEntry = entries.find((entry) =>
      entry.hooks?.some((hook) => hook.command === USER_SIBLING_COMMAND),
    );
    expect(siblingEntry?.matcher).toBe(USER_MATCHER);
    expect(siblingEntry?.hooks).toEqual([
      { type: 'command', command: USER_SIBLING_COMMAND, timeout: 7 },
    ]);
  });

  it('throws and leaves the file untouched when the existing hooks.json is not JSON', () => {
    // A file the installer cannot read is a file it cannot merge into. Overwriting it
    // destroys what the user wrote; skipping it silently leaves the host unregistered with
    // a report that says otherwise.
    const broken = '{ "hooks": [ not json\n';
    mkdirSync(join(projectRoot, dirname(JSON_REL)), { recursive: true });
    writeFileSync(join(projectRoot, JSON_REL), broken);

    expect(() => init()).toThrow();

    expect(read(JSON_REL)).toBe(broken);
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
    expect(call.args.at(-2)).toBe(VOUCHED_BIN);
    expect(call.cwd).toBe(projectRoot);
    expect(call.treeAtCall).toEqual([]);
  });

  it.each([[2], [1], [null]])(
    'aborts with zero files when the scaffold answers status %s',
    (status) => {
      // The umbrella exits 2 on an ambiguous config tree; 1 or null is a scaffold that did
      // not run. Registering a delegator into a tree with no config wires a judge whose
      // every call fails closed.
      expect(() =>
        initCodex({
          projectRoot,
          resolvePolydeukes: resolvesFine,
          spawnScaffold: scaffoldAnswering(status),
        }),
      ).toThrow();

      expect(readdirSync(projectRoot)).toEqual([]);
    },
  );
});

describe('the generated delegator', () => {
  it('imports this package dynamically and calls runHook — never a sibling adapter', () => {
    // The judge is reached through this package's `runHook`. Importing the Claude or Grok
    // adapter loads a roster without `apply_patch`, and every file edit lands unrouted.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(new RegExp(`import\\(\\s*['"]${ADAPTER_SPECIFIER}['"]\\s*\\)`));
    expect(hook).toMatch(/\brunHook\s*\(\s*\{\s*repoRoot\s*\}\s*\)/);
    expect(hook).not.toContain('@polydeukes/adapter-claude-code');
    expect(hook).not.toContain('@polydeukes/adapter-grok');
  });

  it('derives repoRoot from its own location, never process.cwd()', () => {
    // A hook is spawned with whatever working directory the host holds, so a cwd-anchored
    // repoRoot makes config discovery and the `polydeukes` lookup resolve against the
    // WRONG tree. Both `'..', '..'` and `'../..'` spellings of the two-level ascent pass.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(/fileURLToPath\(import\.meta\.url\)/);
    expect(hook).toMatch(/(['"])\.\.\1,\s*(['"])\.\.\2|(['"])\.\.\/\.\.\3/);
    expect(hook).not.toMatch(/process\.cwd\(\)/);
  });

  it('settles exit code 2 from a catch, never calls process.exit(), and never touches stdout', () => {
    // Without the catch an unresolvable package crashes the hook at node's exit 1, which
    // the host reads as NON-blocking. The code is ASSIGNED rather than passed to
    // process.exit(), so a buffered stderr write is never preempted. A `console.log` or
    // `process.stdout` here is the one byte on stdout Codex parses as a decision.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(/\bcatch\s*\(/);
    expect(hook).toMatch(/process\.exitCode\s*=\s*2/);
    expect(hook).not.toMatch(/process\.exit\(/);
    expect(hook).not.toMatch(/console\.log|process\.stdout/);
  });

  it('is left untouched when it already exists, while hooks.json is still written', () => {
    // A delegator regenerated over an existing file replaces a consumer's pinned one; an
    // init early-returning on the first existing artifact leaves the project with a hook
    // and no registration.
    const custom = '// consumer-customized codex delegator\n';
    mkdirSync(join(projectRoot, dirname(HOOK_REL)), { recursive: true });
    writeFileSync(join(projectRoot, HOOK_REL), custom);

    const result = init();

    expect(read(HOOK_REL)).toBe(custom);
    expect(result.skipped).toContain(HOOK_REL);
    expect(ownEntries()).toHaveLength(1);
  });
});

describe('preflight — resolution proven before any write or spawn', () => {
  it('throws an error naming polydeukes, spawns nothing, and creates ZERO files when the injected resolver fails', () => {
    // Any write or spawn ordered before the preflight leaves a partial tree: a generated
    // delegator whose import can never resolve blocks every call through its own catch.
    // The message must name the package — the stub's own message deliberately does not.
    expect(() =>
      initCodex({
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
    expect(() => initCodex({ projectRoot, spawnScaffold: scaffoldAnswering(0) })).toThrow(
      /polydeukes/,
    );

    expect(readdirSync(projectRoot)).toEqual([]);
    expect(scaffoldCalls).toEqual([]);
  });

  it('hands the injected preflight seam the TARGET project root, exactly once', () => {
    // An installer probing some other directory with the caller's resolver reports
    // resolution state for the wrong tree.
    const seen: string[] = [];
    initCodex({
      projectRoot,
      resolvePolydeukes: (from: string) => {
        seen.push(from);
        return resolvesFine();
      },
      spawnScaffold: scaffoldAnswering(0),
    });

    expect(seen).toEqual([projectRoot]);
  });
});
