/**
 * The covenant package as a resolved artifact — the existence proof both composition roots
 * share.
 *
 * What the roots prove is the package IMPORT itself. The barrel is eager: a dist missing one
 * of the modules it references throws on import, before any assembly can compose a
 * registration, and the surface's own fail-closed catch records that as one `blocked` row. A
 * partially loaded judge set has no representation here — an ESM import either fully succeeds
 * or throws.
 *
 * The `covenantDist` seam selects WHICH dist is imported, so a fixture can inject a gutted
 * mirror where real Node resolution would always land on the healthy build.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as covenant from '@polydeukes/covenant';

/** The covenant surface both roots assemble against — the members they call, and no more. */
export type CovenantModule = Pick<
  typeof covenant,
  | 'dispatchCovenants'
  | 'compileDisciplineRegistrations'
  | 'selfModRegistration'
  | 'shellModRegistration'
  | 'transcriptModRegistration'
>;

/** Where real Node resolution puts the covenant package's built barrel. */
export function resolveCovenantDist(): string {
  return join(createRequire(import.meta.url).resolve('@polydeukes/covenant'), '..');
}

/**
 * Import the covenant barrel from `distDir`, naming the recovery command when it will not
 * load. The message carries the loader's own text, which names the module that is missing;
 * a reader locked out by an unbuilt or half-built dist needs both that name and the one
 * command that fixes it.
 */
export async function loadCovenantModule(distDir: string): Promise<CovenantModule> {
  try {
    return (await import(pathToFileURL(join(distDir, 'index.js')).href)) as CovenantModule;
  } catch (error) {
    throw new Error(
      `the covenant judges could not be loaded from ${distDir} — run 'pnpm build' to rebuild them: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
