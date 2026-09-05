/**
 * JSONL-backed `CanonicalTranscript` provider — parses a Claude Code session
 * transcript into the agent-neutral query seam the witness valve judges over.
 *
 * JSONL vocabulary (`origin`, `subagent_type`, ISO timestamps) stays confined to this
 * package, never the core. Parsing happens once (a snapshot); the queries are pure
 * reads. Every failure — unreadable file, broken line, shape mismatch — reduces
 * evidence instead of throwing, fail-closed.
 */

import { readFileSync } from 'node:fs';

import {
  type CanonicalTranscript,
  isPlainObject,
  type TranscriptToolCall,
  type TranscriptUserMessage,
} from '@polydeukes/core';

/**
 * Extract a human utterance from one entry, or `undefined`.
 *
 * The allowlist is positive identification: `type === 'user'`, `origin.kind === 'human'`,
 * and a plain-string `message.content`. Anything else — tool_result blocks,
 * task-notifications, origin-less command wrappers — is an AI-controlled or ambiguous
 * surface and never counts as human. A missing/unparseable timestamp keeps the message
 * with `timestampMs` undefined; fabricating freshness would open the witness.
 */
function toUserMessage(entry: Record<string, unknown>): TranscriptUserMessage | undefined {
  if (entry.type !== 'user') {
    return undefined;
  }
  if (!isPlainObject(entry.origin) || entry.origin.kind !== 'human') {
    return undefined;
  }
  if (!isPlainObject(entry.message) || typeof entry.message.content !== 'string') {
    return undefined;
  }
  const parsed = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
  return {
    text: entry.message.content,
    timestampMs: Number.isFinite(parsed) ? parsed : undefined,
  };
}

/** One observed tool call, carrying the id its result block will reference. */
type ObservedToolCall = { name: string; args: Record<string, unknown>; id?: string };

/**
 * Extract tool calls from one entry.
 *
 * Positive identification on the *name*: any `tool_use` block with a string `name` is a
 * call, in observation order. A non-plain `input` empties the args but keeps the block —
 * the call's existence is itself the evidence, and dropping it would shrink a precedent
 * gate's evidence beyond what the malformed field justifies. Spawn blocks surface here
 * too: the same fact answers two queries. A non-string `id` is left absent, which the
 * join then reads as an unproven outcome.
 */
function toToolCalls(entry: Record<string, unknown>): ObservedToolCall[] {
  if (entry.type !== 'assistant' || !isPlainObject(entry.message)) {
    return [];
  }
  const content = entry.message.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const calls: ObservedToolCall[] = [];
  for (const block of content) {
    if (isPlainObject(block) && block.type === 'tool_use' && typeof block.name === 'string') {
      calls.push({
        name: block.name,
        args: isPlainObject(block.input) ? { ...block.input } : {},
        ...(typeof block.id === 'string' ? { id: block.id } : {}),
      });
    }
  }
  return calls;
}

/**
 * Extract the outcomes reported by one entry's result blocks.
 *
 * Results ride `user` entries and reference the call they answer; only that reference and
 * the error marker are read, never the result body. Success is ENUMERATED — no marker, or
 * a marker of exactly `false` — so every other value, boolean or not, reads as a failure
 * and a shape mismatch can only ever reduce evidence. A block that cannot prove a
 * string reference is dropped alone.
 */
function toToolResults(entry: Record<string, unknown>): { id: string; succeeded: boolean }[] {
  if (entry.type !== 'user' || !isPlainObject(entry.message)) {
    return [];
  }
  const content = entry.message.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const results: { id: string; succeeded: boolean }[] = [];
  for (const block of content) {
    if (
      isPlainObject(block) &&
      block.type === 'tool_result' &&
      typeof block.tool_use_id === 'string'
    ) {
      results.push({
        id: block.tool_use_id,
        succeeded: block.is_error === undefined || block.is_error === false,
      });
    }
  }
  return results;
}

/**
 * Parse JSONL transcript text into a {@link CanonicalTranscript}.
 *
 * One pass over the lines builds an immutable snapshot; the queries only read it.
 * Unparseable lines, non-object lines, and shape-mismatched entries are skipped
 * silently — a broken line never aborts the rest of the scan and never throws.
 */
export function transcriptFromJsonl(text: string): CanonicalTranscript {
  const userMessages: TranscriptUserMessage[] = [];
  const observedCalls: ObservedToolCall[] = [];
  const outcomes = new Map<string, boolean>();

  for (const line of text.split('\n')) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isPlainObject(entry)) {
      continue;
    }
    const message = toUserMessage(entry);
    if (message !== undefined) {
      userMessages.push(message);
    }
    observedCalls.push(...toToolCalls(entry));
    for (const result of toToolResults(entry)) {
      // First result wins. Real transcripts carry no duplicate reference within one file
      // (the duplicates they do carry are cross-file copies made on resume), and the
      // judge reads one file.
      if (!outcomes.has(result.id)) outcomes.set(result.id, result.succeeded);
    }
  }

  // The join. No result found is not ignorance: this provider CAN read the result
  // channel, so silence is success it failed to prove — `undefined` stays reserved
  // for a provider that cannot see results at all.
  const toolCalls: TranscriptToolCall[] = observedCalls.map((call) => ({
    name: call.name,
    args: call.args,
    succeeded: call.id !== undefined && outcomes.get(call.id) === true,
  }));

  // Every query returns fresh objects — never live aliases into the snapshot, down to a
  // call's nested args — so a consumer mutating a result cannot corrupt what later
  // queries read (the same alias-safety contract the core transcriptFromInput upholds).
  return {
    findUserMessages: () => userMessages.map((message) => ({ ...message })),
    findToolCalls: (name) =>
      toolCalls
        .filter((call) => name === undefined || call.name === name)
        .map((call) => ({ name: call.name, args: { ...call.args }, succeeded: call.succeeded })),
  };
}

/** {@link transcriptFromJsonlFile} input — the transcript file to read. */
export type TranscriptFromJsonlFileSpec = { path: string };

/**
 * Read a transcript file and parse it.
 *
 * ANY read failure — missing file, permission, directory — answers `undefined`, never a
 * throw. It is deliberately NOT an empty transcript: the two are different facts, and
 * collapsing them hid the more likely one. An empty transcript is a session that has said
 * nothing yet, and judging against it is correct. An unreadable one is no session channel
 * at all, so a history declaration must skip rather than demand evidence from a session
 * nobody can read — while the witness valve reads the same absence and stays shut, leaving
 * a dead end with no message naming the cause.
 *
 * Either way the valve turns off, never open: `undefined` leaves the dispatcher on its
 * `noopTranscript` default.
 */
export function transcriptFromJsonlFile(
  spec: TranscriptFromJsonlFileSpec,
): CanonicalTranscript | undefined {
  let text: string;
  try {
    text = readFileSync(spec.path, 'utf-8');
  } catch {
    return undefined;
  }
  return transcriptFromJsonl(text);
}
