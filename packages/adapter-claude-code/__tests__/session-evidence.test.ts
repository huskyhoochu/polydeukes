import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// `sessionEvidenceFromPayload({ rawPayload })` builds the IR's `session` key from one
// PreToolUse payload: the JSONL transcript at `transcript_path` flattened to user messages
// (with timestamps) and tool calls (with outcomes), the spawn sidecar beside it as channel
// text, and the path itself as `evidencePath`. Two absences are two facts: no
// `transcript_path` is no session (`undefined`), a path that cannot be read is a supplier
// fault (a session whose lists are empty but whose `evidencePath` remains).
import { sessionEvidenceFromPayload } from '../src/session-evidence.ts';

// JSONL vocabulary (`origin`, ISO timestamps, `tool_use` / `tool_result`) lives in this
// test file and in the adapter — never in core.

const SESSION_ID = 'sess-1';
const SHELL_TOOL = 'Bash';
const READ_TOOL = 'Read';
const SENT_AT = '2026-07-21T04:00:00.000Z';
const WRITER_META = { agentType: 'tdd-test-writer', toolUseId: 't1', spawnDepth: 1 };

let dir: string;
let transcriptPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-session-evidence-'));
  transcriptPath = join(dir, `${SESSION_ID}.jsonl`);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A well-formed PreToolUse payload string carrying `overrides` on top of the envelope. */
function rawPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: '/repo',
    tool_name: 'Edit',
    tool_input: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' },
    ...overrides,
  });
}

/** A real human-typed entry: origin.kind === 'human', string content, ISO timestamp. */
function humanEntry(content: string, timestamp?: string) {
  return {
    origin: { kind: 'human' },
    promptSource: 'typed',
    type: 'user',
    message: { role: 'user', content },
    ...(timestamp === undefined ? {} : { timestamp }),
    uuid: 'u-human',
  };
}

/** An assistant entry carrying tool_use blocks. */
function assistantEntry(blocks: unknown[]) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: blocks },
    timestamp: '2026-07-21T04:01:00.000Z',
    uuid: 'a-1',
  };
}

/** A user entry carrying tool_result blocks — where real transcripts put results. */
function resultEntry(blocks: unknown[]) {
  return {
    type: 'user',
    message: { role: 'user', content: blocks },
    timestamp: '2026-07-21T04:01:01.000Z',
    uuid: 'u-1',
  };
}

