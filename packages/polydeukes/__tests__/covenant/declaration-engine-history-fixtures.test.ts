import type { AlgebraDeclaration } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import type { World } from '../../src/covenant/declaration-engine.ts';
import { judge, loadDeclaration, witnessesOf } from './declaration-engine-helpers.ts';

// The three history-mechanism fixtures — phase order (`ordered` over spawn ordinals), turn
// locality (`userTexts → first → ageMs → filter lte`), stated ground (`userTexts` alone) —
// judged on this engine. Every fixture reads one transcript source named `session`, supplied
// inline as a snapshot; an absent key is the declaration's own `supply` policy's to dispose
// of. Tool names, the agent names, and the clock are the fixtures' values.

const SESSION = 'session';
const NOW = 1_700_000_000_000;
const AGENT_TOOL = 'Agent';
const SUBAGENT_ARG = 'subagent_type';
const WRITER = 'tdd-test-writer';
const IMPLEMENTER = 'tdd-implementer';

type Turn = { index: number; text: string; timestampMs?: number };
type Call = { index: number; name: string; args: Record<string, unknown>; succeeded?: boolean };

function turn(index: number, text: string, offsetMs?: number): Turn {
  return offsetMs === undefined ? { index, text } : { index, text, timestampMs: NOW + offsetMs };
}

function spawn(index: number, subagentType: string): Call {
  return { index, name: AGENT_TOOL, args: { [SUBAGENT_ARG]: subagentType } };
}

function world(userMessages: Turn[] = [], toolCalls: Call[] = []): World {
  return { [SESSION]: { observedAtMs: NOW, userMessages, toolCalls } };
}

describe('phase-order-writer-before-implementer · judge', () => {
  const decl = loadDeclaration('phase-order-writer-before-implementer');
  const ENTRY = 'writer-first';

  it('writer at index 2, implementer at index 5 → pass', () => {
    expect(judge(decl, world([], [spawn(2, WRITER), spawn(5, IMPLEMENTER)])).kind).toBe('pass');
  });

  it('implementer at index 1, writer at index 4 → broken, the implementer ordinal is the witness', () => {
    // The union is writers then implementers, so the sequence reads [4, 1]; `ordered`
    // names the later element of the pair that breaks monotony — key '1', value 1. A
    // relation that names the earlier one, or compares array positions instead of the
    // `index` values, answers differently here.
    const verdict = judge(decl, world([], [spawn(1, IMPLEMENTER), spawn(4, WRITER)]));
    expect(witnessesOf(verdict, ENTRY)).toEqual([{ key: '1', value: 1 }]);
  });

  it('a writer at index 4 and two implementers at 1 and 6 → broken on the first implementer', () => {
    // Each side is reduced to its first spawn, so the sequence is [4, 1]: the 1 breaks,
    // and the 6 is never compared — the question is whether the first implementer had a
    // writer before it.
    const verdict = judge(
      decl,
      world([], [spawn(1, IMPLEMENTER), spawn(4, WRITER), spawn(6, IMPLEMENTER)]),
    );
    expect(witnessesOf(verdict, ENTRY).map((w) => w.value)).toEqual([1]);
  });

  it('two interleaved cycles (writer, implementer, writer, implementer) → pass', () => {
    // Without `first` the union would read [1, 3, 2, 4] and the second cycle's writer
    // would break the order against the first cycle's implementer — a legal session
    // reported broken (review #90 finding 1).
    expect(
      judge(
        decl,
        world(
          [],
          [spawn(1, WRITER), spawn(2, IMPLEMENTER), spawn(3, WRITER), spawn(4, IMPLEMENTER)],
        ),
      ).kind,
    ).toBe('pass');
  });

  it('no implementer spawned → pass (the union is the writers alone)', () => {
    expect(judge(decl, world([], [spawn(2, WRITER), spawn(3, WRITER)])).kind).toBe('pass');
  });

  it('no writer spawned but an implementer → pass (nothing is out of order)', () => {
    // The declaration asks about ORDER, not presence — presence is the precedent
    // fixture's question. A relation that reads an empty writer side as a break turns
    // this into a second precedent covenant.
    expect(judge(decl, world([], [spawn(0, IMPLEMENTER)])).kind).toBe('pass');
  });

  it('the session absent → not-applicable by supply-pass, naming the source', () => {
    expect(judge(decl, {})).toEqual({
      kind: 'not-applicable',
      reason: 'supply-pass',
      source: SESSION,
    });
  });
});

