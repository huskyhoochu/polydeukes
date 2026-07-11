/**
 * `judgeSelfModification` — the self-mod meta-covenant's pure judge (COVENANT-03, zero I/O).
 *
 * Breaks when a *mutating* tool call (a `name` exactly equal to an injected entry of
 * `mutatingToolNames`) mentions a protected path in its `args` at any depth. It judges
 * only its own axis: a non-mutating tool call that merely mentions a protected path is
 * upheld — that path belongs to the Bash meta-covenant, and run-all co-existence depends
 * on this boundary. Tool names and paths are injected values, never source literals.
 */

import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import { mentionsPath } from './mention.js';

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
 * Breaks iff some `toolCalls[i]` has `name` exactly equal to a non-empty entry of
 * `mutatingToolNames` and its `args` mention a non-empty entry of `protectedPaths`; the
 * reason carries the tool name and the mentioned path. Everything else upholds.
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
