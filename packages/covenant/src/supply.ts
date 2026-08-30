/**
 * The supply layer — what a judgment's world is made of before any judgment runs.
 *
 * Two verbs: `planSources` folds the registrations' `sources` bindings into one path list,
 * and `supplySources` fills it through an injected `read`. The reading itself belongs to
 * the composition root, which is the only place that knows how its surface observes the
 * tree; this module opens no file and spawns no process.
 */

import type { CovenantRegistration } from './dispatch.js';

/** `planSources` input — the registration table the judgment will run. */
export type PlanSourcesSpec = { registrations: readonly CovenantRegistration[] };

/** Which files the registrations named, in registration then declaration order, deduplicated. */
export type SourcePlan = { files: readonly string[] };

/**
 * `supplySources` input — a plan and the surface's reader.
 *
 * `read` answers `undefined` for a file that is not there and throws for every other
 * failure, so a permission error reaches the root's fail-closed path instead of passing
 * for an absence the declaration's `supply` policy would wave through.
 */
export type SupplySourcesSpec = {
  plan: SourcePlan;
  read: (path: string) => string | undefined;
};

/** What the reader gave back, keyed by the planned path. A path it could not read has no key. */
export type SuppliedSources = { files: Record<string, string> };

/**
 * The file paths the registrations name, first occurrence winning.
 *
 * Order is the plan's contract: the supplied result and the witnesses built on it keep it,
 * which is what lets two surfaces reach the same first witness.
 */
export function planSources(spec: PlanSourcesSpec): SourcePlan {
  const files: string[] = [];
  for (const registration of spec.registrations) {
    for (const binding of registration.sources ?? []) {
      if (!files.includes(binding.file)) files.push(binding.file);
    }
  }
  return { files };
}

/** Read each planned path once, in plan order, keeping only what came back. */
export function supplySources(spec: SupplySourcesSpec): SuppliedSources {
  const files: Record<string, string> = {};
  for (const path of spec.plan.files) {
    const text = spec.read(path);
    if (text !== undefined) files[path] = text;
  }
  return { files };
}
