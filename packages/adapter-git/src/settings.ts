/**
 * `resolveGitAdapterSettings` — the adapter-git namespace validator (CONFIG-06 §4.2).
 *
 * The first tenant of the CONFIG-07 adapter namespace container: the core validated the
 * container shape only, so this pure function owns the `adapters.git` vocabulary.
 * Absence fills the strictest level (`block` — no silent relaxation); unknown keys and
 * values fail-fast with the full field path in the message.
 */

import { isPlainObject } from '@polydeukes/core';

/** The resolved adapter-git settings — currently the enforcement level only. */
export type GitAdapterSettings = { enforce: 'block' | 'advise' };

/**
 * Resolve the `adapters.git` namespace value into {@link GitAdapterSettings} (pure).
 *
 * `undefined` (absent namespace or absent adapters map) and an empty object both fill
 * `{ enforce: 'block' }`. A valid `enforce` passes through verbatim. Anything else —
 * a non-object namespace, an unknown key, or an enforce outside {block, advise}
 * (including the reserved `measure`) — throws with the field path named.
 */
export function resolveGitAdapterSettings(namespace: unknown): GitAdapterSettings {
  if (namespace === undefined) {
    return { enforce: 'block' };
  }
  if (!isPlainObject(namespace)) {
    throw new Error('adapters.git must be an object');
  }
  for (const key of Object.keys(namespace)) {
    if (key !== 'enforce') {
      throw new Error(`adapters.git has unknown key '${key}'`);
    }
  }
  const enforce = namespace.enforce;
  if (enforce === undefined) {
    return { enforce: 'block' };
  }
  if (enforce !== 'block' && enforce !== 'advise') {
    throw new Error("adapters.git.enforce must be 'block' or 'advise'");
  }
  return { enforce };
}
