import { mkdtempSync, rmSync } from 'node:fs';
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

  it('returns an empty transcript (both queries []) for a nonexistent file, without throwing', () => {
    // P0 valve-off-not-valve-open: an unreadable/missing transcript file must degrade to zero
    // evidence, never a throw and never fabricated evidence. Mutation caught: the file wrapper
    // letting the fs error escape (crashing the hook) or returning a non-empty default.
    const dir = mkdtempSync(join(tmpdir(), 'pdks-transcript-'));
    const missingPath = join(dir, 'does-not-exist.jsonl');
    try {
      let transcript: ReturnType<typeof transcriptFromJsonlFile> | undefined;
      expect(() => {
        transcript = transcriptFromJsonlFile(missingPath);
      }).not.toThrow();

      expect(transcript?.findUserMessages()).toEqual([]);
      expect(transcript?.findSubagentInvocations()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
