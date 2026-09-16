/** Internal envelope validation — not part of the package's public surface. */

import { isPlainObject } from '@polydeukes/core';

/**
 * The keys the host's generated PreToolUse schema marks required.
 *
 * Every one is demanded, including the keys no judgment reads: a payload missing one is not
 * an envelope from the host build this package was written against, and translating it means
 * guessing what the rest of it meant.
 */
const REQUIRED_KEYS = [
  'cwd',
  'hook_event_name',
  'model',
  'permission_mode',
  'session_id',
  'tool_input',
  'tool_name',
  'tool_use_id',
  'transcript_path',
  'turn_id',
] as const;

/** The only event this adapter judges — the one observed before the call runs. */
const HOOK_EVENT = 'PreToolUse';

/** `PayloadEnvelope` — the validated PreToolUse payload, or the reason it is not one. */
export type PayloadEnvelope =
  | { ok: true; cwd: string; toolName: string; command: string }
  | { ok: false; reason: string };

/**
 * Validate one PreToolUse payload (pure).
 *
 * snake_case only: this host has one spelling, and accepting the camelCase one would admit
 * a payload no Codex build produces. Every value this adapter reads is type-checked here so
 * that a wrong type leaves as a reason rather than as a throw deeper in — a crash exits 1,
 * which the host reads as NOT blocked.
 */
export function parsePayloadEnvelope(payload: unknown, roster: readonly string[]): PayloadEnvelope {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'the payload is not a non-null object' };
  }

  for (const key of REQUIRED_KEYS) {
    if (!(key in payload)) {
      return { ok: false, reason: `the payload is missing the required key '${key}'` };
    }
  }

  if (payload.hook_event_name !== HOOK_EVENT) {
    return {
      ok: false,
      reason: `the payload is a ${String(payload.hook_event_name)} event, not ${HOOK_EVENT}`,
    };
  }
  if (typeof payload.cwd !== 'string') {
    return { ok: false, reason: 'the payload cwd is not a string' };
  }
  if (typeof payload.tool_name !== 'string') {
    return { ok: false, reason: 'the payload tool_name is not a string' };
  }
  // Judged before the input shape: a name this adapter does not translate is refused on the
  // name alone, so the reason names it whatever `tool_input` carries. The roster is what
  // reaches the judge; a name outside it is not a mutating tool left unlisted but a call the
  // matcher was widened to — the same layer as a missing required key.
  if (!roster.includes(payload.tool_name)) {
    return {
      ok: false,
      reason:
        `this adapter does not translate tool '${payload.tool_name}'; the roster is ` +
        `${roster.join(', ')} — see the package README, What this surface does not observe`,
    };
  }
  if (!isPlainObject(payload.tool_input)) {
    return { ok: false, reason: 'the payload tool_input is not a non-null object' };
  }
  const command = payload.tool_input.command;
  if (typeof command !== 'string') {
    return { ok: false, reason: 'the payload tool_input.command is not a string' };
  }

  return { ok: true, cwd: payload.cwd, toolName: payload.tool_name, command };
}
