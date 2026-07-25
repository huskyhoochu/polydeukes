/**
 * Adapter-owned precedent evidence evaluator (COVENANT-13 §4.4).
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
 * Judge one `requirePrecedent` evidence object against the session (PRD §4.4).
 *
 * - `subagent`: exact spawn-kind equality (a kind is a value, not a pattern).
 * - `tool`: the observed tool names matched as a regular expression.
 * - anything else: `undefined` — outside this adapter's vocabulary, including the core's
 *   own `command` key, which the covenant compiler evaluates itself.
 *
 * A malformed value (non-string, non-compiling pattern) is absent evidence — `false`,
 * never a throw: a crash at judgment time is worse than a closed gate.
 */
export function evaluatePrecedent(
  evidence: Record<string, unknown>,
  transcript: CanonicalTranscript,
): boolean | undefined {
  if ('subagent' in evidence) {
    const kind = evidence.subagent;
    if (typeof kind !== 'string') {
      return false;
    }
    return transcript.findSubagentInvocations(kind).length > 0;
  }

  if ('tool' in evidence) {
    const pattern = evidence.tool;
    if (typeof pattern !== 'string') {
      return false;
    }
    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern);
    } catch {
      return false;
    }
    return transcript.findToolCalls().some((call) => matcher.test(call.name));
  }

  return undefined;
}
