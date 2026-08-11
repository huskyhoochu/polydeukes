/**
 * Post-hoc state comparison — the baseline comparator (COVENANT-14 §2-b–§2-e).
 *
 * The session surface judges declared calls, so a write nobody declared leaves no row at
 * all. This module answers the same question from the other end: summarize the protected
 * entries' on-disk state, and after the fact name the entries whose state moved with no
 * judgment row explaining it. It records rather than blocks — every failure shape here
 * resolves to a value, never a throw.
 *
 * Split the way the telemetry module is: {@link findUnattributed} is pure and
 * {@link snapshotBaseline} / {@link writeBaseline} / {@link readBaseline} are the I/O
 * points.
 */

import { createHash } from 'node:crypto';
import { type Dirent, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TelemetryEvent, TelemetryRecord } from '@polydeukes/core';

/** One hash per protected entry, keyed by the entry exactly as configured. */
export type BaselineSnapshot = Record<string, string>;

/**
 * The four verdict words that explain a change (§2-c). `blocked` is among them because a
 * block stops the call, not what it already wrote — alarming on that residue would be
 * duplicate reporting. `skipped` and `unattributed` are absent by construction: a recorded
 * absence of judgment explains nothing, and the alarm must not silence its own successor.
 */
const ATTRIBUTING_EVENTS: readonly TelemetryEvent[] = ['passed', 'blocked', 'witnessed', 'advised'];

/**
 * Fold one file's path and content into `hash` (§2-b full content hashing).
 *
 * The path participates, so a rename with byte-identical content still moves the entry's
 * hash. An unreadable file contributes a fixed absence marker rather than aborting the
 * walk — absence is a state, and a file that vanished mid-walk is exactly the state the
 * comparison exists to see. The marker leads with an escaped NUL so no readable file's
 * contents can collide with it; written as an escape rather than a literal byte, which
 * would make this source a binary file to git and hide it from every diff.
 */
function foldFile(hash: ReturnType<typeof createHash>, absolutePath: string, key: string): void {
  hash.update(key);
  try {
    hash.update(readFileSync(absolutePath));
  } catch {
    hash.update('\0absent');
  }
}

/**
 * Fold everything reachable under `absolutePath` into `hash`, in sorted order.
 *
 * Sorted so an unchanged tree hashes identically twice — directory iteration order is not
 * a guarantee, and a nondeterministic term would read as a change on every call. A path
 * that is a file, or that does not exist at all, is not a traversal failure: six of the
 * live config's thirteen entries name a file, and a vanished entry hashes to the empty set.
 */
function foldEntry(hash: ReturnType<typeof createHash>, rootDir: string, relPath: string): void {
  let children: Dirent[];
  try {
    children = readdirSync(join(rootDir, relPath), { withFileTypes: true });
  } catch {
    foldFile(hash, join(rootDir, relPath), relPath);
    return;
  }

  for (const child of [...children].sort((a, b) => a.name.localeCompare(b.name))) {
    foldEntry(hash, rootDir, `${relPath}/${child.name}`);
  }
}

/**
 * Summarize each entry's on-disk state as one sha256 (§2-b).
 *
 * `entries` are repo-relative paths of either shape — a file or a directory. Every entry
 * keeps a key whatever its state, so the diff always sees it; a missing entry simply hashes
 * to the empty set.
 */
export function snapshotBaseline(spec: { rootDir: string; entries: string[] }): BaselineSnapshot {
  const snapshot: BaselineSnapshot = {};
  for (const entry of spec.entries) {
    const hash = createHash('sha256');
    foldEntry(hash, spec.rootDir, entry);
    snapshot[entry] = hash.digest('hex');
  }
  return snapshot;
}

/**
 * The entries whose hash changed and that no window row explains (§2-c, pure).
 *
 * Attribution is asked per entry, never per window: "the window holds an attributing row"
 * and "THIS entry's change has one" are different claims, and answering the first is the
 * fail-open shape this repository already shipped once. `records` is the window since the
 * previous comparison — a row older than that has already been spent.
 */
export function findUnattributed(spec: {
  previous: BaselineSnapshot;
  current: BaselineSnapshot;
  records: TelemetryRecord[];
}): string[] {
  const attributed = new Set(
    spec.records
      .filter((record) => ATTRIBUTING_EVENTS.includes(record.event))
      .map((record) => record.subject),
  );

  return Object.keys(spec.current).filter(
    (entry) => spec.current[entry] !== spec.previous[entry] && !attributed.has(entry),
  );
}

/**
 * Write the baseline file (§2-e).
 *
 * `windowStart` is the telemetry record count at the moment of this comparison, so the next
 * comparison reads only the rows appended since. Without it the whole log is the window and
 * one judged edit absolves that entry for the rest of the session.
 */
export function writeBaseline(
  path: string,
  snapshot: BaselineSnapshot,
  windowStart: number = 0,
): void {
  writeFileSync(path, JSON.stringify({ entries: snapshot, windowStart }));
}

/** Parse the baseline file, or `null` when it is absent, corrupt, or the wrong shape. */
function parseBaselineFile(
  path: string,
): { entries: BaselineSnapshot; windowStart: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }

  // Validate what the comparison will use: valid JSON of the wrong shape parses fine and
  // then crashes the diff, which the fail-open wiring swallows — detection would go dark
  // with no re-establishment and no row.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const { entries, windowStart } = parsed as { entries?: unknown; windowStart?: unknown };
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    return null;
  }
  if (Object.values(entries).some((value) => typeof value !== 'string')) {
    return null;
  }

  return {
    entries: entries as BaselineSnapshot,
    windowStart: typeof windowStart === 'number' ? windowStart : 0,
  };
}

/**
 * Read the baseline snapshot, or `null` (§2-e).
 *
 * Absence and corruption are the same signal — re-establish and record — so neither throws.
 * Observation is fail-open: the worst outcome is a missing datum, never a blocked call.
 */
export function readBaseline(path: string): BaselineSnapshot | null {
  return parseBaselineFile(path)?.entries ?? null;
}

/**
 * The telemetry record count the previous comparison recorded, or `null` alongside an
 * unreadable baseline. This is where the attribution window is cut.
 */
export function readBaselineWindowStart(path: string): number | null {
  return parseBaselineFile(path)?.windowStart ?? null;
}
