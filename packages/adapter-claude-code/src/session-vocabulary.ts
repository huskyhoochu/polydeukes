/**
 * Session-surface tool vocabulary.
 *
 * The PreToolUse surface's tool names, owned by the adapter that speaks them — the
 * `STAGED_WRITE`/`STAGED_DELETE` precedent on the git side. Assembly consumes these
 * values; the core never sees them, and no other project has to copy a hook file to
 * get them. The transcript reader lives here for the same reason: `transcript_path`
 * is a Claude Code envelope key, and reading it is translation, not assembly.
 */

import { isPlainObject } from '@polydeukes/core';

/**
 * Tool names whose calls mutate a file and carry `fileChange` evidence.
 *
 * A tool absent from this list is judged by nobody. Removing an entry that looks
 * unused silently stops judging that tool, and no test in this repository catches it.
 */
export const MUTATING_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/** Tool names that carry a shell command line instead of a file target. */
export const SHELL_TOOLS = ['Bash'];

/** `tool_input` keys a shell tool's command line travels in. */
export const COMMAND_ARGS = ['command'];

/** {@link transcriptPathFromPayload} input — one raw PreToolUse payload as a JSON string. */
export type TranscriptPathFromPayloadSpec = { rawPayload: string };

/**
 * Read the live transcript path out of a raw PreToolUse payload.
 *
 * The transcript path travels in the raw payload only — up-translation drops it, so it
 * is read from the string and nowhere else. Every failure narrows to `undefined`
 * (unparseable JSON, a non-object payload, a non-string field), never a throw: lost
 * evidence leaves the dispatcher on its `noopTranscript` default, which shuts the
 * witness valve rather than opening it. A payload this function
 * cannot parse is still dispatched — `runAdapterPath` owns that verdict.
 */
export function transcriptPathFromPayload(spec: TranscriptPathFromPayloadSpec): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(spec.rawPayload);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed) || typeof parsed.transcript_path !== 'string') {
    return undefined;
  }
  return parsed.transcript_path;
}
