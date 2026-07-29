/**
 * `mentionsPath` — the single path-mention semantic shared by the dispatcher and the
 * pure judges (PRD §7).
 *
 * Both the path-routing dispatcher (`matchRegistrations`) and any covenant judge
 * that keys on a protected path import this one function, so the two layers can never
 * drift apart. Argument names are never inspected — only string *values* are scanned,
 * at any depth, keeping the traversal agent-neutral.
 *
 * COVENANT-07b adds interior `.`/`..` as a SECOND comparison rather than a replacement.
 * The raw segments are matched first, exactly as they always were, and the dot-resolved
 * segments only if that fails. The union is the point: every path this predicate matched
 * before still matches, so closing a notation can never cost a defence — the failure mode
 * that a replacement pass produced twice before this shape was found.
 *
 * What it deliberately does NOT read is a glob, a variable expansion, or a tilde. None can
 * be resolved without running the shell or touching the filesystem, and a judge that guesses
 * at them either misses the real target or blocks an innocent one — both measured. They stay
 * undecidable here and are answered where undecidability belongs (the Bash axis's opaque-token
 * rule, and COVENANT-10b's skip registrations). A spelling that some layer genuinely *can*
 * resolve — the home directory in front of the session transcript — is closed by the layer
 * that knows the value: assembly registers a dedicated `matches` predicate for the transcript
 * (COVENANT-07c) rather than a protected path, so no home spelling is inferred in here.
 */

/**
 * Normalize a path into segments: strip leading `./`, trailing `/`, split on `/`, drop
 * empties. Exported so the self-mod judge can tell a judgeable evidence path from a
 * degenerate one (`''`, `'.'`, `'/'` — zero segments) that proves nothing (COVENANT-09).
 *
 * A lone `.` survives as a segment. Resolving interior dots is a separate pass inside
 * {@link pathMatchesProtected}, kept out of this function on purpose so that its contract —
 * and self-mod's degenerate-evidence check built on top of it — stays exactly what it was.
 */
export function pathSegments(path: string): string[] {
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
 * One comparison, shared by both passes. The two directions are deliberately asymmetric:
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
function segmentsMatch(a: string[], b: string[]): boolean {
  if (a.length === 0) return false;
  if (containsSegmentRun(a, b)) return true;
  // Ancestor: the candidate is a proper root-anchored prefix of the protected path.
  return a.length < b.length && a.every((segment, i) => segment === b[i]);
}

/**
 * Resolve `.` and `..` against the preceding segment — pure string work, no filesystem and
 * no working directory, so the answer is the same wherever the judge runs.
 *
 * A `..` with nothing left to cancel is KEPT rather than dropped. Dropping it would collapse
 * `../packages` into `packages` and hand a sibling checkout the protection meant for this
 * one; keeping it leaves a segment that matches nothing, which is the honest answer for a
 * path that points outside the tree.
 *
 * Exported so a judge whose own equality needs the same second pass (the transcript
 * predicate, COVENANT-07c) shares this one implementation instead of forking it per site.
 */
export function resolveDotSegments(segments: string[]): string[] {
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..' && resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved;
}

/**
 * True iff `candidate` names the protected path, a descendant of it, or a (relative) ancestor
 * of it — compared on path segments (not raw substrings, PRD §4.1), by {@link segmentsMatch}.
 *
 * Two passes, unioned. The raw pass is the shipped semantic and runs first: a command that
 * spells the protected path out loud is caught by it no matter what the path resolves to
 * afterwards, which is why `rm -rf .claude/hooks/../..` breaks here rather than needing a
 * rule of its own. The dot-resolved pass runs only when the raw one finds nothing, and is
 * what `packages/core/./dist/index.js` and `packages/core/src/../dist/index.js` need. Because
 * it is a union it can only ever add matches, never withdraw one.
 */
export function pathMatchesProtected(candidate: string, protectedPath: string): boolean {
  const a = pathSegments(candidate);
  const b = pathSegments(protectedPath);
  if (b.length === 0) return false;
  if (segmentsMatch(a, b)) return true;
  return segmentsMatch(resolveDotSegments(a), b);
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
 * Extract path candidates from a whole command line the tokenizer REFUSED — the fallback-only
 * counterpart of {@link pathCandidates} (COVENANT-07d §2-c).
 *
 * The input precondition is the opposite one. `pathCandidates` receives a word `tokenizeCommandLine`
 * already cut at every shell operator, so its separator set never needed them; the two
 * untokenizable-fallback branches (shell-mod's and transcript-mod's) have no tokenizer left and
 * hand over the raw dequoted line, where nothing consumed those operators and a path glued to one
 * (`packages/core/dist;echo x`) stayed a single unmatchable segment. So the set here is wider by
 * exactly what the tokenizer would have eaten — `;` `&` `|` `<` `>` — and a tokenized input never
 * reaches this function.
 *
 * The line itself stays a candidate alongside the fragments: the union is what keeps a protected
 * path whose own segment carries an operator (`pkg/a&b/dist`) matchable, and an added form can
 * only add a match, never withdraw one (COVENANT-07b's shape). `:` stays out for the reason
 * {@link pathCandidates} records — shattering URLs over-blocks — so a colon-joined list is one
 * candidate here too.
 */
export function untokenizableLineCandidates(line: string): string[] {
  return [line, ...line.split(/[;&|<>]+/).filter((fragment) => fragment !== '')];
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
