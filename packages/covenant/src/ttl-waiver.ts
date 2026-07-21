/**
 * `ttlWaiverHatch` — a time-boxed waiver predicate (COVENANT-06, PRD §4.1–4.2).
 *
 * The second predicate on the escape-hatch seam, replacing the session-global env
 * valve's "forget to disarm" failure mode with built-in expiry. A human types the
 * agreed token into the conversation; the waiver holds for `ttlMs` from that user
 * message's timestamp, then blocking resumes automatically — no stored state, every
 * dispatch re-judges against the injected clock.
 *
 * Invoking the waiver is distinct from talking about it (COVENANT-15): the token must
 * stand alone on the utterance's first line, so quoting or asking about it never opens
 * the valve. Only the token's *placement* is constrained — its value is free, and this
 * module never inspects its shape.
 */

import type { CanonicalTranscript, CovenantInput } from '@polydeukes/core';
import { resolveFailMode } from '@polydeukes/core';

/** Configuration for {@link ttlWaiverHatch}. */
export type TtlWaiverSpec = {
  /**
   * The agreed phrase a human types on the first line of a message, alone. Any value
   * works — the defence is provenance, not secrecy, so the phrase is never checked for
   * a prefix, a command shape, or any other form. Surrounding whitespace is trimmed at
   * assembly (both sides of the comparison normalise the same way); trimmed-empty throws.
   */
  token: string;
  /** Validity window in milliseconds from the user message's timestamp. Must be finite and > 0. */
  ttlMs: number;
  /** Injectable clock (defaults to Date.now). For test determinism. */
  now?: () => number;
};

/**
 * Build a predicate that returns `true` iff some user message carries the token
 * within the TTL window (PRD §4.2).
 *
 * A message waives only when all hold: it comes from `transcript.findUserMessages()`
 * (no other text surface is consulted — an AI-synthesised token never counts), the
 * first line of its `text` equals the token once trimmed, its `timestampMs` is
 * present, and `0 <= now() - timestampMs <= ttlMs` (closed interval; a future
 * timestamp is rejected). A missing `timestampMs` defers to `resolveFailMode('evidence-absence')`
 * — the CORE-04 contract "missing timestampMs = freshness unprovable = fail-closed"
 * — so the disposition's single source of truth stays in the core policy table.
 *
 * Validation is a factory-time concern: a trimmed-empty token or a non-finite /
 * non-positive `ttlMs` throws here; the returned predicate itself never throws.
 * The input is unused (same convention as `envEscapeHatch` — the valve keys on
 * session evidence, not the payload). Pure: no I/O, no state, no mutation.
 */
export function ttlWaiverHatch(
  spec: TtlWaiverSpec,
): (input: CovenantInput, transcript: CanonicalTranscript) => boolean {
  const { token: rawToken, ttlMs, now = Date.now } = spec;
  // Normalise once, at assembly: the first line is compared trimmed, so a token
  // carrying stray surrounding whitespace could never equal it — the valve would
  // pass validation and then silently never open.
  const token = rawToken.trim();
  if (token.length === 0) {
    throw new TypeError('ttlWaiverHatch: token must be non-empty after trimming');
  }
  if (!(Number.isFinite(ttlMs) && ttlMs > 0)) {
    throw new TypeError('ttlWaiverHatch: ttlMs must be a finite positive number');
  }
  return (_input, transcript) => {
    // One clock read per judgment: every message in this dispatch is measured
    // against the same "now", so the closed-interval boundary cannot flip with
    // a message's position in the transcript.
    const judgedAt = now();
    return transcript.findUserMessages().some((message) => {
      // The first line only, compared whole: an utterance invokes the waiver, it does
      // not merely mention it (COVENANT-15 §4.1). `split` keeps a leading blank line as
      // an empty first element, so a token below it never matches, and `trim` absorbs
      // both surrounding spaces and the `\r` a CRLF transport leaves behind.
      const [firstLine = ''] = message.text.split('\n');
      if (firstLine.trim() !== token) return false;
      if (message.timestampMs === undefined) {
        return resolveFailMode('evidence-absence') === 'open';
      }
      const elapsed = judgedAt - message.timestampMs;
      return elapsed >= 0 && elapsed <= ttlMs;
    });
  };
}
