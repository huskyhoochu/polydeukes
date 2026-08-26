/**
 * fail-policy — the failure-kind → fail-mode policy table.
 *
 * Pure and total: classifying a failure and mapping it to an exit code never
 * performs I/O and never throws. The single source of truth for "which failures
 * block and which pass through" lives here, not scattered across call sites.
 */

import { EXIT_BREAK_BLOCKING, EXIT_UPHOLD } from './exit-codes.js';

/** How a failure resolves: 'open' passes the call through, 'closed' blocks it. */
export type FailMode = 'open' | 'closed';

/**
 * The registered failure kinds. Gate-integrity failures
 * (evidence-absence / input-parse / undecidable-structure) fail closed;
 * observability failures fail open so measurement loss never holds work hostage.
 */
export type FailureKind =
  | 'evidence-absence'
  | 'input-parse'
  | 'undecidable-structure'
  | 'observability';

/**
 * Policy table. Null-prototype so lookups can never reach
 * Object.prototype members ('__proto__', 'toString', …) — those must resolve
 * to the fail-closed default, not to an inherited function.
 */
const FAIL_POLICY: Record<FailureKind, FailMode> = Object.assign(Object.create(null), {
  'evidence-absence': 'closed',
  'input-parse': 'closed',
  'undecidable-structure': 'closed',
  observability: 'open',
} satisfies Record<FailureKind, FailMode>);

/**
 * Resolve a failure kind to its {@link FailMode} via the policy table.
 *
 * fail-closed default: any unregistered kind — including '' and prototype-pollution
 * keys — resolves to 'closed'. "Cannot classify" means block. Pure and total: never
 * throws, no I/O, no logging.
 */
export function resolveFailMode(kind: string): FailMode {
  return FAIL_POLICY[kind as FailureKind] ?? 'closed';
}

/**
 * Map a {@link FailMode} to the covenant protocol's exit code:
 * 'open' → {@link EXIT_UPHOLD}, 'closed' → {@link EXIT_BREAK_BLOCKING}.
 * Reuses the protocol's constants — no independent numeric literals here.
 */
export function failModeToExitCode(mode: FailMode): 0 | 2 {
  return mode === 'open' ? EXIT_UPHOLD : EXIT_BREAK_BLOCKING;
}
