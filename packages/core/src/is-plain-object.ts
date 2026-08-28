/**
 * `isPlainObject` — the workspace's single canonical plain-object predicate.
 *
 * typeof `object`, non-null, not an array.
 *
 * Its own file because it is a public export the adapters and the umbrella import; the
 * core-internal validation helpers live in `validation.ts` instead.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
