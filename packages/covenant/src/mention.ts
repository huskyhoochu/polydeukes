/**
 * `mentionsPath` — the single path-mention semantic shared by the dispatcher and the
 * pure judges.
 *
 * Both the path-routing dispatcher (`matchRegistrations`) and any covenant judge that keys
 * on a protected path import this one function, so the two layers can never drift apart.
 * Argument names are never inspected — only string *values* are scanned, at any depth,
 * keeping the traversal agent-neutral.
 *
 * Interior `.`/`..` resolution is a SECOND comparison, never a replacement: raw segments
 * match first, dot-resolved segments only if that fails. Because the result is a union, a
 * newly closed notation can only ever add matches — a replacement pass would silently
 * withdraw defences that the raw comparison already had.
 *
 * A glob, a variable expansion, and a tilde are deliberately NOT read. None can be resolved
 * without running the shell or touching the filesystem, and a judge that guesses at them
 * either misses the real target or blocks an innocent one. They stay undecidable here and
 * are answered where undecidability belongs: the Bash axis's opaque-token rule and the skip
 * registrations. A spelling some layer genuinely *can* resolve — the home directory in front
 * of the session transcript — is closed by the layer that knows the value, via a dedicated
 * `matches` predicate rather than a protected path, so no home spelling is inferred here.
 */

/**
 * Normalize a path into segments: strip leading `./`, trailing `/`, split on `/`, drop
 * empties. Exported so the self-mod judge can tell a judgeable evidence path from a
 * degenerate one (`''`, `'.'`, `'/'` — zero segments) that proves nothing.
 *
 * A lone `.` survives as a segment, and resolving interior dots is a separate pass inside
 * {@link pathMatchesProtected}. Folding that pass in here would change what the
 * degenerate-evidence check built on top of this function counts as degenerate.
 */
export function pathSegments(path: string): string[] {
  return path
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((segment) => segment !== '');
}

/**
 * Return the mutation target proven by a call's `fileChange` evidence, or `null` when the
 * evidence proves none.
 *
 * @param call - The tool call whose evidence is inspected
 * @returns The change path when the evidence carries a recognized kind and a path with at
 *   least one non-`.` segment; otherwise `null`
 */
export function provenChangePath(call: { fileChange?: unknown }): string | null {
  const evidence = call.fileChange;
  if (typeof evidence !== 'object' || evidence === null) return null;
  const { kind, path } = evidence as { kind?: unknown; path?: unknown };
  if (typeof path !== 'string') return null;
  // Core `parseInput` validates the collection shapes, not the element ones, so evidence
  // is usable only when it could prove a target: a recognized discriminant and a path that
  // carries segments to judge. A one-field stub, a bogus kind, or a degenerate path (`''`,
  // `'.'`, `'/'` — zero segments) proves nothing and must fall through rather than be
  // dereferenced or, worse, suppress the fallback — the evidence branch upholding on proof
  // it never had is a fail-open, and an exported pure judge that throws is a bypass vector.
  // `pathSegments` keeps a lone `.` as a segment, so require one that names a file.
  if (!pathSegments(path).some((segment) => segment !== '.')) return null;
  return kind === 'create' || kind === 'modify' || kind === 'delete' ? path : null;
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
 * predicate) shares this one implementation instead of forking it per site.
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
 * of it — compared on path segments, not raw substrings, by {@link segmentsMatch}.
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
 * counterpart of {@link pathCandidates}.
 *
 * The precondition is the opposite one. On the tokenized path an operator between two words
 * has already become a word boundary, so `pathCandidates`' separator set never needed the
 * operators themselves. A fallback branch has no tokenizer left and gets the raw line, where
 * nothing consumed them and a path glued to one (`packages/core/dist;echo x`) stayed a single
 * unmatchable segment — so the set here is wider by exactly what the tokenizer would have
 * eaten: `;` `&` `|` `<` `>`.
 *
 * The line itself stays a candidate alongside the fragments, so a protected path whose own
 * segment carries an operator (`pkg/a&b/dist`) is still matchable; an added form can only add
 * a match, never withdraw one. `:` stays out for the reason {@link pathCandidates} records.
 *
 * Widening a fragment boundary widens the ancestor direction with it: `…?x=1&packages=1`
 * splits to a bare `packages`, which `segmentsMatch` accepts as a root-anchored ancestor of a
 * protected `packages/core/dist`. That over-block is accepted rather than narrowed — the
 * narrowing that would spare it also drops a glued ancestor destroy
 * (`rm -rf packages/core;echo x`), which is the defence this fallback exists to provide.
 */
export function untokenizableLineCandidates(line: string): string[] {
  const fragments = line.split(/[;&|<>]+/).filter((f) => f !== '' && f !== line);
  return [line, ...fragments];
}

/**
 * True when `predicate` holds for any string value inside `value`, at any depth.
 *
 * Arrays and plain objects are walked by value; keys are never scanned, and non-string
 * primitives never match. Short-circuits on the first hit — the walk answers an existence
 * question, so a caller that needs every match wants its own traversal.
 */
export function someStringValue(value: unknown, predicate: (text: string) => boolean): boolean {
  if (typeof value === 'string') {
    return predicate(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => someStringValue(item, predicate));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((item) => someStringValue(item, predicate));
  }
  return false;
}

/**
 * Recursively test whether any string value inside `value` matches `path` by path-segment
 * containment (ancestor / descendant / equal). Each string is split into path candidates,
 * each tested via {@link pathMatchesProtected}. Only string values are scanned; keys,
 * numbers, and other primitives never match.
 */
export function mentionsPath(value: unknown, path: string): boolean {
  return someStringValue(value, (text) =>
    pathCandidates(text).some((candidate) => pathMatchesProtected(candidate, path)),
  );
}
