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
 *  - **evidence** — every `fileChanges[].path` is compared against `protectedPaths` with
 *    the COVENANT-07 segment semantics ({@link pathMatchesProtected}: absolute payload
 *    paths match the relative declared path, descendants of a protected directory match, a
 *    sibling across the segment boundary does not). A match breaks immediately, and it
 *    outranks the `args` traversal below: the adapter has positively identified a mutation
 *    target, so a protected path sitting in `args` — inside a `content` body, or even in
 *    `file_path` — is a *mention*, not a target. Evidence wins because that mention/target
 *    conflation is the false-positive class this branch exists to remove.
 *  - **fallback** — with no evidence match, the conservative `args` mention traversal at
 *    any depth stands, unchanged. This runs whenever the evidence did not clear *this*
 *    call, which is broader than "the input carried no evidence at all": `fileChanges` is
 *    one flat array per input with no call attribution, so a call whose own target is
 *    absent from it must not be absolved by another call's element. A staged deletion
 *    beside an ordinary write is the shipped case — the git adapter omits the deletion's
 *    element by design, and gating the traversal on a non-empty input-level array would
 *    let that deletion ride the write's evidence straight past the gate. Keeping the
 *    fall-through makes evidence absence conservative **per call**, preserving the
 *    fail-closed direction for every producer that cannot prove a given target (an editor
 *    shape outside the adapter's virtual apply, a failed apply, a staged deletion, any
 *    future evidence-free adapter).
 *
 * The break reason carries the tool name plus, on the evidence branch, the matched change
 * path (the file actually being mutated) and, on the fallback branch, the mentioned
 * protected path (no target is proven there, so there is no file path to name).
 *
 * **Adapter completeness contract (COVENANT-09 §4.2).** An adapter that fills
 * `fileChanges` SHOULD include the mutation targets of *every* mutating call in that
 * input. The judge no longer depends on it for safety — a call the evidence does not
 * cover falls through to the mention traversal rather than passing unjudged — so the
 * contract now buys precision, not soundness: a covered call is judged on its proven
 * target instead of on whatever its `args` happen to mention. Both shipped producers
 * satisfy it structurally (one payload = one mutating call = its own change; one staged
 * change dispatched at a time). An adapter that cannot prove a target simply omits the
 * element and gets the conservative judgment for that call.
 */
export function judgeSelfModification(
  input: CovenantInput,
  spec: SelfModificationSpec,
): CovenantVerdict {
  const mutatingNames = spec.mutatingToolNames.filter((name) => name !== '');
  const protectedPaths = spec.protectedPaths.filter((path) => path !== '');
  // Element shapes are an intentionally unvalidated CORE-01 boundary (core `parseInput`
  // checks only that `fileChanges` is an array), so a malformed element must be skipped
  // rather than dereferenced — an exported pure judge that throws is a bypass vector.
  const fileChanges = (input.fileChanges ?? []).filter(
    (change) => typeof change?.path === 'string',
  );
  const protectedTarget = fileChanges.find((change) =>
    protectedPaths.some((path) => pathMatchesProtected(change.path, path)),
  );

  for (const call of input.toolCalls) {
    if (!mutatingNames.includes(call.name)) {
      continue;
    }
    // A proven protected target breaks regardless of which call it belongs to: the evidence
    // says *something* in this input mutates a protected path, and that alone is decisive.
    // (`fileChanges` carries no call attribution, so the reason names this call — see the
    // multi-call note in the doc block.)
    if (protectedTarget !== undefined) {
      return {
        upheld: false,
        reason: `${call.name} would modify protected path ${protectedTarget.path}`,
      };
    }
    // No protected target anywhere in the evidence. That absolves this call only if the
    // evidence actually covered it — "the input carries evidence" is not "this call's
    // target was proven". A call whose own target is missing from the flat array (a staged
    // deletion beside an ordinary write, where the adapter omits the deletion's element by
    // design) would otherwise ride the other call's evidence past the gate, so it falls
    // through to the conservative traversal below. Coverage is recognized by the call's own
    // `args` mentioning a change path: adapters name the target in `args` as well as in the
    // evidence, which is the link the IR itself does not carry.
    if (fileChanges.some((change) => mentionsPath(call.args, change.path))) {
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
