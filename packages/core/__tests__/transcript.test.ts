import { describe, expect, it } from 'vitest';
// Imported through the package entry point — the same surface `@polydeukes/core` publishes.
import type { CovenantInput } from '../src/index.ts';
import { noopTranscript, transcriptFromInput } from '../src/index.ts';

/** Build a CovenantInput with the given spawns and user-message texts. */
function inputWith(subagentSpawns: { kind: string }[], userMessageTexts: string[]): CovenantInput {
  return {
    toolCalls: [],
    subagentSpawns,
    userMessages: userMessageTexts.map((text) => ({ text })),
  };
}

describe('transcriptFromInput — IR-backed implementation', () => {
  it('exposes input.userMessages in order via findUserMessages() with timestampMs absent', () => {
    // The IR carries no timestamps, so an absent timestampMs (freshness unprovable) is the
    // signal a witness consumer fails closed on. The key must be OMITTED, not present with
    // an undefined value, so key-presence checks and JSON round-trips agree about absence;
    // a fabricated Date.now() would open that valve from nothing.
    const input = inputWith([], ['first', 'second']);

    const transcript = transcriptFromInput(input);
    const messages = transcript.findUserMessages();

    expect(messages).toEqual([{ text: 'first' }, { text: 'second' }]);
    expect(messages.every((m) => !('timestampMs' in m))).toBe(true);
  });

  it('does not mutate the input object', () => {
    // The IR-backed implementation is read-only over its input; catches an in-place
    // normalization that rewrites the shared input object.
    const input = inputWith([{ kind: 'writer-kind' }], ['only']);
    const snapshot = structuredClone(input);

    const transcript = transcriptFromInput(input);
    transcript.findUserMessages();

    // Query results must be fresh objects, never live aliases into the shared IR —
    // a consumer mutating a result must not rewrite what other covenants judge.
    const [message] = transcript.findUserMessages();
    message.text = 'rewritten';

    expect(input).toEqual(snapshot);
  });
});

describe('noopTranscript — always-empty default', () => {
  it('returns [] from both queries, with and without a name argument', () => {
    // The injection-absent default answers "nothing happened", which lets a witness
    // consumer converge to fail-closed. A non-empty stub would fabricate evidence.
    expect(noopTranscript.findUserMessages()).toEqual([]);
    expect(noopTranscript.findToolCalls()).toEqual([]);
    expect(noopTranscript.findToolCalls('Edit')).toEqual([]);
  });
});
