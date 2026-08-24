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
import { mentionsPath, pathMatchesProtected, provenChangePath } from './mention.js';

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
 * A call whose `name` is a non-empty `mutatingToolNames` entry is judged on its proven
 * `fileChange` target when it carries one ({@link pathMatchesProtected} segment semantics,
 * every kind including `delete`), and otherwise on an `args` mention traversal at any
 * depth. Evidence, when attached, must be the call's complete mutation-target set.
 *
 * @param input - The call set to judge
 * @param spec - Protected paths and mutating tool names; empty strings are ignored
 * @returns A break naming the tool and the proven or mentioned path, or an uphold
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
    const changePath = provenChangePath(call);
    if (changePath !== null) {
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
