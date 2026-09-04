/**
 * `resolveGitAdapterSettings` — the adapter-git namespace validator.
 *
 * The core validates the adapter namespace container's shape only, so this pure
 * function owns the `adapters.git` vocabulary.
 * Absence fills the strictest level (`block` — no silent relaxation); unknown keys and
 * values fail-fast with the full field path in the message.
 */

import { isPlainObject } from '@polydeukes/core';

/**
 * The resolved adapter-git settings — the enforcement level and the commit surface's
 * additive protection scope.
 */
export type GitAdapterSettings = { enforce: 'block' | 'advise'; protectedPaths: string[] };

/** True when the value is an array whose every element is a string. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** {@link resolveGitAdapterSettings} input — the raw `adapters.git` namespace value. */
export type ResolveGitAdapterSettingsSpec = { namespace: unknown };

/**
 * Resolve the `adapters.git` namespace value into {@link GitAdapterSettings} (pure).
 *
 * `undefined` (absent namespace or absent adapters map) and an empty object both fill
 * `{ enforce: 'block', protectedPaths: [] }`. A valid `enforce` and a valid
 * `protectedPaths` list both pass through verbatim — normalization (trim, `./` strip,
 * dedupe) belongs to the consumer, so this validator only judges shape. Anything else —
 * a non-object namespace, an unknown key, an enforce outside {block, advise} (including
 * the reserved `measure`), or a protectedPaths that is not an array of strings — throws
 * with the field path named.
 */
export function resolveGitAdapterSettings(spec: ResolveGitAdapterSettingsSpec): GitAdapterSettings {
  const { namespace } = spec;
  if (namespace === undefined) {
    return { enforce: 'block', protectedPaths: [] };
  }
  if (!isPlainObject(namespace)) {
    throw new Error('adapters.git must be an object');
  }
  for (const key of Object.keys(namespace)) {
    if (key !== 'enforce' && key !== 'protectedPaths') {
      throw new Error(`adapters.git has unknown key '${key}'`);
    }
  }
  const enforce = namespace.enforce === undefined ? 'block' : namespace.enforce;
  if (enforce !== 'block' && enforce !== 'advise') {
    throw new Error("adapters.git.enforce must be 'block' or 'advise'");
  }
  const protectedPaths = namespace.protectedPaths === undefined ? [] : namespace.protectedPaths;
  if (!isStringArray(protectedPaths)) {
    throw new Error('adapters.git.protectedPaths must be an array of strings');
  }
  return { enforce, protectedPaths };
}
