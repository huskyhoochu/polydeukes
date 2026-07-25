import { describe, expect, it } from 'vitest';
// CORE-06 §4.2 / AC 3 — the omission rule dies: EVERY staged change, deletions included,
// attaches union evidence to its own staged tool-call element. Today a deleted staged
// change produces no evidence at all (the fail-open channel this ticket closes), and no
// call carries a nested fileChange, so this file is RED by construction.
import {
  covenantInputFromStagedChanges,
  STAGED_DELETE,
  STAGED_WRITE,
  type StagedChange,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — the three staged statuses. The deleted file's HEAD blob is distinctive
// content: exact equality catches a dropped or swapped baseline, which an inert
// fixture would let through.
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

describe('covenantInputFromStagedChanges — call-nested union evidence (AC 3)', () => {
  it('attaches evidence to all three staged calls: create/modify/delete, each on its own call', () => {
    // P0 omission-rule abolition: three staged changes yield three calls EACH carrying
    // its own evidence (calls with evidence === 3, not 2). Mutation caught: the deletion
    // still omitted, a kind crossed (added tagged modify), evidence attached to a sibling
    // call, or the legacy flat array emitted alongside the nested home.
    const result = covenantInputFromStagedChanges([addedChange, modifiedChange, deletedChange]);

    expect(result.toolCalls).toEqual([
      {
        name: STAGED_WRITE,
        args: { file_path: 'lib/added.ts' },
        fileChange: { kind: 'create', path: 'lib/added.ts', post: 'export const created = 1;' },
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
      {
        name: STAGED_DELETE,
        args: { file_path: 'lib/removed.ts' },
        fileChange: { kind: 'delete', path: 'lib/removed.ts', pre: 'export const gone = 1;' },
      },
    ]);
    expect(result.toolCalls.filter((call) => call.fileChange !== undefined)).toHaveLength(3);
    expect('fileChanges' in result).toBe(false);
  });
});
