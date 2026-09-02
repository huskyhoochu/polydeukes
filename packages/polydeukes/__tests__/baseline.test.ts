import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TelemetryRecord } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The baseline comparator: a pure attribution core plus its file I/O.
//
//   snapshotBaseline — one hash per protected ENTRY, every file under the entry folded in
//     sorted order. Absence is a state: a missing file or a missing entry changes the hash
//     and never throws. An entry names a file or a directory.
//   findUnattributed — pure: the entries whose hash changed AND that no window row with
//     event witnessed/advised and subject === entry explains. Attribution is ENTRY-granular,
//     the same granularity the dispatcher records, which is what makes the join well-defined
//     at all. `cutAt` bounds the window by time, and only entries the previous baseline
//     already watched are compared.
//   writeBaseline / readBaseline — hashes and cut in ONE parse; an absent or corrupt file
//     reads as null (the re-establish signal), never a throw. Observation is fail-open.
import {
  findUnattributed,
  readBaseline,
  snapshotBaseline,
  writeBaseline,
} from '../src/baseline.ts';

/** Injected fixture entries — config-shaped protected entries, never source literals. */
const ENTRY_A = 'gate';
const ENTRY_B = 'vault';
const FILE_A = 'gate/inner.txt';
const FILE_B = 'vault/secret.txt';
/**
 * A FILE-shaped entry: the entry path is itself the file, not a directory holding one.
 * Six of the live config's thirteen entries have this shape, so a snapshot written around
 * directory traversal fails on the majority of the real domain.
 */
const ENTRY_FILE = 'settings.json';

let rootDir: string;

function write(relPath: string, content: string): void {
  const absolute = join(rootDir, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'pdks-baseline-'));
  write(FILE_A, 'locked: yes\n');
  write(FILE_B, 'kept: yes\n');
  write(ENTRY_FILE, '{"armed": true}\n');
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe('snapshotBaseline — full content hashing over a fixture tree', () => {
  it('an unchanged tree snapshots to the same value twice, one key per entry', () => {
    // A timestamp, nonce, or unsorted-iteration term folded into the hash makes every
    // comparison read as a change, flooding the log with unattributed rows.
    const first = snapshotBaseline({ rootDir, entries: [ENTRY_A, ENTRY_B] });
    const second = snapshotBaseline({ rootDir, entries: [ENTRY_A, ENTRY_B] });

    expect(Object.keys(first).sort()).toEqual([ENTRY_A, ENTRY_B]);
    expect(second).toEqual(first);
  });

  it('detects a same-length content change even with the original mtime restored', () => {
    // An mtime/size heuristic passes this exact tamper (same byte count, `touch -r`-style
    // mtime restore), which is why the hash is over content rather than stat.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    const target = join(rootDir, FILE_A);
    const stats = statSync(target);
    writeFileSync(target, 'locked: no!\n'); // same byte length as 'locked: yes\n'
    utimesSync(target, stats.atime, stats.mtime);

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });

  it('detects a file deletion under an entry (absence is a state)', () => {
    // Per-file diffing that compares only the files present on both sides lets a vanished
    // file contribute no term to either side, so the deletion reads as no change.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    rmSync(join(rootDir, FILE_A));

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });

  it('detects a rename that keeps the content byte-identical', () => {
    // The hash folds path and content per file, because the path is part of the state:
    // under content-only hashing, renaming a judge executable reads as no change at all.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    renameSync(join(rootDir, FILE_A), join(rootDir, 'gate/inner-renamed.txt'));

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });

  it('a change under one entry leaves the other entry hash untouched', () => {
    // Attribution joins on the entry, so the hash must be per-entry. One pot hashing the
    // whole domain makes every change implicate every entry, so one judged edit would
    // absolve an unrelated tamper.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A, ENTRY_B] });
    write(FILE_A, 'locked: tampered\n');

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A, ENTRY_B] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
    expect(after[ENTRY_B]).toBe(before[ENTRY_B]);
  });

  it('hashes a FILE-shaped entry, and detects a change to it', () => {
    // A snapshot built on directory traversal throws ENOTDIR on a file entry; the wiring's
    // fail-open catch swallows it and detection goes dark across the whole domain while the
    // log stays quiet, which is indistinguishable from a clean tree.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_FILE] });
    write(ENTRY_FILE, '{"armed": false}\n');

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_FILE] });

    expect(typeof before[ENTRY_FILE]).toBe('string');
    expect(after[ENTRY_FILE]).not.toBe(before[ENTRY_FILE]);
  });

  it('detects a file ADDED under an entry', () => {
    // Planting an extra module inside a judge's dist is the threat model itself. Re-hashing
    // only the files the previous snapshot listed lets the plant read as no change.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    write('gate/planted.txt', 'extra\n');

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });

  it('an entry whose path vanished entirely still yields a key, with a changed hash', () => {
    // A whole missing entry hashes to the empty set: it must never throw (wiring would
    // swallow it and silence ALL detection) and never drop the key (the diff never sees it).
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    rmSync(join(rootDir, ENTRY_A), { recursive: true });

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(typeof after[ENTRY_A]).toBe('string');
    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });
});

