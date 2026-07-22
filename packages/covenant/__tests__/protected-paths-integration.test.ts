import type { CovenantInput } from '@polydeukes/core';
// normalizeProtectedPaths is CONFIG-02's new core export. The integration lives in
// covenant (not core) because the dependency direction is covenant -> core one-way,
// so core cannot import the self-mod judge (PRD §2).
import { normalizeProtectedPaths } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { judgeSelfModification } from '../src/self-mod.ts';

// ---------------------------------------------------------------------------
// PRD §5.3 — a dummy adapter directory is listed in protectedPaths (since
// CONFIG-07 the surface is declared there directly); its normalized output is
// wired as the self-mod protectedPaths. All strings are injected fixture
// values (PRD §7).
// ---------------------------------------------------------------------------

const MUTATING_TOOLS = ['Edit', 'Write', 'MultiEdit'];
// Dummy adapter directory — a user *value*, never a core/covenant source literal.
const ADAPTER_DIR = 'packages/adapter-foo';

/** Build a minimal CovenantInput with a single toolCalls[0]. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name, args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

describe('adapter directory protection wired through normalizeProtectedPaths (PRD §5.3)', () => {
  it('an Edit inside a listed adapter directory breaks (unprotected-adapter hole is closed)', () => {
    // P0 (assessment §9 difficulty 7): listing the adapter directory in protectedPaths
    // must include it in the protection surface, so a mutating edit inside it is blocked.
    // Mutation caught: normalizeProtectedPaths dropping an entry — the exact
    // regression that let a second agent freely weaken the gate in memoriq.
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
    // Invariant (PRD §7): the protection surface must not silently widen. Mutation
    // caught: normalization emitting an empty-equivalent path (e.g. '' or '.') that
    // match-everything, turning every edit into a break.
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
