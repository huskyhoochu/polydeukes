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
// COVENANT-14 §2-b/§2-c RED phase — the baseline comparator, split as the PRD directs:
// a pure attribution core plus I/O points, the telemetry.ts precedent.
//
// Contract asserted (module does not exist yet — RED by construction):
//   snapshotBaseline({ rootDir, entries }): Record<string, string>
//     - one hash per protected ENTRY (full content hashing, §2-b): every file under the
//       entry folded in sorted order; absence is a state (a missing file or a missing
//       entry changes the hash, never throws).
//   findUnattributed({ previous, current, records }): string[]
//     - pure: the entries whose hash changed AND that no window row with event
//       passed/blocked/witnessed/advised and subject === entry explains (§2-c).
//       Attribution is ENTRY-granular — the same granularity the dispatcher records
//       (covenant.dev-log.telemetry-subject-is-matched-entry), which is what makes the
//       join well-defined at all.
//   writeBaseline(path, snapshot): void / readBaseline(path): Record<string, string> | null
//     - the baseline file I/O (§2-e): an absent or corrupt file reads as null (the
//       re-establish signal), never a throw — observation is fail-open, not fail-closed.
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

describe('COVENANT-14 §2-b snapshotBaseline — full content hashing over a fixture tree', () => {
  it('an unchanged tree snapshots to the same value twice, one key per entry', () => {
    // Mutation caught: a timestamp, nonce, or unsorted-iteration term folded into the
    // hash — every comparison would then read as a change and flood the log with
    // unattributed rows, the noise §3.3 fixes at zero.
    const first = snapshotBaseline({ rootDir, entries: [ENTRY_A, ENTRY_B] });
    const second = snapshotBaseline({ rootDir, entries: [ENTRY_A, ENTRY_B] });

    expect(Object.keys(first).sort()).toEqual([ENTRY_A, ENTRY_B]);
    expect(second).toEqual(first);
  });

  it('detects a same-length content change even with the original mtime restored', () => {
    // THE §2-b fixture: an mtime/size heuristic passes this exact tamper (same byte
    // count, `touch -r`-style mtime restore). Mutation caught: content hashing replaced
    // by the cheaper stat comparison the PRD explicitly rejected.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    const target = join(rootDir, FILE_A);
    const stats = statSync(target);
    writeFileSync(target, 'locked: no!\n'); // same byte length as 'locked: yes\n'
    utimesSync(target, stats.atime, stats.mtime);

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });

  it('detects a file deletion under an entry (absence is a state)', () => {
    // Mutation caught: per-file diffing that compares only the files present on both
    // sides — under it a vanished file contributes no term to either side and the
    // deletion reads as no change.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    rmSync(join(rootDir, FILE_A));

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });

  it('detects a rename that keeps the content byte-identical', () => {
    // §2-b folds sha256(path + content) per file: the path is part of the state.
    // Mutation caught: content-only hashing, under which renaming a judge executable
    // (the resolution the hook walks) reads as no change at all.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    renameSync(join(rootDir, FILE_A), join(rootDir, 'gate/inner-renamed.txt'));

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });

  it('a change under one entry leaves the other entry hash untouched', () => {
    // Attribution joins on the entry, so the hash must be per-entry. Mutation caught:
    // one pot hashing the whole domain — every change would then implicate every entry
    // and one judged edit would absolve an unrelated tamper.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A, ENTRY_B] });
    write(FILE_A, 'locked: tampered\n');

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A, ENTRY_B] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
    expect(after[ENTRY_B]).toBe(before[ENTRY_B]);
  });

  it('hashes a FILE-shaped entry, and detects a change to it', () => {
    // Six of the thirteen live entries name a file, not a directory. Mutation caught: a
    // snapshot built on directory traversal — `readdirSync` on a file throws ENOTDIR, the
    // wiring's fail-open catch swallows it, and detection goes dark across the whole
    // domain while the log stays quiet. Silence is indistinguishable from a clean tree.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_FILE] });
    write(ENTRY_FILE, '{"armed": false}\n');

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_FILE] });

    expect(typeof before[ENTRY_FILE]).toBe('string');
    expect(after[ENTRY_FILE]).not.toBe(before[ENTRY_FILE]);
  });

  it('detects a file ADDED under an entry', () => {
    // Planting an extra module inside a judge's dist is the threat model itself. Mutation
    // caught: re-hashing only the files the previous snapshot listed — under it an added
    // file contributes no term and the plant reads as no change at all.
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    write('gate/planted.txt', 'extra\n');

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });

  it('an entry whose path vanished entirely still yields a key, with a changed hash', () => {
    // §2-b: a whole missing entry hashes to the empty set, never throws and never drops
    // the key. Mutation caught: the missing-directory branch throwing (which wiring
    // would swallow, silencing ALL detection) or omitting the key (diff never sees it).
    const before = snapshotBaseline({ rootDir, entries: [ENTRY_A] });
    rmSync(join(rootDir, ENTRY_A), { recursive: true });

    const after = snapshotBaseline({ rootDir, entries: [ENTRY_A] });

    expect(typeof after[ENTRY_A]).toBe('string');
    expect(after[ENTRY_A]).not.toBe(before[ENTRY_A]);
  });
});

