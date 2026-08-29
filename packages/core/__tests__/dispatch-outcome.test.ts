import { describe, expectTypeOf, it } from 'vitest';
import type { DispatchOutcome } from '../src/index.ts';

// `DispatchOutcome` is the protocol-level shape of one dispatch: a blocking exit code and one
// entry per judged covenant. Type-only — no dist, no build; `expectTypeOf` bites under the
// package typecheck, not the vitest runtime. The dispatcher's real return carries more (a
// telemetry `event` per entry); the core type is the partial shape an adapter reads.

describe('DispatchOutcome — type locks', () => {
  it('is exactly the partial shape an adapter reads — no telemetry event on an entry', () => {
    // An exact lock, not a one-way `toExtend`: catches `event` becoming a required field (the
    // dispatcher's telemetry payload would then be part of the adapter's contract, the decision
    // CONTRACT-02 declines), the blocking `2` dropping out of either exit code, and `label`
    // being dropped or widened — the only field that names WHICH covenant produced an entry.
    expectTypeOf<DispatchOutcome>().toEqualTypeOf<{
      exitCode: 0 | 2;
      results: { label: string; exitCode: 0 | 2 }[];
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
      results: { label: string; exitCode: 1 }[];
    }>().not.toExtend<DispatchOutcome>();
  });
});
