import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transcriptFromJsonl, transcriptFromJsonlFile } from '../src/transcript.ts';

// JSONL vocabulary (`origin`, `subagent_type`, ISO timestamps) lives in this test file and
// in the adapter — never in core.

const TOKEN = 'PDKS-WITNESS-42';

/** A real human-typed entry: origin.kind === 'human', string content, ISO timestamp. */
function humanEntry(content: string, timestamp?: string) {
  return {
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: '/repo',
    origin: { kind: 'human' },
    promptSource: 'typed',
    type: 'user',
    message: { role: 'user', content },
    ...(timestamp === undefined ? {} : { timestamp }),
    uuid: 'u-human',
  };
}

/** An AI-controlled surface (subagent output). Token-smuggling forgery vector. */
function taskNotificationEntry(content: string) {
  return {
    userType: 'external',
    origin: { kind: 'task-notification' },
    promptSource: 'system',
    type: 'user',
    message: { role: 'user', content },
    timestamp: '2026-07-21T04:01:00.000Z',
    uuid: 'u-notif',
  };
}

/** A tool_result injection: user-role entry whose content is an array of blocks, no origin. */
function toolResultEntry(text: string) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: text }],
    },
    timestamp: '2026-07-21T04:02:00.000Z',
    uuid: 'u-toolresult',
  };
}

/** A slash-command wrapper / legacy shape: string content but NO origin field. */
function commandWrapperEntry(content: string) {
  return {
    type: 'user',
    message: { role: 'user', content },
    timestamp: '2026-07-21T04:03:00.000Z',
    uuid: 'u-command',
  };
}

/** An assistant entry spawning subagents via tool_use blocks. */
function assistantSpawnEntry(blocks: unknown[]) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: blocks },
    timestamp: '2026-07-21T04:04:00.000Z',
    uuid: 'a-spawn',
  };
}

/** Join an array of entry objects as JSONL text (one JSON object per line). */
function toJsonl(entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
}

describe('findUserMessages — human-utterance trust contract', () => {
  it('extracts origin.kind==="human" string entries as {text, timestampMs}, order preserved', () => {
    const jsonl = toJsonl([
      humanEntry('first human line', '2026-07-21T04:00:00.000Z'),
      humanEntry('second human line', '2026-07-21T04:05:00.000Z'),
    ]);

    const messages = transcriptFromJsonl(jsonl).findUserMessages();

    expect(messages).toEqual([
      { text: 'first human line', timestampMs: Date.parse('2026-07-21T04:00:00.000Z') },
      { text: 'second human line', timestampMs: Date.parse('2026-07-21T04:05:00.000Z') },
    ]);
  });

  it('excludes user entries whose content is an array of tool_result blocks', () => {
    // tool_result injections are the largest user-role surface in a real transcript and none
    // of them is a human utterance; without the plain-string check that whole surface would
    // flow into the witness.
    const jsonl = toJsonl([toolResultEntry(`smuggled ${TOKEN}`)]);

    expect(transcriptFromJsonl(jsonl).findUserMessages()).toEqual([]);
  });

  it('excludes origin.kind==="task-notification" entries even when the text carries a token', () => {
    // task-notification is an AI-controlled surface. Relaxing the origin.kind==="human"
    // allowlist to "origin present" or "any user entry" would let a subagent self-issue a
    // witness by printing the token here.
    const jsonl = toJsonl([
      taskNotificationEntry(`<task-notification>${TOKEN}</task-notification>`),
    ]);

    expect(transcriptFromJsonl(jsonl).findUserMessages()).toEqual([]);
  });

  it('excludes string-content user entries that have no origin field (command wrappers, legacy)', () => {
    // Absence of origin means the entry cannot be positively identified as human. Reducing
    // the check to "content is a string" would admit slash-command wrappers and isMeta
    // injections.
    const jsonl = toJsonl([commandWrapperEntry('<command-name>/clear</command-name>')]);

    expect(transcriptFromJsonl(jsonl).findUserMessages()).toEqual([]);
  });

  it('keeps a human entry with an absent/unparseable timestamp, exposing timestampMs undefined', () => {
    // This provider reports facts and judges nothing: a missing or non-ISO timestamp keeps
    // the message with timestampMs undefined, so the witness consumer applies its own
    // fail-closed rule. A Date.parse NaN collapses to undefined rather than a number.
    const jsonl = toJsonl([
      humanEntry('no timestamp here'),
      humanEntry('bad timestamp here', 'not-an-iso-date'),
    ]);

    expect(transcriptFromJsonl(jsonl).findUserMessages()).toEqual([
      { text: 'no timestamp here', timestampMs: undefined },
      { text: 'bad timestamp here', timestampMs: undefined },
    ]);
  });

  it('keeps only human entries when all entry shapes are interleaved (blocklist would leak)', () => {
    // Every non-human shape at once: removing any single exclusion branch lets an extra
    // entry through here, which a blocklist written shape by shape would not catch.
    const jsonl = toJsonl([
      toolResultEntry('ignored'),
      humanEntry('human A', '2026-07-21T04:00:00.000Z'),
      taskNotificationEntry(`notif ${TOKEN}`),
      commandWrapperEntry('<command-name>/clear</command-name>'),
      humanEntry('human B', '2026-07-21T04:06:00.000Z'),
      assistantSpawnEntry([{ type: 'text', text: 'assistant prose' }]),
    ]);

    expect(transcriptFromJsonl(jsonl).findUserMessages()).toEqual([
      { text: 'human A', timestampMs: Date.parse('2026-07-21T04:00:00.000Z') },
      { text: 'human B', timestampMs: Date.parse('2026-07-21T04:06:00.000Z') },
    ]);
  });
});

