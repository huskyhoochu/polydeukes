/**
 * exit-codes — the covenant protocol's exit-code vocabulary.
 *
 * The three codes are distinct and ordered by severity. The covenant *body* only ever
 * emits `0` (uphold) or `1` (break, non-blocking); translating a break into the blocking
 * `2` is the wrapper's job, never the core's. The sole place the core itself reaches for
 * `2` is the fail-closed parse path in `protocol.ts`.
 *
 * These live in their own leaf module because `fail-policy.ts` and `protocol.ts` both need
 * them: importing them from the barrel, which re-exports both, is an initialization
 * cycle — the constants read as `undefined` depending on which module the runtime evaluates
 * first. The barrel re-exports them, so every consumer outside core still reaches them at
 * the same path.
 */

/** Promise upheld — no violation, the edit/push passes. */
export const EXIT_UPHOLD = 0;

/** Violation reported as a non-blocking signal. The covenant body's break code. */
export const EXIT_BREAK_NON_BLOCKING = 1;

/** Violation blocked — the edit/push is refused. Reserved for the wrapper / fail-closed. */
export const EXIT_BREAK_BLOCKING = 2;
