import type { CovenantInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { covenantModule } from '../src/covenant/module.ts';
import { assembleCheckRegistrations, runCovenantCheck } from '../src/covenant-check.ts';
import type { loadConfig } from '../src/load-config.ts';

// The type contract alone: `surface` is a required field of both specs. vitest does not
// typecheck, `tsc --noEmit` does — a spec that compiles without `surface` is a caller free
// to default it, and a default is an inference about which surface a call came from.

declare const config: ReturnType<typeof loadConfig>['config'];
declare const input: CovenantInput;

// biome-ignore lint/correctness/noUnusedVariables: read by the typechecker only
function neverCalled(): unknown[] {
  return [
    // @ts-expect-error — `surface` is required on CovenantCheckSpec
    () => runCovenantCheck({ repoRoot: '', input }),
    // @ts-expect-error — `surface` is required on CheckAssemblySpec
    () => assembleCheckRegistrations({ config, rootDir: '', covenant: covenantModule }),
  ];
}

describe('the surface is a required field of both specs', () => {
  it('a check spec and an assembly spec without `surface` do not typecheck', () => {
    expect(true).toBe(true);
  });
});
