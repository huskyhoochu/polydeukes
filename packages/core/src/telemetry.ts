/**
 * ROI telemetry — the single shared collector and its `gain` aggregation (CORE-02).
 *
 * One record is one line of 4-field TSV (PRD §4.1); one append is one write call
 * (PRD §4.2). I/O is confined to exactly two functions — {@link appendRecord} (the
 * only write) and {@link readRecords} (the only read). Formatting, parsing, and
 * aggregation are pure. This is the sole collector: later work calls this API rather
 * than building its own logger.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The three telemetry events. `bypassed` is a first-class event, not a flag on `passed`. */
export type TelemetryEvent = 'passed' | 'blocked' | 'bypassed';

/**
 * `TelemetryRecord` — one measured covenant outcome (PRD §4.1).
 *
 * `subject` is the judged target (a file path, etc.); `-` is the documented sentinel
 * for "no subject", carried round-trip like any other value.
 */
export type TelemetryRecord = {
  timestamp: string;
  event: TelemetryEvent;
  label: string;
  subject: string;
};

/** Per-label event counts, keyed by label then event. */
export type GainSummary = {
  total: number;
  counts: Record<string, Record<TelemetryEvent, number>>;
};

const TAB = '\t';
const VALID_EVENTS: readonly TelemetryEvent[] = ['passed', 'blocked', 'bypassed'];

/**
 * Replace tab/newline/carriage-return with single spaces (PRD §4.1 line integrity).
 *
 * Without this, a tab or newline inside a field would fabricate extra TSV fields or
 * extra lines — a record is always exactly one line.
 */
function sanitize(value: string): string {
  return value.replace(/[\t\n\r]/g, ' ');
}

/**
 * Serialize a {@link TelemetryRecord} into one newline-terminated TSV line (pure).
 *
 * The returned string already includes the trailing `\n`, so {@link appendRecord}
 * writes it verbatim in a single call.
 */
export function formatRecordLine(record: TelemetryRecord): string {
  const fields = [record.timestamp, record.event, sanitize(record.label), sanitize(record.subject)];
  return `${fields.join(TAB)}\n`;
}

/**
 * Parse one TSV line back into a {@link TelemetryRecord}, or `null` if malformed (pure).
 *
 * Tolerates a trailing newline (so it round-trips {@link formatRecordLine}). Returns
 * `null` for the wrong field count, an event outside {passed, blocked, bypassed}, or an
 * empty line — a malformed line is rejected, never coerced into a bogus record.
 */
export function parseRecordLine(line: string): TelemetryRecord | null {
  const trimmed = line.replace(/\n$/, '');
  if (trimmed.length === 0) {
    return null;
  }

  const fields = trimmed.split(TAB);
  if (fields.length !== 4) {
    return null;
  }

  const [timestamp, event, label, subject] = fields;
  if (!VALID_EVENTS.includes(event as TelemetryEvent)) {
    return null;
  }

  return { timestamp, event: event as TelemetryEvent, label, subject };
}

/**
 * Append one record to the log at `path` — the only write I/O (PRD §4.2).
 *
 * Exactly one {@link appendFileSync} call per record, writing {@link formatRecordLine}
 * verbatim. Relying on POSIX `O_APPEND` single-write semantics, concurrent appends do
 * not interleave lines.
 *
 * fail-open (PRD §4.3): any fs failure — bad path, permissions, disk — returns
 * `{ ok: false }` and never throws. This is deliberately the opposite direction of the
 * covenant path's fail-closed: the worst outcome of telemetry is a missing datum, never
 * a blocked workflow.
 */
export function appendRecord(path: string, record: TelemetryRecord): { ok: boolean } {
  try {
    appendFileSync(path, formatRecordLine(record));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Append one telemetry record fail-open, timestamping it here (CORE-05).
 *
 * This layer lives above the deliberately mkdir-free {@link appendRecord} (COVENANT-01b:
 * an absent directory is a fail-open `{ ok: false }` for `appendRecord` itself), so this
 * wrapper carries the parent-directory guarantee. The mkdir and the append share one try
 * block, and a failure of either never alters the caller's verdict and never propagates.
 */
export function appendRecordFailOpen(
  telemetryPath: string,
  record: Omit<TelemetryRecord, 'timestamp'>,
): void {
  try {
    mkdirSync(dirname(telemetryPath), { recursive: true });
    appendRecord(telemetryPath, { timestamp: new Date().toISOString(), ...record });
  } catch {
    // fail-open: a logging problem must not alter the verdict or propagate.
  }
}

/**
 * Read every record from the log at `path` — the only read I/O (PRD §4.4).
 *
 * fail-open: an absent file or any read error returns `{ records: [], skipped: 0 }`
 * (an absent log means "nothing collected yet"), never throwing. Corrupt lines
 * ({@link parseRecordLine} → `null`) are skipped and counted; the blank trailing line
 * from the final `\n` is not counted as skipped.
 */
export function readRecords(path: string): { records: TelemetryRecord[]; skipped: number } {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return { records: [], skipped: 0 };
  }

  const records: TelemetryRecord[] = [];
  let skipped = 0;
  for (const line of content.split('\n')) {
    if (line.length === 0) {
      continue;
    }
    const parsed = parseRecordLine(line);
    if (parsed === null) {
      skipped += 1;
    } else {
      records.push(parsed);
    }
  }

  return { records, skipped };
}

/**
 * Aggregate records into per-label event counts (PRD §4.4, pure).
 *
 * Each label gets its own counter across all three events, so a corrupt or missing
 * event never bleeds counts between labels.
 */
export function aggregateGain(records: TelemetryRecord[]): GainSummary {
  const counts: Record<string, Record<TelemetryEvent, number>> = {};
  for (const record of records) {
    if (!(record.label in counts)) {
      counts[record.label] = { passed: 0, blocked: 0, bypassed: 0 };
    }
    counts[record.label][record.event] += 1;
  }
  return { total: records.length, counts };
}

/**
 * Render a {@link GainSummary} into human-readable lines (pure).
 *
 * Each label is mentioned with its passed/blocked/bypassed counts; `bypassed` is a
 * distinct column, not folded into passed/blocked (PRD §4.4). A non-zero `skipped`
 * count is reported rather than hidden — silent skipping would mask log corruption.
 */
function renderGain(summary: GainSummary, skipped: number): string {
  if (summary.total === 0 && skipped === 0) {
    return 'no telemetry collected';
  }

  const lines = [`total ${summary.total}`];
  for (const [label, counts] of Object.entries(summary.counts)) {
    lines.push(
      `${label}: passed=${counts.passed} blocked=${counts.blocked} bypassed=${counts.bypassed}`,
    );
  }
  if (skipped > 0) {
    lines.push(`skipped=${skipped}`);
  }
  return lines.join('\n');
}

/**
 * `gain` entry point — read the log at `path`, aggregate, and render (PRD §4.4).
 *
 * Composes {@link readRecords} + {@link aggregateGain} + a pure renderer. An absent or
 * empty log yields `no telemetry collected`; a corrupt line is skipped upstream, reported
 * in the output, and does not abort the report.
 */
export function runGain(path: string): string {
  const { records, skipped } = readRecords(path);
  return renderGain(aggregateGain(records), skipped);
}
