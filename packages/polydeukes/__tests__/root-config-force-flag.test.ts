import { fileURLToPath } from 'node:url';
import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { compileDisciplineRegistrations } from '@polydeukes/covenant';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/load-config.ts';
import { sessionPreStateReader } from '../src/pre-state-reader.ts';

// The live root-config contract: this repository's own config, loaded for real through
// loadConfig and judged the way the session composition root judges it — the entry is
// compiled into a registration and that registration's own body decides the call.
//
// The entry is scoped on `command`, so every shell call is admitted and the VERDICT is what
// separates the spellings: routing says the declaration looked at the call, the body says
// what it decided. Reading admission as the answer would report a break for every command.
//
// The defect this pins: `git push\b.*--force` matches `--force-with-lease` too, because
// `\b` before `-` is a word boundary. The recoverable spelling gets over-blocked, and an
// over-block pushes the daily workflow toward the witness valve.
//
// shellTools/commandArgs and the pre-state reader are the session composition root's own
// values, injected here as the root injects them.

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const { config } = loadConfig({ rootDir: REPO_ROOT });

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

/** The entry compiled the way the session composition root compiles it. */
function registration() {
  const [compiled] = compileDisciplineRegistrations({
    disciplines: [recoveryEntry()],
    rootDir: REPO_ROOT,
    shellTools: ['Bash'],
    commandArgs: ['command'],
    readPreState: sessionPreStateReader,
  });
  if (compiled === undefined) {
    throw new Error('the live entry compiled to no registration');
  }
  return compiled;
}

/** Judge one command through the compiled registration's own body. */
async function judge(command: string): Promise<{ exitCode: number; reason?: string }> {
  const outcome = await registration().body?.(bashInput(command));
  if (outcome === undefined) {
    throw new Error(`the compiled registration produced no outcome for: ${command}`);
  }
  return outcome;
}

describe('live root config — work-stays-recoverable flag boundary', () => {
  it('upholds git push --force-with-lease (the recoverable spelling)', async () => {
    // --force-with-lease keeps the remote work recoverable, so this discipline must let it
    // through. A --force pattern without a flag boundary matches the lease form as a prefix,
    // and that over-block pushes the daily workflow toward the witness valve.
    expect((await judge('git push --force-with-lease')).exitCode).toBe(0);
  });

  it('breaks git push --force, naming the discipline id', async () => {
    // The mirror direction: the boundary must not widen into a pass for the real
    // destructive spelling. Anchoring --force to end-of-string would kill the block this
    // entry exists for.
    const bare = await judge('git push --force');
    expect(bare.exitCode).not.toBe(0);
    expect(bare.reason).toContain('work-stays-recoverable');

    // The flag followed by more arguments must still break (kills a $-anchored mutant).
    const withArgs = await judge('git push --force origin main');
    expect(withArgs.exitCode).not.toBe(0);
  });
});
