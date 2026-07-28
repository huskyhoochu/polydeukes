import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// ADAPTER-04 RED phase. The JSONL-backed CanonicalTranscript provider does not exist
// yet, so this import is unresolvable and the whole file is RED by construction. The
// behaviours asserted here become the GREEN contract (PRD §4.2–4.4, §5.1/5.3/5.4).
import { transcriptFromJsonl, transcriptFromJsonlFile } from '../src/transcript.ts';

// ---------------------------------------------------------------------------
// Fixtures — realistic Claude Code transcript JSONL entries (PRD §4 profiling).
// JSONL vocabulary (`origin`, `subagent_type`, ISO timestamps) lives in this test
// file and in the adapter — never in core (CORE-04 §5.3 isolation gate).
// ---------------------------------------------------------------------------

const TOKEN = 'PDKS-WAIVER-42';

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

// ===========================================================================
// §5.1 — human-utterance extraction (findUserMessages trust contract, PRD §4.2)
// ===========================================================================

describe('§5.1 findUserMessages — human-utterance trust contract', () => {
  it('extracts origin.kind==="human" string entries as {text, timestampMs}, order preserved', () => {
    // P0 business rule: only positively-identified human entries surface, and they surface
    // in observation order with the ISO timestamp converted to epoch ms. Mutation caught:
    // Date.parse dropped (timestampMs undefined for a parseable ts), the text field mapped
    // from the wrong path, or the observation order reversed/reordered.
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
    // P0 fail-closed: tool_result injections (3,400+ real entries) are not human utterances.
    // Mutation caught: the "content must be a plain string" check dropped, letting an array
    // content through — a huge non-human surface would then flow into the waiver.
    const jsonl = toJsonl([toolResultEntry(`smuggled ${TOKEN}`)]);

    expect(transcriptFromJsonl(jsonl).findUserMessages()).toEqual([]);
  });

  it('excludes origin.kind==="task-notification" entries even when the text carries a token', () => {
    // P0 forgery vector: task-notification is an AI-controlled surface. A token smuggled
    // there must NOT count as a human utterance. Mutation caught: the origin.kind==="human"
    // allowlist relaxed to "origin present" or "any user entry" — the single most dangerous
    // fail-open hole in this file (a subagent could then self-issue waivers).
    const jsonl = toJsonl([
      taskNotificationEntry(`<task-notification>${TOKEN}</task-notification>`),
    ]);

    expect(transcriptFromJsonl(jsonl).findUserMessages()).toEqual([]);
  });

  it('excludes string-content user entries that have no origin field (command wrappers, legacy)', () => {
    // P0 allowlist: absence of origin means the entry cannot be positively identified as
    // human. Mutation caught: the origin presence/kind check reduced to "content is a
    // string", which would admit slash-command wrappers and isMeta injections.
    const jsonl = toJsonl([commandWrapperEntry('<command-name>/clear</command-name>')]);

    expect(transcriptFromJsonl(jsonl).findUserMessages()).toEqual([]);
  });

  it('keeps a human entry with an absent/unparseable timestamp, exposing timestampMs undefined', () => {
    // P1 fact-only supplier: a missing or non-ISO timestamp must NOT drop the message — it
    // is kept with timestampMs undefined so the waiver consumer applies its own fail-closed
    // rule. Mutation caught: the entry being dropped when timestamp is absent, or Date.parse
    // NaN being written through as a number instead of collapsed to undefined.
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
    // P0 composite invariant: given every non-human shape mixed with humans, exactly the two
    // human entries survive, in order. Mutation caught: any single exclusion branch removed
    // (tool_result / task-notification / no-origin) would let an extra entry through here.
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

// ===========================================================================
// §5.3 — spawn query (findSubagentInvocations by field presence, PRD §4.3)
// ===========================================================================

describe('§5.3 findSubagentInvocations — detection by subagent_type field presence', () => {
  it('yields {kind} for every tool_use block with a string subagent_type, order preserved', () => {
    // P1 field-presence contract: detection keys on input.subagent_type, NOT on tool name
    // (real tools have been renamed Task -> Agent). Here blocks are named "Agent" and "Task"
    // and both surface, in order; the optional kind filter narrows to an exact match.
    // Mutation caught: detection keyed off block.name instead of input.subagent_type, or the
    // kind filter comparing with != instead of ===, or order not preserved.
    const jsonl = toJsonl([
      assistantSpawnEntry([
        { type: 'tool_use', id: 'x', name: 'Agent', input: { subagent_type: 'tdd-writer' } },
        { type: 'tool_use', id: 'y', name: 'Task', input: { subagent_type: 'tdd-implementer' } },
      ]),
    ]);
    const transcript = transcriptFromJsonl(jsonl);

    expect(transcript.findSubagentInvocations()).toEqual([
      { kind: 'tdd-writer' },
      { kind: 'tdd-implementer' },
    ]);
    expect(transcript.findSubagentInvocations('tdd-implementer')).toEqual([
      { kind: 'tdd-implementer' },
    ]);
  });

  it('excludes tool_use blocks with no string subagent_type (default-agent spawns, Bash calls)', () => {
    // P1 evidence-reduction: a block that cannot prove its kind is dropped (safe direction).
    // Mutation caught: the "subagent_type is a string" check removed, which would emit a
    // {kind: undefined} phantom invocation for a Bash call or a default-agent spawn.
    const jsonl = toJsonl([
      assistantSpawnEntry([
        { type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: 'z', name: 'Agent', input: { prompt: 'no subagent_type here' } },
        { type: 'tool_use', id: 'w', name: 'Agent', input: { subagent_type: 'code-reviewer' } },
      ]),
    ]);

    expect(transcriptFromJsonl(jsonl).findSubagentInvocations()).toEqual([
      { kind: 'code-reviewer' },
    ]);
  });

  it('returns fresh objects — mutating a query result does not corrupt the snapshot', () => {
    // PR-review finding: alias-safety is the CanonicalTranscript contract the core
    // transcriptFromInput pins (core transcript tests) — queries must return fresh objects.
    // Mutation caught: filter() results returned as live aliases into the snapshot, so a
    // consumer writing invocation.kind would rewrite what every later query reads.
    const jsonl = toJsonl([
      assistantSpawnEntry([
        { type: 'tool_use', id: 'x', name: 'Agent', input: { subagent_type: 'tdd-writer' } },
      ]),
      humanEntry('hello', '2026-07-21T04:00:00.000Z'),
    ]);
    const transcript = transcriptFromJsonl(jsonl);

    const [invocation] = transcript.findSubagentInvocations();
    invocation.kind = 'rewritten';
    const [message] = transcript.findUserMessages();
    message.text = 'rewritten';

    expect(transcript.findSubagentInvocations()).toEqual([{ kind: 'tdd-writer' }]);
    expect(transcript.findUserMessages()[0]?.text).toBe('hello');
  });
});

// ===========================================================================
// §5.4 — robustness (all failures reduce evidence, never throw, PRD §4.4)
// ===========================================================================

describe('§5.4 robustness — malformed input reduces evidence, never throws', () => {
  it('skips only the broken/non-object lines and still extracts the surrounding valid ones', () => {
    // P0 fail-closed robustness: an unparseable line, a JSON non-object line, and a
    // shape-mismatched entry are each skipped silently; the remaining valid human entries
    // still surface. Mutation caught: a parse failure throwing (blanking the whole
    // transcript, or crashing the hook), or a broken line aborting the rest of the scan.
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
    // Valve-off-not-valve-open still holds: undefined leaves the dispatcher on its noop
    // default, so the waiver stays shut either way. What changed is that an unreadable
    // file no longer impersonates a session that has said nothing. The two demand
    // opposite dispositions from the context family — judge an empty session, skip an
    // absent one — and collapsing them blocked in-scope edits for the rest of a session
    // with no message naming the cause (COVENANT-13 §4.5). Mutation caught: the fs error
    // escaping (crashing the hook), or the empty-transcript fallback restored.
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
    // The contrast that makes the change meaningful: a readable file with nothing in it
    // is a session, and the context family must judge against it rather than skip.
    const dir = mkdtempSync(join(tmpdir(), 'pdks-transcript-'));
    const emptyPath = join(dir, 'empty.jsonl');
    try {
      writeFileSync(emptyPath, '');
      const transcript = transcriptFromJsonlFile(emptyPath);

      expect(transcript).toBeDefined();
      expect(transcript?.findUserMessages()).toEqual([]);
      expect(transcript?.findToolCalls()).toEqual([]);
      // The success branch of the file wrapper is only exercised here, so all three
      // queries are pinned — `subagent` is the waiver's sibling evidence vocabulary.
      expect(transcript?.findSubagentInvocations()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// COVENANT-13 §5.2(5) — findToolCalls (tool-call query; ADAPTER-04 §4.2 trust
// contract inherited: positive identification, every failure reduces evidence).
// RED phase: the query does not exist on the JSONL provider yet.
// ===========================================================================

describe('COVENANT-13 §5.2(5) findToolCalls — tool-call extraction from tool_use blocks', () => {
  it('extracts {name, args} from tool_use blocks across entries, observation order preserved', () => {
    // P0 extraction contract: every tool_use block with a string name surfaces as
    // {name, args} in observation order, across multiple assistant entries, args taken
    // from `input`. Mutation caught: args mapped from the wrong field, text blocks
    // emitted as calls, order lost, or entries after the first assistant entry dropped.
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

    // Every fixture in this describe block is resultless, so COVENANT-13b's join reports
    // `succeeded: false` throughout — the outcome axis itself is pinned next door in
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
    // P1 filter contract: findToolCalls('Bash') narrows by strict name equality — a
    // prefix-sharing tool (BashOutput) must not leak in. Mutation caught: the filter
    // comparing with startsWith/includes, keeping only the first match, or the
    // no-argument path returning a filtered subset.
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
    // P1 positive-identification allowlist: a block that cannot prove a string name is
    // dropped. Mutation caught: the string check relaxed, emitting a {name: 42} or
    // {name: undefined} phantom call that a tool evidence regex could then match.
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
    // P0 evidence-reduction boundary (PRD §4.3): a string/array/null/absent input empties
    // the args but the call itself remains evidence — dropping the block would flip a
    // requirePrecedent gate from found to missing for a name-only pattern. Mutation
    // caught: the block excluded instead of kept, or a non-plain input (an array passes
    // typeof === 'object') written through as args verbatim.
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
    // P0 fail-closed robustness (§5.4 pattern extended to the new query): a parse failure
    // must neither throw nor abort the scan. Mutation caught: an unparseable line
    // blanking the whole tool-call history (evidence lost beyond the broken line) or
    // crashing the hook assembly.
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

  it('coexists with the shipped queries — a subagent spawn is both a spawn and a tool call', () => {
    // P0 regression + disposition pin: adding the tool-call query must not change what
    // findUserMessages/findSubagentInvocations return, and a spawn block (a tool_use
    // identified by input.subagent_type) surfaces in BOTH findSubagentInvocations and
    // findToolCalls — two queries over the same fact. Mutation caught: spawn blocks
    // carved out of findToolCalls, or the single-pass scan consuming entries so a later
    // query sees fewer of them.
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
    expect(transcript.findSubagentInvocations()).toEqual([{ kind: 'tdd-implementer' }]);
  });

  it('returns fresh objects — mutating a returned call or its args leaves later queries intact', () => {
    // P1 alias-safety (the same contract the shipped queries pin), extended to the nested
    // args object. Mutation caught: a shallow copy sharing args with the snapshot, so
    // writing call.args.subagent_type would rewrite what a later findToolCalls — or the
    // spawn query reading the same block — returns.
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
    expect(transcript.findSubagentInvocations()).toEqual([{ kind: 'tdd-writer' }]);
  });
});
