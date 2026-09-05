import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// A declare entry bound to the spawn sidecar: `sources: { <name>: { sidecar: true } }`. The
// declare judgment path fills that name from `world.channels.sidecar` — the spawn-record
// list as JSON text. A channel is never a path, so the change-set overlap rule (`post`
// wins) does not apply; absence (no `channels.sidecar` key) is the declaration's own
// `supply` policy's to dispose of, and the empty list text `'[]'` is NOT absence — it is a
// session that observed no spawn.
//
// The engine's value model keys a parsed JSON array as ONE item, and `field`/`filter` drop
// values that are not plain objects, so a per-record pipeline over the parsed list is not
// expressible in the registered vocabulary. The fixture therefore matches the raw channel
// text (`source → matches`), which reaches the same verdicts: a matching record upholds,
// a non-matching list or the empty list breaks, absence falls to the supply policy.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import { inputWithArgs } from './helpers.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const ID = 'writer-precedent';
const ENTRY = 'has-writer';
// Source names, agent names, and channel texts are fixture values.
const SPAWNS = 'spawns';
const TARGET_AGENT = 'tdd-test-writer';
const OTHER_AGENT = 'code-reviewer';
const TARGET_FILE = 'packages/core/src/a.ts';
const WRITER_SPAWNED = `[{"agentType":"${TARGET_AGENT}","toolUseId":"t1"}]`;
const OTHER_SPAWNED = `[{"agentType":"${OTHER_AGENT}","toolUseId":"t2"}]`;
const NO_SPAWNS = '[]';
const CREATE_TARGET: FileChange = { kind: 'create', path: TARGET_FILE, post: 'export {};\n' };

/** Reads the spawn channel and holds when a record of the target agent is on it. */
const READS_SPAWNS = {
  sources: { [SPAWNS]: { sidecar: true } },
  supply: { [SPAWNS]: 'error' },
  extract: {
    writers: [
      { op: 'source', of: SPAWNS },
      { op: 'matches', re: `"agentType":"${TARGET_AGENT}"` },
    ],
  },
  relate: [
    {
      id: ENTRY,
      relation: { op: 'nonEmpty', of: 'writers' },
      message: 'no writer spawn on record',
    },
  ],
};

/** A declare entry; extra head keys ride along. */
function declareEntry(declare: Record<string, unknown>) {
  return { id: ID, declare } as unknown as DisciplineEntry;
}

function specWith(disciplines: DisciplineEntry[]): CompileDisciplinesSpec {
  return {
    disciplines,
    rootDir: ROOT,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState,
  };
}

/** A CovenantInput of one create, with an optional world axis (channels included). */
function inputOf(
  world?: Record<string, unknown>,
  target: FileChange = CREATE_TARGET,
): CovenantInput {
  return {
    toolCalls: [{ name: 'call-0', args: { file_path: target.path }, fileChange: target }],
    subagentSpawns: [],
    userMessages: [],
    ...(world !== undefined && { world }),
  } as CovenantInput;
}

/** Compile the entry and return its body registration; a missing one fails loudly. */
function compileBody(entry: DisciplineEntry): CovenantRegistration {
  const reg = compileDisciplineRegistrations(specWith([entry])).find(
    (candidate) => candidate.label === entry.id && candidate.skip === undefined,
  );
  if (reg === undefined) throw new Error(`no body registration compiled for ${entry.id}`);
  return reg;
}

/** Run a registration's body; a skip registration has none and that is the failure. */
async function judgeWith(reg: CovenantRegistration, input: CovenantInput) {
  if (reg.body === undefined) throw new Error(`registration ${reg.label} carries no body`);
  return (await reg.body(input)) as {
    exitCode: number;
    reason?: string;
    witnesses?: readonly {
      id: string;
      witnesses: readonly { key: string; value: unknown }[];
    }[];
  };
}

