import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// `runCovenantCheck` assembling from the IR's `tools` and `session` keys. `tools` is the
// host's roster as values: self-mod routes on `tools.mutating`, shell-mod registers only
// when `tools.shell` is non-empty. `session` is the host's evidence for one live call: it
// opens the TTL witness (a fresh, timestamped token utterance), registers transcript-mod
// over `evidencePath`, binds the discipline transcript, supplies the sidecar channel,
// reads discipline pre-state from disk, skips change-set declarations, and runs the
// baseline comparison. An input without either key assembles exactly as the `--diff`
// surface does today. A malformed `tools` or `session` fails closed before any dispatch.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { STAGED_WRITE } from '../src/diff-ir.ts';
import {
  BASELINE_FIRST_RUN_ROW,
  type RecordedCall,
  recordingCovenant,
  telemetryRows,
  writeConfigAt,
} from './helpers.ts';

/** Injected fixture values — the host roster, the protected entry, the discipline targets. */
const MUTATING_TOOL = 'session-write';
const OTHER_MUTATING_TOOL = 'session-edit';
const SHELL_TOOL = 'shell-tool';
const COMMAND_ARG = 'command';
const TOOLS = { mutating: [MUTATING_TOOL], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };
/** The entry is a directory so the subject (matched entry) never coincides with a judged path. */
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
const ORDINARY_FILE = 'notes/ordinary.txt';
const SCOPED_TARGET = 'lib/a.ts';
const WITNESS_TOKEN = 'agreed-token';
const TTL_MINUTES = 10;
const PRECEDENT_ID = 'lib-needs-a-probe';
const PRECEDENT_TOOL = 'probe-tool';
const SESSION_SOURCE = 'session';
const SIDECAR_ID = 'lib-needs-writer-spawn';
const WRITER_AGENT = 'writer-agent';
const CHANGE_SET_ID = 'needs-the-whole-change-set';
const ADDED_ONLY_ID = 'no-lantern';
const BANNED_WORD = 'lantern';
const SHELL_TARGET = 'lib/a.txt';
/** The umbrella's meta-covenant labels — observable contracts, not fixture choices. */
const SELF_MOD_LABEL = 'self-mod';
const SHELL_MOD_LABEL = 'shell-mod';
const TRANSCRIPT_MOD_LABEL = 'transcript-mod';
const BASELINE_LABEL = 'baseline';
/** The runner's own label — the unrouted pass row, and the fail-closed row. */
const CHECK_LABEL = 'covenant-check';
const FAIL_CLOSED_LABEL = 'covenant-check';

type Session = NonNullable<CovenantInput['session']>;
type ToolCall = CovenantInput['toolCalls'][number];

/** A precedent declaration over `lib/` reading the session for a SUCCESSFUL probe call. */
const precedentEntry = {
  id: PRECEDENT_ID,
  why: 'a lib edit follows a successful probe',
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: ['^lib/'] },
    sources: { [SESSION_SOURCE]: { transcript: true } },
    supply: { [SESSION_SOURCE]: 'pass' },
    extract: {
      probes: [
        { op: 'source', of: SESSION_SOURCE },
        { op: 'toolUses', names: [PRECEDENT_TOOL] },
        { op: 'filter', when: [{ field: 'succeeded', eq: true }] },
      ],
    },
    relate: [
      {
        id: 'probed',
        relation: { op: 'nonEmpty', of: 'probes' },
        message: 'no successful probe precedes this edit',
      },
    ],
  },
};

/** A precedent declaration over `lib/` reading the spawn sidecar for a writer record. */
const sidecarEntry = {
  id: SIDECAR_ID,
  why: 'a lib edit wants a writer spawn on record',
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: ['^lib/'] },
    sources: { spawns: { sidecar: true } },
    supply: { spawns: 'pass' },
    extract: {
      writers: [
        { op: 'source', of: 'spawns' },
        { op: 'matches', re: WRITER_AGENT },
      ],
    },
    relate: [
      { id: 'writer', relation: { op: 'nonEmpty', of: 'writers' }, message: 'no writer spawn' },
    ],
  },
};

