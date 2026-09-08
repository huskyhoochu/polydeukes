/** Internal shared envelope validation — not part of the package's public surface. */

import { isPlainObject } from '@polydeukes/core';

/**
 * `PayloadEnvelope` — the validated outer shape every PreToolUse payload shares.
 *
 * Both the translator and `virtualPostState` accept `unknown` and must agree on
 * what counts as a well-formed envelope; sharing the validator keeps their
 * fail-closed diagnostics from drifting apart.
 */
export type PayloadEnvelope =
  | { ok: true; toolName: string; toolInput: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Validate the payload envelope. Prefers camelCase `toolName`/`toolInput` (the host
 * document spelling) and falls back to snake_case. When both input objects exist,
 * camelCase wins. Never throws — failure resolves to `{ ok: false, reason }`.
 */
export function parsePayloadEnvelope(payload: unknown): PayloadEnvelope {
  if (!isPlainObject(payload)) {
    return { ok: false, reason: 'payload is not a non-null object' };
  }

  const toolName =
    typeof payload.toolName === 'string'
      ? payload.toolName
      : typeof payload.tool_name === 'string'
        ? payload.tool_name
        : undefined;
  const toolInput = isPlainObject(payload.toolInput)
    ? payload.toolInput
    : isPlainObject(payload.tool_input)
      ? payload.tool_input
      : undefined;

  if (typeof toolName !== 'string') {
    return { ok: false, reason: 'payload is missing a string toolName' };
  }
  if (toolInput === undefined) {
    return { ok: false, reason: 'payload is missing a non-null object toolInput' };
  }
  return { ok: true, toolName, toolInput };
}
