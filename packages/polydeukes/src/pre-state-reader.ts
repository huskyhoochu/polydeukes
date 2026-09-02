/**
 * The pre-state readers the two surfaces inject into the discipline compiler — the disk
 * access that the judge package must not carry.
 */

import { readFileSync } from 'node:fs';

/**
 * The session surface's reader: the hook runs before the tool does, so the working tree at
 * an absolute location IS the pre-state.
 *
 * Three answers, three consequences. Text is a modify; `null` — the file is not there — is a
 * create, so nothing is forgiven as pre-existing debt; `undefined` is a location that cannot
 * be read at all, which the judge escalates to the fail-closed exit. A permission error or a
 * race collapsed into either of the first two would record the run as `passed`.
 */
export function sessionPreStateReader(location: string): string | null | undefined {
  try {
    return readFileSync(location, 'utf-8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
  }
}

/**
 * The commit surface's reader: it observes a staged diff, whose payloads already carry the
 * pre their own observation saw, and it registers no shell axis — so no derivation ever asks
 * for a pre-state here. Should one arrive, the working tree is not what this surface judges,
 * and answering from it would compare the diff against the wrong baseline; `undefined` says
 * so and fails that call closed.
 */
export function unobservedPreStateReader(): undefined {
  return undefined;
}