describe('turn-locality-fresh-permission · judge', () => {
  const decl = loadDeclaration('turn-locality-fresh-permission');

  it('a /allow force turn one minute old → pass', () => {
    expect(judge(decl, world([turn(0, '/allow force this once', -60_000)])).kind).toBe('pass');
  });

  it('exactly ten minutes old → pass (the bound is inclusive)', () => {
    expect(judge(decl, world([turn(0, '/allow force', -600_000)])).kind).toBe('pass');
  });

  it('eleven minutes old → broken', () => {
    expect(judge(decl, world([turn(0, '/allow force', -11 * 60_000)])).kind).toBe('broken');
  });

  it('a turn without a timestamp → broken (not fresh)', () => {
    expect(judge(decl, world([turn(0, '/allow force')])).kind).toBe('broken');
  });

  it('the first matching turn decides — an expired first and a fresh second → broken', () => {
    // `first` takes the earliest match; a step taking the latest, or `filter` running
    // before `first`, would pass this session on the second turn.
    const turns = [turn(0, '/allow force', -20 * 60_000), turn(1, '/allow force again', -1_000)];
    expect(judge(decl, world(turns)).kind).toBe('broken');
  });

  it('the session absent → not-applicable by supply-pass', () => {
    expect(judge(decl, {})).toMatchObject({ kind: 'not-applicable', reason: 'supply-pass' });
  });
});

describe('stated-ground-plan-before-edit · judge', () => {
  const decl = loadDeclaration('stated-ground-plan-before-edit');

  it('a turn starting with /plan → pass, whatever its age', () => {
    // No freshness here: the ground was stated, and an untimed turn counts.
    expect(judge(decl, world([turn(0, '/plan: split the module')])).kind).toBe('pass');
  });

  it('/plan mid-sentence only → broken (the expression is anchored at the turn start)', () => {
    expect(judge(decl, world([turn(0, 'we could /plan later', -1_000)])).kind).toBe('broken');
  });

  it('a session with no user turn → broken', () => {
    expect(judge(decl, world()).kind).toBe('broken');
  });

  it('the session absent → supply-error naming the source (supply: error)', () => {
    // This fixture refuses absence: a `pass` here would let every commit through unjudged.
    expect(judge(decl, {})).toMatchObject({ kind: 'supply-error', source: SESSION });
  });
});

describe('no merge after the last edit · judge', () => {
  // "The calls after the last successful edit carry no merge" — the same fact as "every
  // merge is followed by an edit". The boundary is the tool name (an edit is any successful
  // call that is not the shell), and whether a shell call is a merge is decided after the
  // cut. `scoped-valve` is the one mechanism admitting `empty` over the history axis; its
  // valve relates the same check, so it never opens the verdict.
  const SHELL = 'Bash';
  const EDITORS = ['Edit', 'Write', 'NotebookEdit'];
  const MERGES = 'mergesSinceEdit';
  const ENTRY = 'no-merge-since-edit';
  const decl: AlgebraDeclaration = {
    discipline: 'no-merge-after-last-edit',
    mechanism: 'scoped-valve',
    sources: { [SESSION]: { transcript: true } },
    supply: { [SESSION]: 'pass' },
    extract: {
      [MERGES]: [
        { op: 'source', of: SESSION },
        { op: 'toolUses', names: [SHELL, ...EDITORS] },
        { op: 'filter', when: [{ field: 'succeeded', eq: true }] },
        { op: 'afterLast', when: [{ field: 'name', ne: SHELL }] },
        { op: 'select', path: 'args.command' },
        { op: 'matches', re: '\\bgit\\s+(cherry-pick|merge|pull)\\b' },
      ],
    },
    relate: [{ id: ENTRY, relation: { op: 'empty', of: MERGES }, message: 'm' }],
    witness: {
      relate: [{ id: `${ENTRY}-valve`, relation: { op: 'empty', of: MERGES }, message: 'w' }],
    },
  };

  function shell(index: number, command: string): Call {
    return { index, name: SHELL, args: { command }, succeeded: true };
  }
  function edit(index: number): Call {
    return { index, name: EDITORS[0], args: { file_path: 'a.ts' }, succeeded: true };
  }

  it('a merge, then a test run with no edit between → broken on the merge', () => {
    // The incident this declaration exists for: a `cargo test` right after a cherry-pick.
    // A step that answers `[]` when nothing is admitted drops this session from judgment.
    const verdict = judge(
      decl,
      world([], [shell(0, 'git cherry-pick main..x'), shell(1, 'cargo test')]),
    );
    expect(witnessesOf(verdict, ENTRY)).toEqual([{ key: '0', value: 'git cherry-pick main..x' }]);
  });

  it('a merge followed by an edit → pass', () => {
    expect(judge(decl, world([], [shell(0, 'git merge x'), edit(1)])).kind).toBe('pass');
  });

  it('edit, merge, edit, merge → broken on the last merge only', () => {
    // A cut at the FIRST edit keeps both merges. The witness sits at output position 0 but
    // carries ordinal '3', so a key renumbered by the cut or by `select` reads differently.
    const calls = [edit(0), shell(1, 'git merge a'), edit(2), shell(3, 'git merge b')];
    expect(witnessesOf(judge(decl, world([], calls)), ENTRY)).toEqual([
      { key: '3', value: 'git merge b' },
    ]);
  });
});

