import { describe, expect, it } from 'vitest';
import { type FailMode, failModeToExitCode, resolveFailMode } from '../src/fail-policy.ts';
// EXIT constants are reused from the package entry point (PRD §4.2: no new numeric
// literals) to bind the mapper to CORE-01's semantics.
import { EXIT_BREAK_BLOCKING, EXIT_UPHOLD } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Policy table (PRD §4.1). Each row is one registered FailureKind → its FailMode.
// Table-driven by design: adding a spec row later costs exactly one array line here,
// not a new test block. Mutating any single row's expected mode is caught by it.each.
// ---------------------------------------------------------------------------
const policyTable: { kind: string; expectedMode: FailMode }[] = [
  // Losing gate integrity → block. Passing an unjudgeable input is a bypass vector.
  { kind: 'evidence-absence', expectedMode: 'closed' },
  { kind: 'input-parse', expectedMode: 'closed' },
  { kind: 'undecidable-structure', expectedMode: 'closed' },
  // Losing one measurement datum → pass. Blocking would let observability hold work hostage.
  { kind: 'observability', expectedMode: 'open' },
];

describe('resolveFailMode — registered kinds (PRD §4.1 policy table)', () => {
  it.each(policyTable)('resolves $kind to fail-$expectedMode', ({ kind, expectedMode }) => {
    // Kills a mutation of any single table row (e.g. observability flipped to 'closed',
    // or a gate-integrity kind flipped to 'open' — the §3-A fail-open bypass hole).
    expect(resolveFailMode(kind)).toBe(expectedMode);
  });
});

describe('resolveFailMode — fail-closed default (PRD §5.2)', () => {
  it.each(['unknown-kind', ''])('resolves the unregistered kind %j to fail-closed', (kind) => {
    // P0: an unregistered/unknown failure is "cannot judge" → block. A mutation that
    // defaults the lookup to 'open' (or drops the default branch entirely, letting an
    // undefined leak through) is the highest-value fail-open hole this ticket closes.
    expect(resolveFailMode(kind)).toBe('closed');
  });

  it('never throws on arbitrary input (a throw is itself a boundary collapse)', () => {
    // PRD §4.2 / §7: resolveFailMode is pure and total. A throw could be caught upstream
    // and mistaken for a pass. Covers unusual runtime-string shapes a serialization path
    // might hand in. Catches a mutation that indexes without a total-lookup guard.
    const hostileInputs = ['', ' ', 'CLOSED', 'open', '__proto__', 'toString', '\n', '0'];
    for (const input of hostileInputs) {
      expect(() => resolveFailMode(input)).not.toThrow();
    }
  });
});

describe('failModeToExitCode — mode → exit-code mapping (PRD §4.2)', () => {
  it('maps fail-closed to the blocking exit code 2', () => {
    // Boundary/security: 'closed' MUST yield EXIT_BREAK_BLOCKING. A mutation to 0 is a
    // silent fail-open; asserting the exact value AND the named constant catches both a
    // wrong literal and EXIT_BREAK_BLOCKING drifting away from 2.
    expect(failModeToExitCode('closed')).toBe(2);
    expect(failModeToExitCode('closed')).toBe(EXIT_BREAK_BLOCKING);
  });

  it('maps fail-open to the uphold exit code 0', () => {
    // The other branch. Catches a mapper that returns a constant (ignoring its argument)
    // or that flips 'open' to a blocking code, which would defeat fail-open kinds.
    expect(failModeToExitCode('open')).toBe(0);
    expect(failModeToExitCode('open')).toBe(EXIT_UPHOLD);
  });
});
