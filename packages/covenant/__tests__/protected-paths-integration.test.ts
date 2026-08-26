import type { CovenantInput } from '@polydeukes/core';
// The integration lives in covenant rather than core: the dependency direction is
// covenant -> core one-way, so core cannot import the self-mod judge.
import { normalizeProtectedPaths } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { judgeSelfModification } from '../src/self-mod.ts';

const MUTATING_TOOLS = ['Edit', 'Write', 'MultiEdit'];
const ADAPTER_DIR = 'packages/adapter-foo';

/** Build a minimal CovenantInput with a single toolCalls[0]. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name, args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

describe('adapter directory protection wired through normalizeProtectedPaths', () => {
  it('an Edit inside a listed adapter directory breaks (unprotected-adapter hole is closed)', () => {
    // Listing a directory in protectedPaths must put it on the protection surface. An entry
    // dropped in normalization leaves a judge that reports no violations forever.
    const protectedPaths = normalizeProtectedPaths({ protectedPaths: [ADAPTER_DIR] });
    const input = inputWithToolCall('Edit', {
      file_path: `${ADAPTER_DIR}/src/index.ts`,
      old_string: 'a',
      new_string: 'b',
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths,
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict.upheld).toBe(false);
  });

  it('an Edit to an unregistered path is upheld (no over-blocking)', () => {
    // The protection surface must not silently widen: normalization emitting an
    // empty-equivalent path such as '' or '.' matches everything and breaks every edit.
    const protectedPaths = normalizeProtectedPaths({ protectedPaths: [ADAPTER_DIR] });
    const input = inputWithToolCall('Edit', {
      file_path: 'packages/unregistered/src/index.ts',
      old_string: 'a',
      new_string: 'b',
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths,
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });
});