/** A companion declaration over `lib/` reading the observation's change set. */
const changeSetEntry = {
  id: CHANGE_SET_ID,
  declare: {
    mechanism: 'companion',
    scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
    supply: { changes: 'pass' },
    extract: {
      own: [{ op: 'source', of: 'target.path' }],
      changed: [{ op: 'source', of: 'changes' }, { op: 'items' }],
    },
    relate: [
      {
        id: 'has-companion',
        relation: { op: 'implies', of: 'own', requires: 'changed' },
        message: '{value} changed alone',
      },
    ],
  },
};

/** An added-only declaration over `lib/`: the banned word may not be newly added. */
const addedOnlyEntry = {
  id: ADDED_ONLY_ID,
  declare: {
    mechanism: 'added-only',
    scope: { source: 'target.path', include: ['^lib/'] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      before: [
        { op: 'source', of: 'pre' },
        { op: 'lines' },
        { op: 'keyByPattern', re: `\\b(${BANNED_WORD})\\b` },
      ],
      after: [
        { op: 'source', of: 'post' },
        { op: 'lines' },
        { op: 'keyByPattern', re: `\\b(${BANNED_WORD})\\b` },
      ],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
    relate: [
      { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
    ],
  },
};

let repoRoot: string;
/** Telemetry and the evidence file live outside the observed directory. */
let outside: string;
let telemetryPath: string;
let evidencePath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-check-session-'));
  outside = mkdtempSync(join(tmpdir(), 'pdks-check-session-outside-'));
  telemetryPath = join(outside, 'roi.log');
  evidencePath = join(outside, 'session.jsonl');
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const rows = () => telemetryRows(telemetryPath);

function writeConfig(extra: Record<string, unknown>): void {
  writeConfigAt(repoRoot, telemetryPath, extra);
}

function writeOnDisk(relPath: string, content: string): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function ir(toolCalls: ToolCall[], extra: Partial<CovenantInput> = {}): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [], ...extra };
}

/** One write by the host's mutating tool, evidence attached. */
function writeCall(path: string, post = 'text\n'): ToolCall {
  return {
    name: MUTATING_TOOL,
    args: { file_path: path, content: post },
    fileChange: { kind: 'create', path, post },
  };
}

/** One shell call by the host's shell tool — no evidence, the command line is the observation. */
function shellCall(command: string): ToolCall {
  return { name: SHELL_TOOL, args: { [COMMAND_ARG]: command } };
}

function sessionOf(overrides: Partial<Session> = {}): Session {
  return { userMessages: [], toolCalls: [], ...overrides };
}

/** A token utterance in its invoking form — first line alone, prose after. */
function tokenMessage(timestampMs?: number): Session['userMessages'][number] {
  return {
    text: `${WITNESS_TOKEN}\nplease proceed`,
    ...(timestampMs === undefined ? {} : { timestampMs }),
  };
}

function dispatches(calls: () => RecordedCall[]): Extract<RecordedCall, { kind: 'dispatch' }>[] {
  return calls().filter(
    (call): call is Extract<RecordedCall, { kind: 'dispatch' }> => call.kind === 'dispatch',
  );
}

