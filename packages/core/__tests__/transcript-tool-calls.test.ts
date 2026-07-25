import { describe, expect, it } from 'vitest';
// COVENANT-13 §4.2 / AC §5.2.4 — the CanonicalTranscript seam gains `findToolCalls`, the
// first seam extension since CORE-04. `noopTranscript` answers [] (no evidence = precedent
// gate stays closed, fail-closed direction), and `transcriptFromInput` projects
// `input.toolCalls` down to `{ name, args }` — since CORE-06 a tool-call element also
// carries `fileChange` evidence, and that evidence vocabulary must NOT leak through the
// history-query seam. `findToolCalls` does not exist yet, so this file is RED by
// construction (runtime TypeError on the missing method).
import type { CovenantInput, TranscriptToolCall } from '../src/index.ts';
import { noopTranscript, transcriptFromInput } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures. Tool names are neutral injected values ('shell-tool'/'edit-tool'), never an
// agent's real vocabulary — those are values an adapter fills in, not the core's words.
// ---------------------------------------------------------------------------

/** Build a CovenantInput carrying only the given tool calls. */
function inputWithToolCalls(toolCalls: CovenantInput['toolCalls']): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [] };
}

describe('§4.2 noopTranscript.findToolCalls — always-empty default', () => {
  it('returns [] with and without a name argument', () => {
    // PRD §4.2: the injection-absent default answers "no evidence", which keeps the
    // requirePrecedent gate closed (fail-closed). Mutation caught: a default returning a
    // non-empty stub — fabricated evidence would open the precedent gate from nothing —
    // or one that returns undefined instead of an empty array.
    expect(noopTranscript.findToolCalls()).toEqual([]);
    expect(noopTranscript.findToolCalls('shell-tool')).toEqual([]);
  });
});

describe('§4.2 transcriptFromInput.findToolCalls — IR-backed projection', () => {
  it('projects input.toolCalls to { name, args } in observation order when no name is given', () => {
    // Mutation caught: calls dropped, reordered, args swapped between calls, or a
    // different IR collection (subagentSpawns) exposed instead. Distinctive args per call
    // make a field swap visible; toEqual is exact so any extra key also fails.
    const input = inputWithToolCalls([
      { name: 'shell-tool', args: { command: 'fake-probe pkg-a' } },
      { name: 'edit-tool', args: { path: 'src/a.ts' } },
      { name: 'shell-tool', args: { command: 'fake-probe pkg-b' } },
    ]);

    const transcript = transcriptFromInput(input);
    const calls: TranscriptToolCall[] = transcript.findToolCalls();

    expect(calls).toEqual([
      { name: 'shell-tool', args: { command: 'fake-probe pkg-a' } },
      { name: 'edit-tool', args: { path: 'src/a.ts' } },
      { name: 'shell-tool', args: { command: 'fake-probe pkg-b' } },
    ]);
  });

  it('filters by name when given, preserving order, and returns [] for a name never called', () => {
    // Mutation caught: the name filter not applied (a discipline asking for shell calls
    // would see every call — evidence inflation, fail-open direction), or an unknown name
    // yielding all calls / undefined instead of the empty result.
    const input = inputWithToolCalls([
      { name: 'shell-tool', args: { command: 'fake-probe pkg-a' } },
      { name: 'edit-tool', args: { path: 'src/a.ts' } },
      { name: 'shell-tool', args: { command: 'fake-probe pkg-b' } },
    ]);

    const transcript = transcriptFromInput(input);

    expect(transcript.findToolCalls('shell-tool')).toEqual([
      { name: 'shell-tool', args: { command: 'fake-probe pkg-a' } },
      { name: 'shell-tool', args: { command: 'fake-probe pkg-b' } },
    ]);
    expect(transcript.findToolCalls('never-called')).toEqual([]);
  });

  it('does not leak fileChange evidence through the projection (CORE-06 boundary)', () => {
    // PRD §4.2 (post-CORE-06 note): tool-call elements now carry per-call fileChange
    // evidence, but the transcript is a history-query seam and evidence is judgment input
    // — the two vocabularies stay separate. Mutation caught: a projection that spreads the
    // whole IR element ({ ...call }) instead of picking { name, args }.
    const input = inputWithToolCalls([
      {
        name: 'edit-tool',
        args: { path: 'src/a.ts' },
        fileChange: { kind: 'modify', path: 'src/a.ts', pre: 'old', post: 'new' },
      },
    ]);

    const transcript = transcriptFromInput(input);
    const calls = transcript.findToolCalls();

    expect(calls).toHaveLength(1);
    expect('fileChange' in calls[0]).toBe(false);
    expect(calls[0]).toEqual({ name: 'edit-tool', args: { path: 'src/a.ts' } });
  });

  it('returns fresh objects — mutating a result never rewrites the shared input IR', () => {
    // Invariant (CORE-04 alias contract, extended to the new query): results are fresh
    // objects, never live aliases into the shared IR — a consumer mutating a result must
    // not rewrite what other covenants judge. Both the element and its args are probed.
    // Mutation caught: the projection aliasing the IR element or its args object.
    const input = inputWithToolCalls([
      { name: 'shell-tool', args: { command: 'fake-probe pkg-a' } },
    ]);
    const snapshot = structuredClone(input);

    const transcript = transcriptFromInput(input);
    const [call] = transcript.findToolCalls();
    call.name = 'rewritten';
    call.args.command = 'rewritten';

    expect(input).toEqual(snapshot);
  });
});
