/**
 * `envEscapeHatch` — an env-var-backed escape hatch predicate (COVENANT-03, PRD §4.3).
 *
 * The minimal valve until the TTL waiver (COVENANT-06) supplies a second predicate to the
 * same seam. The predicate reads `process.env[variableName]` at invocation time, so a hatch
 * can be armed or disarmed between dispatches.
 */

import type { CovenantInput } from '@polydeukes/core';

/**
 * Build a predicate that returns `true` iff the named env var is a non-empty string.
 *
 * An unset var or the empty string is falsy — the hatch stays closed and enforcement
 * proceeds. The input is unused (this hatch keys on the environment, not the payload).
 */
export function envEscapeHatch(variableName: string): (input: CovenantInput) => boolean {
  return () => {
    const value = process.env[variableName];
    return typeof value === 'string' && value.length > 0;
  };
}
