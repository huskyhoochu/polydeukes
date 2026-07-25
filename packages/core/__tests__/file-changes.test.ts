import { describe, expect, it } from 'vitest';
// COVENANT-10 §4.2 / AC §5.6 — CovenantInput transports agent-neutral pre/post evidence.
// CORE-06 §4.1 moved that evidence into its own tool-call element (`fileChange?`) and made
// it a discriminated union, so the round-trip pinned here rides the nested position. The
// removed top-level `fileChanges` field and its array validation are pinned by
// file-change-union.test.ts (the field's absence is now part of the contract).
import { type CovenantInput, type FileChange, parseInput } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — a minimal valid input plus evidence covering the create (no prior
// file) and modify (existing baseline) kinds.
// ---------------------------------------------------------------------------

const modifyChange: FileChange = {
  kind: 'modify',
  path: 'src/a.ts',
  pre: 'const a = 1;',
  post: 'const a = 2;',
};

const createChange: FileChange = { kind: 'create', path: 'src/b.ts', post: 'export const b = 1;' };

const inputWithFileChanges: CovenantInput = {
  toolCalls: [
    { name: 'edit', args: { path: 'src/a.ts' }, fileChange: modifyChange },
    { name: 'write', args: { path: 'src/b.ts' }, fileChange: createChange },
  ],
  subagentSpawns: [],
  userMessages: [],
};

describe('parseInput — file-change evidence round-trip (PRD §4.2, AC §5.6)', () => {
  it('preserves each call element evidence through a JSON round-trip', () => {
    // P1 round-trip atomicity: a payload carrying evidence must deserialize with every
    // element intact and identical. Mutation caught: the field dropped during validation,
    // or an element's kind/pre/post/path rewritten.
    const result = parseInput(JSON.stringify(inputWithFileChanges));

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.toolCalls[0].fileChange).toEqual(modifyChange);
      expect(result.value.toolCalls[1].fileChange).toEqual(createChange);
    }
  });
});

describe('parseInput — file-change absence (PRD §4.2, no key fabrication)', () => {
  it('accepts a payload with no evidence and does not fabricate the key', () => {
    // P0 no-fabrication (CORE-04 timestampMs precedent): an IR whose calls carry no
    // evidence must parse AND the parsed calls must not carry a fabricated `fileChange`
    // key. A fabricated key would be indistinguishable from real evidence downstream.
    // Mutation caught: a default-fill assigning evidence when the key is absent.
    const result = parseInput(
      JSON.stringify({
        toolCalls: [{ name: 'bash', args: { command: 'ls' } }],
        subagentSpawns: [],
        userMessages: [],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect('fileChange' in result.value.toolCalls[0]).toBe(false);
    }
  });
});
