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

/** True iff `needle` occurs as a contiguous segment run inside `haystack` (any offset). */
function containsSegmentRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((segment, i) => segment === haystack[start + i])) return true;
  }
  return false;
}

/** True iff some non-empty suffix of `candidate` is a prefix of `protectedPath`. */
function candidateTailIsProtectedHead(candidate: string[], protectedPath: string[]): boolean {
  for (let start = 0; start < candidate.length; start++) {
    const tail = candidate.slice(start);
    if (tail.length > protectedPath.length) continue;
    if (tail.every((segment, i) => segment === protectedPath[i])) return true;
  }
  return false;
}

/**
 * True iff `candidate` names the protected path, a descendant of it, or an ancestor of it —
 * compared on normalized path segments (not raw substrings, PRD §4.1). Matching is
 * offset-independent, so a candidate carrying leading path noise (an ABSOLUTE path, a `../`
 * chain) still matches a relative protected path:
 *  - descendant / equal: the protected segments appear as a contiguous run inside the
 *    candidate — `/home/u/proj/core/src/x` ⊇ `core/src`;
 *  - ancestor: some suffix of the candidate is a prefix of the protected path — the parent
 *    op `rm -rf /home/u/proj/packages/core` (tail `packages/core` heads `packages/core/src`).
 * The segment boundary is exact, so `core/src-generated` never matches `core/src`.
 */
export function pathMatchesProtected(candidate: string, protectedPath: string): boolean {
  const a = pathSegments(candidate);
  const b = pathSegments(protectedPath);
  if (a.length === 0 || b.length === 0) return false;
  return containsSegmentRun(a, b) || candidateTailIsProtectedHead(a, b);
}

/**
 * Extract path candidates from one string token. The token is split on shell separators
 * that join a path to other lexemes — whitespace, `=`, `:`, `,`, parentheses, backtick — so a
 * path embedded in a compound token (a `--flag=path`, a `PATH=/a:proto/x` list, an opaque
 * command substitution, an eval's quoted argument) surfaces as its own candidate while a
 * standalone token stays intact (so the segment-boundary trap still rejects a sibling like
 * `core/src-generated`). `/` is never a separator — it is the path's own segment boundary.
 */
export function pathCandidates(token: string): string[] {
  return token.split(/[\s=:,()`]+/).filter((fragment) => fragment !== '');
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
