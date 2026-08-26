import { describe, expect, it } from 'vitest';
// Every staged change, deletions included, attaches its evidence to its own staged
// tool-call element.
import {
  covenantInputFromStagedChanges,
  STAGED_DELETE,
  STAGED_WRITE,
  type StagedChange,
} from '../src/index.ts';

// The three staged statuses. Each file's content is distinct, so exact equality catches a
// dropped or swapped baseline that identical fixtures would let through.

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

describe('covenantInputFromStagedChanges — call-nested union evidence', () => {
  it('attaches evidence to all three staged calls: create/modify/delete, each on its own call', () => {
    // Three staged changes must yield three calls each carrying its own evidence — the
    // count assertion pins that the deletion is not the one silently omitted, and the
    // `in` check pins that no flat array is emitted alongside the nested evidence.
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

describe('covenantInputFromStagedChanges — unreadable (binary) content arms (review round 1)', () => {
  it('a deletion with a binary HEAD blob still carries delete evidence, just without pre', () => {
    // Immutable judgment needs no content, so a binary baseline must not suppress the
    // delete evidence — gating on a readable `pre` would let a binary immutable-matched
    // file be deleted silently.
    const result = covenantInputFromStagedChanges([
      { path: 'assets/logo.png', status: 'deleted', pre: null, post: null },
    ]);

    expect(result.toolCalls).toEqual([
      {
        name: STAGED_DELETE,
        args: { file_path: 'assets/logo.png' },
        fileChange: { kind: 'delete', path: 'assets/logo.png' },
      },
    ]);
  });

  it('a modified change with a binary HEAD blob maps to create — an unreadable baseline forgives nothing', () => {
    // An unreadable baseline forgives nothing: {pre: null, post} is judged as a creation
    // so the full post is scanned. Dropping the evidence instead would let newly staged
    // forbidden content through unjudged.
    const result = covenantInputFromStagedChanges([
      { path: 'docs/spec.md', status: 'modified', pre: null, post: 'now text with content' },
    ]);

    expect(result.toolCalls[0].fileChange).toEqual({
      kind: 'create',
      path: 'docs/spec.md',
      post: 'now text with content',
    });
  });

  it('a non-deletion whose staged blob is binary attaches no evidence — the call stays unproven', () => {
    // With no readable staged content there is nothing provable, so the toolCall survives
    // for path judgment but carries no fileChange — fabricating a create with undefined
    // content would claim evidence that was never read.
    const result = covenantInputFromStagedChanges([
      { path: 'assets/icon.png', status: 'added', pre: null, post: null },
    ]);

    expect(result.toolCalls).toEqual([
      { name: STAGED_WRITE, args: { file_path: 'assets/icon.png' } },
    ]);
  });
});
