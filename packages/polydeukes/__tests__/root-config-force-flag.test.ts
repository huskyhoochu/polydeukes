import { fileURLToPath } from 'node:url';
import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { type DisciplineJudgeOptions, judgeDiscipline } from '@polydeukes/covenant';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// CONFIG-09 AC-2 — live root-config contract: the repo's own config, loaded for
// real through loadConfig, judged with covenant's judgeDiscipline. The measured
// defect (`covenant.prd.execution-evidence.md` §4.6): `git push\b.*--force`
// matches `--force-with-lease` too, because `\b` before `-` is a word boundary —
// the recoverable spelling gets over-blocked, and an over-block pushes the daily
// workflow toward the witness valve.
//
// shellTools/commandArgs are the session composition root's vocabulary, injected
// here as fixture values (SHELL_TOOLS ['Bash'] / COMMAND_ARGS ['command']).
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const judgeOpts: DisciplineJudgeOptions = {
  rootDir: REPO_ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
};

const { config } = loadConfig(REPO_ROOT);

/** The live entry under test — throws loud if the config no longer carries it. */
function recoveryEntry(): DisciplineEntry {
  const entry = config.disciplines?.find((d) => d.id === 'work-stays-recoverable');
  if (entry === undefined) {
    throw new Error('work-stays-recoverable is missing from the live root config');
  }
  return entry;
}

/** Build a CovenantInput carrying one Bash tool call with the given command. */
function bashInput(command: string): CovenantInput {
  return { toolCalls: [{ name: 'Bash', args: { command } }], subagentSpawns: [], userMessages: [] };
}

describe('live root config — work-stays-recoverable flag boundary (CONFIG-09 AC-2)', () => {
  it('upholds git push --force-with-lease (the recoverable spelling)', () => {
    // P0 (AC-2): --force-with-lease keeps the remote work recoverable — blocking it is
    // the measured over-block this ticket removes. Mutation caught: a --force pattern
    // without a flag boundary (the live `git push\b.*--force` spelling matches the
    // lease form as a prefix).
    const verdict = judgeDiscipline(
      recoveryEntry(),
      bashInput('git push --force-with-lease'),
      judgeOpts,
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('breaks git push --force, naming the discipline id', () => {
    // P0 mirror direction: the boundary must not widen into a pass for the real
    // destructive spelling. Mutation caught: an over-narrow boundary (e.g. anchoring
    // --force to end-of-string) that kills the block this entry exists for.
    const bare = judgeDiscipline(recoveryEntry(), bashInput('git push --force'), judgeOpts);
    expect(bare.upheld).toBe(false);
    if (bare.upheld === false) {
      expect(bare.reason).toContain('work-stays-recoverable');
    }

    // The flag followed by more arguments must still break (kills a $-anchored mutant).
    const withArgs = judgeDiscipline(
      recoveryEntry(),
      bashInput('git push --force origin main'),
      judgeOpts,
    );
    expect(withArgs.upheld).toBe(false);
  });
});
