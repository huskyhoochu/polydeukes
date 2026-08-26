import { describe, expect, it } from 'vitest';
import { type FailMode, failModeToExitCode, resolveFailMode } from '../src/fail-policy.ts';
// The EXIT constants are reused from the package entry point rather than restated as
// literals, binding the mapper to the exit-code semantics core publishes.
import { EXIT_BREAK_BLOCKING, EXIT_UPHOLD } from '../src/index.ts';

// Each row is one registered FailureKind and the FailMode it must resolve to.
const policyTable: { kind: string; expectedMode: FailMode }[] = [
  // Losing gate integrity → block. Passing an unjudgeable input is a bypass vector.
  { kind: 'evidence-absence', expectedMode: 'closed' },
  { kind: 'input-parse', expectedMode: 'closed' },
  { kind: 'undecidable-structure', expectedMode: 'closed' },
  // Losing one measurement datum → pass. Blocking would let observability hold work hostage.
  { kind: 'observability', expectedMode: 'open' },
];

describe('resolveFailMode — registered kinds', () => {
  it.each(policyTable)('resolves $kind to fail-$expectedMode', ({ kind, expectedMode }) => {
    expect(resolveFailMode(kind)).toBe(expectedMode);
  });
});

describe('resolveFailMode — fail-closed default', () => {
  it.each([
    'unknown-kind',
    '',
    '__proto__',
    'toString',
  ])('resolves the unregistered kind %j to fail-closed', (kind) => {
    // An unregistered failure means "cannot judge", so it must block; a lookup defaulting
    // to 'open' (or leaking undefined) is the fail-open hole this covers. The
    // prototype-pollution keys pin the table's null prototype: on a plain object they
    // would resolve to truthy inherited members and skip the fallback entirely.
    expect(resolveFailMode(kind)).toBe('closed');
  });

  it('never throws on arbitrary input (a throw is itself a boundary collapse)', () => {
    // resolveFailMode is pure and total: a throw could be caught upstream and mistaken for
    // a pass. The inputs are unusual string shapes a serialization path might hand in.
    const hostileInputs = ['', ' ', 'CLOSED', 'open', '__proto__', 'toString', '\n', '0'];
    for (const input of hostileInputs) {
      expect(() => resolveFailMode(input)).not.toThrow();
    }
  });
});

describe('failModeToExitCode — mode → exit-code mapping', () => {
  it('maps fail-closed to the blocking exit code 2', () => {
    // Asserting the exact value AND the named constant is deliberate: it catches both a
    // wrong literal in the mapper and EXIT_BREAK_BLOCKING itself drifting away from 2.
    // A mapping to 0 here is a silent fail-open.
    expect(failModeToExitCode('closed')).toBe(2);
    expect(failModeToExitCode('closed')).toBe(EXIT_BREAK_BLOCKING);
  });

  it('maps fail-open to the uphold exit code 0', () => {
    // The other branch, without which a mapper returning a constant would pass.
    expect(failModeToExitCode('open')).toBe(0);
    expect(failModeToExitCode('open')).toBe(EXIT_UPHOLD);
  });
});
