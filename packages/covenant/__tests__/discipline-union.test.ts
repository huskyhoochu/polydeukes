import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// CORE-06 §4.3 / AC 5–6 — discipline judging consumes the union from the NESTED
// position (toolCalls[n].fileChange): the delta family short-circuits delete to uphold
// (deletion adds no content) and immutable breaks on kind !== 'create' (an immutable
// file can be neither modified nor deleted). Today delete evidence cannot even be
// expressed and the judge reads the removed top-level array, so this file is RED by
// construction — AC 6 in particular demonstrates the live fail-open hole.
import { type DisciplineJudgeOptions, judgeDiscipline } from '../src/discipline.ts';

// ---------------------------------------------------------------------------
// Fixtures. Evidence is ALWAYS nested on its own tool-call element — the only
// home the contract leaves. Deleted files' pre contents deliberately CONTAIN
// forbidden matches (breaking direction: a judge that scans pre would wrongly
// break; one that feeds delete into the added-delta path would throw).
// ---------------------------------------------------------------------------

const ROOT = '/repo';

const judgeOpts: DisciplineJudgeOptions = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
};

/** Build a CovenantInput whose evidence rides its own tool-call element. */
function inputWithEvidence(changes: FileChange[]): CovenantInput {
  return {
    toolCalls: changes.map((fileChange, index) => ({
      name: `call-${index}`,
      args: { file_path: fileChange.path },
      fileChange,
    })),
    subagentSpawns: [],
    userMessages: [],
  };
}

// ===========================================================================
// AC 5 — delta family `forbid: {added}` over the union
// ===========================================================================

describe('judgeDiscipline — forbid {added} delete semantics (AC 5)', () => {
  const forbidHex: DisciplineEntry = {
    id: 'no-hex',
    in: ['src/**'],
    forbid: { added: '#[0-9a-f]{6}' },
  };

  it('upholds a delete whose pre is FULL of forbidden matches (deletion adds nothing)', () => {
    // P1 delete-arm misroute pin: the deleted file's baseline carries two matches, yet
    // deletion cannot add content, so the added-direction verdict is uphold. Mutations
    // caught: the delete arm feeding pre as post into the added delta (would break), or
    // an undefined post reaching captureBaseline (would throw). NOTE: a pass-through of
    // {pre, post: ''} also upholds — the short-circuit's existence is pinned by the
    // default-less switch at compile time, not by this runtime test.
    const input = inputWithEvidence([
      { kind: 'delete', path: 'src/legacy.css', pre: 'a: #123456;\nb: #abcdef;' },
    ]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('breaks a create (nested evidence) whose post carries a match — regression pairing', () => {
    // P0 pairing for the short-circuit: a create with a matching post must still break,
    // proving the judge actually reads the NESTED evidence. Mutation caught: the delete
    // short-circuit over-reaching to every kind, or the judge still reading the removed
    // top-level array and seeing no evidence at all (blanket uphold).
    const input = inputWithEvidence([{ kind: 'create', path: 'src/new.css', post: 'b: #123456;' }]);

    const verdict = judgeDiscipline(forbidHex, input, judgeOpts);

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('no-hex');
      expect(verdict.reason).toContain('#123456');
    }
  });

  it('breaks a modify (nested evidence) that adds a new match over a clean pre', () => {
    // P0 modify arm mapping: {pre, post} must reach the added-delta judgment the right
    // way round. Mutation caught: pre/post swapped in the modify arm (the new match
    // would land in the forgiven baseline and the edit would sail through).
    const input = inputWithEvidence([
      { kind: 'modify', path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts).upheld).toBe(false);
  });
});

// ===========================================================================
// AC 6 — immutable over the union: deletion joins the judgment (the hole closes)
// ===========================================================================

describe('judgeDiscipline — immutable delete judgment (AC 6)', () => {
  const immutable: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };

  it('breaks a delete of an immutable-matched file, naming id and path (the fail-open hole)', () => {
    // P0 money test, breaking direction: today deletion produces no evidence at all, so
    // deleting an immutable file UPHOLDS — this RED run must show that hole live.
    // Mutation caught: the break condition written modify-only (pre-based) instead of
    // kind !== 'create', reopening the deletion channel.
    const input = inputWithEvidence([
      { kind: 'delete', path: 'config/a.lock', pre: 'locked = true' },
    ]);

    const verdict = judgeDiscipline(immutable, input, judgeOpts);

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('lockfile');
      expect(verdict.reason).toContain('config/a.lock');
    }
  });

  it('still breaks a modify of an immutable-matched file (nested evidence)', () => {
    // P0 regression on the new seam: the modify break must survive the move from the
    // pre !== null formulation to the kind formulation AND the move to nested evidence.
    // Mutation caught: the immutable judge left reading the removed top-level array.
    const input = inputWithEvidence([
      { kind: 'modify', path: 'config/a.lock', pre: 'old', post: 'new' },
    ]);

    expect(judgeDiscipline(immutable, input, judgeOpts).upheld).toBe(false);
  });

  it('still upholds creation of an immutable-matched file', () => {
    // P0 across-boundary partner: kind === 'create' is the ONE allowed kind — first
    // authoring must pass. Mutation caught: kind !== 'create' widened to a blanket
    // break on any evidence (would block ever creating the immutable file).
    const input = inputWithEvidence([{ kind: 'create', path: 'config/a.lock', post: 'seed' }]);

    expect(judgeDiscipline(immutable, input, judgeOpts)).toEqual({ upheld: true });
  });
});
