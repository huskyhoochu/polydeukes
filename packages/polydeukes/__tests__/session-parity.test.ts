import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  COMMAND_ARGS,
  MUTATING_TOOLS,
  runAdapterPath,
  SHELL_TOOLS,
  sessionEvidenceFromPayload,
} from '@polydeukes/adapter-claude-code';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// One payload, two paths, one verdict. The old path is the assembled session entry point
// `runClaudeCodeHook`; the new path is the adapter's translation captured at its dispatch
// seam, the session evidence read by `sessionEvidenceFromPayload`, and the two handed to
// `runCovenantCheck` with the host roster as `tools`. Exit codes must agree and the row
// sets must agree as `[event, subject]` — labels are not compared, because the unrouted
// pass row and the fail-closed row carry each path's own label.
//
// Each path gets its own fresh repository built the same way, so the baseline comparison
// starts from the same absent state on both sides. Absolute subjects are re-rooted before
// comparison so a path under one repository equals the same path under the other.
import { runClaudeCodeHook } from '../src/claude-code-hook.ts';
import { runCovenantCheck } from '../src/covenant-check.ts';
import { telemetryRows, writeConfigAt } from './helpers.ts';

/** Injected fixture values — protected entry, discipline targets, witness. */
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
const ORDINARY_FILE = 'notes/ordinary.txt';
const SCOPED_TARGET = 'lib/a.ts';
const PRE_STATE = 'locked: yes\n';
const WITNESS_TOKEN = 'agreed-token';
const TTL_MINUTES = 10;
const SOFT_ID = 'no-todo-softly';
const PRECEDENT_ID = 'lib-needs-fetch';
const PRECEDENT_TOOL = 'WebFetch';
const SESSION_SOURCE = 'session';
const SIDECAR_ID = 'lib-needs-writer-spawn';
const WRITER_AGENT = 'tdd-test-writer';
const SESSION_ID = 's-1';

const softEntry = {
  id: SOFT_ID,
  declare: {
    mechanism: 'added-only',
    scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: '(TODO)' }],
      after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: '(TODO)' }],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
    relate: [
      { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
    ],
  },
  enforce: 'advise',
};

const precedentEntry = {
  id: PRECEDENT_ID,
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
    sources: { [SESSION_SOURCE]: { transcript: true } },
    supply: { [SESSION_SOURCE]: 'pass' },
    extract: {
      fetched: [
        { op: 'source', of: SESSION_SOURCE },
        { op: 'toolUses', names: [PRECEDENT_TOOL] },
        { op: 'filter', when: [{ field: 'succeeded', eq: true }] },
      ],
    },
    relate: [
      {
        id: 'fetched-first',
        relation: { op: 'nonEmpty', of: 'fetched' },
        message: 'no successful fetch precedes this edit',
      },
    ],
  },
};

