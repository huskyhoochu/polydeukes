/**
 * The supply layer — what a judgment's world is made of before any judgment runs.
 *
 * Two verbs: `planSources` folds the registrations' `sources` bindings into a path list and
 * a channel-kind list, and `supplySources` fills each through its own injected reader. The
 * reading itself belongs to the composition root, which is the only place that knows how its
 * surface observes the tree; this module opens no file and spawns no process.
 */

import type { ChannelReader, SourceReader } from '@polydeukes/core';
import type { CovenantRegistration } from './dispatch.js';

/** `planSources` input — the registration table the judgment will run. */
export type PlanSourcesSpec = { registrations: readonly CovenantRegistration[] };

/**
 * What the registrations named, in registration then declaration order, deduplicated per
 * axis: `files` are repo-relative paths, `channels` the channel KINDS the bindings name —
 * two bindings on one kind are one reading, and which name each carries is the merge's own.
 */
export type SourcePlan = { files: readonly string[]; channels: readonly string[] };

/**
 * `supplySources` input — a plan and the surface's readers.
 *
 * Both readers answer `undefined` for something that is not there and throw for every other
 * failure, so a permission error reaches the root's fail-closed path instead of passing
 * for an absence the declaration's `supply` policy would wave through. An ABSENT
 * `readChannel` is the commit surface, which has no session: every channel is absent.
 */
export type SupplySourcesSpec = {
  plan: SourcePlan;
  read: SourceReader;
  readChannel?: ChannelReader;
};

/**
 * What the readers gave back, keyed by the planned path and the planned kind. Anything a
 * reader could not answer has no key at all — a key holding `undefined` would pass the
 * engine's presence test as a supply that never happened.
 */
export type SuppliedSources = {
  files: Record<string, string>;
  channels: Record<string, string>;
};

/**
 * The paths and channel kinds the registrations name, first occurrence winning.
 *
 * Order is the plan's contract: the supplied result and the witnesses built on it keep it,
 * which is what lets two surfaces reach the same first witness.
 */
export function planSources(spec: PlanSourcesSpec): SourcePlan {
  const files: string[] = [];
  const channels: string[] = [];
  for (const registration of spec.registrations) {
    for (const binding of registration.sources ?? []) {
      // A transcript is neither a path nor a channel kind: the surface hands the session
      // to assembly directly, so there is nothing here for a reader to fetch.
      if ('transcript' in binding) continue;
      if ('sidecar' in binding) {
        if (!channels.includes('sidecar')) channels.push('sidecar');
      } else if (!files.includes(binding.file)) {
        files.push(binding.file);
      }
    }
  }
  return { files, channels };
}

/** Read each planned path and kind once, in plan order, keeping only what came back. */
export function supplySources(spec: SupplySourcesSpec): SuppliedSources {
  const files: Record<string, string> = {};
  for (const path of spec.plan.files) {
    const text = spec.read(path);
    if (text !== undefined) files[path] = text;
  }
  const channels: Record<string, string> = {};
  for (const kind of spec.plan.channels) {
    const text = spec.readChannel?.(kind);
    if (text !== undefined) channels[kind] = text;
  }
  return { files, channels };
}
