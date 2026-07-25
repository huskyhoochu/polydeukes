/**
 * JSONL-backed `CanonicalTranscript` provider (ADAPTER-04) — parses a Claude Code
 * session transcript into the agent-neutral query seam the waiver hatch judges over.
 *
 * JSONL vocabulary (`origin`, `subagent_type`, ISO timestamps) stays confined to this
 * package, never the core. Parsing happens once (a snapshot); the queries are pure
 * reads. Every failure — unreadable file, broken line, shape mismatch — reduces
 * evidence instead of throwing (fail-closed, PRD §4.4).
 */

import { readFileSync } from 'node:fs';

import {
  type CanonicalTranscript,
  isPlainObject,
  type SubagentInvocation,
  type TranscriptToolCall,
  type TranscriptUserMessage,
} from '@polydeukes/core';

/**
 * Extract a human utterance from one entry, or `undefined` (PRD §4.2).
 *
 * The allowlist is positive identification: `type === 'user'`, `origin.kind === 'human'`,
 * and a plain-string `message.content`. Anything else — tool_result blocks,
 * task-notifications, origin-less command wrappers — is an AI-controlled or ambiguous
 * surface and never counts as human. A missing/unparseable timestamp keeps the message
 * with `timestampMs` undefined; fabricating freshness would open the waiver.
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

/**
 * Extract subagent invocations from one entry (PRD §4.3).
 *
 * Detection keys on the *field*, not the tool name (the real tool has been renamed
 * Task → Agent): any `tool_use` block whose `input.subagent_type` is a string is an
 * invocation. A block that cannot prove its kind is dropped (evidence reduction).
 */
function toSubagentInvocations(entry: Record<string, unknown>): SubagentInvocation[] {
  if (entry.type !== 'assistant' || !isPlainObject(entry.message)) {
    return [];
  }
  const content = entry.message.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const invocations: SubagentInvocation[] = [];
  for (const block of content) {
    if (
      isPlainObject(block) &&
      block.type === 'tool_use' &&
      isPlainObject(block.input) &&
      typeof block.input.subagent_type === 'string'
    ) {
      invocations.push({ kind: block.input.subagent_type });
    }
  }
  return invocations;
}

/**
 * Extract tool calls from one entry (COVENANT-13 §4.3).
 *
 * Positive identification on the *name*: any `tool_use` block with a string `name` is a
 * call, in observation order. A non-plain `input` empties the args but keeps the block —
 * the call's existence is itself the evidence, and dropping it would shrink a precedent
 * gate's evidence beyond what the malformed field justifies. Spawn blocks surface here
 * too: the same fact answers two queries.
 */
function toToolCalls(entry: Record<string, unknown>): TranscriptToolCall[] {
  if (entry.type !== 'assistant' || !isPlainObject(entry.message)) {
    return [];
  }
  const content = entry.message.content;
  if (!Array.isArray(content)) {
    return [];
  }
  const calls: TranscriptToolCall[] = [];
  for (const block of content) {
    if (isPlainObject(block) && block.type === 'tool_use' && typeof block.name === 'string') {
      calls.push({
        name: block.name,
        args: isPlainObject(block.input) ? { ...block.input } : {},
      });
    }
  }
  return calls;
}

/**
 * Parse JSONL transcript text into a {@link CanonicalTranscript} (PRD §4.2–4.4).
 *
 * One pass over the lines builds an immutable snapshot; the queries only read it.
 * Unparseable lines, non-object lines, and shape-mismatched entries are skipped
 * silently — a broken line never aborts the rest of the scan and never throws.
 */
export function transcriptFromJsonl(text: string): CanonicalTranscript {
  const userMessages: TranscriptUserMessage[] = [];
  const subagentInvocations: SubagentInvocation[] = [];
  const toolCalls: TranscriptToolCall[] = [];

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
    subagentInvocations.push(...toSubagentInvocations(entry));
    toolCalls.push(...toToolCalls(entry));
  }

  // Every query returns fresh objects — never live aliases into the snapshot, down to a
  // call's nested args — so a consumer mutating a result cannot corrupt what later
  // queries read (the same alias-safety contract the core transcriptFromInput upholds).
  return {
    findSubagentInvocations: (kind) =>
      subagentInvocations
        .filter((invocation) => kind === undefined || invocation.kind === kind)
        .map((invocation) => ({ ...invocation })),
    findUserMessages: () => userMessages.map((message) => ({ ...message })),
    findToolCalls: (name) =>
      toolCalls
        .filter((call) => name === undefined || call.name === name)
        .map((call) => ({ name: call.name, args: { ...call.args } })),
  };
}

/**
 * Read a transcript file and parse it (PRD §5.4).
 *
 * ANY read failure — missing file, permission, directory — degrades to an empty
 * transcript (both queries `[]`), never a throw: the valve turns off, never open.
 */
export function transcriptFromJsonlFile(path: string): CanonicalTranscript {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return transcriptFromJsonl('');
  }
  return transcriptFromJsonl(text);
}