const sidecarEntry = {
  id: SIDECAR_ID,
  declare: {
    mechanism: 'precedent',
    scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
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

/** The evidence files (transcript, sidecar) and both telemetry logs live here, outside every repo. */
let outside: string;
const repoRoots: string[] = [];

beforeEach(() => {
  outside = mkdtempSync(join(tmpdir(), 'pdks-session-parity-outside-'));
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  for (const root of repoRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A fresh repository carrying `config`, the protected file, and a scoped target on disk. */
function makeRepo(config: Record<string, unknown>): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pdks-session-parity-'));
  repoRoots.push(repoRoot);
  writeConfigAt(repoRoot, join(outside, 'unused.log'), config);
  for (const [rel, content] of [
    [PROTECTED_FILE, PRE_STATE],
    [SCOPED_TARGET, 'export const y = 1;\n'],
  ] as const) {
    const absolute = join(repoRoot, rel);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return repoRoot;
}

type Payload = {
  tool_name: string;
  tool_input: Record<string, unknown>;
  transcript_path?: string;
};

/** A payload built against the repository each path receives — targets are absolute under it. */
type PayloadFor = (repoRoot: string) => Payload;

function rawPayloadFor(repoRoot: string, payloadFor: PayloadFor): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: repoRoot,
    ...payloadFor(repoRoot),
  });
}

function editPayload(relTarget: string, newString = 'locked: no'): PayloadFor {
  return (repoRoot) => ({
    tool_name: 'Edit',
    tool_input: {
      file_path: join(repoRoot, relTarget),
      old_string: relTarget === PROTECTED_FILE ? 'locked: yes' : 'export const y = 1;',
      new_string: newString,
    },
  });
}

/** A Write of `relTarget` under the repository, or of an absolute path outside it. */
function writePayload(target: string, content = 'nothing special\n'): PayloadFor {
  return (repoRoot) => ({
    tool_name: 'Write',
    tool_input: { file_path: target.startsWith('/') ? target : join(repoRoot, target), content },
  });
}

function bashPayload(command: string): PayloadFor {
  return () => ({ tool_name: 'Bash', tool_input: { command } });
}

function withTranscript(payloadFor: PayloadFor, transcript_path: string): PayloadFor {
  return (repoRoot) => ({ ...payloadFor(repoRoot), transcript_path });
}

/** A human-typed transcript line: origin.kind === 'human', string content, ISO timestamp. */
function humanLine(content: string, timestampMs?: number): string {
  return JSON.stringify({
    origin: { kind: 'human' },
    promptSource: 'typed',
    type: 'user',
    message: { role: 'user', content },
    ...(timestampMs === undefined ? {} : { timestamp: new Date(timestampMs).toISOString() }),
    uuid: 'u-human',
  });
}

/** A successful precedent-tool call: tool_use followed by a clean tool_result. */
function precedentLines(): string[] {
  return [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: PRECEDENT_TOOL, input: { url: 'https://x' } },
        ],
      },
      uuid: 'a-1',
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
      },
      uuid: 'u-1',
    }),
  ];
}

