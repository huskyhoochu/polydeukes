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
// The Grok session-registration layer: preflight, then the shared scaffold
// (scaffold-project.test.ts owns that layer's own contract), then the generated hook
// and the .grok/hooks JSON registration. Nothing here spawns a judge.
//
// `resolvePolydeukes` is the preflight seam. It is injectable because a fixture tree cannot
// fake the install graph; the DEFAULT resolver is still reachable from a fixture in the
// FAILING direction, because `polydeukes` resolves from nowhere under tmpdir.
import { initGrok } from '../src/init-grok.ts';

// Each test builds a throwaway projectRoot under tmpdir, so no protected path of THIS
// repository is ever targeted — the installer never runs against this checkout. The
// generated-hook cases below judge the artifact's TEXT.

/** Injected fixture values — Grok's mutating+shell roster and the Claude aliases the matcher also carries. */
const GROK_WRITE = 'write';
const GROK_SEARCH_REPLACE = 'search_replace';
const GROK_RUN = 'run_terminal_command';
const GROK_TOOL_NAMES = [GROK_WRITE, GROK_SEARCH_REPLACE, GROK_RUN];
const CLAUDE_ALIASES = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'];

/** The generated artifacts as projectRoot-relative paths — the report vocabulary. */
const HOOK_REL = '.grok/hooks/covenant-pretooluse.mjs';
const JSON_REL = '.grok/hooks/covenant-pretooluse.json';
const CONFIG_REL = 'polydeukes.config.yaml';
const GITIGNORE_REL = '.gitignore';
const ARTIFACTS = [HOOK_REL, JSON_REL, CONFIG_REL, GITIGNORE_REL];
const GITIGNORE_LINE = '.polydeukes/';
/** The Claude delegator this installer reuses when it is already on disk. */
const CLAUDE_HOOK_REL = '.claude/hooks/covenant-pretooluse.mjs';
/** How a registration is recognized: the command string names one delegator file. */
const GROK_HOOK_COMMAND = `node "$CLAUDE_PROJECT_DIR"/${HOOK_REL}`;
const CLAUDE_HOOK_COMMAND = `node "$CLAUDE_PROJECT_DIR"/${CLAUDE_HOOK_REL}`;
/** A consumer-owned grok command — not the installer-generated grok-mjs string. */
const CUSTOM_GROK_COMMAND = 'echo consumer-owned-grok-pretooluse';
/** The Claude settings file whose delegator entry the grok matcher must agree with. */
const CLAUDE_SETTINGS_REL = '.claude/settings.json';
/** A matcher only a consumer would have written — no roster constant can reproduce it. */
const CONSUMER_MATCHER = 'Edit|Write|consumer-kept|Bash';
/** A registration some other tool installed — its matcher is never ours to copy. */
const FOREIGN_COMMAND = 'echo consumer-owned-pretooluse';
const FOREIGN_MATCHER = 'WebFetch';

/** Preflight stub, success side — injected wherever the run must get past preflight. */
const resolvesFine = (): void => undefined;
/**
 * Preflight stub, failure side. Its message deliberately does NOT name the package: the
 * assertion below demands `polydeukes` in the thrown message, so it can only be satisfied
 * by an error the production code composed itself — never by echoing this stub.
 */
const resolutionFails = (): never => {
  throw new Error('resolution refused by fixture');
};

let projectRoot: string;

function read(rel: string): string {
  return readFileSync(join(projectRoot, rel), 'utf-8');
}

