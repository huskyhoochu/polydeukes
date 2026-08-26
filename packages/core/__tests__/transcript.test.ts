import { describe, expect, it } from 'vitest';
// Imported through the package entry point — the same surface `@polydeukes/core` publishes.
import type {
  CanonicalTranscript,
  CovenantInput,
  SubagentInvocation,
  TranscriptUserMessage,
} from '../src/index.ts';
import { noopTranscript, transcriptFromInput } from '../src/index.ts';

// A fake transcript is built inline to prove the interface is consumable by covenant code
// with a stand-in, without any I/O.

/** Build a CovenantInput with the given spawns and user-message texts. */
function inputWith(subagentSpawns: { kind: string }[], userMessageTexts: string[]): CovenantInput {
  return {
    toolCalls: [],
    subagentSpawns,
    userMessages: userMessageTexts.map((text) => ({ text })),
  };
}

describe('§5.1 CanonicalTranscript — fake transcript consumable by the interface', () => {
  it('a fake transcript satisfies the type and findSubagentInvocations() returns every invocation in order', () => {
    // Covenant code must be able to drive the seam with a fake; catches an interface too
    // strict to accept one. The no-arg call returns ALL kinds, order preserved.
    const invocations: SubagentInvocation[] = [
      { kind: 'writer-kind' },
      { kind: 'reader-kind' },
      { kind: 'writer-kind' },
    ];
    const messages: TranscriptUserMessage[] = [];
    const fake: CanonicalTranscript = {
      findSubagentInvocations: () => invocations,
      findUserMessages: () => messages,
      findToolCalls: () => [],
    };

    expect(fake.findSubagentInvocations()).toEqual([
      { kind: 'writer-kind' },
      { kind: 'reader-kind' },
      { kind: 'writer-kind' },
    ]);
  });
});

describe('§5.1 transcriptFromInput — IR-backed implementation', () => {
  it('exposes input.subagentSpawns as invocations in observation order via findSubagentInvocations()', () => {
    // Observation order is load-bearing: catches spawns dropped, reordered, or a different
    // IR collection exposed instead.
    const input = inputWith([{ kind: 'writer-kind' }, { kind: 'reader-kind' }], []);

    const transcript = transcriptFromInput(input);

    expect(transcript.findSubagentInvocations()).toEqual([
      { kind: 'writer-kind' },
      { kind: 'reader-kind' },
    ]);
  });

  it('filters invocations by kind when a kind argument is given', () => {
    // Without the filter, a covenant asking for one kind would see all spawns.
    const input = inputWith(
      [{ kind: 'writer-kind' }, { kind: 'reader-kind' }, { kind: 'writer-kind' }],
      [],
    );

    const transcript = transcriptFromInput(input);

    expect(transcript.findSubagentInvocations('writer-kind')).toEqual([
      { kind: 'writer-kind' },
      { kind: 'writer-kind' },
    ]);
  });

  it('returns [] for an unknown kind', () => {
    // A kind that never occurred must yield the empty result, not all spawns (a fail-open
    // vector for a witness consumer) and not undefined.
    const input = inputWith([{ kind: 'writer-kind' }], []);

    const transcript = transcriptFromInput(input);

    expect(transcript.findSubagentInvocations('never-spawned')).toEqual([]);
  });

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
    transcript.findSubagentInvocations();
    transcript.findUserMessages();

    // Query results must be fresh objects, never live aliases into the shared IR —
    // a consumer mutating a result must not rewrite what other covenants judge.
    const [invocation] = transcript.findSubagentInvocations();
    invocation.kind = 'rewritten';
    const [message] = transcript.findUserMessages();
    message.text = 'rewritten';

    expect(input).toEqual(snapshot);
  });
});

describe('§5.1 noopTranscript — always-empty default', () => {
  it('returns [] from both queries, with and without a kind argument', () => {
    // The injection-absent default answers "nothing happened", which lets a witness
    // consumer converge to fail-closed. A non-empty stub would fabricate evidence.
    expect(noopTranscript.findSubagentInvocations()).toEqual([]);
    expect(noopTranscript.findSubagentInvocations('writer-kind')).toEqual([]);
    expect(noopTranscript.findUserMessages()).toEqual([]);
  });
});