/**
 * One window row; the label is free, since attribution joins on subject and event only. The
 * timestamp defaults to a fixed instant because most cases do not exercise the cut.
 */
function row(
  event: TelemetryRecord['event'],
  subject: string,
  timestamp = '2026-08-12T12:00:00.000Z',
): TelemetryRecord {
  return { timestamp, event, label: 'self-mod', subject };
}

describe('findUnattributed — pure attribution over snapshots', () => {
  it('a changed entry with an empty window is unattributed', () => {
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [],
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('an unchanged entry yields nothing even when the window carries rows about it', () => {
    // The no-change end of the axis: reading row presence as the change signal itself makes
    // every judged call raise the alarm it just explained.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h1' },
      records: [row('witnessed', ENTRY_A)],
    });

    expect(result).toEqual([]);
  });

  it.each([
    'witnessed',
    'advised',
  ] as const)('a %s row with the entry as subject attributes the change (no alarm)', (event) => {
    // The two words that mean a mutation of a protected entry was judged and let through
    // anyway — a human opening it in person, or an advise-level surface recording without
    // stopping. Dropping either from the accepted set turns every sanctioned edit into an
    // alarm and teaches the reader to ignore the row.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row(event, ENTRY_A)],
    });

    expect(result).toEqual([]);
  });

  it('a skipped row does NOT attribute — a recorded absence of judgment explains nothing', () => {
    // `skipped` means "could not judge", so letting it absolve a change would make the
    // axis's declared limit double as an absolution stamp.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('skipped', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('an unattributed row does NOT attribute — the alarm never silences its successor', () => {
    // Admitting the alarm into its own accepted set means an entry that keeps changing
    // without judgment is reported once and then absolved by its own report forever after.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('unattributed', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('a passed row does NOT attribute — a judged call that upheld wrote nothing to explain', () => {
    // On a protected entry, `passed` means the call was judged and did NOT break the
    // covenant: it mentioned the entry without mutating it, and a mention explains no later
    // change. Admitting `passed` lets a read-only call (`cat` on a protected file) absolve
    // every tamper that follows it.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('passed', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('a blocked row does NOT attribute — a refused call did not write what followed', () => {
    // A block stops the call, so a later change is not its doing. Admitting `blocked` turns
    // provoking one block into a licence for every subsequent write to that entry — the
    // mechanism disarmed by the verdict that is supposed to be its strongest signal.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('blocked', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('a row about entry A does not absolve a change under entry B', () => {
    // "The window has an attributing row" and "THIS entry's change is explained" are
    // different claims. A window-level existence gate lets any judged call in the window
    // absolve every changed entry.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      current: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b2' },
      records: [row('witnessed', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_B]);
  });

  it('two changed entries with one attributed leave exactly the other', () => {
    // Attribution must not answer for the changed SET all-or-nothing: one explained entry
    // must not absolve, nor one unexplained entry implicate, its neighbour.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      current: { [ENTRY_A]: 'a2', [ENTRY_B]: 'b2' },
      records: [row('witnessed', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_B]);
  });

  it('two changed entries with an empty window are BOTH reported', () => {
    // One row per changed entry: aggregation must not hide the judged unit, and
    // first-match-only reporting would collapse simultaneous tampers.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      current: { [ENTRY_A]: 'a2', [ENTRY_B]: 'b2' },
      records: [],
    });

    expect([...result].sort()).toEqual([ENTRY_A, ENTRY_B]);
  });

  it('an entry the config no longer lists is dropped, not reported', () => {
    // The domain moves when the config does. An entry removed from `protectedPaths` is
    // absent from `current`, and the comparison has nothing to say about a path it no
    // longer watches. Diffing over the union of both sides turns every deregistration into
    // a permanent alarm nobody can clear.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      current: { [ENTRY_A]: 'a1' },
      records: [],
    });

    expect(result).toEqual([]);
  });

  it('an entry the config newly lists is not an alarm on its first comparison', () => {
    // A newly registered entry has no previous hash, so `current !== previous` is trivially
    // true and the first comparison after a config edit would report a row indistinguishable
    // from a real tamper. The comparison must ask whether the entry was watched before,
    // never compare against `undefined`.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1' },
      current: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      records: [],
    });

    expect(result).toEqual([]);
  });

  it('a newly listed entry IS compared from the next comparison onward', () => {
    // The forgiveness above is one-shot, not permanent. Written as a standing exemption it
    // would leave every entry added after the first run permanently unwatched, making a
    // config edit a way to opt out of observation.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      current: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b2' },
      records: [],
    });

    expect(result).toEqual([ENTRY_B]);
  });
});