describe('tools — the host roster routes the two meta-covenants', () => {
  it('a protected write by a tool in tools.mutating blocks under enforce: block — blocked self-mod, passed shell-mod, subject = the entry', async () => {
    // The roster is an IR value. A runner that keeps the staged names as its only
    // mutating roster never routes a session write to self-mod, and a protected write by
    // the host's editor lands one pass row instead of a block.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_FILE)], { tools: TOOLS }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ['passed', SHELL_MOD_LABEL, PROTECTED_ENTRY],
    ]);
  });

  it('the same IR without tools passes with exactly one row — the host tool is unrouted under the staged default', async () => {
    // The default roster is the staged names, so a session tool name reaches no judge and
    // the call leaves one pass row. A runner that hard-codes a host roster into the
    // umbrella blocks here; one that fails closed on an unknown tool name exits 2.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_FILE)]),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', expect.any(String), expect.any(String)]]);
  });

  it('a tools key whose value is undefined reads as absent — the same one unrouted row', async () => {
    // Only an in-process caller can write this shape (a JSON round-trip drops the key), and
    // a runner keying on `'tools' in input` would fail it closed instead of judging it as
    // the staged default.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_FILE)], { tools: undefined }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', expect.any(String), expect.any(String)]]);
  });

  it('the second name of a two-name mutating roster routes to self-mod too', async () => {
    // A roster is the whole list: a runner reading its first entry, or registering one
    // name after normalizing, leaves every other host editor unrouted.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([{ ...writeCall(PROTECTED_FILE), name: OTHER_MUTATING_TOOL }], {
        tools: { ...TOOLS, mutating: [MUTATING_TOOL, OTHER_MUTATING_TOOL] },
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ['passed', SHELL_MOD_LABEL, PROTECTED_ENTRY],
    ]);
  });

  it('an EMPTY tools.mutating is a roster with no mutating tool — a protected write under the staged name passes', async () => {
    // The degenerate roster: the host declared it has no mutating tool. A runner that
    // falls back to the staged default on an empty list (`||`, or a length check) routes a
    // call under the staged name that no host tool made, and blocks it.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([{ ...writeCall(PROTECTED_FILE), name: STAGED_WRITE }], {
        tools: { mutating: [], shell: [], commandArgs: [] },
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(0);
    expect(rows().filter(([event]) => event === 'blocked')).toEqual([]);
  });

  it('a shell mutation of a protected path by a tool in tools.shell blocks under shell-mod, self-mod passing the mention', async () => {
    // The shell axis exists only through the roster: `tools.shell` names the tool and
    // `tools.commandArgs` names where the command line is. A runner registering shell-mod
    // with the commit surface's empty list leaves an `echo >>` into a protected file with
    // nothing but a passed self-mod row.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([shellCall(`echo x >> ${PROTECTED_FILE}`)], { tools: TOOLS }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      ['passed', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ['blocked', SHELL_MOD_LABEL, PROTECTED_ENTRY],
    ]);
  });

  it('an empty tools.shell registers no shell-mod at all — the same mutation passes with no shell-mod row', async () => {
    // "No shell tool" means no shell axis, not a shell axis over nothing. A runner that
    // registers shell-mod whenever `tools` is present judges a command line the host said
    // it has no tool for.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([shellCall(`echo x >> ${PROTECTED_FILE}`)], {
        tools: { ...TOOLS, shell: [] },
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(0);
    expect(rows().filter(([, label]) => label === SHELL_MOD_LABEL)).toEqual([]);
  });

  it('a read-only head over a protected path passes both meta-covenants (exit 0)', async () => {
    // The over-blocking end: `cat` of a protected file is the ordinary operation, and a
    // shell axis that blocks every mention sends people to the valve.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([shellCall(`cat ${PROTECTED_FILE}`)], { tools: TOOLS }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([
      ['passed', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ['passed', SHELL_MOD_LABEL, PROTECTED_ENTRY],
    ]);
  });
});

describe('session.userMessages — the TTL witness opens on a fresh, timestamped token', () => {
  beforeEach(() => {
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
    });
  });

  it('a token utterance inside the TTL turns the self-mod block into witnessed, exit 0', async () => {
    // The valve on this surface: the session proves a human typed the token recently.
    // A runner that binds the witness to the top-level `userMessages` (no timestamps) can
    // never open it, and a session-carrying call has no valve at all.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_FILE)], {
        tools: TOOLS,
        session: sessionOf({ userMessages: [tokenMessage(Date.now() - 1_000)] }),
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['witnessed', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ['passed', SHELL_MOD_LABEL, PROTECTED_ENTRY],
    ]);
  });

  it('the same token utterance without timestampMs never opens the valve — blocked, exit 2', async () => {
    // Freshness unprovable is not fresh. A runner that fills a missing timestamp with its
    // own clock lets any transcript line that carries the token — pasted, replayed,
    // forged — open the valve forever.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_FILE)], {
        tools: TOOLS,
        session: sessionOf({ userMessages: [tokenMessage()] }),
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ['passed', SHELL_MOD_LABEL, PROTECTED_ENTRY],
    ]);
  });

  it('a token utterance older than the TTL is expired — blocked, exit 2', async () => {
    // The TTL is `ttlMinutes * 60_000`. A runner reading the config's minutes as
    // milliseconds closes the valve on every real utterance; one reading them as seconds
    // or hours holds it open past the window the human agreed to.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(PROTECTED_FILE)], {
        tools: TOOLS,
        session: sessionOf({
          userMessages: [tokenMessage(Date.now() - (TTL_MINUTES + 1) * 60_000)],
        }),
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', SELF_MOD_LABEL, PROTECTED_ENTRY],
      ['passed', SHELL_MOD_LABEL, PROTECTED_ENTRY],
    ]);
  });
});

