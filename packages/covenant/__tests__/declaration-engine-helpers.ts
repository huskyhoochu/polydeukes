/** Shared helpers for the declaration-engine suites. Not a test file itself. */

import type { AlgebraDeclaration, ExtractStep } from '@polydeukes/core';
import {
  type CompiledDeclaration,
  type ConfigFault,
  compileDeclaration,
  type DeclarationVerdict,
  judgeDeclaration,
  type Witness,
  type World,
} from '../src/declaration-engine.ts';

/** Narrow a compile result to the fault branch. */
export function isConfigFault(result: CompiledDeclaration | ConfigFault): result is ConfigFault {
  return (
    typeof result === 'object' &&
    result !== null &&
    'kind' in result &&
    (result as { kind?: unknown }).kind === 'config-fault'
  );
}

/** Compile a declaration the contract admits; a fault here is a test-setup error. */
export function compileOrFail(decl: AlgebraDeclaration): CompiledDeclaration {
  const compiled = compileDeclaration({ declaration: decl });
  if (isConfigFault(compiled)) {
    throw new Error(`unexpected config fault at ${compiled.location}: ${compiled.reason}`);
  }
  return compiled;
}

/** Compile and judge in one step. */
export function judge(decl: AlgebraDeclaration, world: World): DeclarationVerdict {
  return judgeDeclaration({ compiled: compileOrFail(decl), world });
}

/**
 * The witnesses of one entry's break — `[]` when the verdict passed, and a thrown error on
 * any other kind so a supply failure or a scope miss never reads as "holds".
 */
export function witnessesOf(verdict: DeclarationVerdict, id?: string): readonly Witness[] {
  if (verdict.kind === 'pass') return [];
  if (verdict.kind !== 'broken') {
    throw new Error(`expected pass or broken, got ${JSON.stringify(verdict)}`);
  }
  const target = id === undefined ? verdict.breaks[0] : verdict.breaks.find((b) => b.id === id);
  if (target === undefined) {
    throw new Error(`no break for entry ${id ?? '[0]'} in ${JSON.stringify(verdict)}`);
  }
  return target.witnesses;
}

/**
 * A declaration that reads `sourceName`, pipes it through `steps`, and relates the result
 * with `empty` — whose witnesses are every item in input order, so judging it dumps the
 * pipeline's output through the public verdict.
 */
export function dumpDeclaration(
  sourceName: string,
  extractName: string,
  steps: readonly ExtractStep[],
): AlgebraDeclaration {
  return {
    discipline: 'probe',
    mechanism: 'scoped-valve',
    extract: { [extractName]: [{ op: 'source', of: sourceName }, ...steps] },
    relate: [
      { id: `${extractName}-dump`, relation: { op: 'empty', of: extractName }, message: 'm' },
    ],
    // `scoped-valve` is the one name admitting every relation, and it asks for a valve; the
    // valve never opens (it relates the same empty check), so the dump is unchanged.
    witness: {
      relate: [
        { id: `${extractName}-valve`, relation: { op: 'empty', of: extractName }, message: 'w' },
      ],
    },
  };
}

/** The items a pipeline over `sourceValue` produces, as `{ key, value }` witnesses. */
export function extracted(
  sourceName: string,
  extractName: string,
  steps: readonly ExtractStep[],
  sourceValue: unknown,
): readonly Witness[] {
  return witnessesOf(
    judge(dumpDeclaration(sourceName, extractName, steps), { [sourceName]: sourceValue }),
  );
}
