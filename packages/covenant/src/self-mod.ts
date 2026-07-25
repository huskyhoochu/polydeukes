/**
 * `judgeSelfModification` — the self-mod meta-covenant's pure judge (COVENANT-03, zero I/O).
 *
 * Breaks when a *mutating* tool call (a `name` exactly equal to an injected entry of
 * `mutatingToolNames`) targets a protected path. Since COVENANT-09 the target is read from
 * the input IR's `fileChanges` evidence when it is present, and only otherwise from an
 * `args` mention traversal. It judges only its own axis: a non-mutating tool call that
 * merely mentions a protected path is upheld — that path belongs to the Bash meta-covenant,
 * and run-all co-existence depends on this boundary. Tool names and paths are injected
 * values, never source literals.
 */

import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import { mentionsPath, pathMatchesProtected } from './mention.js';

/**
 * `SelfModificationSpec` — the injected axes of the judge (PRD §4.1).
 *
 * `protectedPaths` are literal path strings; `mutatingToolNames` are the tool names that
 * count as mutating. Empty-string entries in either list are ignored (an unguarded `''`
 * would match every path / every tool).
 */
export type SelfModificationSpec = {
  protectedPaths: string[];
  mutatingToolNames: string[];
};

/**
 * Judge a {@link CovenantInput} against the self-mod spec (pure).
 *
 * Only calls whose `name` is exactly a non-empty entry of `mutatingToolNames` are judged;
 * for each such call the target is determined on one of two branches (COVENANT-09 §4.1):
 *
 *  - **evidence** — when `input.fileChanges` is present *and non-empty*, every
 *    `fileChanges[].path` is compared against `protectedPaths` with the COVENANT-07
 *    segment semantics ({@link pathMatchesProtected}: absolute payload paths match the
 *    relative declared path, descendants of a protected directory match, a sibling across
 *    the segment boundary does not). The `args` traversal is skipped **entirely**: the
 *    adapter has positively identified the mutation target, so a protected path sitting in
 *    `args` — inside a `content` body, or even in `file_path` — is a *mention*, not a
 *    target. Evidence wins because that mention/target conflation is the false-positive
 *    class this branch exists to remove.
 *  - **fallback** — with no evidence (key absent, or an empty array), the conservative
 *    `args` mention traversal at any depth stands, unchanged. Evidence *absence* always
 *    falls to the conservative judgment, so the fail-closed direction is preserved for
 *    producers that cannot prove a target (an editor shape outside the adapter's virtual
 *    apply, a failed apply, a staged deletion, any future evidence-free adapter).
 *
 * The break reason carries the tool name plus, on the evidence branch, the matched change
 * path (the file actually being mutated) and, on the fallback branch, the mentioned
 * protected path (no target is proven there, so there is no file path to name).
 *
 * **Adapter completeness contract (COVENANT-09 §4.2).** An adapter that fills
 * `fileChanges` MUST include the mutation targets of *every* mutating call in that input.
 * A partially-filled `fileChanges` lets the unlisted mutations pass unjudged, because the
 * evidence branch skips the `args` traversal that would otherwise have caught them. Both
 * shipped producers satisfy this structurally (one payload = one mutating call = its own
 * change; one staged change dispatched at a time), and an adapter that cannot prove a
 * target must omit `fileChanges` so the fallback judges it instead.
 */
export function judgeSelfModification(
  input: CovenantInput,
  spec: SelfModificationSpec,
): CovenantVerdict {
  const mutatingNames = spec.mutatingToolNames.filter((name) => name !== '');
  const protectedPaths = spec.protectedPaths.filter((path) => path !== '');
  const fileChanges = input.fileChanges ?? [];

  for (const call of input.toolCalls) {
    if (!mutatingNames.includes(call.name)) {
      continue;
    }
    if (fileChanges.length > 0) {
      const target = fileChanges.find((change) =>
        protectedPaths.some((path) => pathMatchesProtected(change.path, path)),
      );
      if (target !== undefined) {
        return {
          upheld: false,
          reason: `${call.name} would modify protected path ${target.path}`,
        };
      }
      continue;
    }
    const mentioned = protectedPaths.find((path) => mentionsPath(call.args, path));
    if (mentioned !== undefined) {
      return {
        upheld: false,
        reason: `${call.name} would modify protected path ${mentioned}`,
      };
    }
  }

  return { upheld: true };
}
