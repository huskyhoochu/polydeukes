/**
 * `mentionsPath` — the single path-mention semantic shared by the dispatcher and the
 * pure judges (PRD §7).
 *
 * Both the path-routing dispatcher (`matchRegistrations`) and any covenant judge
 * that keys on a protected path import this one function, so the two layers can never
 * drift apart. Argument names are never inspected — only string *values* are scanned,
 * at any depth, keeping the traversal agent-neutral.
 *
 * Since COVENANT-07b the comparison is a POTENTIAL match: a candidate segment that cannot
 * be resolved statically (a glob, a variable expansion, a tilde) is not compared as a
 * literal but read as a position something else will fill. Nothing is ever expanded and
 * nothing is resolved — no filesystem, no home directory, no working directory — so the
 * judgment reads the same wherever it runs, and ambiguity falls toward a match. The hole
 * this closes was seven notations of the same file passing while the literal one blocked.
 */

/**
 * True when a segment's expansion is unknown in both content and length: a tilde
 * (`~`, `~user`), a parameter expansion (`$HOME`), or a `..` that had nothing left to
 * cancel — it reaches outside the tree, so it can stand for anything (PRD §2-a).
 *
 * Such a segment stands for ONE OR MORE segments, never zero. A zero-width expansion would
 * root-anchor whatever follows it, making `~/packages` an ancestor of every protected path
 * under `packages/` and blocking the ordinary work of the repository.
 */
function isUnknownSegment(segment: string): boolean {
  return segment === '..' || segment.startsWith('~') || segment.includes('$');
}

/** True when a segment carries glob metacharacters and is therefore matched as a pattern. */
function isGlobSegment(segment: string): boolean {
  return segment.includes('*') || segment.includes('?');
}

/**
 * True when a glob segment carries at least one literal character to constrain it.
 *
 * A segment made only of `*` and `?` constrains nothing, so it fills a position without
 * proving one. Counting it as proof is what let a lone `*` name every protected segment
 * there is — `ls packages/*`, a `--name '*.mjs'` argument, and a markdown bullet in a file
 * body all blocked, which is the friction the 2026-07-26 narrowing existed to remove.
 */
function globHasLiteral(segment: string): boolean {
  return segment.replace(/[*?]/g, '') !== '';
}

/**
 * Normalize a path into segments: split on `/`, drop empties and `.`, and cancel the
 * preceding segment on `..`. Cancellation is refused when that predecessor is unknown —
 * one `..` cancels one segment while an unknown stands for an unbounded run — so the `..`
 * survives as an unknown segment of its own rather than eating evidence it cannot account
 * for. Exported so the self-mod judge can tell a judgeable evidence path from a degenerate
 * one (`''`, `'.'`, `'/'` — zero segments) that proves nothing (COVENANT-09).
 */
export function pathSegments(path: string): string[] {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    const previous = segments[segments.length - 1];
    if (segment === '..' && previous !== undefined && !isUnknownSegment(previous)) {
      segments.pop();
      // Cancelling the last definite segment lands on the tree root, which is an ancestor
      // of every relative protected path. An empty list would answer "names nothing", and
      // `rm -rf .claude/hooks/../..` would reach no judge at all.
      if (segments.length === 0) segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

/**
 * True iff the candidate segment could name `target`. A segment carrying `*` or `?`
 * occupies exactly ONE position and is constrained by the literals around the glob, so
 * `lefthook.y*` can name `lefthook.yml` while `core-generated*` can never name `core` —
 * the glob is read, never expanded. Every other segment is definite and compares by string
 * equality; prefix-comparing a segment that carries no glob is the `core/src-generated`
 * boundary trap COVENANT-07 closed.
 */
function segmentCanName(segment: string, target: string): boolean {
  if (!isGlobSegment(segment)) return segment === target;
  const pattern = segment
    // Collapse runs of `*` before translating. Consecutive `.*` groups backtrack
    // combinatorially against a non-matching literal — 24 asterisks measured at 32s inside
    // a hook that runs on every tool call — and `**` cannot mean more than `*` within one
    // segment anyway, since the segment boundary is the split.
    .replace(/\*+/g, '*')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`).test(target);
}

/**
 * Walk candidate segments from `ci` against protected segments from `pi` — one protected
 * segment per definite/glob candidate segment, one or more per unknown one — and answer
 * whether any walk reaches a position pair `accepts` recognizes. Both match directions are
 * this same walk under a different acceptance.
 *
 * `named` counts the protected segments a segment CONSTRAINED by literals answered for, and
 * must reach one before either acceptance holds: an unknown segment — and a glob carrying no
 * literal — fills a position but never proves one. Without that, a walk carried by expansion
 * alone makes `~/anything` and a lone `*` match every protected path there is.
 *
 * `absolute` says whether the protected path is absolute, which decides what an unknown may
 * stand for. A relative protected path is anchored at the repository root while `~`, `$VAR`,
 * and a surviving `..` all reach outside it, so against a relative path an unknown can never
 * name one of its segments — otherwise `~/dist` becomes `packages/core/dist` and a sibling
 * checkout's build output is protected. Against an absolute path (the transcript assembly
 * attaches) the unknown stands for its leading run. A repository that lives under the home
 * directory is still reached either way, because the descendant rule slides its start.
 */
function walk(
  candidate: string[],
  protectedSegments: string[],
  ci: number,
  pi: number,
  named: number,
  absolute: boolean,
  accepts: (ci: number, pi: number) => boolean,
): boolean {
  if (named > 0 && accepts(ci, pi)) return true;
  if (ci === candidate.length || pi === protectedSegments.length) return false;
  const segment = candidate[ci];
  if (isUnknownSegment(segment)) {
    if (!absolute) return false;
    for (let taken = 1; pi + taken <= protectedSegments.length; taken++) {
      if (walk(candidate, protectedSegments, ci + 1, pi + taken, named, absolute, accepts)) {
        return true;
      }
    }
    return false;
  }
  if (!segmentCanName(segment, protectedSegments[pi])) return false;
  const proves = !isGlobSegment(segment) || globHasLiteral(segment);
  const next = named + (proves ? 1 : 0);
  return walk(candidate, protectedSegments, ci + 1, pi + 1, next, absolute, accepts);
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
 * A run may be filled by segments the judge cannot resolve (COVENANT-07b): `~/.claude/…`
 * matches an absolute transcript path because the definite tail is the whole comparison,
 * and `lefthook.y*` matches `lefthook.yml` because a glob is a potential name, not a literal.
 */
export function pathMatchesProtected(candidate: string, protectedPath: string): boolean {
  const a = pathSegments(candidate);
  const b = pathSegments(protectedPath);
  if (a.length === 0 || b.length === 0) return false;
  // A candidate left with nothing but `..` cancelled above the tree root, which is an
  // ancestor of every relative protected path — the `rm -rf .claude/hooks/../..` form,
  // which names no protected segment yet removes all of them.
  if (a.every((segment) => segment === '..')) return true;
  const absolute = protectedPath.startsWith('/');
  for (let start = 0; start < a.length; start++) {
    if (walk(a, b, start, 0, 0, absolute, (_ci, pi) => pi === b.length)) return true;
  }
  // Ancestor: the candidate is a proper root-anchored prefix of the protected path.
  return walk(a, b, 0, 0, 0, absolute, (ci, pi) => ci === a.length && pi < b.length);
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
