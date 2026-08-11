import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-14 §2-f RED phase — the post-hoc state comparison wired into the assembled
// session hook. At every hook call start, BEFORE this call's judgment rows land, the
// protected entries' on-disk state is compared against `.polydeukes/baseline.json`; an
// entry that changed with no attributing row in the window since the previous comparison
// leaves ONE `unattributed` row (label 'baseline', subject = the changed ENTRY — the
// config element, covenant.dev-log.telemetry-subject-is-matched-entry). The comparison
// records, never blocks (§6): no exit code and no judgment row ever changes because of
// it, and any comparison failure stays inside the hook (fail-open, the
// appendRecordFailOpen direction).
import { runClaudeCodeHook } from '../src/index.ts';
import { telemetryRows, writeConfigAt } from './helpers';

/** Injected fixture values — the config entries and the files judged under them. */
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
const SECOND_ENTRY = 'vault';
const SECOND_FILE = 'vault/secret.txt';
/** The label every baseline row carries (PRD §2-d). */
const BASELINE_LABEL = 'baseline';
/** The label runAdapterPath records the funnel supplement under. */
const ADAPTER_LABEL = 'adapter-claude-code';
/**
 * The first-run/corruption row's subject is the baseline file itself (PRD §2-e); the
 * repo-relative vs absolute spelling is not fixed by the PRD, so the pin is the tail.
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

describe('COVENANT-14 §3.4 baseline re-establishment', () => {
  it('first call re-establishes an absent baseline: one unattributed row (subject = the baseline file), judgment untouched', async () => {
    // §2-e: absence is an event, not a protected path — the file is NOT on the
    // protection list (infinite regress), so its deletion must be legible in the log
    // forever. Mutation caught: silent re-establishment (deleting the baseline erases
    // all detection with no trace), the row blocking the call (exit 2), or the file
    // established somewhere other than .polydeukes/baseline.json.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
    expect(existsSync(baselineFile())).toBe(true);
  }, 20_000);

  it('a corrupt baseline file is re-established with one row, and the next call is quiet', async () => {
    // §3.4: corruption is handled exactly like absence — re-establish + row, exit
    // code untouched. Mutation caught: the parse failure escaping into the judgment
    // try (a fail-closed exit 2 for a file the covenant never protected), or a
    // re-establishment that keeps the corrupt file so EVERY subsequent call alarms.
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

describe('COVENANT-14 §3.1 detection — out-of-band changes surface as unattributed rows', () => {
  it('an out-of-band edit under a protected entry leaves one row, subject = the ENTRY, before the judgment rows', async () => {
    // The mechanism itself: a write no tool call declared (an interpreter, a test
    // runner child, an out-of-repo script) left no row, and the state comparison is
    // what makes it visible. Mutation caught: detection missing entirely, the subject
    // recorded as the changed FILE instead of the matched-entry granularity the
    // attribution join needs, or the observation running AFTER this call's judgment
    // rows (the order §2-f fixes: the row lands first).
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
    // §2-b: deletion and content change are the same axis. Mutation caught: the
    // snapshot skipping missing files so a deleted gate definition reads as no
    // change — disarming by deletion would be the one tamper the comparison misses.
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
    // AC §3.1: one row per changed entry. Mutation caught: a single summary row for
    // the whole comparison, which would make `gain` unable to say WHICH gate
    // definition moved. The two rows land before the judgment row; their mutual
    // order is not part of the contract, hence the sort.
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

describe('COVENANT-14 §3.2 attribution — a judged change raises no alarm', () => {
  it('a change explained by a prior blocked judgment on the same entry yields no row', async () => {
    // §2-c: `blocked` attributes — a blocked call's partial write is already
    // reported once, and alarming again is duplicate reporting, not detection.
    // Mutation caught: `blocked` dropped from the attributing set, or the window cut
    // so the previous call's rows are invisible to this comparison.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    await hookCall(ordinaryPayload());

    const blocked = await hookCall(editPayload(PROTECTED_FILE));
    expect(blocked.exitCode).toBe(2);

    // The residue the blocked call left behind (§2-c: a block stops the call, not
    // what it already wrote).
    write(PROTECTED_FILE, 'locked: partially written\n');
    await expect(hookCall(ordinaryPayload())).resolves.toEqual({ exitCode: 0 });

    expect(rows()).toEqual([
      ['unattributed', BASELINE_LABEL, BASELINE_SUBJECT],
      ['passed', ADAPTER_LABEL, '-'],
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  }, 30_000);

  it('a judgment row about entry A does not absolve an out-of-band change under entry B', async () => {
    // THE fixture (covenant.dev-log.input-level-evidence-gate-fail-open): asking
    // "does the window hold an attributing row" instead of "does THIS entry's change
    // have one" is the fail-open this repository already shipped once. The window
    // here holds blocked/passed rows about `gate`; the tamper is under `vault`, and
    // the alarm must still fire for it. Mutation caught: the window-level existence
    // gate absolving every changed entry.
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
    // §2-c scopes the window to rows since the LAST comparison. The cheapest wiring —
    // scanning the whole log — makes one judged edit an alibi for that entry for the
    // rest of the session, so a tamper only has to follow any earlier legitimate
    // judgment to travel unrecorded. Mutation caught: the window left uncut.
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

describe('COVENANT-14 §3.3 noise defence — a quiet session stays quiet', () => {
  it('10 consecutive ordinary calls leave zero unattributed rows beyond the first-run one', async () => {
    // The telemetry log and the baseline file live side by side in .polydeukes/ and
    // BOTH change on every call — the log gains this call's rows, the baseline is
    // rewritten at call end. Neither is in the domain (the domain derives from
    // config protectedPaths, §6), so neither may feed back as a detected change.
    // Mutation caught: the comparator observing its own state files (one alarm per
    // call — the signal-to-noise collapse §2-a rejects for the transcript), or the
    // baseline not persisting between calls (a re-establishment row per call).
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

describe('COVENANT-14 §3.4 fail-open — a comparison failure never touches the judgment', () => {
  it('an unreadable protected entry leaves the exit code and judgment rows of a comparison-free run', async () => {
    // §6: no comparison failure propagates — the worst outcome of observation is a
    // missing datum, never a blocked workflow. Mutation caught: the comparator's
    // exception escaping into the fail-closed judgment catch, turning an EACCES on a
    // fixture directory into exit 2 with a hook blocked row.
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
});