describe('baseline file I/O — absence and corruption read as null', () => {
  it('writeBaseline → readBaseline round-trips a snapshot', () => {
    // An asymmetric serialization (write one shape, read another) makes every restart
    // re-establish, so the comparison never spans two calls.
    const path = join(rootDir, 'baseline.json');
    const snapshot = { [ENTRY_A]: 'h1', [ENTRY_B]: 'h2' };

    writeBaseline(path, snapshot);

    expect(readBaseline(path)?.entries).toEqual(snapshot);
  });

  it('an absent baseline file reads as null, never a throw', () => {
    // Absence is the re-establish signal. An escaping ENOENT is swallowed fail-open by the
    // wiring, and the comparator simply never starts.
    expect(readBaseline(join(rootDir, 'missing', 'baseline.json'))).toBeNull();
  });

  it('a corrupt baseline file reads as null, never a throw', () => {
    // Corruption is handled like absence — re-establish and record — because observation is
    // fail-open. A JSON.parse throwing out of the read is not.
    const path = join(rootDir, 'baseline.json');
    writeFileSync(path, '{ corrupt');

    expect(readBaseline(path)).toBeNull();
  });

  it('valid JSON of the wrong shape reads as null too', () => {
    // Validate what the comparator will use, not what a file could contain: a JSON number
    // parses fine and then crashes the diff at compare time, which the wiring swallows,
    // silencing detection with no re-establish and no row.
    const path = join(rootDir, 'baseline.json');
    writeFileSync(path, '42');

    expect(readBaseline(path)).toBeNull();
  });
});

describe('the attribution window is cut by time, not by position', () => {
  const path = () => join(rootDir, 'baseline.json');

  it('readBaseline returns the snapshot AND the cut together, from one parse', () => {
    // The window bound and the hashes it will be compared against must come from the same
    // read: with two separate parses, a write landing between them pairs one call's hashes
    // with another call's cut, and the mismatch is invisible in every log.
    writeBaseline(path(), { [ENTRY_A]: 'h1' }, '2026-08-12T12:00:00.000Z');

    expect(readBaseline(path())).toEqual({
      entries: { [ENTRY_A]: 'h1' },
      cutAt: '2026-08-12T12:00:00.000Z',
    });
  });

  it('the cut survives a truncated telemetry log', () => {
    // A positional index into the records array points past the end once the log is trimmed
    // or rotated, emptying the window for every later call so every legitimate judgment
    // stops attributing. A timestamp does not move when rows are removed.
    writeBaseline(path(), { [ENTRY_A]: 'h1' }, '2026-08-12T12:00:00.000Z');
    const { cutAt } = readBaseline(path()) ?? {};
    const survivingRow = row('witnessed', ENTRY_A, '2026-08-12T12:00:05.000Z');

    // One row survived a truncation that removed everything before it.
    const window = [survivingRow].filter((record) => record.timestamp >= (cutAt ?? ''));

    expect(window).toEqual([survivingRow]);
  });

  it('a row written before the cut no longer attributes', () => {
    // The point of the cut: a judgment already spent on a previous comparison must not
    // explain the next change too, or one judged edit is an alibi for the whole session.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('witnessed', ENTRY_A, '2026-08-12T11:59:00.000Z')],
      cutAt: '2026-08-12T12:00:00.000Z',
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('a row written at or after the cut still attributes', () => {
    // The other end of the same axis: a cut that also excludes the rows it should admit
    // turns every judged edit into an alarm, and the noise failure is as bad as the miss.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('witnessed', ENTRY_A, '2026-08-12T12:00:00.000Z')],
      cutAt: '2026-08-12T12:00:00.000Z',
    });

    expect(result).toEqual([]);
  });

  it('an absent cut admits the whole window rather than none of it', () => {
    // A baseline written before this field existed, or one whose cut failed to parse. The
    // safe direction is to attribute MORE, not less: over-attributing costs one missed row
    // in a session that is already anomalous, while under-attributing floods an ordinary
    // session with alarms and trains the reader to ignore them.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('witnessed', ENTRY_A, '2026-08-12T11:00:00.000Z')],
      cutAt: undefined,
    });

    expect(result).toEqual([]);
  });
});
