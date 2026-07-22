import { parseInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// ADAPTER-git §4.1 — import from the package entry point (the published surface).
import {
  covenantInputFromStagedChanges,
  STAGED_DELETE,
  STAGED_WRITE,
  type StagedChange,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — structured staged changes (what the collector fills, what the pure
// translation core consumes). Paths are repo-root-relative strings.
// ---------------------------------------------------------------------------

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

describe('§5 AC-1 covenantInputFromStagedChanges — toolCalls', () => {
  it('emits STAGED_WRITE for an added file, carrying the path as file_path', () => {
    // Mutation caught: added routed to STAGED_DELETE, or file_path key renamed/dropped.
    const result = covenantInputFromStagedChanges([addedChange]);

    expect(result.toolCalls).toEqual([{ name: STAGED_WRITE, args: { file_path: 'lib/added.ts' } }]);
  });

  it('emits STAGED_WRITE for a modified file', () => {
    // Mutation caught: modified routed to STAGED_DELETE (modified is a write, not a delete).
    const result = covenantInputFromStagedChanges([modifiedChange]);

    expect(result.toolCalls).toEqual([
      { name: STAGED_WRITE, args: { file_path: 'lib/modified.ts' } },
    ]);
  });

  it('emits STAGED_DELETE for a deleted file', () => {
    // Mutation caught: deleted routed to STAGED_WRITE (delete misclassified as a write).
    const result = covenantInputFromStagedChanges([deletedChange]);

    expect(result.toolCalls).toEqual([
      { name: STAGED_DELETE, args: { file_path: 'lib/removed.ts' } },
    ]);
  });

  it('emits exactly one toolCall per change, in input order', () => {
    // Mutation caught: order not preserved, a change dropped, or a change duplicated.
    const result = covenantInputFromStagedChanges([addedChange, deletedChange, modifiedChange]);

    expect(result.toolCalls).toEqual([
      { name: STAGED_WRITE, args: { file_path: 'lib/added.ts' } },
      { name: STAGED_DELETE, args: { file_path: 'lib/removed.ts' } },
      { name: STAGED_WRITE, args: { file_path: 'lib/modified.ts' } },
    ]);
  });
});

describe('§5 AC-1 covenantInputFromStagedChanges — fileChanges', () => {
  it('pairs pre/post for an added file with pre=null', () => {
    // Mutation caught: pre defaulted to '' instead of null on a creation (the delta layer
    // treats null as an empty baseline — a '' would still be a value, not "no file").
    const result = covenantInputFromStagedChanges([addedChange]);

    expect(result.fileChanges).toEqual([
      { path: 'lib/added.ts', pre: null, post: 'export const created = 1;' },
    ]);
  });

  it('pairs pre/post for a modified file with the HEAD blob as pre', () => {
    // Mutation caught: pre/post swapped, which would forgive the new violation and judge
    // the old content instead (delta family reads pre as the forgiven baseline).
    const result = covenantInputFromStagedChanges([modifiedChange]);

    expect(result.fileChanges).toEqual([
      { path: 'lib/modified.ts', pre: 'export const old = 1;', post: 'export const changed = 2;' },
    ]);
  });

  it('omits the deleted file from fileChanges while keeping its toolCall', () => {
    // P0: a deleted file has no post content, so it produces no fileChanges element
    // (ADAPTER-04 "unsatisfiable element omitted"), yet its toolCall must survive so the
    // path axis still judges the deletion.
    const result = covenantInputFromStagedChanges([deletedChange]);

    expect(result.fileChanges).toEqual([]);
    expect(result.toolCalls).toEqual([
      { name: STAGED_DELETE, args: { file_path: 'lib/removed.ts' } },
    ]);
  });
});

describe('§5 AC-1 covenantInputFromStagedChanges — session-less collections', () => {
  it('fixes subagentSpawns and userMessages to empty arrays', () => {
    // The commit surface has no session — the two collections must be honestly empty,
    // never fabricated (CORE-04). Mutation caught: a key omitted (parseInput rejects) or
    // filled with a placeholder.
    const result = covenantInputFromStagedChanges([addedChange, modifiedChange]);

    expect(result.subagentSpawns).toEqual([]);
    expect(result.userMessages).toEqual([]);
  });

  it('returns empty collections for an empty change list', () => {
    // Boundary: zero staged changes still yields a well-formed IR (empty everywhere),
    // not undefined fields. Mutation caught: fileChanges left undefined vs [].
    const result = covenantInputFromStagedChanges([]);

    expect(result).toEqual({
      toolCalls: [],
      subagentSpawns: [],
      userMessages: [],
      fileChanges: [],
    });
  });
});

describe('§5 AC-1 covenantInputFromStagedChanges — core protocol compatibility', () => {
  it('round-trips through JSON.stringify and core parseInput', () => {
    // Proves the produced IR is a valid CovenantInput the core accepts (IR neutrality —
    // the second adapter feeds the same shape the claude-code adapter does). Mutation
    // caught: any structural drift that parseInput would reject, or a shape that parses
    // but does not deep-equal the built value.
    const built = covenantInputFromStagedChanges([addedChange, deletedChange, modifiedChange]);

    const roundTripped = parseInput(JSON.stringify(built));

    expect(roundTripped.ok).toBe(true);
    if (roundTripped.ok === true) {
      expect(roundTripped.value).toEqual(built);
    }
  });
});