/** Write a transcript under `outside` as `<SESSION_ID>.jsonl` so a sidecar can sit beside it. */
function writeTranscript(lines: string[]): string {
  const path = join(outside, `${SESSION_ID}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function writeSidecar(transcriptPath: string): void {
  const subagents = join(dirname(transcriptPath), SESSION_ID, 'subagents');
  mkdirSync(subagents, { recursive: true });
  writeFileSync(
    join(subagents, 'agent-001.meta.json'),
    JSON.stringify({ agentType: WRITER_AGENT, toolUseId: 't1' }),
  );
}

/** The labels a call no registration routed passes under — the adapter funnel on the old path, the runner on the new. */
const UNROUTED_LABELS = new Set(['adapter-claude-code', 'covenant-check']);

/**
 * `[event, subject]` per row, absolute subjects re-rooted, sorted for set comparison.
 *
 * Two rows are projected narrower than the rest: an unrouted pass carries a different
 * subject on each path (`-` from the funnel, the path from the runner), so it compares on
 * the event alone; and baseline rows are left out entirely — the old path compares on every
 * call, the new one only under a session, and the session suite pins that directly.
 */
function projected(telemetryPath: string, repoRoot: string): [string, string][] {
  return telemetryRows(telemetryPath)
    .filter(([event]) => event !== 'unattributed')
    .map(([event, label, subject]): [string, string] => [
      event,
      UNROUTED_LABELS.has(label) && event === 'passed'
        ? '-'
        : subject.startsWith(repoRoot)
          ? `<root>${subject.slice(repoRoot.length)}`
          : subject,
    ])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

type ParityOutcome = { exitCode: number; rows: [string, string][] };

async function oldPath(
  config: Record<string, unknown>,
  payload: PayloadFor,
): Promise<ParityOutcome> {
  const repoRoot = makeRepo(config);
  const telemetryPath = join(outside, 'old.log');
  const result = await runClaudeCodeHook({
    repoRoot,
    rawPayload: rawPayloadFor(repoRoot, payload),
    telemetryPath,
  });
  return { exitCode: result.exitCode, rows: projected(telemetryPath, repoRoot) };
}

async function newPath(
  config: Record<string, unknown>,
  payload: PayloadFor,
): Promise<ParityOutcome> {
  const repoRoot = makeRepo(config);
  const rawPayload = rawPayloadFor(repoRoot, payload);
  let captured: string | undefined;
  await runAdapterPath({
    rawPayload,
    telemetryPath: join(outside, 'scratch.log'),
    dispatch: async (ir) => {
      captured = ir;
      return { exitCode: 0, results: [] };
    },
  });
  if (captured === undefined) throw new Error('the adapter never reached its dispatch seam');
  const translated = JSON.parse(captured) as CovenantInput;
  const telemetryPath = join(outside, 'new.log');
  const result = await runCovenantCheck({
    repoRoot,
    input: {
      ...translated,
      tools: { mutating: MUTATING_TOOLS, shell: SHELL_TOOLS, commandArgs: COMMAND_ARGS },
      session: sessionEvidenceFromPayload({ rawPayload }),
    },
    enforce: 'block',
    telemetryPath,
  });
  return { exitCode: result.exitCode, rows: projected(telemetryPath, repoRoot) };
}

/** Run both paths on one payload and pin them equal, plus the exit the case expects. */
async function expectParity(
  config: Record<string, unknown>,
  payload: PayloadFor,
  exitCode: 0 | 2,
): Promise<ParityOutcome> {
  const old = await oldPath(config, payload);
  const fresh = await newPath(config, payload);
  expect(fresh.exitCode).toBe(old.exitCode);
  expect(fresh.rows).toEqual(old.rows);
  expect(old.exitCode).toBe(exitCode);
  return old;
}

const BASE_CONFIG = { protectedPaths: [PROTECTED_ENTRY] };
const WITNESS_CONFIG = {
  ...BASE_CONFIG,
  witness: { token: WITNESS_TOKEN, ttlMinutes: TTL_MINUTES },
};

describe('session parity — meta-covenants', () => {
  it('a protected-path Edit blocks on both paths', async () => {
    // The roster must route the host's editor: a new path whose self-mod still routes on
    // the staged names exits 0 where the old one exits 2.
    const outcome = await expectParity(BASE_CONFIG, editPayload(PROTECTED_FILE), 2);
    expect(outcome.rows).toContainEqual(['blocked', PROTECTED_ENTRY]);
  });

  it('an unprotected Write passes on both paths', async () => {
    // The over-blocking end of the same axis.
    await expectParity(BASE_CONFIG, writePayload(ORDINARY_FILE), 0);
  });

  it('a Bash line mutating a protected path blocks on both paths', async () => {
    // The shell axis exists on the new path only through `tools.shell` and
    // `tools.commandArgs`; a new path that leaves shell-mod unregistered passes this.
    const outcome = await expectParity(BASE_CONFIG, bashPayload(`echo x >> ${PROTECTED_FILE}`), 2);
    expect(outcome.rows).toContainEqual(['blocked', PROTECTED_ENTRY]);
  });

  it('a Bash line with a read-only head over a protected path passes on both paths', async () => {
    await expectParity(BASE_CONFIG, bashPayload(`cat ${PROTECTED_FILE}`), 0);
  });
});

describe('session parity — the witness valve', () => {
  it('a fresh token utterance on the transcript witnesses the protected Edit on both paths — exit 0', async () => {
    // The new path reads freshness from `session.userMessages[].timestampMs`; a builder
    // or wrapper that drops the timestamp blocks where the old path witnesses.
    const transcript = writeTranscript([
      humanLine(`${WITNESS_TOKEN}\nproceed`, Date.now() - 1_000),
    ]);
    const outcome = await expectParity(
      WITNESS_CONFIG,
      withTranscript(editPayload(PROTECTED_FILE), transcript),
      0,
    );
    expect(outcome.rows).toContainEqual(['witnessed', PROTECTED_ENTRY]);
  });

  it('an expired token utterance blocks the protected Edit on both paths — exit 2', async () => {
    const transcript = writeTranscript([
      humanLine(`${WITNESS_TOKEN}\nproceed`, Date.now() - (TTL_MINUTES + 1) * 60_000),
    ]);
    const outcome = await expectParity(
      WITNESS_CONFIG,
      withTranscript(editPayload(PROTECTED_FILE), transcript),
      2,
    );
    expect(outcome.rows).toContainEqual(['blocked', PROTECTED_ENTRY]);
  });

  it('a Write targeting the transcript path itself blocks on both paths — transcript-mod', async () => {
    // `session.evidencePath` is what the new path registers transcript-mod over; without
    // it a forged utterance appended by Write passes and then witnesses itself.
    const transcript = writeTranscript([humanLine('hello', Date.now() - 1_000)]);
    await expectParity(
      BASE_CONFIG,
      withTranscript(writePayload(transcript, humanLine(WITNESS_TOKEN, Date.now())), transcript),
      2,
    );
  });
});

describe('session parity — disciplines', () => {
  it('an advise entry broken by a scoped Edit lands advised on both paths — exit 0', async () => {
    // The disk pre-state and the entry's own level both have to reach the new path: an
    // unobserved reader fails closed, and a dropped entry level blocks.
    const outcome = await expectParity(
      { ...BASE_CONFIG, disciplines: [softEntry] },
      editPayload(SCOPED_TARGET, 'export const y = 1;\n// TODO later'),
      0,
    );
    expect(outcome.rows).toContainEqual(['advised', SCOPED_TARGET]);
  });

  it('a precedent declaration is satisfied by a successful call on the transcript, on both paths', async () => {
    // `session.toolCalls[].succeeded` is the evidence; a new path binding the judged IR
    // instead of the session reports no precedent.
    const transcript = writeTranscript(precedentLines());
    const outcome = await expectParity(
      { ...BASE_CONFIG, disciplines: [precedentEntry] },
      withTranscript(editPayload(SCOPED_TARGET, 'export const y = 2;'), transcript),
      0,
    );
    expect(outcome.rows).toContainEqual(['passed', SCOPED_TARGET]);
  });

  it('a sidecar declaration is satisfied by the spawn records beside the transcript, on both paths', async () => {
    // `session.channels.sidecar` must reach the dispatched world's channels; a new path
    // that never lifts it there skips where the old path passes.
    const transcript = writeTranscript([humanLine('carry on', Date.now() - 1_000)]);
    writeSidecar(transcript);
    const outcome = await expectParity(
      { ...BASE_CONFIG, disciplines: [sidecarEntry] },
      withTranscript(editPayload(SCOPED_TARGET, 'export const y = 2;'), transcript),
      0,
    );
    expect(outcome.rows).toContainEqual(['passed', SCOPED_TARGET]);
  });
});

describe('session parity — a payload without a transcript', () => {
  it('a protected-path Edit with no transcript_path blocks on both paths with the same judgment rows', async () => {
    // `sessionEvidenceFromPayload` answers undefined, so the new path has no session and
    // runs no baseline comparison, while the old path always runs it: the two row sets are
    // compared without the baseline rows, and the judgment rows and exit must still agree.
    const config = BASE_CONFIG;
    const payload = editPayload(PROTECTED_FILE);
    const old = await oldPath(config, payload);
    const fresh = await newPath(config, payload);

    expect(fresh.exitCode).toBe(old.exitCode);
    expect(old.exitCode).toBe(2);
    const judged = (rows: [string, string][]) => rows.filter(([event]) => event !== 'unattributed');
    expect(judged(fresh.rows)).toEqual(judged(old.rows));
    expect(fresh.rows.filter(([event]) => event === 'unattributed')).toEqual([]);
  });
});