describe('COVENANT-14 §2-c findUnattributed — pure attribution over snapshots', () => {
  /** One window row; the label is free (§2-c joins on subject + event, never label). */
  function row(event: TelemetryRecord['event'], subject: string): TelemetryRecord {
    return { timestamp: '2026-08-12T12:00:00Z', event, label: 'self-mod', subject };
  }

  it('a changed entry with an empty window is unattributed', () => {
    // Mutation caught: the diff inverted (reporting unchanged entries) or the change
    // detection deleted — the detection direction of AC §3.1.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [],
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('an unchanged entry yields nothing even when the window carries rows about it', () => {
    // The no-change end of the axis. Mutation caught: row presence read as the change
    // signal itself — every judged call would then also raise the alarm it just
    // explained.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h1' },
      records: [row('passed', ENTRY_A)],
    });

    expect(result).toEqual([]);
  });

  it.each([
    'passed',
    'blocked',
    'witnessed',
    'advised',
  ] as const)('a %s row with the entry as subject attributes the change (no alarm)', (event) => {
    // All four verdict words attribute (§2-c — blocked included: a blocked call's
    // partial write is already reported once). Mutation caught: any one of the four
    // dropped from the accepted set, turning an explained change into a false alarm
    // — the over-reporting that teaches readers to ignore the row.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row(event, ENTRY_A)],
    });

    expect(result).toEqual([]);
  });

  it('a skipped row does NOT attribute — a recorded absence of judgment explains nothing', () => {
    // Mutation caught: the accepted set widened to every event. `skipped` means "could
    // not judge", so letting it absolve a change would make the axis's declared limit
    // double as an absolution stamp.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('skipped', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('an unattributed row does NOT attribute — the alarm never silences its successor', () => {
    // Mutation caught: the sixth word admitted into its own accepted set, so an entry
    // that keeps changing without judgment is reported once and then absolved by its
    // own report forever after.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'h1' },
      current: { [ENTRY_A]: 'h2' },
      records: [row('unattributed', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_A]);
  });

  it('a row about entry A does not absolve a change under entry B', () => {
    // THE §2-c fixture (covenant.dev-log.input-level-evidence-gate-fail-open): "the
    // window has an attributing row" and "THIS entry's change is explained" are
    // different claims. Mutation caught: the window-level existence gate — any judged
    // call in the window absolving every changed entry, the exact fail-open shape
    // COVENANT-09 shipped and had to recall.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      current: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b2' },
      records: [row('blocked', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_B]);
  });

  it('two changed entries with one attributed leave exactly the other', () => {
    // Mutation caught: attribution answered for the changed SET all-or-nothing — one
    // explained entry absolving (or one unexplained entry implicating) its neighbour.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      current: { [ENTRY_A]: 'a2', [ENTRY_B]: 'b2' },
      records: [row('passed', ENTRY_A)],
    });

    expect(result).toEqual([ENTRY_B]);
  });

  it('two changed entries with an empty window are BOTH reported', () => {
    // AC §3.1: one row per changed entry — aggregation must not hide the judged unit.
    // Mutation caught: first-match-only reporting collapsing simultaneous tampers.
    const result = findUnattributed({
      previous: { [ENTRY_A]: 'a1', [ENTRY_B]: 'b1' },
      current: { [ENTRY_A]: 'a2', [ENTRY_B]: 'b2' },
      records: [],
    });

    expect([...result].sort()).toEqual([ENTRY_A, ENTRY_B]);
  });
});

describe('COVENANT-14 §2-e baseline file I/O — absence and corruption read as null', () => {
  it('writeBaseline → readBaseline round-trips a snapshot', () => {
    // Mutation caught: an asymmetric serialization (write one shape, read another) —
    // every restart would then re-establish and the comparison never spans two calls.
    const path = join(rootDir, 'baseline.json');
    const snapshot = { [ENTRY_A]: 'h1', [ENTRY_B]: 'h2' };

    writeBaseline(path, snapshot);

    expect(readBaseline(path)).toEqual(snapshot);
  });

  it('an absent baseline file reads as null, never a throw', () => {
    // §2-e: absence is the re-establish signal. Mutation caught: the ENOENT escaping —
    // wiring would swallow it fail-open and the comparator would simply never start.
    expect(readBaseline(join(rootDir, 'missing', 'baseline.json'))).toBeNull();
  });

  it('a corrupt baseline file reads as null, never a throw', () => {
    // §2-e: corruption is handled like absence (re-establish + row), observation is
    // fail-open. Mutation caught: JSON.parse throwing out of the read.
    const path = join(rootDir, 'baseline.json');
    writeFileSync(path, '{ corrupt');

    expect(readBaseline(path)).toBeNull();
  });

  it('valid JSON of the wrong shape reads as null too', () => {
    // Validate what the comparator will use, not what a file could contain: a JSON
    // number parses fine and then crashes the diff at compare time — which wiring
    // swallows, silencing detection with no re-establish and no row. Mutation caught:
    // parse success standing in for shape validity.
    const path = join(rootDir, 'baseline.json');
    writeFileSync(path, '42');

    expect(readBaseline(path)).toBeNull();
  });
});
