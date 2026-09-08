/**
 * Locating the `polydeukes` install a session surface runs through.
 *
 * Both users of this module ask the same question from the same anchor — the project root,
 * never this module's own location. Anchoring at the installer or the hook would answer for
 * the graph THIS package was installed into, which is a different tree from the one being
 * judged or wired.
 */

import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { join } from 'node:path';
import { isPlainObject } from '@polydeukes/core';

/** The umbrella package both the spawn and the preflight look for. */
export const UMBRELLA_PACKAGE = 'polydeukes';

/**
 * The absolute path of the umbrella's `pdks` bin as reachable from `projectRoot`, or
 * `undefined` when there is nothing to spawn.
 *
 * ESM resolution specifically, because that is what a generated delegator's `await
 * import(...)` runs; the CJS alternatives were measured disagreeing with it in both
 * directions. `findPackageJSON` is experimental in Node 24, so its behaviour can still
 * change.
 *
 * A manifest found but carrying no `bin.pdks` answers `undefined` too: spawning `node
 * undefined` crashes with no verdict and no row, which reads to the caller as the same
 * absence reached without saying so.
 */
export function findUmbrellaBin(projectRoot: string): string | undefined {
  let manifestPath: string | undefined;
  try {
    // Absence throws here rather than returning undefined (Node 24.18); the branch below
    // covers the documented `string | undefined` return.
    manifestPath = findPackageJSON(UMBRELLA_PACKAGE, join(projectRoot, 'package.json'));
  } catch {
    return undefined;
  }
  if (manifestPath === undefined) return undefined;

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return undefined;
  }
  const bin = isPlainObject(manifest) ? manifest.bin : undefined;
  const pdks = isPlainObject(bin) ? bin.pdks : undefined;
  if (typeof pdks !== 'string') return undefined;

  return join(manifestPath, '..', pdks);
}