describe('session.evidencePath — transcript-mod protects exactly that file', () => {
  beforeEach(() => {
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    writeFileSync(evidencePath, '{"type":"user"}\n');
  });

  it('a mutating-tool write naming the evidence path blocks under transcript-mod', async () => {
    // The evidence file is what the witness reads; a runner that never registers
    // transcript-mod from `session.evidencePath` lets a Write append a forged human
    // utterance and then witness itself with it.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([{ name: MUTATING_TOOL, args: { file_path: evidencePath, content: 'forged' } }], {
        tools: TOOLS,
        session: sessionOf({ evidencePath }),
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(rows().map(([event, label]) => [event, label])).toContainEqual([
      'blocked',
      TRANSCRIPT_MOD_LABEL,
    ]);
  });

  it('a shell append onto the evidence path blocks under transcript-mod — the roster reaches this registration too', async () => {
    // transcript-mod takes the shell tool and command-arg names from the same roster. A
    // runner that registers it with the commit surface's empty shell list judges the tool
    // axis only, and `echo >> <transcript>` passes.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([shellCall(`echo forged >> ${evidencePath}`)], {
        tools: TOOLS,
        session: sessionOf({ evidencePath }),
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(2);
    expect(rows().map(([event, label]) => [event, label])).toContainEqual([
      'blocked',
      TRANSCRIPT_MOD_LABEL,
    ]);
  });

  it('a session without evidencePath composes no transcript-mod — the same write passes, no such row', async () => {
    // The registration exists only where the evidence path is produced. Hoisting it above
    // that condition (registering over `undefined`, or over a default path) turns every
    // session call into either a fail-closed block or a judgment about a file nobody named.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([{ name: MUTATING_TOOL, args: { file_path: evidencePath, content: 'forged' } }], {
        tools: TOOLS,
        session: sessionOf(),
      }),
      telemetryPath,
      enforce: 'block',
    });

    expect(result.exitCode).toBe(0);
    expect(rows().filter(([, label]) => label === TRANSCRIPT_MOD_LABEL)).toEqual([]);
    expect(rows().filter(([event]) => event === 'blocked')).toEqual([]);
  });
});

describe('session — the discipline transcript binding reads session.toolCalls', () => {
  beforeEach(() => {
    writeConfig({ protectedPaths: [PROTECTED_ENTRY], disciplines: [precedentEntry] });
  });

  it('a successful precedent call in session.toolCalls satisfies the declaration — passed', async () => {
    // The binding must be `transcriptFromSession(session)`, not the IR wrapper over the
    // judged call: the judged call is never its own precedent, so a runner binding
    // `transcriptFromInput` reports "no probe" on every session and the gate never opens.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(SCOPED_TARGET)], {
        tools: TOOLS,
        session: sessionOf({
          toolCalls: [{ name: PRECEDENT_TOOL, args: { target: 'x' }, succeeded: true }],
        }),
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', PRECEDENT_ID, SCOPED_TARGET]]);
  });

  it('the same precedent call with succeeded: false breaks the declaration — advised', async () => {
    // `succeeded` must reach the snapshot: a binding that projects `{ name, args }` alone
    // makes a refused probe count as a probe that ran.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(SCOPED_TARGET)], {
        tools: TOOLS,
        session: sessionOf({
          toolCalls: [{ name: PRECEDENT_TOOL, args: { target: 'x' }, succeeded: false }],
        }),
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['advised', PRECEDENT_ID, SCOPED_TARGET]]);
  });

  it('with no session the same declaration records skipped — the binding is absent, not empty', async () => {
    // Absence and emptiness demand opposite dispositions: an absent session is disposed
    // of by `supply: pass` as a skip; a runner that binds an empty transcript when the IR
    // has no session judges "nothing happened" and breaks every session-free run.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(SCOPED_TARGET)], { tools: TOOLS }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['skipped', PRECEDENT_ID, SCOPED_TARGET]]);
  });
});

