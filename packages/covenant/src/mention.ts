/**
 * `mentionsPath` — the single path-mention semantic shared by the dispatcher and the
 * pure judges (PRD §7).
 *
 * Both the path-routing dispatcher (`matchRegistrations`) and any covenant judge
 * that keys on a protected path import this one function, so the two layers can never
 * drift apart. Argument names are never inspected — only string *values* are scanned,
 * at any depth, keeping the traversal agent-neutral.
 */

/** Normalize a path into segments: strip leading `./`, trailing `/`, split on `/`, drop empties. */
function pathSegments(path: string): string[] {
  return path
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((segment) => segment !== '');
}

/**
 * True iff `candidate` equals `protectedPath`, is a descendant of it, or is an ancestor of
 * it — compared on normalized path segments (not raw substrings). One segment array must be
 * a prefix of the other, so `core/src-generated` does not match `core/src` (segment-boundary
 * safe), while `core` (ancestor) and `core/src/x` (descendant) both do (PRD §4.1).
 */
export function pathMatchesProtected(candidate: string, protectedPath: string): boolean {
  const a = pathSegments(candidate);
  const b = pathSegments(protectedPath);
  if (a.length === 0 || b.length === 0) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.every((segment, i) => segment === longer[i]);
}

/**
 * Extract path candidates from one string token. The token is split on shell separators
 * (whitespace, `=`, parentheses, backtick) so a path embedded in a compound token — an
 * opaque command substitution, a `--flag=path`, an eval's quoted argument — surfaces as its
 * own candidate while a standalone token stays intact (so the segment-boundary trap still
 * rejects a sibling like `core/src-generated`).
 */
function pathCandidates(token: string): string[] {
  return token.split(/[\s=()`]+/).filter((fragment) => fragment !== '');
}

/**
 * Recursively test whether any string value inside `value` matches `path` by path-segment
 * containment (ancestor / descendant / equal). Each string is split into path candidates,
 * each tested via {@link pathMatchesProtected}. Only string values are scanned; keys,
 * numbers, and other primitives never match.
 */
export function mentionsPath(value: unknown, path: string): boolean {
  if (typeof value === 'string') {
    return pathCandidates(value).some((candidate) => pathMatchesProtected(candidate, path));
  }
  if (Array.isArray(value)) {
    return value.some((item) => mentionsPath(item, path));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => mentionsPath(item, path));
  }
  return false;
}
