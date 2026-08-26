import { fileURLToPath } from 'node:url';
import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { type DisciplineJudgeOptions, judgeDiscipline } from '@polydeukes/covenant';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index.ts';

// The live root-config contract: this repository's own config, loaded for real through
// loadConfig and judged with covenant's judgeDiscipline.
//
// The defect this pins: `git push\b.*--force` matches `--force-with-lease` too, because
// `\b` before `-` is a word boundary. The recoverable spelling gets over-blocked, and an
// over-block pushes the daily workflow toward the witness valve.
//
// shellTools/commandArgs are the session composition root's vocabulary, injected here as
// fixture values.

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

describe('live root config — work-stays-recoverable flag boundary', () => {
  it('upholds git push --force-with-lease (the recoverable spelling)', () => {
    // --force-with-lease keeps the remote work recoverable, so it must not block. A
    // --force pattern without a flag boundary matches the lease form as a prefix.
    const verdict = judgeDiscipline(
      recoveryEntry(),
      bashInput('git push --force-with-lease'),
      judgeOpts,
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('breaks git push --force, naming the discipline id', () => {
    // The mirror direction: the boundary must not widen into a pass for the real
    // destructive spelling. Anchoring --force to end-of-string would kill the block this
    // entry exists for.
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
