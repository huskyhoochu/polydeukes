import { parseInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import {
  covenantInputFromStagedChanges,
  STAGED_DELETE,
  STAGED_WRITE,
  type StagedChange,
} from '../src/index.ts';

const addedChange: StagedChange = {
  path: 'lib/added.ts',
  status: 'added',
  pre: null,
  post: 'export const created = 1;',
};

const modifiedChange: StagedChange = {
  path: 'lib/modified.ts',
  status: 'modified',
  pre: 'export const old = 1;',
  post: 'export const changed = 2;',
};

const deletedChange: StagedChange = {
  path: 'lib/removed.ts',
  status: 'deleted',
  pre: 'export const gone = 1;',
  post: null,
};

describe('covenantInputFromStagedChanges — toolCalls', () => {
  it('emits STAGED_WRITE for an added file, carrying the path as file_path', () => {
    const result = covenantInputFromStagedChanges([addedChange]);

    expect(result.toolCalls.map((call) => ({ name: call.name, args: call.args }))).toEqual([
      { name: STAGED_WRITE, args: { file_path: 'lib/added.ts' } },
    ]);
  });

  it('emits STAGED_WRITE for a modified file', () => {
    // A modification is a write, not a delete.
    const result = covenantInputFromStagedChanges([modifiedChange]);

    expect(result.toolCalls.map((call) => ({ name: call.name, args: call.args }))).toEqual([
      { name: STAGED_WRITE, args: { file_path: 'lib/modified.ts' } },
    ]);
  });

  it('emits STAGED_DELETE for a deleted file', () => {
    const result = covenantInputFromStagedChanges([deletedChange]);

    expect(result.toolCalls.map((call) => ({ name: call.name, args: call.args }))).toEqual([
      { name: STAGED_DELETE, args: { file_path: 'lib/removed.ts' } },
    ]);
  });

  it('emits exactly one toolCall per change, in input order, each with its own evidence', () => {
    // Full-element equality, not per-field checks: it is what pins each change's evidence
    // to its own call, so one change's evidence cannot be laundered onto a sibling.
    const result = covenantInputFromStagedChanges([addedChange, deletedChange, modifiedChange]);

    expect(result.toolCalls).toEqual([
      {
        name: STAGED_WRITE,
        args: { file_path: 'lib/added.ts' },
        fileChange: { kind: 'create', path: 'lib/added.ts', post: 'export const created = 1;' },
      },
      {
        name: STAGED_DELETE,
        args: { file_path: 'lib/removed.ts' },
        fileChange: { kind: 'delete', path: 'lib/removed.ts', pre: 'export const gone = 1;' },
      },
      {
        name: STAGED_WRITE,
        args: { file_path: 'lib/modified.ts' },
        fileChange: {
          kind: 'modify',
          path: 'lib/modified.ts',
          pre: 'export const old = 1;',
          post: 'export const changed = 2;',
        },
      },
    ]);
  });
});

describe('covenantInputFromStagedChanges — nested evidence', () => {
  it('tags an added file as create evidence on its own call', () => {
    // A creation tagged modify would make an immutable discipline break on first
    // authoring.
    const result = covenantInputFromStagedChanges([addedChange]);

    expect(result.toolCalls[0].fileChange).toEqual({
      kind: 'create',
      path: 'lib/added.ts',
      post: 'export const created = 1;',
    });
  });

  it('tags a modified file as modify evidence with the HEAD blob as pre', () => {
    // The delta family reads pre as the forgiven baseline, so swapping pre and post would
    // forgive the new violation and judge the old content instead.
    const result = covenantInputFromStagedChanges([modifiedChange]);

    expect(result.toolCalls[0].fileChange).toEqual({
      kind: 'modify',
      path: 'lib/modified.ts',
      pre: 'export const old = 1;',
      post: 'export const changed = 2;',
    });
  });
});

describe('covenantInputFromStagedChanges — session-less collections', () => {
  it('fixes subagentSpawns and userMessages to empty arrays', () => {
    // The commit surface has no session, so the two collections must be honestly empty —
    // never filled with a placeholder, and never omitted (parseInput rejects that).
    const result = covenantInputFromStagedChanges([addedChange, modifiedChange]);

    expect(result.subagentSpawns).toEqual([]);
    expect(result.userMessages).toEqual([]);
  });

  it('returns empty collections for an empty change list', () => {
    const result = covenantInputFromStagedChanges([]);

    expect(result).toEqual({
      toolCalls: [],
      subagentSpawns: [],
      userMessages: [],
    });
  });
});

describe('covenantInputFromStagedChanges — core protocol compatibility', () => {
  it('round-trips through JSON.stringify and core parseInput', () => {
    // IR neutrality: this adapter must feed the core the same shape the claude-code
    // adapter does. Parsing alone is not enough — the parsed value must deep-equal what
    // was built, or a lossy round-trip would pass.
    const built = covenantInputFromStagedChanges([addedChange, deletedChange, modifiedChange]);

    const roundTripped = parseInput(JSON.stringify(built));

    expect(roundTripped.ok).toBe(true);
    if (roundTripped.ok === true) {
      expect(roundTripped.value).toEqual(built);
    }
  });
});
