/**
 * `isPlainObject` — the workspace's single canonical plain-object predicate.
 *
 * typeof `object`, non-null, not an array.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
