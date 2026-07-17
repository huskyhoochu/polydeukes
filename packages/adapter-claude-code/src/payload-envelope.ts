/** Internal shared envelope validation — not part of the package's public surface. */

import { isPlainObject } from './is-plain-object.js';

/**
 * `PayloadEnvelope` — the validated outer shape every PreToolUse payload shares.
 *
 * Both `translateEvent` and `virtualPostState` accept `unknown` and must agree on
 * what counts as a well-formed envelope; sharing the validator keeps their
 * fail-closed diagnostics from drifting apart.
 */
export type PayloadEnvelope =
  | { ok: true; toolName: string; toolInput: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Validate the payload envelope (plain object, string `tool_name`, plain-object
 * `tool_input`). Never throws — failure resolves to `{ ok: false, reason }`.
 */
export function parsePayloadEnvelope(payload: unknown): PayloadEnvelope {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload is not a non-null object' };
  }
  if (typeof payload.tool_name !== 'string') {
    return { ok: false, reason: 'payload is missing a string tool_name' };
  }
  if (!isPlainObject(payload.tool_input)) {
    return { ok: false, reason: 'payload is missing a non-null object tool_input' };
  }
  return { ok: true, toolName: payload.tool_name, toolInput: payload.tool_input };
}
