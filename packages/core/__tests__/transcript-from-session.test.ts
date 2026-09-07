import { describe, expect, it } from 'vitest';
import type { CovenantInput } from '../src/protocol.ts';
import { parseInput } from '../src/protocol.ts';
import { transcriptFromSession } from '../src/transcript.ts';

// `transcriptFromSession(session)` wraps the IR's `session` key as a `CanonicalTranscript`.
// It differs from `transcriptFromInput` on exactly the two facts a session can prove and a
// bare IR cannot: `findUserMessages` carries `timestampMs` through (a witness consumer reads
// freshness from it) and `findToolCalls` carries `succeeded` through (a precedent consumer
// reads outcome from it). Same alias rules as the IR wrapper: fresh objects per query, the
// input never mutated.

// Tool names and texts are injected fixture values, never an agent's vocabulary.
const SHELL_TOOL = 'shell-tool';
const EDIT_TOOL = 'edit-tool';
const SENT_AT = Date.parse('2026-07-21T04:00:00.000Z');
const LATER_AT = SENT_AT + 60_000;

type Session = NonNullable<CovenantInput['session']>;

function sessionOf(overrides: Partial<Session> = {}): Session {
  return { userMessages: [], toolCalls: [], ...overrides };
}

describe('transcriptFromSession.findUserMessages — timestamps pass through', () => {
  it('carries timestampMs through in observation order, and leaves the key ABSENT where the session had none', () => {
    // The wrapper copied from `transcriptFromInput` projects `{ text }` alone and every
    // witness fails closed on a fresh token; a wrapper that fills a missing timestamp with
    // Date.now() opens the valve from nothing. The key must be omitted, not present as
    // undefined, so key-presence checks and JSON round-trips agree about absence.
    const transcript = transcriptFromSession(
      sessionOf({
        userMessages: [
          { text: 'first', timestampMs: SENT_AT },
          { text: 'second' },
          { text: 'third', timestampMs: LATER_AT },
        ],
      }),
    );

    const messages = transcript.findUserMessages();

    expect(messages).toEqual([
      { text: 'first', timestampMs: SENT_AT },
      { text: 'second' },
      { text: 'third', timestampMs: LATER_AT },
    ]);
    expect('timestampMs' in messages[1]).toBe(false);
  });
});

describe('transcriptFromSession.findToolCalls — outcome passes through', () => {
  it('carries succeeded through as true, false, or absent, with args defaulting to {}', () => {
    // A projection to `{ name, args }` (the IR wrapper's) drops the outcome and every
    // precedent gate closes on a call that provably ran; one that coerces absence to
    // false loses the "provider cannot observe results" state, and one that coerces to
    // true turns a refused call into evidence. Absent `args` reads as `{}` because the
    // transcript type requires the field.
    const transcript = transcriptFromSession(
      sessionOf({
        toolCalls: [
          { name: SHELL_TOOL, args: { command: 'fake-probe a' }, succeeded: true },
          { name: EDIT_TOOL, args: { path: 'src/a.ts' }, succeeded: false },
          { name: SHELL_TOOL },
        ],
      }),
    );

    const calls = transcript.findToolCalls();

    expect(calls).toEqual([
      { name: SHELL_TOOL, args: { command: 'fake-probe a' }, succeeded: true },
      { name: EDIT_TOOL, args: { path: 'src/a.ts' }, succeeded: false },
      { name: SHELL_TOOL, args: {} },
    ]);
    expect('succeeded' in calls[2]).toBe(false);
  });

  it('filters by exact name when given, preserving order, and answers [] for a name never called', () => {
    // Without the filter a discipline asking for shell calls sees every call — evidence
    // inflation in the fail-open direction. The two shell calls straddle another name so a
    // reorder shows.
    const transcript = transcriptFromSession(
      sessionOf({
        toolCalls: [
          { name: SHELL_TOOL, args: { command: 'a' }, succeeded: true },
          { name: EDIT_TOOL, args: { path: 'src/a.ts' }, succeeded: true },
          { name: SHELL_TOOL, args: { command: 'b' }, succeeded: false },
        ],
      }),
    );

    expect(transcript.findToolCalls(SHELL_TOOL)).toEqual([
      { name: SHELL_TOOL, args: { command: 'a' }, succeeded: true },
      { name: SHELL_TOOL, args: { command: 'b' }, succeeded: false },
    ]);
    expect(transcript.findToolCalls('never-called')).toEqual([]);
  });
});

describe('transcriptFromSession — alias safety', () => {
  it('returns fresh objects: mutating a result, its nested args, or a message never rewrites the session or a later query', () => {
    // A wrapper returning the session's own arrays (or shallow copies sharing `args`) lets
    // one covenant's consumer rewrite what the next covenant reads from the same IR.
    const session = sessionOf({
      userMessages: [{ text: 'hello', timestampMs: SENT_AT }],
      toolCalls: [{ name: SHELL_TOOL, args: { nested: { command: 'a' } }, succeeded: true }],
    });
    const snapshot = structuredClone(session);
    const transcript = transcriptFromSession(session);

    const [message] = transcript.findUserMessages();
    message.text = 'rewritten';
    const [call] = transcript.findToolCalls();
    call.name = 'rewritten';
    (call.args.nested as { command: string }).command = 'rewritten';

    expect(session).toEqual(snapshot);
    expect(transcript.findUserMessages()).toEqual([{ text: 'hello', timestampMs: SENT_AT }]);
    expect(transcript.findToolCalls()).toEqual([
      { name: SHELL_TOOL, args: { nested: { command: 'a' } }, succeeded: true },
    ]);
  });
});

describe('parseInput — the two session keys survive the stdin round-trip', () => {
  it('a payload carrying tools and session parses ok with both keys intact', () => {
    // The keys ride stdin-JSON into the runner. A parser that whitelists the four
    // pre-existing keys drops them silently, and a session-shaped IR then judges as a
    // bare one: no roster, no witness, no history — every valve closed and every routing
    // absent, with nothing on stderr saying why.
    const tools = { mutating: [EDIT_TOOL], shell: [SHELL_TOOL], commandArgs: ['command'] };
    const session: Session = {
      evidencePath: '/evidence/session.jsonl',
      userMessages: [{ text: 'hello', timestampMs: SENT_AT }],
      toolCalls: [{ name: SHELL_TOOL, args: { command: 'a' }, succeeded: true }],
      channels: { sidecar: '[]' },
    };

    const parsed = parseInput(
      JSON.stringify({ toolCalls: [], subagentSpawns: [], userMessages: [], tools, session }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.tools).toEqual(tools);
    expect(parsed.value.session).toEqual(session);
  });
});
