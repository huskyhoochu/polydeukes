import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// `runCovenantCheck({ repoRoot, input })`: the commit surface judges an IR it is handed,
// never one it collects. Nothing here initialises git unless the case is about the
// difference between the index and the disk — the runner must judge a plain directory,
// because a runner that still spawns git would fail closed in one. One dispatch per
// toolCall, the world's change set is the paths with evidence, the world's files come from
// the working tree, and a protected path blocks with no surface-level softening.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { STAGED_DELETE, STAGED_WRITE } from '../src/diff-ir.ts';
import {
  createCheckRepo,
  REAL_COVENANT_DIST,
  type RecordedCall,
  recordingDist,
  telemetryRows,
  writeConfigAt,
} from './helpers.ts';

/** Injected fixture values. */
const PROTECTED_ENTRY = 'secret.txt';
const ORDINARY_A = 'notes/a.txt';
const ORDINARY_B = 'notes/b.txt';
const BINARY_FILE = 'assets/blob.bin';
const PLANNED_PRESENT = 'locales/en.json';
const PLANNED_MISSING = 'locales/missing.json';
const PLANNED_LINK = 'locales/link.json';
const LINK_TARGET = 'locales/target.json';
const DISK_CONTENT = '{"disk":true}\n';
const INDEX_CONTENT = '{"index":true}\n';
const WITNESS_TOKEN = 'agreed-token';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
/** The runner's own label — the row an unrouted call leaves (one call, one record). */
const CHECK_LABEL = 'covenant-check';
/** The label a run that failed closed before judging writes its one blocked row under. */
const FAIL_CLOSED_LABEL = 'covenant-check';

function ir(toolCalls: CovenantInput['toolCalls']): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [] };
}

function writeCall(path: string): CovenantInput['toolCalls'][number] {
  return {
    name: STAGED_WRITE,
    args: { file_path: path },
    fileChange: { kind: 'create', path, post: 'text\n' },
  };
}

let repoRoot: string;
/** Telemetry, the recording dist, and its log live outside the observed directory. */
let outside: string;
let telemetryPath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-check-input-'));
  outside = mkdtempSync(join(tmpdir(), 'pdks-check-input-outside-'));
  telemetryPath = join(outside, 'roi.log');
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeOnDisk(relPath: string, content: string | Buffer): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function dispatches(calls: () => RecordedCall[]): Extract<RecordedCall, { kind: 'dispatch' }>[] {
  return calls().filter(
    (call): call is Extract<RecordedCall, { kind: 'dispatch' }> => call.kind === 'dispatch',
  );
}

describe("a protected path in the input — advised by default, blocked on the caller's opt-in", () => {
  it('exits 0 with an advised self-mod row naming the path, in a directory that is not a git repository', async () => {
    // The judged unit is the IR. A runner that still collects from git fails closed here
    // under the covenant-check label instead of judging; a runner that reads the
    // configured witness token from somewhere records `witnessed`. The default posture is
    // advise: this surface has no valve a human could answer, so a block here would only
    // ever stop a human.
    writeConfigAt(repoRoot, telemetryPath, {
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 10 },
    });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_ENTRY)]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });

    expect(result.exitCode).toBe(0);
    const rows = telemetryRows(telemetryPath);
    expect(rows).toEqual([['advised', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
  });

  it('exits 2 with a blocked self-mod row under enforce: block', async () => {
    // The opt-in is the caller's, per run: a runner that ignores it lands advised.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_ENTRY)]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
  });

  it('still exits 2 under enforce: block when the config carries adapters.git.enforce: advise — the namespace is not read', async () => {
    // The deleted namespace must not survive as a softening key: a runner that keeps
    // reading it composes lenient-wins and lands the same change `advised` at exit 0.
    writeConfigAt(repoRoot, telemetryPath, {
      protectedPaths: [PROTECTED_ENTRY],
      adapters: { git: { enforce: 'advise' } },
    });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_ENTRY)]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toContainEqual([
      'blocked',
      SELF_MOD_LABEL,
      PROTECTED_ENTRY,
    ]);
  });

  it('a path listed only under adapters.git.protectedPaths passes; the same path on the common list is judged', async () => {
    // The commit-additive list is no longer read: only the common list protects. A runner
    // that still unions the two blocks the first run; a runner that reads neither list
    // passes the second.
    const additive = 'extra.txt';
    writeConfigAt(repoRoot, telemetryPath, {
      protectedPaths: [PROTECTED_ENTRY],
      adapters: { git: { protectedPaths: [additive] } },
    });
    const fromAdditive = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(additive)]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });
    expect(fromAdditive.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([['passed', CHECK_LABEL, additive]]);

    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY, additive] });
    const fromCommon = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(additive)]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });
    expect(fromCommon.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([
      ['passed', CHECK_LABEL, additive],
      ['advised', SELF_MOD_LABEL, additive],
    ]);
  });

  it('a protected path between two ordinary writes exits 2 under enforce: block with rows passed, blocked, passed in order', async () => {
    // The exit is the worst dispatch, not the last: a runner that returns the final
    // dispatch's exit code exits 0 here while the middle row says blocked.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_A), writeCall(PROTECTED_ENTRY), writeCall(ORDINARY_B)]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([
      ['passed', CHECK_LABEL, ORDINARY_A],
      ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ['passed', CHECK_LABEL, ORDINARY_B],
    ]);
  });

  it('a deletion of a protected path is judged under the delete tool name', async () => {
    // The self-mod registration must list both tool names as mutating; a runner that
    // registers the write name alone lets `git rm` of a gate definition through unrecorded.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([
        {
          name: STAGED_DELETE,
          args: { file_path: PROTECTED_ENTRY },
          fileChange: { kind: 'delete', path: PROTECTED_ENTRY },
        },
      ]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([['advised', SELF_MOD_LABEL, PROTECTED_ENTRY]]);
  });
});

