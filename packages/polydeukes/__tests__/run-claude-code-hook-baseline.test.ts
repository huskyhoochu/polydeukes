import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The post-hoc state comparison wired into the assembled session hook. At every call
// start, BEFORE this call's judgment rows land, the protected entries' on-disk state is
// compared against `.polydeukes/baseline.json`; an entry that changed with no attributing
// row in the window since the previous comparison leaves ONE `unattributed` row (label
// 'baseline', subject = the changed ENTRY, the config element). The comparison records
// and never blocks: no exit code and no judgment row changes because of it, and any
// comparison failure stays inside the hook.
import { runClaudeCodeHook } from '../src/claude-code-hook.ts';
import { telemetryRows, writeConfigAt } from './helpers';

/** Injected fixture values — the config entries and the files judged under them. */
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
const SECOND_ENTRY = 'vault';
const SECOND_FILE = 'vault/secret.txt';
/** The label every baseline row carries. */
const BASELINE_LABEL = 'baseline';
/** The label runAdapterPath records the funnel supplement under. */
const ADAPTER_LABEL = 'adapter-claude-code';
/**
 * The first-run and corruption rows carry the baseline file itself as subject. The
 * repo-relative vs absolute spelling is not part of the contract, so match the tail.
 */
const BASELINE_SUBJECT = expect.stringMatching(/baseline\.json$/);

let repoRoot: string;
let telemetryPath: string;

const rows = () => telemetryRows(telemetryPath);

const baselineFile = () => join(repoRoot, '.polydeukes', 'baseline.json');

function writeConfig(extra: Record<string, unknown>): void {
  writeConfigAt(repoRoot, telemetryPath, extra);
}

function write(relPath: string, content: string): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

/** One ordinary Write payload touching no protected path — the quiet-session call. */
function ordinaryPayload(): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: repoRoot,
    tool_name: 'Write',
    tool_input: { file_path: join(repoRoot, 'notes/ordinary.txt'), content: 'nothing special\n' },
  });
}

/** One Edit payload targeting `relTarget` (pre-state written by the caller). */
function editPayload(relTarget: string): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: repoRoot,
    tool_name: 'Edit',
    tool_input: {
      file_path: join(repoRoot, relTarget),
      old_string: 'locked: yes',
      new_string: 'locked: no',
    },
  });
}

