import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// Discipline judging consumes file-change evidence from the NESTED position
// (toolCalls[n].fileChange): the delta family short-circuits delete to uphold (deletion adds
// no content) and immutable breaks on kind !== 'create' (an immutable file can be neither
// modified nor deleted).
import {
  compileDisciplineRegistrations,
  type DisciplineJudgeOptions,
  judgeDiscipline,
} from '../src/discipline.ts';

// Deleted files' pre contents deliberately CONTAIN forbidden matches: a judge that scans
// pre would wrongly break, and one that feeds delete into the added-delta path would throw.

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

describe('judgeDiscipline — forbid {added} delete semantics (AC 5)', () => {
  const forbidHex: DisciplineEntry = {
    id: 'no-hex',
    in: ['src/**'],
    forbid: { added: '#[0-9a-f]{6}' },
  };

  it('upholds a delete whose pre is FULL of forbidden matches (deletion adds nothing)', () => {
    // The deleted file's baseline carries two matches, yet deletion cannot add content, so
    // the added-direction verdict is uphold. A pass-through of {pre, post: ''} also upholds
    // — the short-circuit's existence is pinned by the default-less switch at compile time,
    // not by this runtime test.
    const input = inputWithEvidence([
      { kind: 'delete', path: 'src/legacy.css', pre: 'a: #123456;\nb: #abcdef;' },
    ]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('breaks a create (nested evidence) whose post carries a match — regression pairing', () => {
    // Paired with the short-circuit above: a create with a matching post must still break,
    // proving the judge actually reads the nested evidence rather than upholding blanket.
    const input = inputWithEvidence([{ kind: 'create', path: 'src/new.css', post: 'b: #123456;' }]);

    const verdict = judgeDiscipline(forbidHex, input, judgeOpts);

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('no-hex');
      expect(verdict.reason).toContain('#123456');
    }
  });

  it('breaks a modify (nested evidence) that adds a new match over a clean pre', () => {
    // {pre, post} must reach the added-delta judgment the right way round: swapped, the new
    // match lands in the forgiven baseline and the edit sails through.
    const input = inputWithEvidence([
      { kind: 'modify', path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    expect(judgeDiscipline(forbidHex, input, judgeOpts).upheld).toBe(false);
  });
});

describe('judgeDiscipline — immutable delete judgment (AC 6)', () => {
  const immutable: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };

  it('breaks a delete of an immutable-matched file, naming id and path (the fail-open hole)', () => {
    // The break condition is kind !== 'create', never a modify-only (pre-based) test: the
    // latter reopens the deletion channel around the whole family.
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
    // The modify break must survive the kind formulation as well as the pre-based one.
    const input = inputWithEvidence([
      { kind: 'modify', path: 'config/a.lock', pre: 'old', post: 'new' },
    ]);

    expect(judgeDiscipline(immutable, input, judgeOpts).upheld).toBe(false);
  });

  it('still upholds creation of an immutable-matched file', () => {
    // kind === 'create' is the ONE allowed kind: widened to a blanket break on any
    // evidence, the immutable file could never be created in the first place.
    const input = inputWithEvidence([{ kind: 'create', path: 'config/a.lock', post: 'seed' }]);

    expect(judgeDiscipline(immutable, input, judgeOpts)).toEqual({ upheld: true });
  });

  it('breaks a delete of an immutable-matched binary file — evidence without a pre baseline', () => {
    // A binary HEAD blob leaves delete.pre absent, and the judgment must not care —
    // immutable reads path and kind only. Requiring pre lets a binary deletion uphold.
    const input = inputWithEvidence([{ kind: 'delete', path: 'config/a.lock' }]);

    expect(judgeDiscipline(immutable, input, judgeOpts).upheld).toBe(false);
  });
});

describe('judgeDiscipline — unrecognized evidence kind (review round 1)', () => {
  it('throws a legible unjudgeable error instead of a bare TypeError', () => {
    // Evidence from a stale adapter dist has no `kind`; the judged body must fail closed
    // with a reason an operator can act on rather than a bare TypeError.
    const forbidHex: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
    const legacy = {
      toolCalls: [
        {
          name: 'call-0',
          args: { file_path: 'src/a.css' },
          fileChange: { path: 'src/a.css', pre: 'a', post: 'b' },
        },
      ],
      subagentSpawns: [],
      userMessages: [],
    } as unknown as CovenantInput;

    expect(() => judgeDiscipline(forbidHex, legacy, judgeOpts)).toThrow(
      /unjudgeable evidence kind/,
    );
  });
});

describe('forbid routing — deletions never spawn a body (review round 1)', () => {
  function compileOne(entry: DisciplineEntry) {
    const [reg] = compileDisciplineRegistrations({
      disciplines: [entry],
      rootDir: ROOT,
      shellTools: ['Bash'],
      commandArgs: ['command'],
    });
    return reg;
  }

  it('forbid matches returns null for a delete-only input (no spawn waste, no telemetry noise)', () => {
    // A deletion cannot break the added direction, so routing it runs a judge that can only
    // uphold — one per discipline per file on a delete-heavy commit.
    const forbidHex: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
    const reg = compileOne(forbidHex);
    const input = inputWithEvidence([
      { kind: 'delete', path: 'src/legacy.css', pre: 'a: #123456;' },
    ]);

    expect(reg.matches?.(input)).toBeNull();
  });

  it('immutable matches still routes a delete-only input (that family judges deletions)', () => {
    // The delete filter belongs to forbid ONLY: over-extended to immutable routing, an
    // immutable deletion would never reach a judge at all.
    const immutable: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };
    const reg = compileOne(immutable);
    const input = inputWithEvidence([{ kind: 'delete', path: 'config/a.lock', pre: 'locked' }]);

    expect(reg.matches?.(input)).toBe('config/a.lock');
  });
});