describe('ordinary input passes, one row per toolCall', () => {
  it('one ordinary write exits 0 with exactly one passed row', async () => {
    // The over-blocking side, and the proof the run judged rather than skipped: zero rows
    // would mean nothing was dispatched.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_A)]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([['passed', CHECK_LABEL, ORDINARY_A]]);
  });

  it('two toolCalls leave two rows in input order', async () => {
    // A runner that dispatches the whole input once leaves one row for two files, and the
    // second file's subject never appears.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_A), writeCall(ORDINARY_B)]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([
      ['passed', CHECK_LABEL, ORDINARY_A],
      ['passed', CHECK_LABEL, ORDINARY_B],
    ]);
  });

  it('an input with no toolCalls exits 0 and leaves no row', async () => {
    // The empty observation is an explicit pass, not a fail-closed exit and not a row.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([]),
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });

    expect(result).toEqual({ exitCode: 0 });
    expect(telemetryRows(telemetryPath)).toEqual([]);
  });
});

describe('an input carrying a world key fails closed', () => {
  it('exits 2 with exactly one blocked covenant-check row and dispatches nothing', async () => {
    // The world axis is the runner's to fill. An input that supplies its own would let a
    // client hand the judge the files it wants read; a runner that merges or overwrites it
    // dispatches, and the recording dist would see the call.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });
    const { distDir, calls } = recordingDist(outside, []);

    const result = await runCovenantCheck({
      repoRoot,
      input: { ...ir([writeCall(ORDINARY_A)]), world: { files: {} } },
      telemetryPath,
      covenantDist: distDir,
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
    expect(dispatches(calls)).toEqual([]);
  });
});

describe('the world every dispatch receives', () => {
  it('changes lists the paths of the toolCalls that carry evidence, in input order, on every dispatch', async () => {
    // Three calls, one of them binary (no evidence): three dispatches, each seeing the two
    // evidence-bearing paths. A runner that hands each dispatch its own path turns every
    // pairing declaration into a one-element vacuity; one that lists the binary path
    // hands the pairing a path no world answers for.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });
    const { distDir, calls } = recordingDist(outside, []);
    const input = ir([
      writeCall(ORDINARY_A),
      { name: STAGED_WRITE, args: { file_path: BINARY_FILE } },
      {
        name: STAGED_DELETE,
        args: { file_path: ORDINARY_B },
        fileChange: { kind: 'delete', path: ORDINARY_B },
      },
    ]);

    const result = await runCovenantCheck({
      repoRoot,
      input,
      telemetryPath,
      covenantDist: distDir,
    });

    expect(result.exitCode).toBe(0);
    expect(dispatches(calls).map((call) => call.world?.changes)).toEqual([
      [ORDINARY_A, ORDINARY_B],
      [ORDINARY_A, ORDINARY_B],
      [ORDINARY_A, ORDINARY_B],
    ]);
  });

  it('files carries the disk text of a planned file, no key for a missing one, and no key for NUL-carrying bytes', async () => {
    // The reader is the working tree. Absence must be an absent key — `''` or `null`
    // under the path would pass the engine's presence test as supplied text — and bytes
    // with a NUL are not text.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });
    writeOnDisk(PLANNED_PRESENT, DISK_CONTENT);
    writeOnDisk(BINARY_FILE, Buffer.from('ab\0cd'));
    const { distDir, calls } = recordingDist(outside, [
      PLANNED_PRESENT,
      PLANNED_MISSING,
      BINARY_FILE,
    ]);

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_A)]),
      telemetryPath,
      covenantDist: distDir,
    });

    expect(result.exitCode).toBe(0);
    expect(dispatches(calls).map((call) => call.world?.files)).toEqual([
      { [PLANNED_PRESENT]: DISK_CONTENT },
    ]);
  });

  it('files follows a symlink to its target text', async () => {
    // On disk the observable fact is the target's text; a reader using lstat semantics
    // supplies the link's own path string as the file's content.
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });
    writeOnDisk(LINK_TARGET, DISK_CONTENT);
    symlinkSync(join(repoRoot, LINK_TARGET), join(repoRoot, PLANNED_LINK));
    const { distDir, calls } = recordingDist(outside, [PLANNED_LINK]);

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_A)]),
      telemetryPath,
      covenantDist: distDir,
    });

    expect(result.exitCode).toBe(0);
    expect(dispatches(calls).map((call) => call.world?.files)).toEqual([
      { [PLANNED_LINK]: DISK_CONTENT },
    ]);
  });

  it('files reads the working tree, not the index, when the two differ', async () => {
    // The one case that needs git: the same path holds one text in the index and another
    // on disk. The runner reads disk; a leftover index reader supplies the staged blob.
    const repo = createCheckRepo('pdks-check-input-tree-');
    try {
      writeConfigAt(repo.repoRoot, telemetryPath, { protectedPaths: [PROTECTED_ENTRY] });
      repo.write(PLANNED_PRESENT, INDEX_CONTENT);
      repo.git('add', PLANNED_PRESENT);
      repo.write(PLANNED_PRESENT, DISK_CONTENT);
      const { distDir, calls } = recordingDist(outside, [PLANNED_PRESENT]);

      const result = await runCovenantCheck({
        repoRoot: repo.repoRoot,
        input: ir([writeCall(ORDINARY_A)]),
        telemetryPath,
        covenantDist: distDir,
      });

      expect(result.exitCode).toBe(0);
      expect(dispatches(calls).map((call) => call.world?.files)).toEqual([
        { [PLANNED_PRESENT]: DISK_CONTENT },
      ]);
    } finally {
      repo.cleanup();
    }
  });
});
