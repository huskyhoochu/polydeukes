/**
 * The session evidence builder — one raw PreToolUse payload in, the IR's `session` key out.
 *
 * Composes the two readers this package already owns: the JSONL transcript beside the
 * payload's `transcript_path`, and the spawn sidecar derived from that same location. It
 * opens the files those readers open and spawns nothing, so the runner receives the host's
 * session evidence as data and needs no knowledge of the format it was read from.
 */

import type { CovenantInput } from '@polydeukes/core';
import { sessionChannelReader } from './session-channel-reader.ts';
import { transcriptPathFromPayload } from './session-vocabulary.ts';
import { transcriptFromJsonlFile } from './transcript.ts';

/** {@link sessionEvidenceFromPayload} input — one raw PreToolUse payload as a JSON string. */
export type SessionEvidenceFromPayloadSpec = { rawPayload: string };

/**
 * The IR's session evidence, or its absence — what one payload proves about the session it
 * was made in.
 */
export type SessionEvidenceOutcome = CovenantInput['session'];

/**
 * Build the session evidence one payload carries, or `undefined`.
 *
 * The two absences are two facts. No `transcript_path` is no session, and answering an
 * empty session there would make every session-free payload register transcript-mod over
 * nothing. A path that cannot be read is a supplier fault: the lists come back empty and
 * `evidencePath` stays, so the runner still protects the file the host named while the
 * witness and every history declaration see an empty session and stay shut.
 *
 * An unparseable payload narrows to `undefined`, leaving the parse failure to the
 * translator's own verdict, and an unreadable transcript narrows to empty lists. A permission
 * refusal on the sidecar directory propagates, as the channel reader's own rule has it —
 * swallowing it would report a session that never spawned — so the caller composing this
 * into a hook keeps it inside its fail-closed catch.
 */
export function sessionEvidenceFromPayload(
  spec: SessionEvidenceFromPayloadSpec,
): SessionEvidenceOutcome {
  const evidencePath = transcriptPathFromPayload({ rawPayload: spec.rawPayload });
  if (evidencePath === undefined) return undefined;

  const transcript = transcriptFromJsonlFile({ path: evidencePath });
  const sidecar = sessionChannelReader({ transcriptPath: evidencePath })('sidecar');

  return {
    evidencePath,
    userMessages: (transcript?.findUserMessages() ?? []).map((message) => ({
      text: message.text,
      ...(message.timestampMs === undefined ? {} : { timestampMs: message.timestampMs }),
    })),
    toolCalls: (transcript?.findToolCalls() ?? []).map((call) => ({
      name: call.name,
      args: call.args,
      ...(call.succeeded === undefined ? {} : { succeeded: call.succeeded }),
    })),
    ...(sidecar === undefined ? {} : { channels: { sidecar } }),
  };
}
