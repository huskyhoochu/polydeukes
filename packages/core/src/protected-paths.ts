/**
 * Protected-path normalization — the `protectedPaths` list normalized into the literal
 * path strings the dispatcher contract expects (CONFIG-02). Pure string transformation —
 * zero file I/O, no glob expansion, no path resolution (PRD §4.2).
 */

/**
 * Normalize the protection surface from a config-shaped spec (PRD §4.2).
 *
 * Processing order: trim each entry → strip a leading `./` → strip a trailing `/` → drop
 * empty-equivalent entries → dedupe on the normalized value, keeping the first occurrence.
 * A `ResolvedConfig` can be passed directly. An absent or empty `protectedPaths` yields
 * `[]` — its meaning is the dispatcher's call.
 */
export function normalizeProtectedPaths(spec: { protectedPaths?: string[] }): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of spec.protectedPaths ?? []) {
    let path = entry.trim();
    // Strip to a fixpoint: a single pass would leave residues on repeated prefixes or
    // suffixes ('././x', 'x//'), and a residual './' or '/' silently matches nothing
    // downstream — the fail-open narrowing the contract forbids. Interior segments and
    // absolute paths are path *resolution*, deliberately out of scope.
    while (path.startsWith('./')) {
      path = path.slice(2);
    }
    while (path.endsWith('/')) {
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