/**
 * The generated hook's own comments legitimately NAME what its code must never do — the
 * header says `never process.cwd()` in prose — so every shape assertion below judges
 * comment-stripped text only.
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

/** Every PreToolUse command string in the generated JSON, in file order. */
function grokCommands(): string[] {
  return (readGrokJson().hooks?.PreToolUse ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .map((hook) => hook.command)
    .filter((command): command is string => typeof command === 'string');
}

function grokInnerHook(): GrokCommandHook | undefined {
  return readGrokJson().hooks?.PreToolUse?.[0]?.hooks?.[0];
}

function grokMatcherTokens(): string[] {
  const matcher = readGrokJson().hooks?.PreToolUse?.[0]?.matcher;
  return typeof matcher === 'string' ? matcher.split('|') : [];
}

/** The happy-path invocation — preflight injected as succeeding. */
function init(): { created: string[]; skipped: string[] } {
  return initGrok({ projectRoot, resolvePolydeukes: resolvesFine });
}

type ClaudeSettingsEntry = { matcher: string; hooks: { type: string; command: string }[] };

function claudeEntry(command: string, matcher: string): ClaudeSettingsEntry {
  return { matcher, hooks: [{ type: 'command', command }] };
}

function writeClaudeSettings(entries: ClaudeSettingsEntry[]): void {
  mkdirSync(join(projectRoot, dirname(CLAUDE_SETTINGS_REL)), { recursive: true });
  writeFileSync(
    join(projectRoot, CLAUDE_SETTINGS_REL),
    JSON.stringify({ hooks: { PreToolUse: entries } }, null, 2),
  );
}

function plantClaudeHook(): void {
  mkdirSync(join(projectRoot, dirname(CLAUDE_HOOK_REL)), { recursive: true });
  writeFileSync(join(projectRoot, CLAUDE_HOOK_REL), '// existing Claude delegator\n');
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-init-grok-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('initGrok — absent-project creation', () => {
  it('creates the grok hook, grok JSON, and shared scaffold on an empty tree and reports each as created', () => {
    // Each artifact answers for a different failure: no hook file and nothing ever judges;
    // no JSON registration and the hook exists but never spawns; no config and fail-closed
    // blocks every call; no ignore line and every consumer commits its telemetry. The
    // command pin is the other half of registration: a JSON that exists but names a file
    // that was never written leaves the host spawning a missing judge. A copy of the
    // Claude installer that also writes `.claude/` would plant a second command string.
    const result = init();

    for (const rel of ARTIFACTS) {
      expect(existsSync(join(projectRoot, rel)), rel).toBe(true);
    }
    expect(read(GITIGNORE_REL).split('\n')).toContain(GITIGNORE_LINE);
    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    expect(grokCommands()).toEqual([GROK_HOOK_COMMAND]);
    expect(grokInnerHook()?.type).toBe('command');
    expect([...result.created].sort()).toEqual([...ARTIFACTS].sort());
    expect(result.skipped).toEqual([]);
  });

  it('generates a hook that imports the polydeukes/claude-code subpath, never the barrel', () => {
    // A generated import pointing at the package barrel instead of the session subpath
    // makes every consumer session call load the commit surface and the git adapter with
    // it, because barrel re-exports are eager; a workspace missing only that dist would
    // then kill the session hook with no telemetry row. A Grok-named subpath would be a
    // new entry point this installer is not allowed to add.
    init();

    const hook = executableText(read(HOOK_REL));
    expect(hook).toMatch(/import\(\s*['"]polydeukes\/claude-code['"]\s*\)/);
    expect(hook).not.toMatch(/import\(\s*['"]polydeukes['"]\s*\)/);
    expect(hook).not.toMatch(/import\(\s*['"]polydeukes\/grok['"]\s*\)/);
  });

  it('writes timeout 60 on the command hook, never the host default', () => {
    // The host default is 5 seconds. A warmed delegator is well under that, but a cold
    // import is not, and a timed-out hook is fail-open: the call proceeds unjudged. The
    // number is the contract — a string `'60'` or an omitted key both miss it.
    init();

    expect(grokInnerHook()?.timeout).toBe(60);
  });

  it('writes a matcher that includes the Grok mutating+shell names and the Claude aliases', () => {
    // A matcher copied from the Claude installer names only Edit/Write/Bash. Grok's host
    // aliases those onto write/search_replace/run_terminal_command today, but the JSON
    // this installer writes is what a host without that alias table consults — dropping
    // the Grok names means those tools never spawn the judge. An empty matcher is the
    // other end: it is not a predicate, it matches everything the host will send.
    init();

    const tokens = grokMatcherTokens();
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toEqual(expect.arrayContaining(GROK_TOOL_NAMES));
    expect(tokens).toEqual(expect.arrayContaining(CLAUDE_ALIASES));
  });
});

describe('non-destructive idempotence', () => {
  it('leaves every artifact byte-identical on a second run and reports zero created', () => {
    // Any writer that appends or rewrites on re-run breaks here — the likeliest being the
    // ignore line appended unconditionally, growing .gitignore by one line per run, or the
    // JSON re-serialized and losing a consumer's formatting. The skipped report is the
    // other half of the stdout contract: a silent skip leaves the user unable to tell an
    // idempotent no-op from a run that failed.
    init();
    const snapshot = new Map(ARTIFACTS.map((rel) => [rel, read(rel)]));

    const second = init();

    for (const rel of ARTIFACTS) {
      expect(read(rel), rel).toBe(snapshot.get(rel));
    }
    expect(second.created).toEqual([]);
    expect([...second.skipped].sort()).toEqual([...ARTIFACTS].sort());
  });

  it('leaves a pre-existing grok hook file untouched while still creating the other artifacts', () => {
    // A hook regenerated over an existing file silently replaces a consumer's pinned or
    // customized delegator; an init early-returning on the first existing artifact leaves
    // the project with a hook and no JSON registration, so the host is never told to spawn
    // it — zero verdicts, zero telemetry rows.
    const custom = '// consumer-customized grok delegator\n';
    mkdirSync(join(projectRoot, dirname(HOOK_REL)), { recursive: true });
    writeFileSync(join(projectRoot, HOOK_REL), custom);

    const result = init();

    expect(read(HOOK_REL)).toBe(custom);
    expect(result.skipped).toContain(HOOK_REL);
    expect(existsSync(join(projectRoot, JSON_REL))).toBe(true);
    expect(existsSync(join(projectRoot, CONFIG_REL))).toBe(true);
    expect(grokCommands()).toEqual([GROK_HOOK_COMMAND]);
  });
});

describe('existing Claude delegator is reused — one command string, never two', () => {
  it('does not create a grok hook when the Claude delegator exists; JSON command points at that file', () => {
    // Two different command strings mean the host spawns two judges per call, doubling
    // every verdict and every telemetry row. The reuse condition is the Claude file's
    // presence, not a settings.json merge: planting a grok mjs alongside it is the second
    // command, even if the JSON names only one of them. Reporting the grok path as
    // skipped would also lie — the file was never there.
    const claudeHook = '// existing Claude delegator\n';
    mkdirSync(join(projectRoot, dirname(CLAUDE_HOOK_REL)), { recursive: true });
    writeFileSync(join(projectRoot, CLAUDE_HOOK_REL), claudeHook);

    const result = init();

    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(false);
    expect(result.created).not.toContain(HOOK_REL);
    expect(result.skipped).not.toContain(HOOK_REL);
    expect(read(CLAUDE_HOOK_REL)).toBe(claudeHook);
    expect(existsSync(join(projectRoot, JSON_REL))).toBe(true);
    expect(grokCommands()).toEqual([CLAUDE_HOOK_COMMAND]);
    expect(grokInnerHook()?.timeout).toBe(60);
    expect(existsSync(join(projectRoot, '.claude/settings.json'))).toBe(false);
  });
});

describe('the matcher follows the Claude settings entry — one (command, matcher) pair, never two', () => {
  it('copies the matcher of the settings entry whose command is the Claude delegator, verbatim', () => {
    // The host merges both registrations and collapses them only when command AND matcher
    // are byte-identical. A grok JSON that reuses the Claude command under the roster
    // matcher is a distinct pair, so the host spawns the judge twice per call. The
    // consumer's matcher is unreachable from any constant, and the entry with our command
    // is second in the file: a copy of PreToolUse[0].matcher lands on the foreign one.
    plantClaudeHook();
    writeClaudeSettings([
      claudeEntry(FOREIGN_COMMAND, FOREIGN_MATCHER),
      claudeEntry(CLAUDE_HOOK_COMMAND, CONSUMER_MATCHER),
    ]);

    init();

    expect(grokCommands()).toEqual([CLAUDE_HOOK_COMMAND]);
    expect(readGrokJson().hooks?.PreToolUse?.[0]?.matcher).toBe(CONSUMER_MATCHER);
    expect(grokInnerHook()?.timeout).toBe(60);
  });

  it('keeps the native+alias roster when settings carries no entry for the Claude delegator', () => {
    // A settings file whose only entry belongs to another tool has nothing to copy.
    // Taking that entry's matcher anyway narrows the grok registration to whatever the
    // foreign tool watches — every mutating tool outside it goes unjudged.
    plantClaudeHook();
    writeClaudeSettings([claudeEntry(FOREIGN_COMMAND, FOREIGN_MATCHER)]);

    init();

    const tokens = grokMatcherTokens();
    expect(grokCommands()).toEqual([CLAUDE_HOOK_COMMAND]);
    expect(tokens).toEqual(expect.arrayContaining(GROK_TOOL_NAMES));
    expect(tokens).toEqual(expect.arrayContaining(CLAUDE_ALIASES));
    expect(tokens).not.toContain(FOREIGN_MATCHER);
  });
});

describe('existing grok JSON is retargeted when a Claude delegator appears', () => {
  /** Values a template rewrite would not re-emit — the stay-pin for matcher and timeout. */
  const MATCHER_PIN = 'write|consumer-kept-matcher|Bash';
  const TIMEOUT_PIN = 90;

  /**
   * Compact JSON plus a trailing newline. `JSON.stringify(obj, null, 2)` cannot emit this
   * shape, so a parse-and-dump that kept the command still fails byte-identity.
   */
  function compactGrokJson(command: string): string {
    return `{"hooks":{"PreToolUse":[{"matcher":${JSON.stringify(MATCHER_PIN)},"hooks":[{"type":"command","command":${JSON.stringify(command)},"timeout":${TIMEOUT_PIN}}]}]}}\n`;
  }

  function writeGrokJson(command: string): string {
    mkdirSync(join(projectRoot, dirname(JSON_REL)), { recursive: true });
    const body = compactGrokJson(command);
    writeFileSync(join(projectRoot, JSON_REL), body);
    return body;
  }

  it('rewrites a grok-mjs command to the Claude-hook command; matcher, timeout, and the grok mjs stay', () => {
    // Once a Claude delegator is on disk, a grok JSON still naming the grok mjs is a
    // second command string and the host spawns two judges. Rebuilding the JSON from a
    // template also resets matcher and timeout; deleting the grok mjs removes a file
    // that was not the rewrite target.
    writeGrokJson(GROK_HOOK_COMMAND);
    const grokMjs = '// consumer grok delegator — must survive retarget\n';
    mkdirSync(join(projectRoot, dirname(HOOK_REL)), { recursive: true });
    writeFileSync(join(projectRoot, HOOK_REL), grokMjs);
    plantClaudeHook();

    init();

    expect(grokCommands()).toEqual([CLAUDE_HOOK_COMMAND]);
    expect(readGrokJson().hooks?.PreToolUse?.[0]?.matcher).toBe(MATCHER_PIN);
    expect(grokInnerHook()?.timeout).toBe(TIMEOUT_PIN);
    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(true);
    expect(read(HOOK_REL)).toBe(grokMjs);
  });

  it('leaves a consumer-custom command byte-identical', () => {
    // The rewrite key is exact equality with the grok-mjs command. Any other string is
    // the consumer's spawn target — replacing it with the Claude hook steals a
    // registration they pointed elsewhere. Byte-identity is the pin: parse-and-dump
    // that happens to keep the command still rewrote their file.
    const body = writeGrokJson(CUSTOM_GROK_COMMAND);
    plantClaudeHook();

    init();

    expect(read(JSON_REL)).toBe(body);
  });

  it('retargets the command AND takes the matcher of the Claude settings entry; timeout stays', () => {
    // A retarget that rewrites only the command leaves the grok JSON as (Claude command,
    // old matcher) — a pair the host does not collapse against (Claude command, settings
    // matcher), so the judge spawns twice per call. The timeout is not part of the pair
    // and a consumer's value must survive.
    writeGrokJson(GROK_HOOK_COMMAND);
    plantClaudeHook();
    writeClaudeSettings([claudeEntry(CLAUDE_HOOK_COMMAND, CONSUMER_MATCHER)]);

    init();

    expect(grokCommands()).toEqual([CLAUDE_HOOK_COMMAND]);
    expect(readGrokJson().hooks?.PreToolUse?.[0]?.matcher).toBe(CONSUMER_MATCHER);
    expect(grokInnerHook()?.timeout).toBe(TIMEOUT_PIN);
  });

  it('syncs the matcher of an entry that already names the Claude-hook command; timeout stays', () => {
    // A tree installed before the matcher rule exists — or written by the fallback while
    // settings had no entry yet — already carries the Claude command with the old roster
    // matcher. Gating the copy on a command rewrite leaves that pair different for good:
    // re-running either installer writes nothing, and only a hand edit or deleting the
    // JSON ends the double spawn.
    writeGrokJson(CLAUDE_HOOK_COMMAND);
    plantClaudeHook();
    writeClaudeSettings([claudeEntry(CLAUDE_HOOK_COMMAND, CONSUMER_MATCHER)]);

    init();

    expect(grokCommands()).toEqual([CLAUDE_HOOK_COMMAND]);
    expect(readGrokJson().hooks?.PreToolUse?.[0]?.matcher).toBe(CONSUMER_MATCHER);
    expect(grokInnerHook()?.timeout).toBe(TIMEOUT_PIN);
  });

  it('leaves a consumer-custom command byte-identical even when settings carries a Claude entry', () => {
    // The matcher copy is keyed on the rewrite, not on the settings file: a sync that
    // runs over every grok entry once a Claude settings entry exists overwrites the
    // matcher of a registration the consumer pointed elsewhere.
    const body = writeGrokJson(CUSTOM_GROK_COMMAND);
    plantClaudeHook();
    writeClaudeSettings([claudeEntry(CLAUDE_HOOK_COMMAND, CONSUMER_MATCHER)]);

    init();

    expect(read(JSON_REL)).toBe(body);
  });
});

describe('preflight — resolution proven before any write', () => {
  it('throws an error naming polydeukes and creates ZERO files when the injected resolver fails', () => {
    // Any write ordered before the preflight leaves a partial tree, the worst failure
    // shape: a generated hook whose import can never resolve blocks every call through its
    // own catch, with no config and no witness valve to open. The message must name the
    // package — the stub's own message deliberately does not — so the bin's exit-2 output
    // can tell the user what to install.
    expect(() => initGrok({ projectRoot, resolvePolydeukes: resolutionFails })).toThrow(
      /polydeukes/,
    );

    expect(readdirSync(projectRoot)).toEqual([]);
  });

  it('throws and creates ZERO files with NO injected resolver on a tree where polydeukes cannot resolve', () => {
    // The ONE case that runs the DEFAULT preflight resolver — no stub. The seam-argument
    // pin below cannot catch a wrong anchor, because injecting a stub replaces the very
    // resolver under observation; this call can. Anchored at the TARGET root, resolution
    // walks the tmpdir's ancestors, finds no `polydeukes`, and throws before any write.
    // Anchored at the installer's own module, it would find THIS repository's own install
    // and succeed — a no-throw here IS that failure.
    expect(() => initGrok({ projectRoot })).toThrow(/polydeukes/);

    expect(readdirSync(projectRoot)).toEqual([]);
  });

  it('hands the injected preflight seam the TARGET project root, exactly once', () => {
    // The seam's calling contract: whatever resolver a caller provides is consulted about
    // the TARGET root, once. An installer probing some other directory — its cwd, its
    // module dir — with the caller's resolver would report resolution state for the wrong
    // tree, and a double consultation would run the probe's side effects twice.
    const seen: string[] = [];
    initGrok({
      projectRoot,
      resolvePolydeukes: (from) => {
        seen.push(from);
      },
    });

    expect(seen).toEqual([projectRoot]);
  });
});

describe('bin wiring — pdks init grok', () => {
  it('bin.ts branches on init grok, dynamically imports the installer, and lists the command in usage', () => {
    // A usage line that names the command without a branch that runs it prints help for a
    // verb that never runs; a branch without a usage listing makes a mistyped `init grok`
    // look like an unknown command rather than a documented one. The dynamic import keeps
    // the installer off `covenant check`'s load path — a static import would pull it in on
    // every pre-commit spawn.
    const source = readFileSync(resolve(import.meta.dirname, '../src/bin.ts'), 'utf-8');

    expect(source).toMatch(/args\[1\] === ['"]grok['"]/);
    expect(source).toMatch(/import\(\s*['"]\.\/init-grok\.js['"]\s*\)/);
    expect(source).toMatch(/usage:.*init grok/);
  });

  it('the package exports map does not grow a ./grok subpath', () => {
    // The generated hook imports polydeukes/claude-code; a new surface entry point would
    // widen the closed list and ship a second assembly for a host that does not need one.
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf-8'),
    ) as { exports: Record<string, unknown> };

    expect(manifest.exports).not.toHaveProperty('./grok');
  });
});
