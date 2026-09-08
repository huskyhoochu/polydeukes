/**
 * up-translate — Grok PreToolUse payloads into the agent-neutral IR.
 *
 * Pure translation only — no I/O, no process spawning. Agent and tool literals live in
 * this package by design: it is the boundary where Grok's vocabulary is translated away
 * before it reaches the core.
 */

import type { CovenantInput } from '@polydeukes/core';
import { parsePayloadEnvelope } from './payload-envelope.ts';

/**
 * Fold one payload into one {@link CovenantInput} (pure).
 *
 * A recognised envelope becomes a single `toolCall`; `subagentSpawns` and `userMessages`
 * are always empty — this host proves neither. `actor` and `session` are omitted: the
 * envelope does not prove an actor, and there is no transcript channel.
 */
export function buildCovenantInput(
  payload: unknown,
): { ok: true; value: CovenantInput } | { ok: false; reason: string } {
  const envelope = parsePayloadEnvelope(payload);
  if (envelope.ok !== true) {
    return { ok: false, reason: envelope.reason };
  }

  return {
    ok: true,
    value: {
      toolCalls: [{ name: envelope.toolName, args: envelope.toolInput }],
      subagentSpawns: [],
      userMessages: [],
    },
  };
}
