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
import { initGrok } from '../src/init.ts';

// The Grok installer: preflight, then the umbrella's agent-neutral scaffold spawned as
// `pdks init`, then the two registration artifacts — the delegator and the hook JSON.
// Nothing here spawns a judge.
//
// Two seams. `resolvePolydeukes` is the preflight: injectable because a fixture tree cannot
// fake the install graph, while the DEFAULT resolver is still reachable in the FAILING
// direction, since `polydeukes` resolves from nowhere under tmpdir. `spawnScaffold` is the
// `pdks init` spawn: injected so no case here depends on a built umbrella; what it is handed
// and when it is called are the assertions.

// Each test builds a throwaway projectRoot under tmpdir, so no protected path of THIS
// repository is ever targeted. The generated-artifact cases judge TEXT; spawning the
// delegator against real payloads is the symlink-tree e2e's job.

/** Injected fixture values — Grok-native tool names and the generated artifacts. */
const WRITE = 'write';
const SEARCH_REPLACE = 'search_replace';
const RUN = 'run_terminal_command';
const MATCHER = `${WRITE}|${SEARCH_REPLACE}|${RUN}`;
const HOOK_REL = '.grok/hooks/covenant-pretooluse.mjs';
const JSON_REL = '.grok/hooks/covenant-pretooluse.json';
const ARTIFACTS = [HOOK_REL, JSON_REL];
const HOOK_COMMAND = `node "$GROK_WORKSPACE_ROOT"/${HOOK_REL}`;
const ADAPTER_SPECIFIER = '@polydeukes/adapter-grok';
const CLAUDE_HOOK_REL = '.claude/hooks/covenant-pretooluse.mjs';
const CLAUDE_HOOK_COMMAND = `node "$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_REL}`;
const VOUCHED_BIN = '/vouched/polydeukes/dist/bin.js';

/** Preflight stub, success side — injected wherever the run must get past preflight. */
const resolvesFine = (): string => VOUCHED_BIN;
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

type GrokCommandHook = { type?: string; command?: string; timeout?: number };
type GrokMatcherEntry = { matcher?: string; hooks?: GrokCommandHook[] };
type GrokHookFile = { hooks?: { PreToolUse?: GrokMatcherEntry[] } };

function readGrokJson(): GrokHookFile {
  return JSON.parse(read(JSON_REL)) as GrokHookFile;
}

function grokInnerHook(): GrokCommandHook | undefined {
  return readGrokJson().hooks?.PreToolUse?.[0]?.hooks?.[0];
}

function grokMatcher(): string | undefined {
  return readGrokJson().hooks?.PreToolUse?.[0]?.matcher;
}