describe('at most three test runs after the last edit · judge', () => {
  // "At most three" is "after dropping the first three, nothing is left": the runs past the
  // bound are the witnesses. Every call is cut at the last edit, so a run before it never
  // counts. `scoped-valve` admits `empty` over the history axis, and its valve relates the
  // same check, so it never opens the verdict.
  const SHELL = 'Bash';
  const EDITORS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
  const RUNS = 'testRunsSinceEdit';
  const ENTRY = 'at-most-three-runs';
  const decl: AlgebraDeclaration = {
    discipline: 'test-runs-per-edit',
    mechanism: 'scoped-valve',
    sources: { [SESSION]: { transcript: true } },
    supply: { [SESSION]: 'pass' },
    extract: {
      [RUNS]: [
        { op: 'source', of: SESSION },
        { op: 'toolUses', names: [SHELL, ...EDITORS] },
        {
          op: 'afterLast',
          when: [
            { field: 'name', ne: SHELL },
            { field: 'succeeded', eq: true },
          ],
        },
        { op: 'select', path: 'args.command' },
        { op: 'matches', re: '\\bcargo\\s+(test|nextest)\\b' },
        { op: 'drop', n: 3 },
      ],
    },
    relate: [{ id: ENTRY, relation: { op: 'empty', of: RUNS }, message: 'm' }],
    witness: {
      relate: [{ id: `${ENTRY}-valve`, relation: { op: 'empty', of: RUNS }, message: 'w' }],
    },
  };

  function run(index: number, crate: string): Call {
    return { index, name: SHELL, args: { command: `cargo test -p ${crate}` } };
  }
  function edit(index: number): Call {
    return { index, name: EDITORS[0], args: { file_path: 'a.rs' }, succeeded: true };
  }

  it('an edit, then three runs → pass', () => {
    // Three runs are within the bound; dropping one too few breaks here.
    const calls = [edit(2), run(4, 'a'), run(7, 'b'), run(9, 'c')];
    expect(judge(decl, world([], calls)).kind).toBe('pass');
  });

  it('an edit, then five runs → broken, the fourth and fifth runs are the witnesses', () => {
    // The witnesses carry the call ordinals 11 and 15, not their positions after the cut
    // (3, 4) or after the drop (0, 1), so a renumbering step reads differently; keeping the
    // first runs instead of the last names the crates a and b.
    const calls = [edit(2), run(4, 'a'), run(7, 'b'), run(9, 'c'), run(11, 'd'), run(15, 'e')];
    expect(witnessesOf(judge(decl, world([], calls)), ENTRY)).toEqual([
      { key: '11', value: 'cargo test -p d' },
      { key: '15', value: 'cargo test -p e' },
    ]);
  });

  it('four runs, an edit, two runs → pass', () => {
    // The runs before the edit are cut away; a count over the whole session breaks here.
    const calls = [
      run(1, 'a'),
      run(3, 'b'),
      run(5, 'c'),
      run(6, 'd'),
      edit(8),
      run(10, 'e'),
      run(12, 'f'),
    ];
    expect(judge(decl, world([], calls)).kind).toBe('pass');
  });
});