describe('alias safety — query results are fresh objects', () => {
  it('returns fresh objects — mutating a query result does not corrupt the snapshot', () => {
    // Alias-safety is part of the CanonicalTranscript contract: returning filter() results
    // as live aliases into the snapshot would let a consumer writing message.text rewrite
    // what every later query reads.
    const jsonl = toJsonl([humanEntry('hello', '2026-07-21T04:00:00.000Z')]);
    const transcript = transcriptFromJsonl(jsonl);

    const [message] = transcript.findUserMessages();
    message.text = 'rewritten';

    expect(transcript.findUserMessages()[0]?.text).toBe('hello');
  });
});

describe('robustness — malformed input reduces evidence, never throws', () => {
  it('skips only the broken/non-object lines and still extracts the surrounding valid ones', () => {
    // A broken line must be skipped alone: a parse failure that throws blanks the whole
    // transcript and crashes the hook, and one that aborts the scan silently discards every
    // entry after it.
    const jsonl = [
      JSON.stringify(humanEntry('before break', '2026-07-21T04:00:00.000Z')),
      '{broken',
      '"a bare json string, not an object"',
      '42',
      JSON.stringify(humanEntry('after break', '2026-07-21T04:07:00.000Z')),
    ].join('\n');

    let messages: ReturnType<ReturnType<typeof transcriptFromJsonl>['findUserMessages']> = [];
    expect(() => {
      messages = transcriptFromJsonl(jsonl).findUserMessages();
    }).not.toThrow();

    expect(messages).toEqual([
      { text: 'before break', timestampMs: Date.parse('2026-07-21T04:00:00.000Z') },
      { text: 'after break', timestampMs: Date.parse('2026-07-21T04:07:00.000Z') },
    ]);
  });

  it('answers undefined for a nonexistent file — absence, not an empty session', () => {
    // undefined leaves the dispatcher on its noop default, so the witness stays shut either
    // way — but an unreadable file must not impersonate a session that has said nothing. The
    // two demand opposite dispositions from the context family (judge an empty session, skip
    // an absent one), and collapsing them blocked in-scope edits for the rest of a session
    // with no message naming the cause.
    const dir = mkdtempSync(join(tmpdir(), 'pdks-transcript-'));
    const missingPath = join(dir, 'does-not-exist.jsonl');
    try {
      // Calling it directly IS the no-throw assertion — a raise fails the test outright.
      expect(transcriptFromJsonlFile(missingPath)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still answers an empty-but-real transcript for a file that exists and is empty', () => {
    // The contrast to the case above: a readable file with nothing in it IS a session, and
    // the context family must judge against it rather than skip.
    const dir = mkdtempSync(join(tmpdir(), 'pdks-transcript-'));
    const emptyPath = join(dir, 'empty.jsonl');
    try {
      writeFileSync(emptyPath, '');
      const transcript = transcriptFromJsonlFile(emptyPath);

      expect(transcript).toBeDefined();
      expect(transcript?.findUserMessages()).toEqual([]);
      // The success branch of the file wrapper is only exercised here, so both queries
      // are pinned.
      expect(transcript?.findToolCalls()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('findToolCalls — tool-call extraction from tool_use blocks', () => {
  it('extracts {name, args} from tool_use blocks across entries, observation order preserved', () => {
    const jsonl = toJsonl([
      assistantSpawnEntry([
        { type: 'text', text: 'let me check the registry first' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm view yaml version' } },
        { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/package.json' } },
      ]),
      humanEntry('carry on', '2026-07-26T01:00:00.000Z'),
      assistantSpawnEntry([
        {
          type: 'tool_use',
          id: 't3',
          name: 'mcp__context7__get-library-docs',
          input: { context7CompatibleLibraryID: '/eemeli/yaml' },
        },
      ]),
    ]);

    // Every fixture in this describe block is resultless, so the result join reports
    // `succeeded: false` throughout — the outcome axis itself is pinned in
    // transcript-tool-results.test.ts; here it is only part of the extracted shape.
    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: 'Bash', args: { command: 'npm view yaml version' }, succeeded: false },
      { name: 'Read', args: { file_path: '/repo/package.json' }, succeeded: false },
      {
        name: 'mcp__context7__get-library-docs',
        args: { context7CompatibleLibraryID: '/eemeli/yaml' },
        succeeded: false,
      },
    ]);
  });

  it('filters by exact tool name when given, and returns every call when omitted', () => {
    // The filter is strict name equality: the fixture carries a prefix-sharing tool
    // (BashOutput) so a startsWith/includes comparison would leak it in.
    const jsonl = toJsonl([
      assistantSpawnEntry([
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm view yaml version' } },
        { type: 'tool_use', id: 't2', name: 'BashOutput', input: { bash_id: 'b1' } },
      ]),
      assistantSpawnEntry([
        { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'pnpm build' } },
      ]),
    ]);
    const transcript = transcriptFromJsonl(jsonl);

    expect(transcript.findToolCalls('Bash')).toEqual([
      { name: 'Bash', args: { command: 'npm view yaml version' }, succeeded: false },
      { name: 'Bash', args: { command: 'pnpm build' }, succeeded: false },
    ]);
    expect(transcript.findToolCalls()).toHaveLength(3);
  });

  it('excludes tool_use blocks whose name is not a string (numeric or absent)', () => {
    // A block that cannot prove a string name is dropped: a {name: 42} or {name: undefined}
    // phantom call is something a tool evidence regex could then match.
    const jsonl = toJsonl([
      assistantSpawnEntry([
        { type: 'tool_use', id: 't1', name: 42, input: { command: 'ls' } },
        { type: 'tool_use', id: 't2', input: { command: 'ls' } },
        { type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: '/repo/a.ts' } },
      ]),
    ]);

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: 'Edit', args: { file_path: '/repo/a.ts' }, succeeded: false },
    ]);
  });

  it('keeps a block whose input is not a plain object, reducing args to {} — call still counts', () => {
    // A string/array/null/absent input empties the args but the call itself remains
    // evidence — dropping the block would flip a requirePrecedent gate from found to
    // missing for a name-only pattern. An array is included deliberately: it passes
    // typeof === 'object' and would be written through as args by a laxer check.
    const jsonl = toJsonl([
      assistantSpawnEntry([
        { type: 'tool_use', id: 't1', name: 'Glob', input: 'src/**/*.ts' },
        { type: 'tool_use', id: 't2', name: 'Grep', input: ['pattern'] },
        { type: 'tool_use', id: 't3', name: 'WebFetch', input: null },
        { type: 'tool_use', id: 't4', name: 'TodoWrite' },
        { type: 'tool_use', id: 't5', name: 'Edit', input: { file_path: '/repo/a.ts' } },
      ]),
    ]);

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: 'Glob', args: {}, succeeded: false },
      { name: 'Grep', args: {}, succeeded: false },
      { name: 'WebFetch', args: {}, succeeded: false },
      { name: 'TodoWrite', args: {}, succeeded: false },
      { name: 'Edit', args: { file_path: '/repo/a.ts' }, succeeded: false },
    ]);
  });

  it('skips broken/non-object lines without affecting extraction from surrounding lines', () => {
    const jsonl = [
      JSON.stringify(
        assistantSpawnEntry([
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'a' } },
        ]),
      ),
      '{broken',
      '42',
      JSON.stringify(
        assistantSpawnEntry([
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'b' } },
        ]),
      ),
    ].join('\n');

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: 'Bash', args: { command: 'a' }, succeeded: false },
      { name: 'Bash', args: { command: 'b' }, succeeded: false },
    ]);
  });

  it('reports a subagent spawn as an ordinary tool call, args intact', () => {
    // A spawn block is a tool_use like any other; it carries subagent_type in its args and
    // gets no special casing. Catches a spawn-shaped block being filtered out of the call
    // stream on the theory that it is "not really" a tool call.
    const jsonl = toJsonl([
      humanEntry('please run the tdd cycle', '2026-07-26T01:00:00.000Z'),
      assistantSpawnEntry([
        { type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'tdd-implementer' } },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'pnpm test' } },
      ]),
    ]);
    const transcript = transcriptFromJsonl(jsonl);

    expect(transcript.findToolCalls()).toEqual([
      { name: 'Task', args: { subagent_type: 'tdd-implementer' }, succeeded: false },
      { name: 'Bash', args: { command: 'pnpm test' }, succeeded: false },
    ]);
    expect(transcript.findUserMessages()).toEqual([
      { text: 'please run the tdd cycle', timestampMs: Date.parse('2026-07-26T01:00:00.000Z') },
    ]);
  });

  it('returns fresh objects — mutating a returned call or its args leaves later queries intact', () => {
    // Alias-safety extended to the nested args object: a shallow copy would share args with
    // the snapshot, so writing call.args.subagent_type rewrites what a later findToolCalls
    // returns.
    const jsonl = toJsonl([
      assistantSpawnEntry([
        { type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'tdd-writer' } },
      ]),
    ]);
    const transcript = transcriptFromJsonl(jsonl);

    const [call] = transcript.findToolCalls();
    call.name = 'rewritten';
    call.args.subagent_type = 'rewritten';

    expect(transcript.findToolCalls()).toEqual([
      { name: 'Agent', args: { subagent_type: 'tdd-writer' }, succeeded: false },
    ]);
  });
});
