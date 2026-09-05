// The session surface honours an entry's `enforce`, and an entry that omits it lands at
// advise — proven by spawning the REAL PreToolUse hook (the shipped delegator, the real
// built dist, a real discipline body) against a fixture tree carrying a config the test
// authors. A green unit suite does not substitute for the spawn: the unit tests cover the
// branch that was written, the spawn covers the branch that runs. The hook is copied into
// a temp tree whose `packages` and `node_modules` link back to the real install graph, so
// the delegator's bare-specifier imports resolve.
import { execSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const hookPath = join(repoRoot, '.claude/hooks/covenant-pretooluse.mjs');

// Injected fixture values. The forbidden command is synthetic and never a real tool, the
// protected entry is the git-untracked directory only the session surface can watch, and
// the why is real rationale prose that must reach stderr verbatim. The ids avoid the word
// `advise` so a containment check over a row or stream never matches a label by accident.

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

/** The ban over the command line; only the entry's level varies between the three. */
const banDeclare = {
  mechanism: 'forbidden-command',
  scope: { source: 'command' },
  extract: {
    hits: [
      { op: 'source', of: 'command' },
      { op: 'lines' },
      { op: 'matches', re: FORBIDDEN_COMMAND },
    ],
  },
  relate: [{ id: 'no-probe', relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
};

const softEntry = { id: SOFT_ID, declare: banDeclare, why: SOFT_WHY, enforce: 'advise' };
const plainEntry = { id: PLAIN_ID, declare: banDeclare, why: SOFT_WHY };
const hardEntry = { id: HARD_ID, declare: banDeclare, why: SOFT_WHY, enforce: 'block' };

/** The call that breaks the ban: the forbidden command at the head of the line. */
const breakingCall = bashPayload(`${FORBIDDEN_COMMAND} --run`);

describe('real hook spawn: the session surface honours an entry at advise', () => {
  it("a call breaking an enforce: 'advise' entry exits 0 with ONE advised row and the why on stderr", () => {
    // Three things separate a real advise from the ways this can be green for the wrong
    // reason: exit 0 alone is also a no-match pass, so the row must be advised rather than
    // the adapter's passed supplement; the label must be the entry, so the discipline
    // judged rather than a crash being recorded elsewhere; and the why must reach stderr,
    // its only delivery.
    const result = runHookWithDisciplines([softEntry], breakingCall);

    expect(result.status).toBe(0);
    expect(judgedRows()).toEqual([['advised', SOFT_ID]]);
    expect(result.stderr).toContain(SOFT_WHY);
  });

  it('the same call against the same entry WITHOUT enforce exits 0 · ONE advised row · why on stderr', () => {
    // The default rung: identical payload, identical predicate, only the key is absent.
    // The row must be advised under the entry id and the why must still reach stderr —
    // advise is a recorded break, not silence.
    const result = runHookWithDisciplines([plainEntry], breakingCall);

    expect(result.status).toBe(0);
    expect(judgedRows()).toEqual([['advised', PLAIN_ID]]);
    expect(result.stderr).toContain(SOFT_WHY);
  });

  it("the same call against an explicit enforce: 'block' entry exits 2 · ONE blocked row", () => {
    // The promotion rung, and the control proving the advise default above is a default
    // rather than the whole axis collapsing: a compiler normalising every value to advise,
    // or a dispatcher reading the field as a presence flag, would leave an author's
    // explicit block at exit 0.
    const result = runHookWithDisciplines([hardEntry], breakingCall);

    expect(result.status).toBe(2);
    expect(judgedRows()).toEqual([['blocked', HARD_ID]]);
  });

  it('a shell-axis meta-covenant break in the same assembly still exits 2 · blocked (shell-mod, not just self-mod)', () => {
    // The shell axis routes through a different registration than the tool axis, so
    // self-mod staying at block does not prove shell-mod did. The config carries an advise
    // entry AND a plain (default-advise) command entry, neither of which matches this
    // write, so an entry default leaking onto the meta registrations would show here.
    const result = runHookWithDisciplines(
      [softEntry, plainEntry],
      bashPayload(`echo 'exit 0' > ${PROTECTED_ENTRY}/pre-commit`),
    );

    expect(result.status).toBe(2);
    expect(judgedRows()).toContainEqual(['blocked', 'shell-mod']);
  });

  it('a meta-covenant break in the same assembly still exits 2 · blocked (the entry axis has no reach)', () => {
    // Meta registrations carry no entry level, so an advise entry elsewhere in the config
    // must leave the judging chain's own protection at block: the level must never be
    // applied dispatch-wide, nor handed to registrations the compiler did not build.
    const result = runHookWithDisciplines(
      [softEntry],
      writePayload(`${PROTECTED_ENTRY}/pre-commit`, '#!/bin/sh\nexit 0\n'),
    );

    expect(result.status).toBe(2);
    expect(judgedRows()).toContainEqual(['blocked', META_LABEL]);
    expect(judgedRows()).not.toContainEqual([expect.anything(), SOFT_ID]);
  });
});