/** The happy-path invocation — preflight injected as succeeding, scaffold answering 0. */
function init(): { created: string[]; skipped: string[] } {
  return initGrok({
    projectRoot,
    resolvePolydeukes: resolvesFine,
    spawnScaffold: scaffoldAnswering(0),
  });
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-grok-init-'));
  scaffoldCalls = [];
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('initGrok — absent-project creation', () => {
  it('creates the hook mjs and JSON on an empty tree, reports each as created, and writes no .claude files', () => {
    // No delegator and nothing ever judges; no JSON and the delegator exists but the host
    // never spawns it. A .claude/ file written here is a second surface this installer
    // does not own.
    const result = init();

    for (const rel of ARTIFACTS) {
      expect(existsSync(join(projectRoot, rel)), rel).toBe(true);
    }
    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    expect([...result.created].sort()).toEqual([...ARTIFACTS].sort());
    expect(result.skipped).toEqual([]);
  });

  it('registers the exact Grok matcher, GROK_WORKSPACE_ROOT command, and timeout 60', () => {
    // The host spawns exactly the string written here; a CLAUDE_PROJECT_DIR command runs
    // a different delegator. A matcher missing a tool name leaves that tool judged by
    // nobody; an empty matcher is not a predicate. The host default timeout is 5 seconds
    // and a timed-out hook is fail-open, so 60 is the contract — a string `'60'` or an
    // omitted key both miss it.
    init();

    expect(grokMatcher()).toBe(MATCHER);
    expect(grokInnerHook()).toEqual({ type: 'command', command: HOOK_COMMAND, timeout: 60 });
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

  it('aborts with zero files when the scaffold exits 2', () => {
    // The umbrella exits 2 on an already-ambiguous config tree, and adding registration
    // artifacts to it wires a judge whose every call fails closed. Zero files is the
    // contract: a human deletes one config and re-runs.
    expect(() =>
      initGrok({
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
      initGrok({
        projectRoot,
        resolvePolydeukes: resolvesFine,
        spawnScaffold: scaffoldAnswering(1),
      }),
    ).toThrow();

    expect(readdirSync(projectRoot)).toEqual([]);
  });
});

describe('the generated delegator', () => {
  it('imports this package dynamically and calls runHook — never the sibling adapter', () => {
    // The judge is reached through this package's `runHook`. Importing the Claude adapter
    // loads a roster that does not contain Grok names, and every call lands unrouted.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(new RegExp(`import\\(\\s*['"]${ADAPTER_SPECIFIER}['"]\\s*\\)`));
    expect(hook).toMatch(/\brunHook\s*\(\s*\{\s*repoRoot\s*\}\s*\)/);
    expect(hook).not.toContain('@polydeukes/adapter-claude-code');
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
  it('leaves both artifacts byte-identical on a second run, reports zero created, and spawns the scaffold again', () => {
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

  it('leaves a pre-existing delegator untouched while still creating the JSON', () => {
    // A delegator regenerated over an existing file silently replaces a consumer's pinned
    // or customized one; an init early-returning on the first existing artifact leaves the
    // project with a hook and no JSON, so the host is never told to spawn it.
    const custom = '// consumer-customized grok delegator\n';
    mkdirSync(join(projectRoot, dirname(HOOK_REL)), { recursive: true });
    writeFileSync(join(projectRoot, HOOK_REL), custom);

    const result = init();

    expect(read(HOOK_REL)).toBe(custom);
    expect(result.skipped).toContain(HOOK_REL);
    expect(existsSync(join(projectRoot, JSON_REL))).toBe(true);
    expect(result.created).toContain(JSON_REL);
  });

  it('leaves a pre-existing JSON untouched while still creating the delegator', () => {
    // The skip is per artifact. A JSON rewrite on re-run drops a consumer timeout or
    // matcher; skipping the JSON because the mjs is missing leaves the host unregistered.
    const custom = '{"hooks":{"PreToolUse":[]}}\n';
    mkdirSync(join(projectRoot, dirname(JSON_REL)), { recursive: true });
    writeFileSync(join(projectRoot, JSON_REL), custom);

    const result = init();

    expect(read(JSON_REL)).toBe(custom);
    expect(result.skipped).toContain(JSON_REL);
    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(true);
    expect(result.created).toContain(HOOK_REL);
  });
});

describe('a tree that already has a Claude delegator', () => {
  it('still writes a JSON command pointing at the grok mjs, and does not reuse the Claude file', () => {
    // Reusing the Claude delegator sends Grok tool names into a roster that does not
    // contain them, and every call lands as an unrouted pass. The Claude file is not
    // this installer's to rewrite.
    mkdirSync(join(projectRoot, dirname(CLAUDE_HOOK_REL)), { recursive: true });
    const claudeBody = '// existing claude delegator\n';
    writeFileSync(join(projectRoot, CLAUDE_HOOK_REL), claudeBody);

    init();

    expect(grokInnerHook()?.command).toBe(HOOK_COMMAND);
    expect(grokInnerHook()?.command).not.toBe(CLAUDE_HOOK_COMMAND);
    expect(grokMatcher()).toBe(MATCHER);
    expect(read(CLAUDE_HOOK_REL)).toBe(claudeBody);
    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(true);
  });
});

describe('preflight — resolution proven before any write or spawn', () => {
  it('throws an error naming polydeukes, spawns nothing, and creates ZERO files when the injected resolver fails', () => {
    // Any write or spawn ordered before the preflight leaves a partial tree: a generated
    // delegator whose import can never resolve blocks every call through its own catch. The
    // message must name the package — the stub's own message deliberately does not.
    expect(() =>
      initGrok({
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
    expect(() => initGrok({ projectRoot, spawnScaffold: scaffoldAnswering(0) })).toThrow(
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
    initGrok({
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
