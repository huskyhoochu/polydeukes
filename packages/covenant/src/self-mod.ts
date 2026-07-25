/**
 * `judgeSelfModification` — the self-mod meta-covenant's pure judge (COVENANT-03, zero I/O).
 *
 * Breaks when a *mutating* tool call (a `name` exactly equal to an injected entry of
 * `mutatingToolNames`) targets a protected path. Since COVENANT-09 the target is read from
 * the call's own nested `fileChange` evidence when it carries one, and only otherwise from
 * an `args` mention traversal. It judges only its own axis: a non-mutating tool call that
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
 * each such call takes exactly one of two branches (COVENANT-09 §4.1):
 *
 *  - **evidence** — the call carries its own `fileChange`, so its mutation target is
 *    proven. That one path is compared against `protectedPaths` with the COVENANT-07
 *    segment semantics ({@link pathMatchesProtected}: an absolute payload path matches the
 *    relative declared path, a descendant of a protected directory matches, a sibling
 *    across the segment boundary does not), and every kind is judged identically —
 *    `delete` included, since removing a protected file is a modification of the surface.
 *    `args` are never consulted here: with the target known, a protected path sitting in
 *    `args` — quoted inside a `content` body, or even parked in `file_path` — is a
 *    *mention*, not a target, and that conflation is the false-positive class this ticket
 *    removes. Evidence nests on its own call element (CORE-06, singular `fileChange`), so
 *    one call's proof can never absolve a sibling.
 *  - **fallback** — the call carries no usable evidence, so the conservative `args` mention
 *    traversal at any depth stands, unchanged. It is kept permanently, not as a migration
 *    step: evidence-free producers are a standing shape (a NotebookEdit-style call outside
 *    the adapter's virtual apply, an apply that failed, a binary staged change with no text
 *    to diff, any future adapter). Absence of proof stays fail-closed per call.
 *
 * The break reason carries the tool name plus, on the evidence branch, the change path (the
 * file actually being mutated) and, on the fallback branch, the mentioned protected path (no
 * target is proven there, so there is no file path to name).
 *
 * **Adapter completeness contract (COVENANT-09 §4.2).** An adapter SHOULD attach a
 * `fileChange` to every mutating call it emits. The judge does not depend on it for safety —
 * an uncovered call falls through to the mention traversal rather than passing unjudged — so
 * the contract buys precision, not soundness: a covered call is judged on its proven target
 * instead of on whatever its `args` happen to mention.
 */
export function judgeSelfModification(
  input: CovenantInput,
  spec: SelfModificationSpec,
): CovenantVerdict {
  const mutatingNames = spec.mutatingToolNames.filter((name) => name !== '');
  const protectedPaths = spec.protectedPaths.filter((path) => path !== '');

  for (const call of input.toolCalls) {
    if (!mutatingNames.includes(call.name)) {
      continue;
    }
    // Element shapes are an intentionally unvalidated CORE-01 boundary (core `parseInput`
    // checks only the collection shapes), so a `fileChange` without a string `path` proves
    // nothing and must fall through rather than be dereferenced — an exported pure judge
    // that throws is a bypass vector.
    const changePath = call.fileChange?.path;
    if (typeof changePath === 'string') {
      if (protectedPaths.some((path) => pathMatchesProtected(changePath, path))) {
        return {
          upheld: false,
          reason: `${call.name} would modify protected path ${changePath}`,
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
