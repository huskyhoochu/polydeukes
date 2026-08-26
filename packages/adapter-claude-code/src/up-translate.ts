/**
 * up-translate — Claude Code PreToolUse payloads into the agent-neutral IR.
 *
 * Pure translation only — no I/O, no process spawning. Agent and tool literals live in
 * this package by design: it is the boundary where Claude Code's vocabulary is
 * translated away before it reaches the core.
 *
 * These live outside the barrel because `run-adapter-path.ts` consumes
 * `buildCovenantInput` and the barrel re-exports `run-adapter-path`: importing through
 * the barrel is an initialization cycle. The barrel re-exports this
 * module, so every consumer outside the package still reaches it at the same path.
 */

import { type CovenantInput, EXIT_BREAK_BLOCKING } from '@polydeukes/core';

import { parsePayloadEnvelope } from './payload-envelope.js';

/**
 * `ClaudePreToolUsePayload` — a Claude Code PreToolUse hook payload.
 *
 * Only `tool_name` and `tool_input` are required; the rest is preserved when present.
 * The agent/tool literals this package interprets live in the *values* of these fields,
 * never in core — this boundary is the package's reason to exist.
 */
export type ClaudePreToolUsePayload = {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
};

/**
 * `TranslatedEvent` — the result of up-translating one payload.
 *
 * Success carries the IR fragment; failure carries a human-readable `reason`. A `Task`
 * with a string `subagent_type` becomes a `subagentSpawn`; every other tool becomes a
 * `toolCall`. Classification failure never demotes to a `toolCall` — losing spawn
 * evidence is a bypass vector.
 */
export type TranslatedEvent =
  | { ok: true; kind: 'toolCall'; value: { name: string; args?: Record<string, unknown> } }
  | { ok: true; kind: 'subagentSpawn'; value: { kind: string } }
  | { ok: false; reason: string };

/**
 * Up-translate one Claude Code payload into an IR fragment (pure).
 *
 * Never throws: a payload that cannot be classified — a non-object, a missing/invalid
 * `tool_name` or `tool_input`, or a `Task` lacking a string `subagent_type` — resolves
 * to `{ ok: false, reason }`, fail-closed.
 */
export function translateEvent(payload: unknown): TranslatedEvent {
  const envelope = parsePayloadEnvelope(payload);
  if (envelope.ok !== true) {
    return { ok: false, reason: envelope.reason };
  }

  const { toolName, toolInput } = envelope;

  if (toolName === 'Task') {
    if (typeof toolInput.subagent_type !== 'string') {
      return { ok: false, reason: 'Task payload is missing a string subagent_type' };
    }
    return { ok: true, kind: 'subagentSpawn', value: { kind: toolInput.subagent_type } };
  }

  return { ok: true, kind: 'toolCall', value: { name: toolName, args: toolInput } };
}

/**
 * Fold a sequence of payloads into one {@link CovenantInput} (pure).
 *
 * Preserves observation order into `toolCalls` / `subagentSpawns`; `userMessages` is
 * always `[]` — witness evidence arrives through the transcript, not this path. If any
 * payload fails classification the whole build fails closed with the blocking exit
 * code — a silent drop would be a bypass vector.
 */
export function buildCovenantInput(
  payloads: unknown[],
): { ok: true; value: CovenantInput } | { ok: false; exitCode: 2; reason: string } {
  const input: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };

  for (let index = 0; index < payloads.length; index++) {
    const translated = translateEvent(payloads[index]);
    if (translated.ok !== true) {
      return {
        ok: false,
        exitCode: EXIT_BREAK_BLOCKING,
        reason: `payload at index ${index} failed classification: ${translated.reason}`,
      };
    }
    if (translated.kind === 'toolCall') {
      input.toolCalls.push(translated.value);
    } else {
      input.subagentSpawns.push(translated.value);
    }
  }

  return { ok: true, value: input };
}
