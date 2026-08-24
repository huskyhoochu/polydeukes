// CONFIG-11 AC-4 / POSTURE-01 AC-2·AC-3 — the session surface honours an entry's
// `enforce`, and an entry that omits it lands at advise, proven by
// spawning the REAL PreToolUse hook (the shipped delegator, the real built dist, a real
// discipline body) against a fixture tree carrying a config the test authors. A green
// unit suite does not substitute for this spawn (judging-paths-and-shells): the unit
// tests prove the branch that was written, the spawn proves the branch that runs. The
// spawn shape is the CONFIG-08 fixture-tree case in the adapter's assembly e2e — hook
// copied into a temp tree whose `packages` and `node_modules` link back to the real
// install graph, so the delegator's bare-specifier imports resolve.
import { execSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const hookPath = join(repoRoot, '.claude/hooks/covenant-pretooluse.mjs');

// ---------------------------------------------------------------------------
// Injected fixture values. The forbidden command is synthetic (never a real tool), the
// protected entry is the git-untracked directory only the session surface can watch
// (CONFIG-08 M2), and the why is real rationale prose — it must reach stderr verbatim.
// The ids avoid the word `advise` so a row/stream containment check never matches the
// label by accident.
// ---------------------------------------------------------------------------

const SOFT_ID = 'softly-held-command';
const PLAIN_ID = 'plainly-held-command';
const HARD_ID = 'hardly-held-command';
const FORBIDDEN_COMMAND = 'zzz_probe_cmd';
const SOFT_WHY = 'the probe command reshapes state no review has seen';
const PROTECTED_ENTRY = '.git/hooks';
/** The meta-covenant that owns the tool-axis block on PROTECTED_ENTRY. */
const META_LABEL = 'self-mod';

let tmpRoot: string;
let telemetryPath: string;

beforeAll(() => {
  // The hook imports built dist; turbo caching makes repeat runs ~1s.
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pdks-session-enforce-'));
  telemetryPath = join(tmpRoot, 'roi.log');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Copy the real hook into a fixture tree carrying `disciplines`, then spawn it on `payload`. */
function runHookWithDisciplines(disciplines: unknown[], payload: unknown) {
  const fixtureRoot = join(tmpRoot, 'fixture-tree');
  mkdirSync(join(fixtureRoot, '.claude', 'hooks'), { recursive: true });
  cpSync(hookPath, join(fixtureRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs'));
  symlinkSync(join(repoRoot, 'packages'), join(fixtureRoot, 'packages'), 'dir');
  symlinkSync(join(repoRoot, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');
  writeFileSync(
    join(fixtureRoot, 'polydeukes.config.json'),
    JSON.stringify(
      {
        languages: { typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' } },
        telemetry: { logPath: telemetryPath },
        protectedPaths: [PROTECTED_ENTRY],
        disciplines,
      },
      null,
      2,
    ),
  );
  return spawnSync(
    process.execPath,
    [join(fixtureRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs')],
    {
      input: JSON.stringify(payload),
      encoding: 'utf-8',
      env: { ...process.env, POLYDEUKES_TELEMETRY_PATH: telemetryPath },
    },
  );
}

/** Every judged row as [event, label] — the state comparison's own rows are on another axis. */
function judgedRows(): [string, string][] {
  return readRecords(telemetryPath)
    .records.filter((record) => record.event !== 'unattributed')
    .map((record) => [record.event, record.label]);
}

function bashPayload(command: string) {
  return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } };
}

function writePayload(filePath: string, content: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

const softEntry = {
  id: SOFT_ID,
  forbidCommand: FORBIDDEN_COMMAND,
  why: SOFT_WHY,
  enforce: 'advise',
};
const plainEntry = { id: PLAIN_ID, forbidCommand: FORBIDDEN_COMMAND, why: SOFT_WHY };
const hardEntry = {
  id: HARD_ID,
  forbidCommand: FORBIDDEN_COMMAND,
  why: SOFT_WHY,
  enforce: 'block',
};

/** The call that breaks the command entry: the forbidden command at the head of the line. */
const breakingCall = bashPayload(`${FORBIDDEN_COMMAND} --run`);

describe('CONFIG-11 AC-4 — real hook spawn: the session surface honours an entry at advise', () => {
  it("a call breaking an enforce: 'advise' entry exits 0 with ONE advised row and the why on stderr", () => {
    // The ticket's definition of done, observed where it lands. Three things separate a
    // real advise from the ways this can be green for the wrong reason: exit 0 alone is
    // also a no-match pass (so the row must be advised, not the adapter's passed
    // supplement); the label must be the entry (so the discipline judged, not a crash
    // recorded elsewhere); and the why must reach stderr (§4.4 — the reason's only
    // delivery). Mutation caught: the level lost anywhere between config load, compile,
    // and dispatch (exit 2 · blocked), or the config refused as unknown vocabulary
    // (exit 2 · a fail-closed row).
    const result = runHookWithDisciplines([softEntry], breakingCall);

    expect(result.status).toBe(0);
    expect(judgedRows()).toEqual([['advised', SOFT_ID]]);
    expect(result.stderr).toContain(SOFT_WHY);
  });

  it('the same call against the same entry WITHOUT enforce exits 0 · ONE advised row · why on stderr (POSTURE-01 AC-2)', () => {
    // The default rung, observed where it lands: identical payload, identical predicate,
    // only the key is absent. The row must be advised under the entry id (exit 0 alone is
    // also a no-match pass) and the why must still reach stderr — advise is a recorded
    // break, not silence. Mutation caught: the compile default left at "inherit the
    // surface" (exit 2 · blocked), or the default filled with 'block'.
    const result = runHookWithDisciplines([plainEntry], breakingCall);

    expect(result.status).toBe(0);
    expect(judgedRows()).toEqual([['advised', PLAIN_ID]]);
    expect(result.stderr).toContain(SOFT_WHY);
  });

  it("the same call against an explicit enforce: 'block' entry exits 2 · ONE blocked row (POSTURE-01 AC-3)", () => {
    // The promotion rung: the control that proves the advise default above is a default
    // and not the whole axis collapsing. Mutation caught: the compiler normalising every
    // value to advise (`'advise'` unconditionally), or the dispatcher reading the field
    // as a presence flag — either leaves an author's explicit block at exit 0.
    const result = runHookWithDisciplines([hardEntry], breakingCall);

    expect(result.status).toBe(2);
    expect(judgedRows()).toEqual([['blocked', HARD_ID]]);
  });

  it('a shell-axis meta-covenant break in the same assembly still exits 2 · blocked (shell-mod, not just self-mod)', () => {
    // POSTURE-01 §4.3 remnant 2: the shell axis routes through a different registration
    // than the tool axis, so self-mod staying at block does not prove shell-mod did. The
    // config carries an advise entry AND a plain (default-advise) command entry, neither
    // of which matches this write. Mutation caught: the compile default leaking onto meta
    // registrations built beside the disciplines on the shell axis.
    const result = runHookWithDisciplines(
      [softEntry, plainEntry],
      bashPayload(`echo 'exit 0' > ${PROTECTED_ENTRY}/pre-commit`),
    );

    expect(result.status).toBe(2);
    expect(judgedRows()).toContainEqual(['blocked', 'shell-mod']);
  });

  it('a meta-covenant break in the same assembly still exits 2 · blocked (the entry axis has no reach)', () => {
    // §4.2: meta registrations carry no entry level, so an advise entry elsewhere in the
    // config must leave the judging chain's own protection at block. Mutation caught:
    // the level applied dispatch-wide once any entry declares it, or the compiler
    // handing the level to registrations it did not compile.
    const result = runHookWithDisciplines(
      [softEntry],
      writePayload(`${PROTECTED_ENTRY}/pre-commit`, '#!/bin/sh\nexit 0\n'),
    );

    expect(result.status).toBe(2);
    expect(judgedRows()).toContainEqual(['blocked', META_LABEL]);
    expect(judgedRows()).not.toContainEqual([expect.anything(), SOFT_ID]);
  });
});