function toJsonl(entries: unknown[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

/** A transcript with one timestamped human line, one successful and one failed tool call. */
function writeTranscript(): void {
  writeFileSync(
    transcriptPath,
    toJsonl([
      humanEntry('please run the probe', SENT_AT),
      assistantEntry([
        { type: 'tool_use', id: 'toolu_01', name: SHELL_TOOL, input: { command: 'fake-probe' } },
        { type: 'tool_use', id: 'toolu_02', name: READ_TOOL, input: { file_path: '/repo/x' } },
      ]),
      resultEntry([
        { type: 'tool_result', tool_use_id: 'toolu_01', content: 'ok' },
        { type: 'tool_result', tool_use_id: 'toolu_02', is_error: true, content: 'refused' },
      ]),
    ]),
  );
}

describe('sessionEvidenceFromPayload — session absence', () => {
  it('answers undefined for a payload without transcript_path', () => {
    // No path is no session. A builder that answers an empty session here makes every
    // session-free payload register transcript-mod over nothing and run the baseline
    // comparison as if a session were live.
    expect(sessionEvidenceFromPayload({ rawPayload: rawPayload() })).toBeUndefined();
  });

  it('answers undefined for a payload that is not JSON — never a throw', () => {
    // The parse failure belongs to the translator's verdict; a throw escaping this builder
    // would fail the caller closed before that verdict could land its row.
    expect(sessionEvidenceFromPayload({ rawPayload: 'PreToolUse{ not json' })).toBeUndefined();
  });
});

describe('sessionEvidenceFromPayload — supplier fault', () => {
  it('a transcript_path that cannot be read yields empty lists with evidencePath kept and no sidecar', () => {
    // The path names a file the host promised and did not deliver. Dropping to
    // `undefined` here would erase the distinction the runner acts on: transcript-mod
    // must still register over the path, while the witness and every history declaration
    // see an empty session and stay shut.
    const missing = join(dir, 'does-not-exist.jsonl');

    const session = sessionEvidenceFromPayload({
      rawPayload: rawPayload({ transcript_path: missing }),
    });

    expect(session).toBeDefined();
    expect(session?.evidencePath).toBe(missing);
    expect(session?.userMessages).toEqual([]);
    expect(session?.toolCalls).toEqual([]);
    expect(session?.channels?.sidecar).toBeUndefined();
  });
});

describe('sessionEvidenceFromPayload — a readable transcript', () => {
  it('flattens human messages with timestampMs and tool calls with succeeded, evidencePath = the path', () => {
    // The two facts the IR wrapper cannot carry must survive the flattening: a builder
    // projecting `{ text }` closes the witness on every fresh token, and one projecting
    // `{ name, args }` makes a refused call count as precedent.
    writeTranscript();

    const session = sessionEvidenceFromPayload({
      rawPayload: rawPayload({ transcript_path: transcriptPath }),
    });

    expect(session).toEqual({
      evidencePath: transcriptPath,
      userMessages: [{ text: 'please run the probe', timestampMs: Date.parse(SENT_AT) }],
      toolCalls: [
        { name: SHELL_TOOL, args: { command: 'fake-probe' }, succeeded: true },
        { name: READ_TOOL, args: { file_path: '/repo/x' }, succeeded: false },
      ],
    });
    expect(session?.channels?.sidecar).toBeUndefined();
  });

  it('carries the spawn sidecar beside the transcript as channels.sidecar, the record list as JSON text', () => {
    // The sidecar is derived from the transcript's location. A builder that never reads
    // it leaves every sidecar declaration judging absence on a session whose records are
    // on disk; one that resolves it against cwd reads another session's records.
    writeTranscript();
    const subagents = join(dir, SESSION_ID, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, 'agent-001.meta.json'), JSON.stringify(WRITER_META));

    const session = sessionEvidenceFromPayload({
      rawPayload: rawPayload({ transcript_path: transcriptPath }),
    });

    expect(session?.channels?.sidecar).toBeDefined();
    expect(JSON.parse(session?.channels?.sidecar as string)).toEqual([WRITER_META]);
  });
});

describe('sessionEvidenceFromPayload — a call made inside a subagent', () => {
  // The host sends a subagent's call with the parent's `transcript_path` and a top-level
  // `agent_id`; the subagent's own record sits at `<dir>/<session>/subagents/agent-<id>.jsonl`.
  // The parent and subagent files carry different calls so every assertion says which file
  // was read.
  const AGENT_ID = 'a7b52c110d65a4668';
  const PARENT_CALLS = [
    { name: SHELL_TOOL, args: { command: 'fake-probe' }, succeeded: true },
    { name: READ_TOOL, args: { file_path: '/repo/x' }, succeeded: false },
  ];
  const PARENT_HUMAN = [{ text: 'please run the probe', timestampMs: Date.parse(SENT_AT) }];
  const SUBAGENT_CALLS = [
    { name: SHELL_TOOL, args: { command: 'subagent-probe' }, succeeded: true },
  ];

  function subagentsDir(): string {
    return join(dir, SESSION_ID, 'subagents');
  }

  /** A subagent record: the prompt it was given (no `origin` — no human typed it), one call. */
  function writeSubagentRecord(path: string, command = 'subagent-probe'): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(
      path,
      toJsonl([
        {
          type: 'user',
          isSidechain: true,
          message: { role: 'user', content: 'subagent prompt text' },
          timestamp: '2026-07-21T04:02:00.000Z',
          uuid: 'u-sub',
        },
        assistantEntry([
          { type: 'tool_use', id: 'toolu_s1', name: SHELL_TOOL, input: { command } },
        ]),
        resultEntry([{ type: 'tool_result', tool_use_id: 'toolu_s1', content: 'ok' }]),
      ]),
    );
  }

  function evidence(overrides: Record<string, unknown>) {
    return sessionEvidenceFromPayload({
      rawPayload: rawPayload({ transcript_path: transcriptPath, ...overrides }),
    });
  }

  /** The session without `channels`: a `subagents/` directory on disk makes the sidecar `'[]'`, which the last case covers. */
  function lists(overrides: Record<string, unknown>) {
    const session = evidence(overrides);
    return {
      evidencePath: session?.evidencePath,
      userMessages: session?.userMessages,
      toolCalls: session?.toolCalls,
    };
  }

  it.each([AGENT_ID, 'Agent_x-1'])(
    'agent_id %s: tool calls from the subagent file, human messages and evidencePath from the parent',
    (id) => {
      // Reading tool calls from `transcript_path` judges a subagent on the parent's runs and
      // merges; reading human messages from the subagent file leaves the witness nothing to
      // read, and its plain prompt must not count as a human line. The second id carries
      // uppercase, `_` and `-`, which a pattern narrowed to the observed hex form refuses.
      writeTranscript();
      writeSubagentRecord(join(subagentsDir(), `agent-${id}.jsonl`));

      expect(lists({ agent_id: id })).toEqual({
        evidencePath: transcriptPath,
        userMessages: PARENT_HUMAN,
        toolCalls: SUBAGENT_CALLS,
      });
    },
  );

  it.each([
    ['absent', {}],
    ['the empty string', { agent_id: '' }],
  ] as const)(
    'agent_id %s reads both lists from the parent even with subagent files on disk',
    (_label, overrides) => {
      // The main session must be untouched. A record under `agent-.jsonl` is where an
      // implementation that treats '' as an id would read; one that picks any subagent file
      // whenever one exists reads the other.
      writeTranscript();
      writeSubagentRecord(join(subagentsDir(), `agent-${AGENT_ID}.jsonl`));
      writeSubagentRecord(join(subagentsDir(), 'agent-.jsonl'), 'empty-id-decoy');

      expect(lists(overrides)).toEqual({
        evidencePath: transcriptPath,
        userMessages: PARENT_HUMAN,
        toolCalls: PARENT_CALLS,
      });
    },
  );

  it('a subagent file that does not exist yields no tool calls, never the parent’s', () => {
    // Falling back to the parent's calls restores the reported defect: a subagent blocked on
    // the parent's history. The human messages and evidencePath stay the parent's.
    writeTranscript();

    expect(lists({ agent_id: AGENT_ID })).toEqual({
      evidencePath: transcriptPath,
      userMessages: PARENT_HUMAN,
      toolCalls: [],
    });
  });

  it('a subagent path that is a directory yields no tool calls and no throw', () => {
    // An EISDIR escaping the reader fails the hook closed on every call of that subagent;
    // treating it as absent-and-fall-back reads the parent's calls.
    writeTranscript();
    mkdirSync(join(subagentsDir(), `agent-${AGENT_ID}.jsonl`), { recursive: true });

    expect(lists({ agent_id: AGENT_ID })).toEqual({
      evidencePath: transcriptPath,
      userMessages: PARENT_HUMAN,
      toolCalls: [],
    });
  });

  it('a parent transcript that cannot be read empties both lists even when the subagent file exists', () => {
    // A missing parent is a supplier fault for the whole session. Filling tool calls from the
    // subagent file alone hands a history declaration a session with no human line, and the
    // evidencePath must stay so transcript-mod still registers over the parent.
    writeSubagentRecord(join(subagentsDir(), `agent-${AGENT_ID}.jsonl`));

    expect(lists({ agent_id: AGENT_ID })).toEqual({
      evidencePath: transcriptPath,
      userMessages: [],
      toolCalls: [],
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    'a subagent file refused by permissions yields no tool calls and no throw',
    () => {
      // An EACCES escaping the reader fails the hook closed on every call of that subagent;
      // treating it as absent-and-fall-back reads the parent's calls. Skipped as root, which
      // no mode can refuse.
      writeTranscript();
      const record = join(subagentsDir(), `agent-${AGENT_ID}.jsonl`);
      writeSubagentRecord(record);
      chmodSync(record, 0o000);
      try {
        expect(lists({ agent_id: AGENT_ID })).toEqual({
          evidencePath: transcriptPath,
          userMessages: PARENT_HUMAN,
          toolCalls: [],
        });
      } finally {
        chmodSync(record, 0o600);
      }
    },
  );

  it.each([
    ['a number', 42],
    ['null', null],
    ['an array', ['a']],
    ['a parent-directory hop', '../x'],
    ['a path separator', 'a/b'],
    ['a space', 'a b'],
    ['a bare ..', '..'],
  ] as const)('an agent_id that is %s opens no file and yields no tool calls', (_label, id) => {
    // A decoy sits where `agent-${String(id)}.jsonl` lands, so string coercion (42, null,
    // ['a'] → 'a') or a path built before validation reads it. Treating the value as no
    // agent_id reads the parent's calls instead; both leaks fail the empty list.
    writeTranscript();
    writeSubagentRecord(join(subagentsDir(), `agent-${String(id)}.jsonl`), 'decoy-probe');

    expect(lists({ agent_id: id })).toEqual({
      evidencePath: transcriptPath,
      userMessages: PARENT_HUMAN,
      toolCalls: [],
    });
  });

  it('keeps channels.sidecar what the parent session carries', () => {
    // The sidecar hangs off the parent's location. Re-deriving it from the subagent file
    // looks under `agent-<id>/subagents` and drops the spawn records.
    writeTranscript();
    writeSubagentRecord(join(subagentsDir(), `agent-${AGENT_ID}.jsonl`));
    writeFileSync(join(subagentsDir(), `agent-${AGENT_ID}.meta.json`), JSON.stringify(WRITER_META));

    const main = evidence({});
    const sub = evidence({ agent_id: AGENT_ID });

    expect(JSON.parse(sub?.channels?.sidecar as string)).toEqual([WRITER_META]);
    expect(sub?.channels).toEqual(main?.channels);
  });
});
