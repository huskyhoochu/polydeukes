/**
 * `CanonicalTranscript` — the agent-neutral session-query seam (CORE-04).
 *
 * Layering (PRD §1): this seam does not replace `CovenantInput`. The IR (CORE-01) is
 * the *data* a covenant judges; `CanonicalTranscript` is the *behavioral seam* that
 * queries session data — CORE-04 sits on top of CORE-01, and the IR is one source it
 * can wrap. Concrete transcript formats stay in adapters; the core knows only the
 * query vocabulary. Pure types and functions, zero I/O.
 */

import type { CovenantInput } from './index.js';

/** One subagent invocation observed in the session. `kind` is an adapter-supplied value. */
export type SubagentInvocation = { kind: string };

/**
 * One user message observed in the session (PRD §4.1).
 *
 * `timestampMs` is epoch milliseconds. Its absence means the source cannot prove
 * freshness — the fail-closed signal a waiver consumer must treat as "not fresh".
 */
export type TranscriptUserMessage = { text: string; timestampMs?: number };

/**
 * `CanonicalTranscript` — what a covenant may ask about the session (PRD §4.1).
 *
 * Synchronous by design (covenant bodies are short-lived CLI processes) and
 * verdict-free: the seam carries facts only; TTL filtering and token matching belong
 * to the consumer.
 */
export type CanonicalTranscript = {
  /** Invocations of the given kind, or all of them when omitted. Observation order preserved. */
  findSubagentInvocations(kind?: string): SubagentInvocation[];
  /** Every user message, observation order preserved. Missing timestampMs = freshness unprovable. */
  findUserMessages(): TranscriptUserMessage[];
};

/**
 * The injection-absent default (PRD §4.2): both queries answer "nothing happened".
 * A waiver consumer naturally converges to fail-closed — no evidence, no skip.
 */
export const noopTranscript: CanonicalTranscript = {
  findSubagentInvocations: () => [],
  findUserMessages: () => [],
};

/**
 * Wrap a {@link CovenantInput} as a {@link CanonicalTranscript} (PRD §4.2).
 *
 * Exposes `subagentSpawns` as invocations (filtered when a kind is given) and
 * `userMessages` with `timestampMs` always `undefined` — the bare IR cannot prove
 * freshness, and that absence is the *correct* fail-closed signal for a waiver
 * consumer. Order preserved; the input is never mutated.
 */
export function transcriptFromInput(input: CovenantInput): CanonicalTranscript {
  return {
    findSubagentInvocations: (kind) =>
      input.subagentSpawns.filter((spawn) => kind === undefined || spawn.kind === kind),
    findUserMessages: () =>
      input.userMessages.map((message) => ({ text: message.text, timestampMs: undefined })),
  };
}
