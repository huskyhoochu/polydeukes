/**
 * Locating the `polydeukes` install this SDK spawns the judge from.
 *
 * The anchor is the project root the caller named, never this module's own location:
 * anchoring here would answer for the graph THIS package was installed into, which is a
 * different tree from the one being judged.
 */

import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { join } from 'node:path';
import { isPlainObject } from '@polydeukes/core';

/** The umbrella package the spawn looks for. */
export const UMBRELLA_PACKAGE = 'polydeukes';

/**
 * The absolute path of the umbrella's `pdks` bin as reachable from `projectRoot`, or
 * `undefined` when there is nothing to spawn.
 *
 * `findPackageJSON` is experimental in Node 24, so its behaviour can still change.
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
