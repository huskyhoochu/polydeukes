import { describe, expect, it } from 'vitest';
// CovenantInput transports agent-neutral pre/post evidence, carried per tool call as the
// discriminated `fileChange?` element. The absence of a top-level `fileChanges` field is part
// of the contract and is pinned by file-change-union.test.ts.
import { type CovenantInput, type FileChange, parseInput } from '../src/index.ts';

// Evidence covering both kinds: create (no prior file) and modify (existing baseline).

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
    // A payload carrying evidence must deserialize with every element intact and identical —
    // no field dropped during validation, no kind/pre/post/path rewritten.
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
    // An IR whose calls carry no evidence must parse without a default-fill inventing the
    // key: a fabricated `fileChange` is indistinguishable from real evidence downstream.
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