describe('session.channels — the sidecar rides into the dispatched world', () => {
  beforeEach(() => {
    writeConfig({ protectedPaths: [PROTECTED_ENTRY], disciplines: [sidecarEntry] });
  });

  it('a sidecar text carrying the writer record satisfies the sidecar declaration — passed', async () => {
    // `world.channels` must come from `session.channels`. A runner that leaves the commit
    // surface's channel-less world in place hands the declaration an absent source on a
    // session that provably spawned the writer.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(SCOPED_TARGET)], {
        tools: TOOLS,
        session: sessionOf({
          channels: { sidecar: JSON.stringify([{ agentType: WRITER_AGENT, toolUseId: 't1' }]) },
        }),
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', SIDECAR_ID, SCOPED_TARGET]]);
  });

  it('a session without channels leaves the sidecar absent — skipped under supply: pass', async () => {
    // No channel is a different fact from a channel that observed nothing: a runner that
    // fabricates `'[]'` for a session without channels judges a spawn-less session and
    // breaks the declaration instead of skipping it.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(SCOPED_TARGET)], { tools: TOOLS, session: sessionOf() }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['skipped', SIDECAR_ID, SCOPED_TARGET]]);
  });

  it("a sidecar that observed no spawn ('[]') is a present source — judged and broken, not skipped", async () => {
    // `'[]'` and absence are two facts: the channel was there and saw nothing. A runner
    // that folds the empty list into absence skips a declaration that should break.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(SCOPED_TARGET)], {
        tools: TOOLS,
        session: sessionOf({ channels: { sidecar: '[]' } }),
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['advised', SIDECAR_ID, SCOPED_TARGET]]);
  });
});

describe('session — one call is not the whole change set', () => {
  beforeEach(() => {
    writeConfig({ protectedPaths: [PROTECTED_ENTRY], disciplines: [changeSetEntry] });
  });

  it('with a session the change-set declaration records skipped', async () => {
    // A session call is one of a wider change set the runner cannot see, so a declaration
    // reading `changes` cannot be judged. A runner that keeps `observesChangeSet` on for
    // session inputs judges a one-element change set and lands a verdict on a vacuity.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(SCOPED_TARGET)], { tools: TOOLS, session: sessionOf() }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['skipped', CHANGE_SET_ID, SCOPED_TARGET]]);
  });

  it('without a session the same declaration is judged over the input change set — passed', async () => {
    // The other end: a session-free IR is its own whole change set, as `--diff` is today.
    // A runner that skips change-set declarations whenever `tools` is present would
    // silence them on every input a host roster reaches.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(SCOPED_TARGET)], { tools: TOOLS }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', CHANGE_SET_ID, SCOPED_TARGET]]);
  });
});

describe('session — discipline pre-state is read from disk under repoRoot', () => {
  it('a shell append of a word the disk pre already carries passes the added-only declaration', async () => {
    // The shell-derived write needs the disk pre to judge its added set. A runner that
    // keeps the commit surface's unobserved reader answers "cannot read" and the call
    // fails closed; one that answers `null` reads the append as a create and the word
    // already on disk breaks the declaration again.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY], disciplines: [addedOnlyEntry] });
    writeOnDisk(SHELL_TARGET, `${BANNED_WORD} already lives here\n`);

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([shellCall(`echo '${BANNED_WORD}' >> ${join(repoRoot, SHELL_TARGET)}`)], {
        tools: TOOLS,
        session: sessionOf(),
      }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADDED_ONLY_ID, SHELL_TARGET]]);
  });
});

