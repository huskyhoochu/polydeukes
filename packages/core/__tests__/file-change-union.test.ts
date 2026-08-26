import { describe, expect, it } from 'vitest';
import { allFileChanges, type CovenantInput, type FileChange, parseInput } from '../src/index.ts';

// One evidence per union kind. Contents are distinctive on purpose: exact-equality
// assertions catch a field swap or a dropped baseline, which an inert 'x' fixture
// would let through.

const createEvidence: FileChange = {
  kind: 'create',
  path: 'src/new.ts',
  post: 'export const born = 1;',
};

const deleteEvidence: FileChange = {
  kind: 'delete',
  path: 'src/removed.ts',
  pre: 'export const gone = 1;',
};

// Each `@ts-expect-error` must sit on the offending PROPERTY line: TypeScript anchors
// excess-property errors there, not on the opening-brace line.

describe('FileChange union — type locks', () => {
  it('rejects a delete variant carrying a post', () => {
    // Catches the delete variant widening to carry post — a deletion with "resulting
    // content" is the shape this union exists to outlaw.
    const bad: FileChange = {
      kind: 'delete',
      path: 'src/removed.ts',
      pre: 'export const gone = 1;',
      // @ts-expect-error — the delete variant has no post: deletion leaves no content
      post: 'zombie content',
    };

    expect(bad.kind).toBe('delete');
  });

  it('rejects a create variant carrying a pre', () => {
    // Catches the create variant widening to carry pre — a creation with a baseline
    // would let a judge forgive brand-new content as pre-existing debt.
    const bad: FileChange = {
      kind: 'create',
      path: 'src/new.ts',
      post: 'export const born = 1;',
      // @ts-expect-error — the create variant has no pre: there was no file before
      pre: 'phantom baseline',
    };

    expect(bad.kind).toBe('create');
  });

  it('rejects a CovenantInput literal with a top-level fileChanges key', () => {
    // Catches the top-level home resurrecting as an optional field: two homes for
    // evidence make it ambiguous which call a change belongs to.
    const bad: CovenantInput = {
      toolCalls: [],
      subagentSpawns: [],
      userMessages: [],
      // @ts-expect-error — evidence has exactly one home: the tool-call element
      fileChanges: [],
    };

    expect(bad.toolCalls).toEqual([]);
  });
});

describe('CovenantInput — call-nested evidence attribution', () => {
  it('preserves nesting through a JSON round-trip: evidence stays on its own call only', () => {
    // Evidence on the second call only, so the assertions can catch a parse/serialize
    // step hoisting evidence into a shared home where it would forgive a sibling call.
    const input: CovenantInput = {
      toolCalls: [
        { name: 'call-a', args: { file_path: 'src/other.ts' } },
        { name: 'call-b', args: { file_path: 'src/removed.ts' }, fileChange: deleteEvidence },
      ],
      subagentSpawns: [],
      userMessages: [],
    };

    const result = parseInput(JSON.stringify(input));

    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.value.toolCalls[1].fileChange).toEqual(deleteEvidence);
    expect('fileChange' in result.value.toolCalls[0]).toBe(false);
    expect('fileChanges' in result.value).toBe(false);
  });

  it('allFileChanges flattens evidence across calls in input order, skipping bare calls', () => {
    // The evidence-less call sits between the two others so the assertion catches a walk
    // that aborts on a gap; the two kinds differ so a reversed order fails too.
    const input: CovenantInput = {
      toolCalls: [
        { name: 'call-a', fileChange: createEvidence },
        { name: 'call-b', args: { command: 'git status' } },
        { name: 'call-c', fileChange: deleteEvidence },
      ],
      subagentSpawns: [],
      userMessages: [],
    };

    expect(allFileChanges(input)).toEqual([createEvidence, deleteEvidence]);
  });
});

// parseInput validates that the three collections exist; it does not validate their
// element shapes. These pin that boundary.

describe('parseInput — fail-closed axis unchanged after the field removal', () => {
  it('still fails closed with exit 2 when a required collection is missing', () => {
    // Catches the toolCalls presence check being dropped alongside the removed
    // top-level fileChanges validation.
    const result = parseInput(JSON.stringify({ subagentSpawns: [], userMessages: [] }));

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });

  it('parses an evidence-less input ok (legacy shape tolerance)', () => {
    // An IR with no fileChange anywhere is valid input: absence means "these calls are
    // unproven", a judging disposition, not a parse failure.
    const result = parseInput(
      JSON.stringify({
        toolCalls: [{ name: 'call-a', args: { command: 'ls' } }],
        subagentSpawns: [],
        userMessages: [],
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('tolerates a legacy top-level fileChanges key as an unknown key (field removed)', () => {
    // A legacy IR carrying the old top-level key — even with a non-array value — parses
    // ok because the key is no longer part of the contract and no judge reads it. Catches
    // a leftover Array.isArray(fileChanges) check keeping a phantom field in the protocol.
    const result = parseInput(
      '{"toolCalls":[],"subagentSpawns":[],"userMessages":[],"fileChanges":"legacy"}',
    );

    expect(result.ok).toBe(true);
  });
});
