/**
 * Post-hoc state comparison — the baseline comparator.
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
 * The baseline file's contents: the entry hashes plus the instant the attribution window
 * opens at. Named for the file rather than the concept — `Baseline` already belongs to the
 * delta family, where it means a file's prior CONTENT, not a protection snapshot.
 *
 * The two fields travel together because they are read together — pairing one comparison's
 * hashes with another's cut would silently mis-attribute, undetectably.
 */
export type StoredBaseline = { entries: BaselineSnapshot; cutAt?: string };

/**
 * The two verdict words that explain a change — the ones that mean a mutation of a
 * protected entry was judged and let through anyway.
 *
 * `witnessed` is a break a human opened in person; `advised` is one an advise-level surface
 * recorded without stopping. Both name a write the session knew about, so the change that
 * follows is accounted for.
 *
 * The other four do not attribute, each for its own reason. `passed` means the call was
 * judged and did NOT break the covenant — on a protected entry that is a mention, not a
 * mutation, so it explains no later change; admitting it is what let a read-only call
 * absolve a tamper. `blocked` stops the call, so what follows is not its doing, and
 * admitting it would make provoking a block a licence for every later write to that entry
 * (the residue a blocked call really left is present when that same call compares, reported
 * there once, and folded into its own re-establishment). `skipped` is a recorded absence of
 * judgment, which explains nothing. `unattributed` must never silence its own successor.
 */
const ATTRIBUTING_EVENTS: readonly TelemetryEvent[] = ['witnessed', 'advised'];

/**
 * Fold one file's path and content into `hash`.
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
 * Summarize each entry's on-disk state as one sha256.
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
 * The entries whose hash changed and that no window row explains (pure).
 *
 * Attribution is asked per entry, never per window: "the window holds an attributing row"
 * and "THIS entry's change has one" are different claims, and answering the first is the
 * fail-open shape this repository already shipped once.
 *
 * The window is cut by `cutAt` — rows at or after that instant, which are the ones written
 * since the previous comparison. Cutting by time rather than by a record count keeps the
 * bound meaningful when the log is trimmed or rotated; a positional index would point past
 * the end and empty the window for every later call. An absent cut admits every row: over-
 * attributing costs one missed alarm in a session that is already anomalous, while under-
 * attributing floods an ordinary one and teaches the reader to ignore the alarm entirely.
 *
 * Only entries the previous baseline already watched are compared. An entry the config just
 * added has no prior hash, and reporting it would make editing one's own policy look
 * identical to a tamper; an entry the config dropped is simply no longer watched.
 */
export function findUnattributed(spec: {
  previous: BaselineSnapshot;
  current: BaselineSnapshot;
  records: TelemetryRecord[];
  cutAt?: string;
}): string[] {
  const cutAt = spec.cutAt;
  const attributed = new Set(
    spec.records
      .filter((record) => cutAt === undefined || record.timestamp >= cutAt)
      .filter((record) => ATTRIBUTING_EVENTS.includes(record.event))
      .map((record) => record.subject),
  );

  return Object.keys(spec.current).filter(
    (entry) =>
      entry in spec.previous &&
      spec.current[entry] !== spec.previous[entry] &&
      !attributed.has(entry),
  );
}

/**
 * Write the baseline file.
 *
 * `cutAt` is the instant this comparison ran, so the next one attributes from rows written
 * at or after it. Written at call END, so the rows explaining what this call itself changed
 * fall before the cut — the snapshot beside them already absorbed those changes.
 */
export function writeBaseline(path: string, snapshot: BaselineSnapshot, cutAt?: string): void {
  writeFileSync(path, JSON.stringify({ entries: snapshot, cutAt }));
}

/**
 * Read the baseline — entries and window cut in ONE parse — or `null`.
 *
 * One parse rather than two: reading the hashes and the cut separately lets a concurrent
 * write land between them, pairing one comparison's state with another's window bound. That
 * mismatch changes which entries are attributed and leaves no trace anywhere.
 *
 * Absence and corruption are the same signal — re-establish and record — so neither throws.
 * Observation is fail-open: the worst outcome is a missing datum, never a blocked call.
 */
export function readBaseline(path: string): StoredBaseline | null {
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
  const { entries, cutAt } = parsed as { entries?: unknown; cutAt?: unknown };
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    return null;
  }
  if (Object.values(entries).some((value) => typeof value !== 'string')) {
    return null;
  }

  // An unparseable cut degrades to absent, which admits the whole window — the same safe
  // direction {@link findUnattributed} takes, rather than a bound nobody can trust.
  return {
    entries: entries as BaselineSnapshot,
    cutAt: typeof cutAt === 'string' ? cutAt : undefined,
  };
}
