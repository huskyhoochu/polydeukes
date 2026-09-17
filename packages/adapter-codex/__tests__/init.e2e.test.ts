import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The generated artifacts EXECUTE: the built `pdks-codex init` installs into a throwaway
// tree wired to the real install graph by symlink, and the generated delegator is spawned
// as the Codex host would spawn it — payload on stdin, nothing read back but the exit code
// and stderr. init.test.ts judges the same artifacts as text; only a spawn proves that the
// delegator loads this package, that `runHook` finds and spawns `pdks`, and that the child
// judges the patch against the GENERATED config.

const checkoutRoot = resolve(import.meta.dirname, '../../..');
const ADAPTER_BIN = resolve(import.meta.dirname, '../dist/bin.js');
/** The registration artifacts init generates — the delegator is the file every case spawns. */
const HOOK_REL = '.codex/hooks/covenant-pretooluse.mjs';
const JSON_REL = '.codex/hooks.json';
/**
 * The protected entry the generated config names for THIS host's gate definitions; a write
 * under it is self-mod. The scaffold protects it because this installer wrote it.
 */
const PROTECTED_ENTRY = '.codex/hooks';
/** Everything one install must leave behind: two registration artifacts, two scaffold ones. */
const ARTIFACTS = [HOOK_REL, JSON_REL, 'polydeukes.config.yaml', '.gitignore'];
/**
 * A path this repository's own config protects and the generated config does not. Only
 * such a target catches a repoRoot mutant: a hook or a child anchored on the runner's cwd
 * lands on THIS checkout and reads its config — an ordinary target would pass there too.
 */
const DOGFOODING_ONLY_PROTECTED = 'lefthook.yml';
/** The generated config names no log path, so the child writes the default under the project. */
const TELEMETRY_REL = '.polydeukes/roi.log';
/** The label the runner's own rows carry — an unrouted pass, or a fail-closed block. */
const RUNNER_LABEL = 'covenant-check';
const APPLY_PATCH = 'apply_patch';
const BASH = 'Bash';
const FAILURE_PREFIX = 'adapter-codex failed before spawn:';
const DEFAULT_WITNESS_TOKEN = 'pdks witness';
/** The Code Mode dispatch name — a tool the host never routes through PreToolUse. */
const EXEC = 'exec';
/** The fixed notice the installer prints after the /hooks line. */
const UNOBSERVED_SURFACE_NOTE =
  'note: Code Mode exec dispatches, and the tool calls nested in them, do not reach PreToolUse in codex-cli 0.154 (openai/codex#23411); an approved hook does not observe that surface';

let projectRoot: string;