function spyStderr() {
  return vi.spyOn(process.stderr, 'write').mockReturnValue(true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('compileDisciplineRegistrations — a sidecar binding rides the registration by kind', () => {
  it('lists the binding as { name, sidecar: true }, never as a file', () => {
    // The registration is the plan's only input: a compiler that coerces the binding into
    // the file shape (`{ name, file: undefined }`) makes the plan read a path nobody named
    // and never plan the channel, so every session judges the declaration absent-sourced.
    const reg = compileBody(declareEntry(READS_SPAWNS));

    expect(reg.sources).toEqual([{ name: SPAWNS, sidecar: true }]);
  });
});

describe('the declare body — the sidecar source reads world.channels.sidecar', () => {
  it('upholds when the channel text carries a record of the target agent', async () => {
    // The happy path proves the channel VALUE was merged, not merely its key: a merge that
    // fills the name with '' (or the wrong channel) leaves `matches` empty and breaks a
    // session that did spawn the writer.
    const reg = compileBody(declareEntry(READS_SPAWNS));

    const outcome = await judgeWith(reg, inputOf({ channels: { sidecar: WRITER_SPAWNED } }));

    expect(outcome.exitCode).toBe(0);
  });

  it('breaks with one witness when only another agent was spawned', async () => {
    // The control for the test above: a body that answers 0 whenever the channel KEY is
    // present passes both fixtures, so only the pair proves the text was judged. The break
    // must carry a witness — an empty witness list renders no message and gives the valve
    // nothing to open on.
    const reg = compileBody(declareEntry(READS_SPAWNS));

    const outcome = await judgeWith(reg, inputOf({ channels: { sidecar: OTHER_SPAWNED } }));

    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toContain(`discipline '${ID}' broken on ${TARGET_FILE}`);
    expect(outcome.witnesses?.[0]?.witnesses).toEqual([{ key: 'writers', value: null }]);
  });

  it('breaks on the empty list text — a channel that observed no spawn is not an absent channel', async () => {
    // `'[]'` and a missing key are different facts: folding the empty text into absence
    // hands the verdict to the supply policy, and under `pass` a session that provably
    // spawned nothing would skip a judgment it should have failed.
    const reg = compileBody(declareEntry(READS_SPAWNS));

    const outcome = await judgeWith(reg, inputOf({ channels: { sidecar: NO_SPAWNS } }));

    expect(outcome.exitCode).toBe(1);
  });

  it('with no channel supplied, supply: error exits 2 and names the source on stderr', async () => {
    // The commit surface injects no channel reader, so this is every commit's disposition
    // of the entry: `2` is the unjudgeable row, never a fabricated `'[]'` that would break
    // (or a fabricated match that would pass) a session nobody observed.
    const reg = compileBody(declareEntry(READS_SPAWNS));
    const stderr = spyStderr();

    const outcome = await judgeWith(reg, inputOf());

    expect(outcome.exitCode).toBe(2);
    const lines = stderr.mock.calls.map((call) => String(call[0])).filter((s) => s.includes(ID));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(SPAWNS);
  });

  it('with no channel supplied, supply: pass exits 0', async () => {
    // The author's escape hatch must reach the sidecar kind like the file kind; a merge
    // that consults the policy for file bindings alone keeps every channel-less surface
    // refused.
    const reg = compileBody(declareEntry({ ...READS_SPAWNS, supply: { [SPAWNS]: 'pass' } }));

    expect((await judgeWith(reg, inputOf())).exitCode).toBe(0);
  });

  it('a world with files but no channels key is still channel absence', async () => {
    // Absence is the missing KEY, per axis: a merge that reads "world present" as "channel
    // present" feeds the extract an `undefined` the supply policy never sees.
    spyStderr();
    const reg = compileBody(declareEntry(READS_SPAWNS));

    const outcome = await judgeWith(reg, inputOf({ files: { 'locales/en.json': '{}' } }));

    expect(outcome.exitCode).toBe(2);
  });
});

describe('the declare body — a mixed declaration reads each binding from its own axis', () => {
  const EN = 'en';
  const EN_FILE = 'locales/en.json';
  /** One file binding and one channel binding in a single declaration, both `error`. */
  const MIXED = {
    sources: { [EN]: { file: EN_FILE }, [SPAWNS]: { sidecar: true } },
    supply: { [EN]: 'error', [SPAWNS]: 'error' },
    extract: {
      enKeys: [{ op: 'source', of: EN }, { op: 'json' }, { op: 'flattenKeys' }],
      writers: [
        { op: 'source', of: SPAWNS },
        { op: 'matches', re: `"agentType":"${TARGET_AGENT}"` },
      ],
    },
    relate: [
      { id: 'has-keys', relation: { op: 'nonEmpty', of: 'enKeys' }, message: 'm' },
      {
        id: ENTRY,
        relation: { op: 'nonEmpty', of: 'writers' },
        message: 'no writer spawn on record',
      },
    ],
  };

  it('the file from world.files, the channel from world.channels — the post-override rule never touches a channel name', async () => {
    // The change's path is deliberately the CHANNEL BINDING's name, and its post matches
    // no writer pattern: a merge that treats the sidecar binding as a path lets that post
    // override the channel text and breaks a session that spawned the writer. One that
    // drops the file side refuses with 2 under `error`. Only the two-axis merge — `en`
    // from world.files (outside the change set), `spawns` from world.channels — upholds.
    const reg = compileBody(declareEntry(MIXED));
    const input = inputOf(
      { files: { [EN_FILE]: '{"a":1}' }, channels: { sidecar: WRITER_SPAWNED } },
      { kind: 'create', path: SPAWNS, post: 'not a spawn record' },
    );

    expect((await judgeWith(reg, input)).exitCode).toBe(0);
  });
});

describe('dispatchCovenants — spec.world.channels reaches the judged input', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-dispatch-channels-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the body sees the channels the root supplied, deep-equal', async () => {
    // The session root supplies channels through the dispatch spec like the other two
    // world fields; a dispatcher that copies `files` and `changes` by name drops the third
    // axis, and every sidecar declaration judges absence on a session that supplied one.
    const world = { channels: { sidecar: WRITER_SPAWNED } };
    let seen: CovenantInput | undefined;
    const registration: CovenantRegistration = {
      label: 'recording',
      protectedPaths: [],
      matches: () => TARGET_FILE,
      body: async (input) => {
        seen = input;
        return { exitCode: 0 };
      },
    };

    await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: TARGET_FILE })),
      registrations: [registration],
      telemetryPath: join(dir, 'roi.log'),
      world: world as NonNullable<CovenantInput['world']>,
    });

    expect(seen?.world).toEqual(world);
  });
});
