import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CanonicalTranscript,
  CovenantInput,
  DisciplineEntry,
  FileChange,
  TranscriptToolCall,
  TranscriptUserMessage,
} from '@polydeukes/core';
import { noopTranscript, readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// A declare entry bound to the session history: `sources: { <name>: { transcript: true } }`.
// The declare judgment path fills that name from `spec.transcript` — the `CanonicalTranscript`
// the session surface already hands assembly for the context family — flattened once into
// a plain snapshot `{ observedAtMs, userMessages: [{ index, text, timestampMs? }], toolCalls:
// [{ index, name, args, succeeded? }] }`. Nothing is read from `world.channels` or
// `world.files`: the history is not a channel and not a path, so the change-set overlap rule
// never touches it. Absence is `spec.transcript` being absent (the commit surface), and the
// declaration's own `supply` policy disposes of it; an EMPTY transcript is a session that
// has said nothing yet and is judged as such.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';

const readPreState = () => null;

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const ID = 'tests-before-implementation';
const ENTRY = 'has-writer';
// Source names, tool names, agent names, and paths are fixture values.
const SESSION = 'session';
const AGENT_TOOL = 'Agent';
const SUBAGENT_ARG = 'subagent_type';
const WRITER = 'tdd-test-writer';
const OTHER_AGENT = 'code-reviewer';
const TARGET_FILE = 'packages/core/src/a.ts';
const OTHER_FILE = 'docs/readme.md';
const EN_FILE = 'locales/en.json';
const CREATE_TARGET: FileChange = { kind: 'create', path: TARGET_FILE, post: 'export {};\n' };
const TEN_MINUTES = 600_000;

/** Reads the session and holds when a writer spawn is on record. */
const READS_SESSION = {
  mechanism: 'stated-ground',
  sources: { [SESSION]: { transcript: true } },
  supply: { [SESSION]: 'error' },
  extract: {
    writers: [
      { op: 'source', of: SESSION },
      { op: 'toolUses', names: [AGENT_TOOL], subagentType: WRITER },
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

/** Reads the session and holds when a `/allow` turn is at most ten minutes old. */
const READS_FRESH_TURN = {
  mechanism: 'turn-locality',
  sources: { [SESSION]: { transcript: true } },
  supply: { [SESSION]: 'error' },
  extract: {
    fresh: [
      { op: 'source', of: SESSION },
      { op: 'userTexts', re: '^/allow\\b' },
      { op: 'first' },
      { op: 'ageMs' },
      { op: 'filter', when: [{ field: 'ageMs', lte: TEN_MINUTES }] },
    ],
  },
  relate: [{ id: 'fresh-permission', relation: { op: 'nonEmpty', of: 'fresh' }, message: 'stale' }],
};

/** A transcript answering fixed lists, the way the session adapter's provider does. */
function transcriptOf(
  toolCalls: TranscriptToolCall[],
  userMessages: TranscriptUserMessage[] = [],
): CanonicalTranscript {
  return {
    findUserMessages: () => userMessages,
    findToolCalls: (name) => toolCalls.filter((call) => name === undefined || call.name === name),
  };
}

const spawnOf = (subagentType: string): TranscriptToolCall => ({
  name: AGENT_TOOL,
  args: { [SUBAGENT_ARG]: subagentType },
});

/** A declare entry; extra head keys ride along. */
function declareEntry(declare: Record<string, unknown>, id = ID) {
  return { id, declare } as unknown as DisciplineEntry;
}

function specWith(
  disciplines: DisciplineEntry[],
  extra: Partial<CompileDisciplinesSpec> = {},
): CompileDisciplinesSpec {
  return {
    disciplines,
    rootDir: ROOT,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState,
    ...extra,
  };
}

/** A CovenantInput of the given creates, in order, with an optional world axis. */
function inputOf(changes: FileChange[] = [CREATE_TARGET], world?: Record<string, unknown>) {
  return {
    toolCalls: changes.map((change, index) => ({
      name: `call-${index}`,
      args: { file_path: change.path },
      fileChange: change,
    })),
    subagentSpawns: [],
    userMessages: [],
    ...(world !== undefined && { world }),
  } as CovenantInput;
}

/** Compile the entry and return its body registration; a missing one fails loudly. */
function compileBody(entry: DisciplineEntry, extra: Partial<CompileDisciplinesSpec> = {}) {
  const reg = compileDisciplineRegistrations(specWith([entry], extra)).find(
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
    skipped?: string;
    witnesses?: readonly { id: string; witnesses: readonly { key: string; value: unknown }[] }[];
  };
}

/** Every telemetry row under `label` as `{ event, subject, reason }`. */
function rowsOf(telemetryPath: string, label: string) {
  return readRecords(telemetryPath)
    .records.filter((record) => record.label === label)
    .map(({ event, subject, reason }) => ({ event, subject, reason }));
}

function spyStderr() {
  return vi.spyOn(process.stderr, 'write').mockReturnValue(true);
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-declare-transcript-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('compileDisciplineRegistrations — a transcript binding rides the registration by kind', () => {
  it('lists the binding as { name, transcript: true }, never as a file or a channel', () => {
    // The registration is the plan's only input: a compiler that folds the binding into
    // the file shape makes the plan read a path nobody named, and one that folds it into
    // the sidecar shape asks the channel reader for a history it does not carry.
    const reg = compileBody(declareEntry(READS_SESSION), { transcript: noopTranscript });

    expect(reg.sources).toEqual([{ name: SESSION, transcript: true }]);
  });
});

describe('the declare body — the transcript source reads spec.transcript as a snapshot', () => {
  it('upholds when the session carries a writer spawn', async () => {
    // The happy path proves the snapshot's tool calls were flattened under the binding's
    // name: a merge that fills the name with the CanonicalTranscript object itself (its
    // two functions) leaves `toolUses` nothing to read and breaks a session that spawned.
    const reg = compileBody(declareEntry(READS_SESSION), {
      transcript: transcriptOf([spawnOf(WRITER)]),
    });

    expect((await judgeWith(reg, inputOf())).exitCode).toBe(0);
  });

  it('breaks with one witness when only another agent was spawned', async () => {
    // The control for the test above: a body answering 0 whenever `spec.transcript` is
    // present passes both fixtures; only the pair proves the calls were judged.
    const reg = compileBody(declareEntry(READS_SESSION), {
      transcript: transcriptOf([spawnOf(OTHER_AGENT)]),
    });

    const outcome = await judgeWith(reg, inputOf());

    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toContain(`discipline '${ID}' broken on ${TARGET_FILE}`);
    expect(outcome.witnesses?.[0]?.witnesses).toEqual([{ key: 'writers', value: null }]);
  });

  it('breaks on the empty transcript — a session that said nothing is not an absent session', async () => {
    // `noopTranscript` and an absent `spec.transcript` are different facts: folding the
    // empty session into absence hands the verdict to the supply policy, and under `pass` a
    // session that provably spawned nothing would skip a judgment it should have failed.
    const reg = compileBody(declareEntry({ ...READS_SESSION, supply: { [SESSION]: 'pass' } }), {
      transcript: noopTranscript,
    });

    expect((await judgeWith(reg, inputOf())).exitCode).toBe(1);
  });

  it('the snapshot is observed at the judgment clock: a turn one second old is fresh, one twenty minutes old is not', async () => {
    // `ageMs` is `observedAtMs − timestampMs`, and `observedAtMs` is the clock at supply
    // time. A snapshot stamped with 0, or with the turn's own timestamp, reads every turn
    // as ageless and the ten-minute bound admits a permission from last week.
    const fresh = compileBody(declareEntry(READS_FRESH_TURN), {
      transcript: transcriptOf([], [{ text: '/allow force', timestampMs: Date.now() - 1_000 }]),
    });
    const stale = compileBody(declareEntry(READS_FRESH_TURN), {
      transcript: transcriptOf(
        [],
        [{ text: '/allow force', timestampMs: Date.now() - 2 * TEN_MINUTES }],
      ),
    });

    expect((await judgeWith(fresh, inputOf())).exitCode).toBe(0);
    expect((await judgeWith(stale, inputOf())).exitCode).toBe(1);
  });

  it('a turn without a timestamp never counts as fresh', async () => {
    // The IR-wrapped transcript carries no timestamps at all; a snapshot that stamps the
    // turn with the observation clock makes every such turn zero seconds old.
    const reg = compileBody(declareEntry(READS_FRESH_TURN), {
      transcript: transcriptOf([], [{ text: '/allow force' }]),
    });

    expect((await judgeWith(reg, inputOf())).exitCode).toBe(1);
  });

  it('with no transcript injected, supply: error exits 2 and names the source on stderr', async () => {
    // The commit surface injects no session, so this is every commit's disposition of the
    // entry: `2` is the unjudgeable row, never a fabricated empty snapshot that would break.
    const reg = compileBody(declareEntry(READS_SESSION));
    const stderr = spyStderr();

    const outcome = await judgeWith(reg, inputOf());

    expect(outcome.exitCode).toBe(2);
    const lines = stderr.mock.calls.map((call) => String(call[0])).filter((s) => s.includes(ID));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(SESSION);
  });

  it('with no transcript injected, supply: pass exits 0 with the supply-pass token', async () => {
    // The author's escape hatch reaches the transcript kind like the other two, and the
    // outcome must carry the token: a bare exit 0 records `passed` for a call never judged.
    const reg = compileBody(declareEntry({ ...READS_SESSION, supply: { [SESSION]: 'pass' } }));

    expect(await judgeWith(reg, inputOf())).toEqual({ exitCode: 0, skipped: 'supply-pass' });
  });

  it('an injected transcript that throws is absence, disposed of by supply — never a routing block', async () => {
    // The precedent path reads a throwing transcript as an unusable channel; here the same
    // failure must not escape `matches` into the dispatcher's fail-closed routing, which
    // would block an advised entry (review #90 finding 4).
    const broken: CanonicalTranscript = {
      findUserMessages: () => [],
      findToolCalls: () => {
        throw new Error('provider failure');
      },
    };
    const reg = compileBody(declareEntry({ ...READS_SESSION, supply: { [SESSION]: 'pass' } }), {
      transcript: broken,
    });

    expect(reg.matches?.(inputOf())).toBe(TARGET_FILE);
    expect(await judgeWith(reg, inputOf())).toEqual({ exitCode: 0, skipped: 'supply-pass' });
  });

  it('a world with a sidecar channel is still transcript absence', async () => {
    // Absence is `spec.transcript`, per axis: a merge that reads the history off
    // `world.channels` (the sidecar's home) finds text there and judges a JSON list as a
    // session.
    spyStderr();
    const reg = compileBody(declareEntry(READS_SESSION));

    const outcome = await judgeWith(
      reg,
      inputOf([CREATE_TARGET], { channels: { sidecar: `[{"agentType":"${WRITER}"}]` } }),
    );

    expect(outcome.exitCode).toBe(2);
  });
});

describe('dispatchCovenants — the transcript-bound entry records its disposition per world', () => {
  it('with no transcript injected and supply: pass, the row is skipped with reason supply-pass', async () => {
    // End to end on the commit surface's shape: the token the body answers is the reason the
    // row carries, under the entry id and the routed path.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry({ ...READS_SESSION, supply: { [SESSION]: 'pass' } })]),
    );

    const { exitCode, results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(inputOf()),
      registrations: regs,
      telemetryPath,
    });

    expect(exitCode).toBe(0);
    expect(results.filter((r) => r.label === ID)).toEqual([
      { label: ID, exitCode: 0, event: 'skipped' },
    ]);
    expect(rowsOf(telemetryPath, ID)).toEqual([
      { event: 'skipped', subject: TARGET_FILE, reason: 'supply-pass' },
    ]);
  });

  it('a supply-passed first world does not hide a second world the session breaks — the row is advised', async () => {
    // Two worlds in one dispatch: the first is a create and has no `pre` (supply-pass, the
    // entry stops there), the second is a modify and is judged — and the session, merged
    // into every world, has no writer. Stopping at the first world records skipped for a
    // call that broke; a session merged into the first world only reports nothing at all.
    const MIXED = {
      mechanism: 'scoped-valve',
      sources: { [SESSION]: { transcript: true } },
      supply: { pre: 'pass', [SESSION]: 'pass' },
      extract: {
        before: [{ op: 'source', of: 'pre' }, { op: 'lines' }],
        writers: READS_SESSION.extract.writers,
      },
      relate: [
        { id: 'had-lines', relation: { op: 'nonEmpty', of: 'before' }, message: 'm' },
        ...READS_SESSION.relate,
      ],
      witness: { relate: [{ id: 'valve', relation: { op: 'empty', of: 'before' }, message: 'w' }] },
    };
    const input = inputOf([
      { kind: 'create', path: OTHER_FILE, post: 'content' },
      { kind: 'modify', path: EN_FILE, pre: 'before\n', post: 'after\n' },
    ]);
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(MIXED)], { transcript: transcriptOf([spawnOf(OTHER_AGENT)]) }),
    );

    const { results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: regs,
      telemetryPath,
    });

    expect(results.filter((r) => r.label === ID).map((r) => r.event)).toEqual(['advised']);
    // The subject is the first world the declaration admits (the routing contract), not
    // the world that broke — the event is what the regression pins.
    expect(rowsOf(telemetryPath, ID).map((row) => row.event)).toEqual(['advised']);
  });

  it('with the transcript injected and a writer on record, the same entry records passed', async () => {
    // The other end: a body that answers `skipped` whenever the binding is a transcript,
    // rather than when the session was actually absent, turns every judged call into a
    // non-judgment.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry({ ...READS_SESSION, supply: { [SESSION]: 'pass' } })], {
        transcript: transcriptOf([spawnOf(WRITER)]),
      }),
    );

    const { results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(inputOf()),
      registrations: regs,
      telemetryPath,
    });

    expect(results.filter((r) => r.label === ID)).toEqual([
      { label: ID, exitCode: 0, event: 'passed' },
    ]);
    expect(rowsOf(telemetryPath, ID)).toEqual([
      { event: 'passed', subject: TARGET_FILE, reason: undefined },
    ]);
  });
});
