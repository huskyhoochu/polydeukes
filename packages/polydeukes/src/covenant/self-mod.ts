/**
 * `judgeSelfModification` — the self-mod meta-covenant's pure judge (zero I/O).
 *
 * Breaks when a *mutating* tool call (a `name` exactly equal to an injected entry of
 * `mutatingToolNames`) targets a protected path. The target is read from the call's own
 * nested `fileChange` evidence when it carries one, and only otherwise from an `args`
 * mention traversal. It judges only its own axis: a non-mutating tool call that merely
 * mentions a protected path is upheld — that path belongs to the Bash meta-covenant, and
 * run-all co-existence depends on this boundary. Tool names and paths are injected values,
 * never source literals.
 */

import type { CovenantInput, CovenantVerdict } from '@polydeukes/core';
import type { CovenantRegistration, MetaCovenantRegistration } from './dispatch.ts';
import { mentionsPath, pathMatchesProtected, provenChangePath } from './mention.ts';
import { outcomeFromVerdict, UNJUDGEABLE_OUTCOME } from './run-covenant.ts';

/**
 * `SelfModificationSpec` — the injected axes of the judge.
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

/**
 * `SelfModRegistrationSpec` — the assembly values baked into the registration. The call
 * set is not among them: the dispatcher supplies it to the judge at call time, so one
 * built registration serves every payload.
 */
export type SelfModRegistrationSpec = {
  protectedPaths: string[];
  mutatingToolNames: string[];
  witness?: CovenantRegistration['witness'];
};

/**
 * Build the self-mod registration. Routing stays path mention; the judgment is the thunk.
 *
 * The misassembly gate lives at the thunk's entry: zero valid entries in either list would
 * make {@link judgeSelfModification} uphold every call, so it answers the unjudgeable
 * outcome instead, which no enforce level softens.
 */
export function selfModRegistration(spec: SelfModRegistrationSpec): MetaCovenantRegistration {
  const judgeSpec: SelfModificationSpec = {
    protectedPaths: spec.protectedPaths,
    mutatingToolNames: spec.mutatingToolNames,
  };
  return {
    label: 'self-mod',
    protectedPaths: spec.protectedPaths,
    body: async (input) => {
      if (
        judgeSpec.protectedPaths.filter((path) => path !== '').length === 0 ||
        judgeSpec.mutatingToolNames.filter((name) => name !== '').length === 0
      ) {
        return UNJUDGEABLE_OUTCOME;
      }
      try {
        return outcomeFromVerdict(judgeSelfModification(input, judgeSpec));
      } catch {
        // Structurally unjudgeable input that passed parseInput (which validates the
        // collection shapes, not the element ones): cannot judge means block.
        return UNJUDGEABLE_OUTCOME;
      }
    },
    ...(spec.witness !== undefined ? { witness: spec.witness } : {}),
  };
}
