/**
 * The session surface's supply body for the spawn sidecar channel — the subagent records
 * this host keeps beside the session's own transcript.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { ChannelReader } from '@polydeukes/core';

/** {@link sessionChannelReader} input — the session's transcript, when the host named one. */
export type SessionChannelReaderSpec = { transcriptPath?: string };

/** The channel kind this surface carries; any other kind is absent. */
const SIDECAR = 'sidecar';

/** The file extension the transcript is named with, stripped to get the session id. */
const TRANSCRIPT_SUFFIX = '.jsonl';

/** One subagent record per file, under the session's own directory beside the transcript. */
const SUBAGENTS_DIR = 'subagents';
const META_PREFIX = 'agent-';
const META_SUFFIX = '.meta.json';

/**
 * A reader over the spawn sidecar: a channel kind in, the spawn-record list as JSON text or
 * absence out.
 *
 * A transcript at `<dir>/<sessionId>.jsonl` keeps its subagent records at
 * `<dir>/<sessionId>/subagents/agent-*.meta.json`, one object per file. The three answers
 * are three facts: the parsed records as one JSON array, `'[]'` when the directory is there
 * and holds no record (the channel observed no spawn), and `undefined` when there is no
 * channel at all. A record that will not parse shrinks the evidence rather than poisoning
 * it — failing the whole channel would let one corrupt file erase a spawn that happened.
 */
export function sessionChannelReader(spec: SessionChannelReaderSpec): ChannelReader {
  return (kind) => {
    if (kind !== SIDECAR) return undefined;
    const { transcriptPath } = spec;
    // The path is the host's own fact, and every real host hands an absolute one. A
    // relative or empty spelling would resolve the sidecar against the hook's cwd, where
    // a checked-out `subagents/` directory could pass its records off as this session's
    // spawn evidence — so anything non-absolute is channel absence.
    if (transcriptPath === undefined || !isAbsolute(transcriptPath)) return undefined;

    const sessionId = basename(transcriptPath, TRANSCRIPT_SUFFIX);
    const dir = join(dirname(transcriptPath), sessionId, SUBAGENTS_DIR);
    let entries: string[];
    try {
      // Directory entries rather than names: a host can leave a directory whose name matches
      // the record pattern, and reading it as a file would take the whole channel down.
      entries = readdirSync(dir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.startsWith(META_PREFIX) &&
            entry.name.endsWith(META_SUFFIX),
        )
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      // Only "no such directory" is channel absence. Anything else — a permission refusal
      // above all — throws, so it reaches the root's fail-closed path instead of passing
      // for a session that never spawned.
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
      throw error;
    }

    const records: unknown[] = [];
    for (const name of entries) {
      let text: string;
      try {
        text = readFileSync(join(dir, name), 'utf-8');
      } catch (error) {
        // A record deleted between the listing and the read is one fewer witness; a read
        // the host refused is the same fail-closed fact as the directory case above.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      try {
        records.push(JSON.parse(text));
      } catch {
        // A record this host wrote half-way is one fewer witness, never a failed channel.
      }
    }
    return JSON.stringify(records);
  };
}
