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

/**
 * True iff `candidate` names the protected path, a descendant of it, or a (relative) ancestor
 * of it — compared on normalized path segments (not raw substrings, PRD §4.1). The two
 * directions are deliberately asymmetric:
 *  - descendant / equal: the protected segments appear as a contiguous run at ANY offset in
 *    the candidate, so an ABSOLUTE `file_path` (`/home/u/proj/core/src/x` — the real Edit
 *    payload shape) matches the relative protected `core/src`;
 *  - ancestor: the WHOLE candidate is a root-anchored prefix of the protected path, so the
 *    relative parent op `rm -rf packages/core` matches but an unrelated `vendor/packages`
 *    whose tail merely coincides with the protected head does NOT.
 * The asymmetry is load-bearing: allowing any candidate *suffix* to head the protected path
 * would block legitimate unrelated dirs (`x/packages/core`). The cost is that an ABSOLUTE
 * ancestor path (`rm -rf /abs/.../packages/core`) is not caught — an accepted non-goal
 * (complete Bash lockdown was never the goal; the relative form is still caught, and the
 * over-block alternative is worse). The segment boundary is exact, so `core/src-generated`
 * never matches `core/src`.
 */
export function pathMatchesProtected(candidate: string, protectedPath: string): boolean {
  const a = pathSegments(candidate);
  const b = pathSegments(protectedPath);
  if (a.length === 0 || b.length === 0) return false;
  if (containsSegmentRun(a, b)) return true;
  // Ancestor: the candidate is a proper root-anchored prefix of the protected path.
  return a.length < b.length && a.every((segment, i) => segment === b[i]);
}

/**
 * Extract path candidates from one string token. The token is split on shell separators
 * that join a path to other lexemes — whitespace, `=`, `,`, parentheses, backtick — so a path
 * embedded in a compound token (a `--flag=path`, an opaque command substitution, an eval's
 * quoted argument) surfaces as its own candidate while a standalone token stays intact (so the
 * segment-boundary trap still rejects a sibling like `core/src-generated`). `/` is never a
 * separator (it is the path's own segment boundary); `:` is deliberately NOT a separator
 * either — splitting on it shatters URLs (`https://…`) into fragments that the offset-free
 * descendant match then over-blocks, and a colon-joined path list is already reached by the
 * contiguous-run match without the split.
 */
export function pathCandidates(token: string): string[] {
  return token.split(/[\s=,()`]+/).filter((fragment) => fragment !== '');
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
