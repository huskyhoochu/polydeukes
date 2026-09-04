/**
 * ROI telemetry — the single shared collector and its `gain` aggregation.
 *
 * One record is one line of TSV — four fields, or five when a judgment names witnesses;
 * one append is one write call. I/O is confined to
 * exactly two functions — {@link appendRecord} (the only write) and {@link readRecords}
 * (the only read). Formatting, parsing, and aggregation are pure.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The six telemetry events. `witnessed` is a first-class event, not a flag on `passed`:
 * a break a human stood behind by supplying the pass condition themselves. `advised` is a
 * violation verdict an advise-level observer recorded but let through; `skipped` is a
 * discipline a surface could not judge at all (no evidence channel) — a no-op that shows
 * up in the data instead of vanishing.
 *
 * `unattributed` is the one observation event among them: a protected entry whose state
 * changed with no judgment row explaining it. It sits on a different axis from the five
 * verdicts — `skipped` is an inability known up front, `unattributed` an attribution
 * failure found after the fact — and it never blocks or passes a call.
 */
export type TelemetryEvent =
  | 'passed'
  | 'blocked'
  | 'witnessed'
  | 'advised'
  | 'skipped'
  | 'unattributed';

/**
 * Why a `skipped` row records no judgment, closed: the surface has no observation channel
 * for what the entry reads, assembly could not compile the entry, or the declaration's own
 * `supply: pass` let an absent source through.
 */
export const SKIP_REASONS = ['no-observation', 'config-fault', 'supply-pass'] as const;

/** One of the three skip reasons — the closed vocabulary of the fifth field on a skip row. */
export type SkipReason = (typeof SKIP_REASONS)[number];

/**
 * `TelemetryRecord` — one measured covenant outcome.
 *
 * `subject` is the judged target (a file path, etc.); `-` is the documented sentinel
 * for "no subject", carried round-trip like any other value.
 *
 * `witnesses` is the optional fifth field: an already-serialized JSON string naming what
 * a judgment found broken. Only a judgment that produced witness elements carries it, so
 * every other producer's row keeps its four fields.
 *
 * `reason` is the other reading of that fifth field, and only a `skipped` row takes it: a
 * skip has no witness to name, so the two never contend for the slot.
 */
export type TelemetryRecord = {
  timestamp: string;
  event: TelemetryEvent;
  label: string;
  subject: string;
  witnesses?: string;
  reason?: SkipReason;
};

/** Per-label event counts, keyed by label then event. */
export type GainSummary = {
  total: number;
  counts: Record<string, Record<TelemetryEvent, number>>;
};

const TAB = '\t';
const VALID_EVENTS: readonly TelemetryEvent[] = [
  'passed',
  'blocked',
  'witnessed',
  'advised',
  'skipped',
  'unattributed',
];

/**
 * The event name `witnessed` was written under before the rename — a read-only migration
 * seam, never a value this module emits.
 *
 * A log written before the rename still carries the old name, and rejecting those rows as
 * corrupt would discard the measurement rather than migrate it. Compatibility runs one way —
 * {@link formatRecordLine} has no path back to this name — and the match is the exact
 * literal, so a genuinely corrupt field is still rejected rather than coerced into a
 * fabricated record.
 */
const LEGACY_WITNESSED_EVENT = 'bypassed';

/**
 * Replace tab/newline/carriage-return with single spaces.
 *
 * Without this, a tab or newline inside a field would fabricate extra TSV fields or
 * extra lines — a record is always exactly one line.
 */
function sanitize(value: string): string {
  return value.replace(/[\t\n\r]/g, ' ');
}

/** True when `text` parses as a JSON array — the only shape the fifth field takes. */
function isJsonArray(text: string): boolean {
  try {
    return Array.isArray(JSON.parse(text));
  } catch {
    return false;
  }
}

/**
 * Serialize a {@link TelemetryRecord} into one newline-terminated TSV line (pure).
 *
 * The returned string already includes the trailing `\n`, so {@link appendRecord}
 * writes it verbatim in a single call. The fifth field appears only when the record
 * carries `witnesses` or a skip `reason`; a record without either writes the four-field
 * line unchanged.
 *
 * Throws when a record claims the fifth field twice, or claims it as a reason on an event
 * that is not `skipped`: both are assembly errors, and writing either one would produce a
 * row no reader can take apart.
 */
export function formatRecordLine(record: TelemetryRecord): string {
  if (record.reason !== undefined) {
    if (record.event !== 'skipped') {
      throw new Error(`a skip reason belongs to a skipped row, not to '${record.event}'`);
    }
    if (record.witnesses !== undefined) {
      throw new Error('a record carries either witnesses or a skip reason, never both');
    }
  }
  const fields = [record.timestamp, record.event, sanitize(record.label), sanitize(record.subject)];
  if (record.witnesses !== undefined) {
    fields.push(sanitize(record.witnesses));
  } else if (record.reason !== undefined) {
    fields.push(record.reason);
  }
  return `${fields.join(TAB)}\n`;
}

