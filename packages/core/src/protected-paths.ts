/**
 * Protected-path normalization — the union of `protectedPaths` and registered adapter
 * directories, normalized into the literal path strings the dispatcher contract expects
 * (CONFIG-02).
 *
 * Registering an adapter directory auto-includes it in the protection surface, so the
 * "adapter left out of the surface" hole is structurally unreproducible. Pure string
 * transformation — zero file I/O, no glob expansion, no path resolution (PRD §4.2).
 */

/**
 * Normalize the protection surface from a config-shaped spec (PRD §4.2).
 *
 * Processing order: union (`protectedPaths` first, `adapters` second) → trim each entry →
 * strip a leading `./` → strip a trailing `/` → drop empty-equivalent entries → dedupe on
 * the normalized value, keeping the first occurrence. A `ResolvedConfig` can be passed
 * directly. Both fields absent or empty yields `[]` — its meaning is the dispatcher's call.
 */
export function normalizeProtectedPaths(spec: {
  protectedPaths?: string[];
  adapters?: string[];
}): string[] {
  const union = [...(spec.protectedPaths ?? []), ...(spec.adapters ?? [])];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of union) {
    let path = entry.trim();
    if (path.startsWith('./')) {
      path = path.slice(2);
    }
    if (path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    if (path.length === 0 || seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
  }

  return result;
}
