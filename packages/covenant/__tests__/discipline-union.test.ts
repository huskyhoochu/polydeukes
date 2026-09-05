import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// Discipline judging consumes file-change evidence from the NESTED position
// (toolCalls[n].fileChange). Evidence carrying a kind this host does not know — a stale
// adapter dist — must fail closed with a legible reason rather than a bare TypeError.
import { type JudgeDisciplineSpec, judgeDiscipline } from '../src/discipline.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

// Deleted files' pre contents deliberately CONTAIN forbidden matches: a judge that scans
// pre would wrongly break, and one that feeds delete into the added-delta path would throw.

const ROOT = '/repo';

const judgeOpts: Omit<JudgeDisciplineSpec, 'entry' | 'input'> = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
  readPreState,
};

describe('judgeDiscipline — unrecognized evidence kind (review round 1)', () => {
  it('throws a legible unjudgeable error instead of a bare TypeError', () => {
    // Evidence from a stale adapter dist has no `kind`; the judged body must fail closed
    // with a reason an operator can act on rather than a bare TypeError.
    const needsView = {
      id: 'needs-view',
      in: ['src/**'],
      when: '#[0-9a-f]{6}',
      requirePrecedent: { command: 'npm view ' },
    } as DisciplineEntry;
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

    expect(() => judgeDiscipline({ ...judgeOpts, entry: needsView, input: legacy })).toThrow(
      /unjudgeable evidence kind/,
    );
  });
});
