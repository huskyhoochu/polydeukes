/**
 * `mentionsPath` — the single path-mention semantic shared by the dispatcher and the
 * pure judges (PRD §7).
 *
 * Both the path-routing dispatcher (`matchRegistrations`) and any covenant judge
 * that keys on a protected path import this one function, so the two layers can never
 * drift apart. Argument names are never inspected — only string *values* are scanned,
 * at any depth, keeping the traversal agent-neutral.
 */

/**
 * Recursively test whether any string value inside `value` contains `path` as a
 * substring. Only string values are scanned; keys, numbers, and other primitives never
 * match.
 */
export function mentionsPath(value: unknown, path: string): boolean {
  if (typeof value === 'string') {
    return value.includes(path);
  }
  if (Array.isArray(value)) {
    return value.some((item) => mentionsPath(item, path));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => mentionsPath(item, path));
  }
  return false;
}
