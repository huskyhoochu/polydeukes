/**
 * `appendRecordFailOpen` — the covenant package's single fail-open telemetry seam.
 *
 * The core's `appendRecord` deliberately does not create directories (core purity —
 * an absent directory is a fail-open `{ ok: false }`), so the wiring point carries the
 * parent-directory guarantee (COVENANT-01b). Both the wrapper and the dispatcher log
 * through this one helper: the mkdir and the append share one try block, and a failure
 * of either never alters the caller's verdict and never propagates. The gate closes;
 * the measurement stays open.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { appendRecord, type TelemetryRecord } from '@polydeukes/core';

/** Append one telemetry record, timestamping it here; swallow every logging failure. */
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
