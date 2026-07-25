import { describe, expect, it } from 'vitest';
// CORE-06 §4.1 / AC 1–2 — `FileChange` becomes a discriminated union (create/modify/delete)
// and evidence moves INTO its own tool-call element (singular `fileChange?`). The top-level
// `fileChanges` home is removed; `allFileChanges` is the one flat traversal for consumers
// that need no attribution. `allFileChanges` does not exist yet, so this file is RED by
// construction (the named import fails at module load), and the union shape does not exist
// yet either (the type anchors below are unused until GREEN).
import { allFileChanges, type CovenantInput, type FileChange, parseInput } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — one evidence per union kind. Contents are distinctive on purpose:
// exact-equality assertions catch a field swap or a dropped baseline, which an
// inert 'x' fixture would let through.
// ---------------------------------------------------------------------------

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

// ===========================================================================
// AC 1 — type locks: impossible states are unrepresentable. Each anchor sits on
// the offending PROPERTY line (TS anchors excess-property errors there; the
// opening-brace line is the known trap — core dev-log ts-expect-error-cast-anchor).
// ===========================================================================

describe('FileChange union — type locks (AC 1)', () => {
  it('rejects a delete variant carrying a post', () => {
    // Mutation caught: the delete variant widened to carry post (a deletion with
    // "resulting content" is the sentinel shape this union exists to outlaw).
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
    // Mutation caught: the create variant widened to carry pre (a creation with a
    // baseline would let a judge forgive brand-new content as debt).
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
    // Mutation caught: the removed top-level home resurrected as an optional field —
    // two homes reintroduce the sibling-amnesty ambiguity this ticket closes.
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

// ===========================================================================
// AC 2 — attribution is structural: evidence rides its own call element through
// serialization, and allFileChanges is the flat traversal.
// ===========================================================================

describe('CovenantInput — call-nested evidence attribution (AC 2)', () => {
  it('preserves nesting through a JSON round-trip: evidence stays on its own call only', () => {
    // P0 attribution: with two calls and evidence only on the second, the round-tripped
    // IR must show the evidence on call B and NOTHING on call A. Mutation caught: a
    // parse/serialize step hoisting evidence to a shared home (sibling amnesty), or
    // rewriting the delete evidence's pre baseline.
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
    // P0 traversal contract: [create, none, delete] calls yield [create, delete] in that
    // order. Mutation caught: order reversed, an evidence-less call aborting the walk
    // (delete after the gap dropped), or only the first evidence returned.
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

// ===========================================================================
// AC 2 / §4.1 — parseInput after the field removal: fail-closed axis unchanged,
// legacy inputs tolerated (element shapes stay unvalidated — the CORE-01 boundary).
// ===========================================================================

describe('parseInput — fail-closed axis unchanged after the field removal (§4.1)', () => {
  it('still fails closed with exit 2 when a required collection is missing', () => {
    // P0 regression pin: deleting the top-level fileChanges check must not take the
    // collection-existence checks with it. Mutation caught: the toolCalls presence
    // check dropped alongside the removed field's validation.
    const result = parseInput(JSON.stringify({ subagentSpawns: [], userMessages: [] }));

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });

  it('parses an evidence-less input ok (legacy shape tolerance)', () => {
    // P0 tolerance: an IR with no fileChange anywhere is a valid input — absence means
    // "these calls are unproven", a judging disposition, not a parse failure. Mutation
    // caught: GREEN making nested evidence mandatory at parse time.
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
    // P1 removal pin (§4.1: "the array check is deleted; unknown-key tolerance stays"):
    // a legacy IR carrying the old top-level key — even a non-array value — parses ok
    // because the key is no longer part of the contract; the judges just never read it.
    // Mutation caught: the old Array.isArray(fileChanges) validation left behind,
    // keeping a phantom field in the protocol. This flips today's exit-2 behaviour.
    const result = parseInput(
      '{"toolCalls":[],"subagentSpawns":[],"userMessages":[],"fileChanges":"legacy"}',
    );

    expect(result.ok).toBe(true);
  });
});