describe('session — the baseline comparison runs around the judgment', () => {
  beforeEach(() => {
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    writeOnDisk(PROTECTED_FILE, 'locked: yes\n');
  });

  it('the first session call in a repository records the absent baseline ahead of its judgment row', async () => {
    // The comparison must run at all on this path: a runner that leaves it in the old
    // session entry point leaves every consumer that spawns the CLI with no out-of-band
    // detection and no row saying so.
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_FILE)], { tools: TOOLS, session: sessionOf() }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', CHECK_LABEL, ORDINARY_FILE]]);
  });

  it('a protected entry changed with no judgment between two session calls leaves one unattributed row, subject = the entry', async () => {
    // The mechanism: the comparison at call start names what moved since the previous
    // call's re-establishment. A runner that compares but never re-establishes at call
    // end alarms on every call; one that re-establishes but never compares alarms on none.
    await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_FILE)], { tools: TOOLS, session: sessionOf() }),
      telemetryPath,
    });
    writeOnDisk(PROTECTED_FILE, 'locked: tampered out of band\n');

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_FILE)], { tools: TOOLS, session: sessionOf() }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['passed', CHECK_LABEL, ORDINARY_FILE],
      ['unattributed', BASELINE_LABEL, PROTECTED_ENTRY],
      ['passed', CHECK_LABEL, ORDINARY_FILE],
    ]);
  });

  it('a comparison failure never touches the exit code — a file occupying .polydeukes leaves exit 0', async () => {
    // Fail-open by contract: the re-establishment's mkdir hits ENOTDIR here and must be
    // caught outside the judgment. A runner that lets it escape rejects the run, or lands
    // it as a fail-closed block over a file no covenant protects.
    writeFileSync(join(repoRoot, '.polydeukes'), 'not a directory\n');

    await expect(
      runCovenantCheck({
        repoRoot,
        input: ir([writeCall(ORDINARY_FILE)], { tools: TOOLS, session: sessionOf() }),
        telemetryPath,
      }),
    ).resolves.toEqual({ exitCode: 0 });
  });

  it('a session input with no toolCalls still compares and re-establishes the baseline', async () => {
    // A call the host translated to nothing judgeable is still a call of the session: the
    // comparison reads the window the previous call left, and re-establishing keeps the
    // next window honest. Skipping both would leave a tamper between two such calls unseen.
    const first = await runCovenantCheck({
      repoRoot,
      input: ir([], { tools: TOOLS, session: sessionOf() }),
      telemetryPath,
    });
    expect(first.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW]);

    writeOnDisk(PROTECTED_FILE, 'locked: tampered out of band\n');
    const second = await runCovenantCheck({
      repoRoot,
      input: ir([], { tools: TOOLS, session: sessionOf() }),
      telemetryPath,
    });
    expect(second.exitCode).toBe(0);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['unattributed', BASELINE_LABEL, PROTECTED_ENTRY],
    ]);
  });

  it('an input without a session leaves no baseline row, on the first call or after a tamper', async () => {
    // The comparison follows the session, not the roster: a runner keyed on `tools`
    // would write baseline rows into every session-free run of a host roster, and one
    // keyed on nothing would write them into `--diff`.
    await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_FILE)], { tools: TOOLS }),
      telemetryPath,
    });
    writeOnDisk(PROTECTED_FILE, 'locked: tampered out of band\n');
    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_FILE)], { tools: TOOLS }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows().filter(([, label]) => label === BASELINE_LABEL)).toEqual([]);
    expect(rows()).toEqual([
      ['passed', CHECK_LABEL, ORDINARY_FILE],
      ['passed', CHECK_LABEL, ORDINARY_FILE],
    ]);
  });
});

describe('a malformed tools or session fails closed before any dispatch', () => {
  it.each<[string, Partial<CovenantInput>]>([
    [
      'tools.mutating is a string, not an array',
      { tools: { mutating: MUTATING_TOOL, shell: [], commandArgs: [] } as never },
    ],
    [
      'tools.shell is a string, not an array',
      { tools: { mutating: [], shell: SHELL_TOOL, commandArgs: [] } as never },
    ],
    ['tools.commandArgs is missing', { tools: { mutating: [MUTATING_TOOL], shell: [] } as never }],
    [
      'tools.mutating holds a non-string name',
      { tools: { mutating: [42], shell: [], commandArgs: [] } as never },
    ],
    [
      'session.toolCalls is an object, not an array',
      { session: { userMessages: [], toolCalls: {} } as never },
    ],
    ['session is present but userMessages is missing', { session: { toolCalls: [] } as never }],
    [
      'tools.shell names a tool but tools.commandArgs is empty',
      { tools: { mutating: [], shell: [SHELL_TOOL], commandArgs: [] } },
    ],
    [
      'session.channels is the sidecar text itself, not an object',
      { session: { userMessages: [], toolCalls: [], channels: '[]' } as never },
    ],
    [
      'session.evidencePath is a number',
      { session: { userMessages: [], toolCalls: [], evidencePath: 42 } as never },
    ],
    [
      'session.channels.sidecar is an array, not text',
      { session: { userMessages: [], toolCalls: [], channels: { sidecar: [] } } as never },
    ],
  ])('%s — exit 2, one blocked covenant-check row, nothing dispatched', async (_name, extra) => {
    // A shape the runner cannot judge is a block, never a default: a runner that folds a
    // missing collection into `[]` or a string roster into a one-element list judges an
    // input nobody wrote, and the recording module would see the dispatch.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    const { covenant, calls } = recordingCovenant([]);

    const result = await runCovenantCheck({
      repoRoot,
      input: ir([writeCall(ORDINARY_FILE)], extra),
      telemetryPath,
      covenant,
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
    expect(dispatches(calls)).toEqual([]);
  });
});
