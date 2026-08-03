import { readRecords } from '@polydeukes/core';

/**
 * Every telemetry row at `telemetryPath` as `[event, label, subject]` — the three-column
 * projection the umbrella suites pin verdicts with. Extracted at the fourth copy (the
 * covenant package's helpers.ts precedent fires at the third): a change to the record
 * shape now lands here once instead of drifting across suites.
 */
export function telemetryRows(telemetryPath: string): [string, string, string][] {
  return readRecords(telemetryPath).records.map((record) => [
    record.event,
    record.label,
    record.subject,
  ]);
}
