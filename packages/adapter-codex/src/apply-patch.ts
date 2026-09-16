/**
 * The V4A patch parser — the raw text of an `apply_patch` call in, one `FileChange` per
 * file out.
 *
 * Pure: the only way to a pre-state is the injected reader, which answers `null` for a file
 * that is not there and throws for a read it was refused. A text the grammar refuses answers
 * `{ ok: false }` rather than throwing, so the caller decides what a refusal costs.
 *
 * Every path leaves exactly as the patch text spelled it. Patch paths are relative to the
 * call's working directory and the judge reads them relative to the project root, so
 * resolving between the two bases belongs to the caller that knows both.
 */

import type { FileChange } from '@polydeukes/core';

/** The result of one parse — the changes the patch proves, or why it proves none. */
export type ParseApplyPatchOutcome =
  | { ok: true; value: FileChange[] }
  | { ok: false; reason: string };

/** A pre-state reader: the text at a path, or `null` when there is no file there. */
export type PreStateReader = (path: string) => string | null;

const BEGIN_PATCH = '*** Begin Patch';
const END_PATCH = '*** End Patch';
const ENVIRONMENT_ID = '*** Environment ID:';
const ADD_FILE = '*** Add File:';
const DELETE_FILE = '*** Delete File:';
const UPDATE_FILE = '*** Update File:';
const MOVE_TO = '*** Move to:';
const END_OF_FILE = '*** End of File';

/** A refusal carrying the sentence the caller turns into its own fail-closed line. */
class PatchRefused extends Error {}

/**
 * One file's section of the patch, as the header names it and the lines that follow.
 *
 * A header is recognised at the head of the raw line only. A change line spells its operator
 * as its first character, so both matching marker text anywhere on a line and matching it on
 * a trimmed one read a file's own text — `+*** Delete File: x`, or ` *** Delete File: x` as
 * context — as a deletion of a file the patch never touches.
 */
type Hunk = { marker: string; path: string; body: string[] };

/** Split the patch text into its hunks, refusing anything the grammar does not admit. */
function splitHunks(patch: string): Hunk[] {
  // The whole text is trimmed once, never line by line — the reference parser spells this
  // as `patch.trim().lines()`. A change line's first character is its operator, so trimming
  // each line would read ` *** Delete File: x`, a context line carrying that text, as a
  // deletion of a file the patch never touches.
  const lines = patch.trim().split('\n');
  // A CRLF patch leaves the carriage return on every line and it belongs to none of them:
  // the grammar ends a line at the LF, so a body line keeping it would never match the
  // pre-state read from disk and every update would be refused.
  const stripped = lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

  if (stripped[0] !== BEGIN_PATCH) {
    throw new PatchRefused(`the patch does not start with '${BEGIN_PATCH}'`);
  }
  if (stripped.at(-1) !== END_PATCH) {
    throw new PatchRefused(`the patch does not end with '${END_PATCH}'`);
  }

  const hunks: Hunk[] = [];
  let index = 1;
  if (stripped[index]?.startsWith(ENVIRONMENT_ID)) index += 1;

  for (; index < stripped.length - 1; index += 1) {
    const line = stripped[index] as string;
    const marker = [ADD_FILE, DELETE_FILE, UPDATE_FILE].find((candidate) =>
      line.startsWith(candidate),
    );
    if (marker === undefined) {
      if (hunks.length === 0) {
        throw new PatchRefused(`'${line.trim()}' appears before any hunk header`);
      }
      (hunks.at(-1) as Hunk).body.push(line);
      continue;
    }
    const path = line.slice(marker.length).trim();
    if (path === '') {
      throw new PatchRefused(`'${marker}' names no path`);
    }
    hunks.push({ marker, path, body: [] });
  }

  if (hunks.length === 0) {
    throw new PatchRefused('the patch names no file to change');
  }
  return hunks;
}

/** Read a pre-state the change cannot be proven without, refusing its absence. */
function requirePreState(path: string, readPreState: PreStateReader): string {
  const pre = readPreState(path);
  if (pre === null) {
    throw new PatchRefused(`the patch targets '${path}', which does not exist`);
  }
  return pre;
}

/** The text an `Add File` body spells, refusing a line the grammar requires a `+` on. */
function addedText(body: string[], path: string): string {
  for (const line of body) {
    if (!line.startsWith('+')) {
      throw new PatchRefused(`'${path}' has a body line without the '+' prefix`);
    }
  }
  return body.map((line) => `${line.slice(1)}\n`).join('');
}

