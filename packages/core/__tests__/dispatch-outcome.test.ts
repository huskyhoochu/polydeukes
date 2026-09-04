import { describe, expectTypeOf, it } from 'vitest';
import type { DispatchOutcome } from '../src/protocol.ts';
import type { TelemetryEvent } from '../src/telemetry.ts';

// `DispatchOutcome` is the protocol-level shape of one dispatch: a blocking exit code, and one
// entry per judged covenant carrying the telemetry word recorded for it. Type-only — no dist,
// no build; `expectTypeOf` bites under the package typecheck, not the vitest runtime.

describe('DispatchOutcome — type locks', () => {
  it('is exactly the shape a dispatcher answers with, telemetry event and all', () => {
    // An exact lock, not a one-way `toExtend`: catches `event` being dropped or widened past
    // the judgment vocabulary, the blocking `2` dropping out of either exit code, and `label`
    // being dropped or widened — the only field that names WHICH covenant produced an entry.
    expectTypeOf<DispatchOutcome>().toEqualTypeOf<{
      exitCode: 0 | 2;
      results: { label: string; exitCode: 0 | 2; event: TelemetryEvent }[];
    }>();
  });

  it('rejects the non-blocking break code at the dispatch boundary', () => {
    // Catches the type widening to admit the body's `1` — a dispatch that exits 1 would leave
    // a break neither blocking nor upheld, and an adapter would forward it as a fail-open exit.
    expectTypeOf<{ exitCode: 1; results: [] }>().not.toExtend<DispatchOutcome>();
  });

  it('rejects the non-blocking break code on an entry', () => {
    // Same fail-open path one level down: a per-covenant `1` would ride inside an otherwise
    // blocking dispatch and be summed or forwarded by an adapter that trusts the type.
    expectTypeOf<{
      exitCode: 2;
      results: { label: string; exitCode: 1; event: TelemetryEvent }[];
    }>().not.toExtend<DispatchOutcome>();
  });
});