beforeAll(() => {
  // The adapter bin and the umbrella bin it spawns both come from dist; turbo caching makes
  // repeat runs cheap.
  execSync('pnpm turbo run build', { cwd: checkoutRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  // Realpath'd so the delegator's own location, the child's cwd, and the paths this file
  // builds agree on macOS, where tmpdir is a symlink.
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-codex-init-e2e-')));
});

afterEach(() => {
  // rmSync removes symlinks themselves, never what they point at.
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * The whole real install graph, one symlink, then the built installer. `polydeukes` and
 * this package then resolve from the fixture to their real builds.
 */
function installIntoFixture() {
  symlinkSync(join(checkoutRoot, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  return spawnSync(process.execPath, [ADAPTER_BIN, 'init'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
}

/**
 * Spawn the fixture's generated delegator with one payload. No cwd on purpose: the hook
 * inherits the runner's working directory, so only its own file location can name the
 * project it defends.
 */
function spawnGeneratedHook(payload: unknown) {
  return spawnSync(process.execPath, [join(projectRoot, HOOK_REL)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf-8',
  });
}

/** Every telemetry row under the fixture as [event, label, subject]. */
function rows(): [string, string, string][] {
  const path = join(projectRoot, TELEMETRY_REL);
  if (!existsSync(path)) return [];
  return readRecords(path).records.map((record) => [record.event, record.label, record.subject]);
}

/** One schema-valid snake_case envelope with the fixture as cwd. */
function envelope(toolName: string, toolInput: Record<string, unknown>) {
  return {
    cwd: projectRoot,
    hook_event_name: 'PreToolUse',
    model: 'gpt-5.3-codex',
    permission_mode: 'default',
    session_id: 'sess-e2e',
    tool_input: toolInput,
    tool_name: toolName,
    tool_use_id: 'call-e2e',
    transcript_path: join(projectRoot, 'transcript.jsonl'),
    turn_id: 'turn-e2e',
  };
}

function patchPayload(...hunks: string[][]) {
  return envelope(APPLY_PATCH, {
    command: ['*** Begin Patch', ...hunks.flat(), '*** End Patch', ''].join('\n'),
  });
}

function userPromptPayload(prompt: string) {
  return {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'sess-e2e',
    prompt,
  };
}

function addHunk(path: string, ...lines: string[]): string[] {
  return [`*** Add File: ${path}`, ...lines.map((line) => `+${line}`)];
}

function writeFixture(relative: string, content: string): string {
  const absolute = join(projectRoot, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

describe('pdks-codex init on a real install graph', () => {
  it('exits 0, leaves the four artifacts, tells the user to approve in /hooks, and rewrites nothing on a re-run', () => {
    // The installer's end-to-end contract: preflight passes through the symlinked graph,
    // the umbrella scaffold runs in the fixture, the two registration artifacts follow, and
    // the user is told the one step no file can do for them. The re-run pins the trust
    // hash: hooks.json byte-identical, nothing reported created.
    const first = installIntoFixture();

    expect(first.status, first.stderr).toBe(0);
    for (const rel of ARTIFACTS) {
      expect(existsSync(join(projectRoot, rel)), rel).toBe(true);
    }
    expect(first.stdout).toContain('/hooks');
    const registration = readFileSync(join(projectRoot, JSON_REL), 'utf-8');

    const second = spawnSync(process.execPath, [ADAPTER_BIN, 'init'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    expect(second.status).toBe(0);
    expect(second.stdout).not.toMatch(/^created /m);
    expect(readFileSync(join(projectRoot, JSON_REL), 'utf-8')).toBe(registration);
  });

  it('tells the user, after the /hooks line, that Code Mode exec dispatches do not reach PreToolUse', () => {
    // An approved hook shows "Active" in /hooks, and the user reads that as coverage of
    // every edit the agent makes. On codex-cli 0.154 a Code Mode `exec` dispatch, and the
    // `tools.apply_patch` nested in it, fire no PreToolUse event, so the session surface
    // never sees them. The line must be the fixed sentence (a paraphrase drifts from the
    // README's declared limit) and must follow the `next:` line, so the approval step is
    // read first and the notice is not mistaken for a step to perform.
    const first = installIntoFixture();

    expect(first.status, first.stderr).toBe(0);
    const lines = first.stdout.split('\n');
    const nextIndex = lines.findIndex((line) => line.startsWith('next: run /hooks'));
    const noteIndex = lines.indexOf(UNOBSERVED_SURFACE_NOTE);
    expect(nextIndex).toBeGreaterThanOrEqual(0);
    expect(noteIndex).toBeGreaterThan(nextIndex);
  });

  it('refuses any argv but `init` with usage on stderr and exit 2', () => {
    // An unknown argument must never be read as `init`: a typo would install into the cwd.
    const result = spawnSync(process.execPath, [ADAPTER_BIN, 'install'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/i);
    expect(existsSync(join(projectRoot, HOOK_REL))).toBe(false);
  });
});

describe('the generated delegator judges real payloads', () => {
  it('passes a single-file patch only the dogfooding config would block: exit 0, one verdict row, empty stdout', () => {
    // A repoRoot anchored near the runner's cwd reads THIS checkout's config, which
    // protects this target — exit 2 instead of 0. The row pin separates a pass from the
    // defect class: a pass with NO row is a hook that never reached the judge. Empty
    // stdout is the host contract: Codex parses whatever lands there as a decision.
    expect(installIntoFixture().status).toBe(0);

    const result = spawnGeneratedHook(
      patchPayload(addHunk(DOGFOODING_ONLY_PROTECTED, 'pre-commit:', '  commands: {}')),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    const verdictRows = rows().filter(([, label]) => label === RUNNER_LABEL);
    expect(verdictRows).toHaveLength(1);
    expect(verdictRows[0]?.slice(0, 2)).toEqual(['passed', RUNNER_LABEL]);
  });

  it('blocks a patch adding a file under a protected entry: exit 2, reason on stderr, self-mod row, empty stdout', () => {
    // The gate entry executing rather than grep'd. The exact-row pin separates a verdict
    // from a fail-closed crash on the same exit code: a crash records under the runner's
    // label, never under self-mod. The child's stderr is inherited through the delegator,
    // so the break reason reaches the host; its stdout is not.
    expect(installIntoFixture().status).toBe(0);

    const result = spawnGeneratedHook(patchPayload(addHunk(`${PROTECTED_ENTRY}/extra.mjs`, '{}')));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(PROTECTED_ENTRY);
    expect(result.stderr).toMatch(/UserPromptSubmit/i);
    expect(result.stderr).toMatch(/witness/i);
    expect(result.stderr).toMatch(/terminal/i);
    expect(rows()).toContainEqual(['blocked', 'self-mod', PROTECTED_ENTRY]);
    expect(rows().filter(([event]) => event === 'blocked')).toHaveLength(1);
  });

  it('releases the next protected patch after a human witness arrives through UserPromptSubmit', () => {
    // This is the assembled valve: recording without reading leaves the patch blocked;
    // reading without the receive timestamp makes it stale; and a generated hooks file
    // that registered only PreToolUse never delivers the human message at all. The row
    // distinguishes a witnessed verdict from a crash or an unrouted pass at the same exit 0.
    expect(installIntoFixture().status).toBe(0);

    const prompt = spawnGeneratedHook(userPromptPayload(DEFAULT_WITNESS_TOKEN));
    const retried = spawnGeneratedHook(
      patchPayload(addHunk(`${PROTECTED_ENTRY}/witnessed.mjs`, 'export {};')),
    );

    expect(prompt.status, prompt.stderr).toBe(0);
    expect(prompt.stdout).toBe('');
    expect(retried.status, retried.stderr).toBe(0);
    expect(retried.stdout).toBe('');
    expect(rows()).toContainEqual(['witnessed', 'self-mod', PROTECTED_ENTRY]);
    expect(
      rows().filter(([event, label]) => event === 'witnessed' && label === 'self-mod'),
    ).toHaveLength(1);
  });

  it('blocks a patch mixing a protected and an unprotected file, on the protected one', () => {
    // One IR, two elements, one spawn: an adapter carrying only the first hunk stops at the
    // harmless file and the call passes, so the block itself is what proves the second
    // element rode along. Rows are counted per routed registration rather than per file, so
    // only the blocking one is pinned — a second block would mean the harmless file broke
    // something too.
    expect(installIntoFixture().status).toBe(0);

    const result = spawnGeneratedHook(
      patchPayload(
        addHunk('notes/harmless.md', 'hello'),
        addHunk(`${PROTECTED_ENTRY}/x.mjs`, '{}'),
      ),
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(rows()).toContainEqual(['blocked', 'self-mod', PROTECTED_ENTRY]);
    expect(rows().filter(([event]) => event === 'blocked')).toHaveLength(1);
  });

  it('blocks a `Move to` whose destination is under a protected entry', () => {
    // The source is harmless; only the destination is protected. A delegator judging the
    // source path alone lets the rename carry a file into the gate directory.
    expect(installIntoFixture().status).toBe(0);
    writeFixture('notes/plain.txt', 'plain\n');

    const result = spawnGeneratedHook(
      patchPayload([
        '*** Update File: notes/plain.txt',
        `*** Move to: ${PROTECTED_ENTRY}/plain.txt`,
        '@@',
        '-plain',
        '+moved',
      ]),
    );

    expect(result.status).toBe(2);
    expect(rows()).toContainEqual(['blocked', 'self-mod', PROTECTED_ENTRY]);
  });

  it('blocks a `Move to` whose source is under a protected entry and destination is not', () => {
    // The other direction: carrying a gate file OUT of the protected directory. A
    // delegator judging the destination alone sees `notes/…` and passes the rename that
    // removes the judge's own registration.
    expect(installIntoFixture().status).toBe(0);

    const result = spawnGeneratedHook(
      patchPayload([
        `*** Update File: ${PROTECTED_ENTRY}/covenant-pretooluse.mjs`,
        '*** Move to: notes/parked.mjs',
      ]),
    );

    expect(result.status).toBe(2);
    expect(rows()).toContainEqual(['blocked', 'self-mod', PROTECTED_ENTRY]);
  });

  it('blocks a Bash command that mentions a protected entry without a read-only head', () => {
    // The shell axis through the real roster: `Bash` must be on `tools.shell`, or the
    // mention is never compared and the deletion of the gate directory passes.
    expect(installIntoFixture().status).toBe(0);

    const result = spawnGeneratedHook(envelope(BASH, { command: `rm -rf ${PROTECTED_ENTRY}` }));

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(rows()).toContainEqual(['blocked', 'shell-mod', PROTECTED_ENTRY]);
  });

  it('fails closed on a patch the grammar refuses: exit 2, the adapter’s reason on stderr, no passed row', () => {
    // The envelope is valid and the tool name is on the roster; only the patch is broken.
    // A pass here is an `apply_patch` call judged with no evidence and no path.
    expect(installIntoFixture().status).toBe(0);

    const result = spawnGeneratedHook(
      envelope(APPLY_PATCH, { command: '*** Begin Patch\n*** End Patch\n' }),
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(FAILURE_PREFIX);
    expect(rows().filter(([event]) => event === 'passed')).toHaveLength(0);
    expect(rows()).toContainEqual(['blocked', RUNNER_LABEL, expect.any(String)]);
  });

  it('fails closed on a Code Mode exec payload nesting apply_patch on a protected entry: exit 2, no passed row, blocked runner row', () => {
    // The issue's own payload: a valid envelope under `exec`, whose JavaScript rewrites a
    // file under the gate directory through `tools.apply_patch`. The adapter parses no
    // JavaScript, so it cannot judge the nested write — and an adapter that builds an IR
    // element under `exec` anyway lands `passed covenant-check -` at exit 0 while the gate
    // file changes. The runner label separates the fail-closed refusal from a self-mod
    // verdict the adapter could not have reached.
    expect(installIntoFixture().status).toBe(0);
    const patch = [
      '*** Begin Patch',
      ...addHunk(`${PROTECTED_ENTRY}/extra.mjs`, '{}'),
      '*** End Patch',
      '',
    ].join('\n');

    const result = spawnGeneratedHook(
      envelope(EXEC, { command: `await tools.apply_patch(${JSON.stringify(patch)});` }),
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(FAILURE_PREFIX);
    expect(result.stderr).toContain(`'${EXEC}'`);
    const recorded = rows();
    expect(recorded.filter(([event]) => event === 'passed')).toHaveLength(0);
    expect(recorded.at(-1)?.slice(0, 2)).toEqual(['blocked', RUNNER_LABEL]);
  });

  it('fails closed on an envelope missing a required key: exit 2, no passed row', () => {
    // `turn_id` is not read by the judgment, which is exactly why an adapter validating
    // only what it reads would let this through.
    expect(installIntoFixture().status).toBe(0);
    const { turn_id: _dropped, ...partial } = patchPayload(addHunk('notes/x.md', 'x'));

    const result = spawnGeneratedHook(partial);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(FAILURE_PREFIX);
    expect(rows().filter(([event]) => event === 'passed')).toHaveLength(0);
  });
});