/**
 * Apply one `Update File` body to its pre-state.
 *
 * Each `@@` opens a block whose ` ` and `-` lines are the text as it stands and whose ` `
 * and `+` lines are the text after. A block whose old lines do not occur is a patch the
 * tool itself refuses; splicing the `+` lines in anyway would prove a mutation that never
 * happens. Blocks are matched in order from where the previous one landed, so a later block
 * reads the earlier one's result rather than the original.
 */
function applyUpdate(pre: string, body: string[], path: string): string {
  const lines = pre.split('\n');
  const trailingNewline = lines.at(-1) === '';
  if (trailingNewline) lines.pop();

  let cursor = 0;
  let index = 0;
  while (index < body.length) {
    const line = body[index] as string;
    // `@@` opens a block, and the first one may be left out — the grammar makes the context
    // marker optional, so a body can begin with its change lines. Skipping such a body
    // instead would answer a post identical to the pre: the path would still be judged, and
    // every discipline reading the content would see an edit that is not there.
    if (line.startsWith('@@')) index += 1;
    else if (index > 0) {
      throw new PatchRefused(`a hunk of '${path}' carries '${line.trim()}' outside any block`);
    }

    const oldLines: string[] = [];
    const newLines: string[] = [];
    while (index < body.length) {
      const change = body[index] as string;
      // Both markers are read at the line head only: a context line begins with a space, so
      // trimming first would read ` @@ x` as a new block rather than as the text it is.
      if (change.startsWith('@@') || change.startsWith(END_OF_FILE)) break;
      index += 1;
      const text = change.slice(1);
      if (change.startsWith('-')) oldLines.push(text);
      else if (change.startsWith('+')) newLines.push(text);
      else {
        oldLines.push(text);
        newLines.push(text);
      }
    }

    const at = indexOfBlock(lines, oldLines, cursor);
    if (at === -1) {
      throw new PatchRefused(`a hunk of '${path}' does not match the file it updates`);
    }
    lines.splice(at, oldLines.length, ...newLines);
    cursor = at + newLines.length;
  }

  return lines.join('\n') + (trailingNewline ? '\n' : '');
}

/** Where `block` occurs in `lines` at or after `from`, or -1. An empty block sits at `from`. */
function indexOfBlock(lines: string[], block: string[], from: number): number {
  if (block.length === 0) return from;
  for (let start = from; start + block.length <= lines.length; start += 1) {
    if (block.every((line, offset) => lines[start + offset] === line)) return start;
  }
  return -1;
}

/** The changes one hunk proves — a `Move to` naming two paths proves two of them. */
function changesOfHunk(hunk: Hunk, readPreState: PreStateReader): FileChange[] {
  if (hunk.marker === ADD_FILE) {
    return [{ kind: 'create', path: hunk.path, post: addedText(hunk.body, hunk.path) }];
  }
  if (hunk.marker === DELETE_FILE) {
    return [{ kind: 'delete', path: hunk.path, pre: requirePreState(hunk.path, readPreState) }];
  }

  // The rename directive stands on the line right after the header and nowhere else, so
  // only that line is read for it. Searching the whole body would take a context line whose
  // own text spells the marker as a rename the tool never performs.
  const first = hunk.body[0];
  const moveLine = first?.startsWith(MOVE_TO) === true ? first : undefined;
  const body = moveLine === undefined ? hunk.body : hunk.body.slice(1);
  const pre = requirePreState(hunk.path, readPreState);
  const post = applyUpdate(pre, body, hunk.path);

  if (moveLine === undefined) {
    return [{ kind: 'modify', path: hunk.path, pre, post }];
  }
  const destination = moveLine.slice(MOVE_TO.length).trim();
  if (destination === '') {
    throw new PatchRefused(`'${MOVE_TO}' names no path`);
  }
  // Two elements, because a rename touches two paths: judged on one of them alone, a file
  // carried out of a protected directory, or into one, passes unseen.
  return [
    { kind: 'delete', path: hunk.path, pre },
    { kind: 'create', path: destination, post },
  ];
}

/**
 * Parse one `apply_patch` command text into the file changes it proves.
 *
 * A reader's throw travels out unchanged: absence and a refused read are different facts,
 * and only the caller can turn the second into its own fail-closed line.
 */
export function parseApplyPatch(
  command: string,
  readPreState: PreStateReader,
): ParseApplyPatchOutcome {
  try {
    const hunks = splitHunks(command);
    return { ok: true, value: hunks.flatMap((hunk) => changesOfHunk(hunk, readPreState)) };
  } catch (error) {
    if (error instanceof PatchRefused) return { ok: false, reason: error.message };
    throw error;
  }
}
