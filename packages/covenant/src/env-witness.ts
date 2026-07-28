/**
 * `envWitness` — an env-var-backed witness predicate (COVENANT-03, PRD §4.3).
 *
 * The minimal valve until the TTL witness (COVENANT-06) supplies a second predicate to the
 * same seam. The predicate reads `process.env[variableName]` at invocation time, so a valve
 * can be armed or disarmed between dispatches.
 */

import type { CovenantInput } from '@polydeukes/core';

/**
 * Build a predicate that returns `true` iff the named env var is a non-empty string.
 *
 * An unset var or the empty string is falsy — the valve stays closed and enforcement
 * proceeds. The input is unused (this witness keys on the environment, not the payload).
 */
export function envWitness(variableName: string): (input: CovenantInput) => boolean {
  return () => {
    const value = process.env[variableName];
    return typeof value === 'string' && value.length > 0;
  };
}