/**
 * Parse one TSV line back into a {@link TelemetryRecord}, or `null` if malformed (pure).
 *
 * Tolerates a trailing newline (so it round-trips {@link formatRecordLine}). Returns
 * `null` for a field count outside four (no fifth field) and five (with one), an event
 * outside the six valid events, or an empty line — a malformed line is rejected, never
 * coerced into a bogus record. The fifth field is read per event: on `skipped` it is a
 * token of {@link SKIP_REASONS} and nothing else, on every other event a JSON array of
 * witnesses. The one exception is {@link LEGACY_WITNESSED_EVENT}, which reads back as
 * `witnessed`.
 */
export function parseRecordLine(line: string): TelemetryRecord | null {
  const trimmed = line.replace(/\n$/, '');
  if (trimmed.length === 0) {
    return null;
  }

  const fields = trimmed.split(TAB);
  if (fields.length !== 4 && fields.length !== 5) {
    return null;
  }

  const [timestamp, event, label, subject, fifth] = fields;
  const resolved = event === LEGACY_WITNESSED_EVENT ? 'witnessed' : event;
  if (!VALID_EVENTS.includes(resolved as TelemetryEvent)) {
    return null;
  }
  const record = { timestamp, event: resolved as TelemetryEvent, label, subject };
  if (fifth === undefined) {
    return record;
  }
  if (resolved === 'skipped') {
    // A skip carries no witness, so a JSON array here is as corrupt as a near-miss token.
    return (SKIP_REASONS as readonly string[]).includes(fifth)
      ? { ...record, reason: fifth as SkipReason }
      : null;
  }
  // The fifth field is a JSON array or the line is corrupt: a stray tab inside a subject
  // would otherwise read as a record with the wrong subject and no witnesses.
  return isJsonArray(fifth) ? { ...record, witnesses: fifth } : null;
}

/**
 * Append one record to the log at `path` — the only write I/O.
 *
 * Exactly one {@link appendFileSync} call per record, writing {@link formatRecordLine}
 * verbatim. Relying on POSIX `O_APPEND` single-write semantics, concurrent appends do
 * not interleave lines.
 *
 * fail-open: any fs failure — bad path, permissions, disk — returns
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
 * Append one telemetry record fail-open, timestamping it here.
 *
 * {@link appendRecord} is deliberately mkdir-free — for it an absent directory is just a
 * fail-open `{ ok: false }` — so this wrapper carries the parent-directory guarantee. The
 * mkdir and the append share one try block, and a failure of either never alters the
 * caller's verdict and never propagates.
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
 * Read every record from the log at `path` — the only read I/O.
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
 * Aggregate records into per-label event counts (pure).
 *
 * Each label gets its own counter across all six events, so a corrupt or missing
 * event never bleeds counts between labels.
 */
export function aggregateGain(records: TelemetryRecord[]): GainSummary {
  const counts: Record<string, Record<TelemetryEvent, number>> = {};
  for (const record of records) {
    if (!(record.label in counts)) {
      counts[record.label] = {
        passed: 0,
        blocked: 0,
        witnessed: 0,
        advised: 0,
        skipped: 0,
        unattributed: 0,
      };
    }
    counts[record.label][record.event] += 1;
  }
  return { total: records.length, counts };
}

/**
 * Render a {@link GainSummary} into human-readable lines (pure).
 *
 * Each label is mentioned with its passed/blocked/witnessed/advised/skipped/unattributed
 * counts; each is a distinct column, never folded into another. A non-zero
 * corrupt-line count is reported rather than hidden — silent skipping would mask log
 * corruption.
 *
 * Two different meanings share the word `skipped`: the per-label EVENT column above,
 * and the unparseable-line count below. They are rendered on separate lines and never
 * summed — `corrupt lines skipped=N` names its own subject so neither reads as the other.
 */
function renderGain(summary: GainSummary, skipped: number): string {
  if (summary.total === 0 && skipped === 0) {
    return 'no telemetry collected';
  }

  const lines = [`total ${summary.total}`];
  for (const [label, counts] of Object.entries(summary.counts)) {
    lines.push(
      `${label}: passed=${counts.passed} blocked=${counts.blocked} witnessed=${counts.witnessed} advised=${counts.advised} skipped=${counts.skipped} unattributed=${counts.unattributed}`,
    );
  }
  if (skipped > 0) {
    lines.push(`corrupt lines skipped=${skipped}`);
  }
  return lines.join('\n');
}

/**
 * `gain` entry point — read the log at `path`, aggregate, and render.
 *
 * Composes {@link readRecords} + {@link aggregateGain} + a pure renderer. An absent or
 * empty log yields `no telemetry collected`; a corrupt line is skipped upstream, reported
 * in the output, and does not abort the report.
 */
export function runGain(path: string): string {
  const { records, skipped } = readRecords(path);
  return renderGain(aggregateGain(records), skipped);
}