/** Drive one assembled hook call with this suite's repo and telemetry. */
function hookCall(rawPayload: string): Promise<{ exitCode: 0 | 2 }> {
  return runClaudeCodeHook({ repoRoot, rawPayload, telemetryPath });
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-session-baseline-'));
  telemetryPath = join(repoRoot, 'roi.log');
  write(PROTECTED_FILE, 'locked: yes\n');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('baseline re-establishment', () => {
  it('first call re-establishes an absent baseline: one unattributed row (subject = the baseline file), judgment untouched', async () => {
    // Absence is an event, not a protected path: putting the baseline file on the
    // protection list would be an infinite regress, so instead its deletion stays legible
    // in the log forever. A silent re-establishment would let deleting the baseline erase
    // all detection with no trace.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
    expect(existsSync(baselineFile())).toBe(true);
  }, 20_000);

  it('a corrupt baseline file is re-established with one row, and the next call is quiet', async () => {
    // Corruption is handled exactly like absence: re-establish, one row, exit code
    // untouched. A parse failure escaping into the judgment would fail the call closed
    // over a file the covenant never protected, and a re-establishment that keeps the
    // corrupt file would alarm on every subsequent call.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    await hookCall(ordinaryPayload());

    writeFileSync(baselineFile(), '{ corrupt');
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);
});

describe('detection — out-of-band changes surface as unattributed rows', () => {
  it('an out-of-band edit under a protected entry leaves one row, subject = the ENTRY, before the judgment rows', async () => {
    // The mechanism itself: a write no tool call declared — an interpreter, a test runner
    // child, an out-of-repo script — leaves no row, and the state comparison is what makes
    // it visible. The subject is the matched ENTRY, the granularity the attribution join
    // needs, and the observation runs before this call's own judgment rows.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    await hookCall(ordinaryPayload());

    write(PROTECTED_FILE, 'locked: tampered out of band\n');
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
      ['unattributed', BASELINE_LABEL, PROTECTED_ENTRY],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);

  it('an out-of-band file deletion surfaces the same way (absence is a state)', async () => {
    // Deletion and content change are the same axis. A snapshot that skipped missing
    // files would read a deleted gate definition as no change, making disarming by
    // deletion the one tamper the comparison misses.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    await hookCall(ordinaryPayload());

    rmSync(join(repoRoot, PROTECTED_FILE));
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
      ['unattributed', BASELINE_LABEL, PROTECTED_ENTRY],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);

  it('two entries changed out of band yield TWO rows — aggregation never hides the judged unit', async () => {
    // One row per changed entry: a single summary row would leave `gain` unable to say
    // WHICH gate definition moved. The two rows land before the judgment row, but their
    // mutual order is not part of the contract, hence the sort.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY, SECOND_ENTRY] });
    write(SECOND_FILE, 'kept: yes\n');
    await hookCall(ordinaryPayload());

    write(PROTECTED_FILE, 'locked: tampered\n');
    write(SECOND_FILE, 'kept: tampered\n');
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    const all = rows();
    expect(all).toHaveLength(5);
    expect(all.slice(2, 4).sort((a, b) => a[2].localeCompare(b[2]))).toEqual([
      ['unattributed', BASELINE_LABEL, PROTECTED_ENTRY],
      ['unattributed', BASELINE_LABEL, SECOND_ENTRY],
    ]);
    expect(all[4]).toEqual(['passed', ADAPTER_LABEL, '-']);
  }, 30_000);
});

describe('attribution — a judged change raises no alarm', () => {
  it('the residue a blocked call left raises no alarm on the call after it', async () => {
    // A block stops the call, not what it already wrote: an Edit failing partway leaves
    // its earlier writes on disk, present before the judgment that refuses the rest. The
    // blocked call's own comparison reports that residue once, and its re-establishment at
    // call END absorbs it, so the next call is silent. Re-establishing at comparison time
    // instead would surface every blocked call's residue again on each following call.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    await hookCall(ordinaryPayload());

    write(PROTECTED_FILE, 'locked: partially written\n');
    const blocked = await hookCall(editPayload(PROTECTED_FILE));
    expect(blocked.exitCode).toBe(2);

    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
      // The residue existed before this call, so this call's comparison names it — once.
      ['unattributed', BASELINE_LABEL, PROTECTED_ENTRY],
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
      // Silent: the re-establishment at the blocked call's end absorbed the residue.
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);

  it('a write AFTER a blocked call is a tamper, not that call residue', async () => {
    // The end of the axis that decides whether the mechanism can be disarmed: if a
    // `blocked` row absolved its entry for the whole next window, provoking one block
    // would licence every later write to that entry. The call ended, its snapshot was
    // taken, and anything after it is unexplained.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    await hookCall(ordinaryPayload());

    const blocked = await hookCall(editPayload(PROTECTED_FILE));
    expect(blocked.exitCode).toBe(2);

    write(PROTECTED_FILE, 'locked: tampered after the block\n');
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
      // The comparison runs at call START, so the alarm precedes this call's own verdict.
      ['unattributed', BASELINE_LABEL, PROTECTED_ENTRY],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);

  it('a judgment row about entry A does not absolve an out-of-band change under entry B', async () => {
    // Asking "does the window hold an attributing row" instead of "does THIS entry's
    // change have one" is a fail-open: a window-level existence check absolves every
    // changed entry. Here the window holds rows about `gate` while the tamper is under
    // `vault`, and the alarm must still fire.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY, SECOND_ENTRY] });
    write(SECOND_FILE, 'kept: yes\n');
    await hookCall(ordinaryPayload());

    const blocked = await hookCall(editPayload(PROTECTED_FILE));
    expect(blocked.exitCode).toBe(2);

    write(SECOND_FILE, 'kept: tampered out of band\n');
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
      ['unattributed', BASELINE_LABEL, SECOND_ENTRY],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);

  it('a judgment row older than the window does not absolve a later tamper', async () => {
    // The window is scoped to rows since the LAST comparison. Scanning the whole log
    // instead makes one judged edit an alibi for that entry for the rest of the session,
    // so a tamper need only follow any earlier legitimate judgment to travel unrecorded.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    await hookCall(ordinaryPayload());

    const blocked = await hookCall(editPayload(PROTECTED_FILE));
    expect(blocked.exitCode).toBe(2);

    // Comparison #1 consumes that blocked row as the explanation for this change.
    write(PROTECTED_FILE, 'locked: partially written\n');
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    // A second tamper, two calls later. The only attributing row in the log is the one
    // already spent above, and it sits before the previous comparison.
    write(PROTECTED_FILE, 'locked: tampered again\n');
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows().slice(-2)).toEqual([
      ['unattributed', BASELINE_LABEL, PROTECTED_ENTRY],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);
});

describe('noise defence — a quiet session stays quiet', () => {
  it('10 consecutive ordinary calls leave zero unattributed rows beyond the first-run one', async () => {
    // The telemetry log and the baseline file live side by side in .polydeukes/ and BOTH
    // change on every call — the log gains this call's rows, the baseline is rewritten at
    // call end. Neither is in the domain, which derives from the config's protectedPaths,
    // so neither may feed back as a detected change: a comparator observing its own state
    // files raises one alarm per call and collapses the signal.
    const dotDir = join(repoRoot, '.polydeukes');
    mkdirSync(dotDir, { recursive: true });
    telemetryPath = join(dotDir, 'roi.log');
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    for (let call = 0; call < 10; call += 1) {
      await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });
    }

    const all = rows();
    expect(all).toHaveLength(11);
    expect(all[0]).toEqual(['unattributed', BASELINE_LABEL, BASELINE_SUBJECT]);
    expect(all.slice(1)).toEqual(Array.from({ length: 10 }, () => ['passed', ADAPTER_LABEL, '-']));
  }, 120_000);
});

describe('fail-open — a comparison failure never touches the judgment', () => {
  it('an unreadable protected entry leaves the exit code and judgment rows of a comparison-free run', async () => {
    // An unreadable entry is absorbed by the walk rather than thrown: absence is a state,
    // so a permission-denied entry hashes like a vanished one. A walk that propagated
    // EACCES would be swallowed by the outer catch, leaving detection dark while the log
    // still looks healthy.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    await hookCall(ordinaryPayload());

    chmodSync(join(repoRoot, PROTECTED_ENTRY), 0o000);
    const result = await hookCall(ordinaryPayload());
    chmodSync(join(repoRoot, PROTECTED_ENTRY), 0o755);

    expect(result.exitCode).toBe(0);
    const judgmentRows = rows().filter(([event]) => event !== 'unattributed');
    expect(judgmentRows).toEqual([
      ['passed', ADAPTER_LABEL, '-'],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);

  it('a baseline directory that is really a file leaves the verdict untouched', async () => {
    // Proving the fail-open needs a failure that actually THROWS, and the comparator
    // resolves every shape it knows to a value — so the throwing seam is the
    // re-establishment's mkdir, which hits ENOTDIR when `.polydeukes` is occupied by a
    // file. That is a real state (a stray write, a botched restore), not a constructed
    // one. Without the call-end catch an unwritable baseline rejects the hook's promise,
    // which exits the delegator non-blocking — the cheapest bypass there is.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    writeFileSync(join(repoRoot, '.polydeukes'), 'not a directory\n');

    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });
  }, 30_000);
});
