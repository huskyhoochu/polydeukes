import { describe, expect, it } from 'vitest';
import type { CovenantInput } from '../src/protocol.ts';
import type { TranscriptToolCall } from '../src/transcript.ts';
import { noopTranscript, transcriptFromInput } from '../src/transcript.ts';

// Tool names are neutral injected values ('shell-tool'/'edit-tool'), never an agent's real
// vocabulary — those are values an adapter fills in, not the core's words.

/** Build a CovenantInput carrying only the given tool calls. */
function inputWithToolCalls(toolCalls: CovenantInput['toolCalls']): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [] };
}

describe('noopTranscript.findToolCalls — always-empty default', () => {
  it('returns [] with and without a name argument', () => {
    // The injection-absent default answers "no evidence", which keeps the requirePrecedent
    // gate closed. A non-empty stub would open that gate from fabricated evidence.
    expect(noopTranscript.findToolCalls()).toEqual([]);
    expect(noopTranscript.findToolCalls('shell-tool')).toEqual([]);
  });
});

describe('transcriptFromInput.findToolCalls — IR-backed projection', () => {
  it('projects input.toolCalls to { name, args } in observation order when no name is given', () => {
    // Each call carries distinctive args so a swap between calls is visible, and the two
    // 'shell-tool' entries sit either side of a different name so a reorder shows up.
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
    // Without the filter a discipline asking for shell calls would see every call —
    // evidence inflation, in the fail-open direction.
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

  it('does not leak fileChange evidence through the projection', () => {
    // Tool-call elements carry per-call fileChange evidence, but the transcript is a
    // history-query seam and evidence is judgment input — the two vocabularies stay
    // separate. A projection that spreads the whole IR element instead of picking
    // { name, args } would leak one into the other.
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
    // Results are fresh objects, never live aliases into the shared IR — a consumer
    // mutating a result must not rewrite what other covenants judge. Both the element and
    // its nested args object are probed; aliasing either one alone would pass otherwise.
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
