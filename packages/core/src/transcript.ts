/**
 * `CanonicalTranscript` — the agent-neutral session-query seam.
 *
 * This seam does not replace `CovenantInput`. The IR is the *data* a covenant judges;
 * `CanonicalTranscript` is the *behavioral seam* that queries session data, and the IR is
 * one source it can wrap. Concrete transcript formats stay in adapters; the core knows only
 * the query vocabulary. Pure types and functions, zero I/O.
 */

import type { CovenantInput } from './index.js';

/** One subagent invocation observed in the session. `kind` is an adapter-supplied value. */
export type SubagentInvocation = { kind: string };

/**
 * One user message observed in the session.
 *
 * `timestampMs` is epoch milliseconds. Its absence means the source cannot prove
 * freshness — the fail-closed signal a witness consumer must treat as "not fresh".
 */
export type TranscriptUserMessage = { text: string; timestampMs?: number };

/**
 * One tool call observed in the session. `name` and `args` are adapter-supplied values —
 * the core knows the query vocabulary, never a tool's name.
 *
 * `succeeded` is three-valued: `true` = it ran and reported success,
 * `false` = it ran and reported an error, was blocked, or was refused, and absent = the
 * provider cannot observe results at all. A consumer that treats the call as evidence
 * accepts only `true`, so the latter two share a disposition while staying diagnosable.
 */
export type TranscriptToolCall = {
  name: string;
  args: Record<string, unknown>;
  succeeded?: boolean;
};

/**
 * `CanonicalTranscript` — what a covenant may ask about the session.
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
  /** Tool calls with the given name, or all when omitted. Observation order preserved. */
  findToolCalls(name?: string): TranscriptToolCall[];
};

/**
 * The injection-absent default: every query answers "nothing happened".
 * A witness consumer naturally converges to fail-closed — no evidence, no skip — and
 * so does a precedent consumer (no evidence, gate stays shut).
 */
export const noopTranscript: CanonicalTranscript = {
  findSubagentInvocations: () => [],
  findUserMessages: () => [],
  findToolCalls: () => [],
};

/**
 * Wrap a {@link CovenantInput} as a {@link CanonicalTranscript}.
 *
 * Exposes `subagentSpawns` as invocations (filtered when a kind is given) and
 * `userMessages` with `timestampMs` omitted — the bare IR cannot prove freshness,
 * and that absence is the *correct* fail-closed signal for a witness consumer.
 * Order preserved; the input is never mutated, and every query returns fresh
 * objects so consumers never hold live aliases into the shared IR.
 *
 * `findToolCalls` projects each call down to `{ name, args }` only: a call element also
 * carries `fileChange` evidence, and evidence is judgment input, not session history — the
 * two vocabularies stay separate. `succeeded` stays absent because these calls are the ones
 * being judged right now: they have not run, and a call can never be its own precedent.
 */
export function transcriptFromInput(input: CovenantInput): CanonicalTranscript {
  return {
    findSubagentInvocations: (kind) =>
      input.subagentSpawns
        .filter((spawn) => kind === undefined || spawn.kind === kind)
        .map((spawn) => ({ kind: spawn.kind })),
    findUserMessages: () => input.userMessages.map((message) => ({ text: message.text })),
    findToolCalls: (name) =>
      input.toolCalls
        .filter((call) => name === undefined || call.name === name)
        // Deep copy: args nest arbitrarily (real payloads are parsed JSON), and a shallow
        // spread would leave nested values as live aliases into the IR the judges share.
        .map((call) => ({ name: call.name, args: structuredClone(call.args ?? {}) })),
  };
}
