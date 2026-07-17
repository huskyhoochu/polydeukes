import { describe, expect, it } from 'vitest';
// CORE-04 RED phase. Import from the package entry point (src/index.ts) — the same
// surface that `@polydeukes/core` will publish. `transcript.ts` and its re-exports do
// not exist yet, so this file is RED by construction (fails to compile / resolve). The
// signatures asserted here become the GREEN-phase contract (PRD §4.1/§4.2, §5.1).
import type {
  CanonicalTranscript,
  CovenantInput,
  SubagentInvocation,
  TranscriptUserMessage,
} from '../src/index.ts';
import { noopTranscript, transcriptFromInput } from '../src/index.ts';

// ---------------------------------------------------------------------------
// §5.1 interface + implementations — pure, no I/O. A fake transcript is built
// inline to prove the interface is consumable by covenant code with a stand-in
// (the roadmap acceptance: findSubagentInvocations works over a fake transcript).
// ---------------------------------------------------------------------------

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
    // Roadmap AC: covenant code must be able to drive the seam with a fake. Mutation
    // caught: a fake shape that a stricter interface would reject, or a query that
    // reorders/drops invocations. The no-arg call returns ALL kinds, order preserved.
    const invocations: SubagentInvocation[] = [
      { kind: 'writer-kind' },
      { kind: 'reader-kind' },
      { kind: 'writer-kind' },
    ];
    const messages: TranscriptUserMessage[] = [];
    const fake: CanonicalTranscript = {
      findSubagentInvocations: () => invocations,
      findUserMessages: () => messages,
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
    // Mutation caught: the spawns dropped, reordered, or a different collection
    // (toolCalls/userMessages) exposed instead. Order is load-bearing (PRD §4.1).
    const input = inputWith([{ kind: 'writer-kind' }, { kind: 'reader-kind' }], []);

    const transcript = transcriptFromInput(input);

    expect(transcript.findSubagentInvocations()).toEqual([
      { kind: 'writer-kind' },
      { kind: 'reader-kind' },
    ]);
  });

  it('filters invocations by kind when a kind argument is given', () => {
    // Mutation caught: the kind filter not applied on the IR-backed path, so a covenant
    // asking for one kind would see all spawns.
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
    // Boundary: a kind that never occurred must yield the empty result, not all spawns
    // (fail-open vector for a waiver consumer) and not undefined.
    const input = inputWith([{ kind: 'writer-kind' }], []);

    const transcript = transcriptFromInput(input);

    expect(transcript.findSubagentInvocations('never-spawned')).toEqual([]);
  });

  it('exposes input.userMessages in order via findUserMessages() with timestampMs absent', () => {
    // PRD §4.2/§2 contract: the IR carries no timestamps, so an absent timestampMs
    // (= freshness unprovable) is the signal a waiver consumer will fail-closed on.
    // The key must be OMITTED, not present with an undefined value, so key-presence
    // checks and JSON round-trips agree about absence. Mutation caught: a fabricated
    // timestamp (Date.now()) injected, a present-but-undefined key, or order lost.
    const input = inputWith([], ['first', 'second']);

    const transcript = transcriptFromInput(input);
    const messages = transcript.findUserMessages();

    expect(messages).toEqual([{ text: 'first' }, { text: 'second' }]);
    expect(messages.every((m) => !('timestampMs' in m))).toBe(true);
  });

  it('does not mutate the input object', () => {
    // Invariant (PRD §4.2, input never mutated): the IR-backed implementation is
    // read-only over its input. Mutation caught: an in-place normalization that
    // rewrites userMessages / subagentSpawns on the shared input object.
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
    // PRD §4.2: the injection-absent default answers "nothing happened", which lets a
    // waiver consumer converge to fail-closed. Mutation caught: a default that returns a
    // non-empty stub, or that ignores the kind argument and returns something.
    expect(noopTranscript.findSubagentInvocations()).toEqual([]);
    expect(noopTranscript.findSubagentInvocations('writer-kind')).toEqual([]);
    expect(noopTranscript.findUserMessages()).toEqual([]);
  });
});
