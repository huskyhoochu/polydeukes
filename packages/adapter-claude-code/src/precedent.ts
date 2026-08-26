/**
 * Adapter-owned precedent evidence evaluator.
 *
 * The core owns the `command` evidence vocabulary and validates only the container
 * shape of everything else; ecosystem values — spawn kinds and tool names — are this
 * adapter's vocabulary, so this package validates and judges them (the
 * `resolveGitAdapterSettings` namespace precedent). The covenant assembly injects this
 * evaluator; `undefined` is the handshake that makes assembly fail closed on a key no
 * adapter recognizes.
 */

import type { CanonicalTranscript } from '@polydeukes/core';

/**
 * Judge one `requirePrecedent` evidence object against the session.
 *
 * - `subagent`: exact spawn-kind equality (a kind is a value, not a pattern).
 * - `tool`: the observed tool names matched as a regular expression.
 * - anything else: `undefined` — outside this adapter's vocabulary, including the core's
 *   own `command` key, which the covenant compiler evaluates itself.
 *
 * Both vocabularies require the call to have RUN and reported success: a call the
 * covenant blocked, one the human refused, and one that simply failed carry the same
 * outcome, and none of them did the work the discipline demands. The spawn
 * axis therefore reads the joined tool calls — the spawn query carries no outcome —
 * identifying a spawn by the same field the transcript provider does.
 *
 * A malformed value of a known key (non-string, non-compiling pattern) is also
 * `undefined`: the adapter cannot evaluate it, and assembly must fail loud. Answering
 * `false` instead would make the gate permanently unsatisfiable — no amount of actually
 * doing the required action could ever open it, with nothing diagnosing why.
 */
export function evaluatePrecedent(
  evidence: Record<string, unknown>,
  transcript: CanonicalTranscript,
): boolean | undefined {
  if ('subagent' in evidence) {
    const kind = evidence.subagent;
    if (typeof kind !== 'string') {
      return undefined;
    }
    return transcript
      .findToolCalls()
      .some((call) => call.succeeded === true && call.args.subagent_type === kind);
  }

  if ('tool' in evidence) {
    const pattern = evidence.tool;
    if (typeof pattern !== 'string') {
      return undefined;
    }
    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern);
    } catch {
      return undefined;
    }
    return transcript
      .findToolCalls()
      .some((call) => call.succeeded === true && matcher.test(call.name));
  }

  return undefined;
}
