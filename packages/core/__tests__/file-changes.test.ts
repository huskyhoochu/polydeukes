import { describe, expect, it } from 'vitest';
// COVENANT-10 §4.2 / AC §5.6 — CovenantInput gains an optional `fileChanges` array
// (agent-neutral pre/post evidence). `parseInput` validates only that it is an array
// (element shapes are intentionally NOT validated — the CORE-01 boundary), and never
// fabricates the key when absent (CORE-04 timestampMs precedent). These symbols are the
// GREEN contract; `FileChange` does not exist yet, so this file is RED by construction.
import { type CovenantInput, type FileChange, parseInput } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — a minimal valid input plus a fileChanges array covering pre=null
// (creation) and pre=string (modification).
// ---------------------------------------------------------------------------

const fileChanges: FileChange[] = [
  { path: 'src/a.ts', pre: 'const a = 1;', post: 'const a = 2;' },
  { path: 'src/b.ts', pre: null, post: 'export const b = 1;' },
];

const inputWithFileChanges: CovenantInput = {
  toolCalls: [{ name: 'edit', args: { path: 'src/a.ts' } }],
  subagentSpawns: [],
  userMessages: [],
  fileChanges,
};

describe('parseInput — fileChanges round-trip (PRD §4.2, AC §5.6)', () => {
  it('preserves a fileChanges array through a JSON round-trip', () => {
    // P1 round-trip atomicity: a payload carrying fileChanges must deserialize with the
    // array intact and identical. Mutation caught: the field dropped during validation, or
    // an element's pre/post/path rewritten (e.g. pre=null coerced to '').
    const result = parseInput(JSON.stringify(inputWithFileChanges));

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.fileChanges).toEqual(fileChanges);
    }
  });
});

describe('parseInput — fileChanges type validation (PRD §4.2)', () => {
  it('fails closed with exit 2 when fileChanges is present but an object (not an array)', () => {
    // P0 fail-closed: a present-but-malformed fileChanges must block, not be silently
    // ignored (a fail-open hole would let a covenant body reach a non-array and mis-judge).
    // Mutation caught: the Array.isArray check on fileChanges dropped or inverted.
    const payload = JSON.stringify({
      toolCalls: [],
      subagentSpawns: [],
      userMessages: [],
      fileChanges: { path: 'src/a.ts', pre: null, post: 'x' },
    });

    const result = parseInput(payload);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });

  it('fails closed with exit 2 when fileChanges is a string', () => {
    // P0 boundary partner: a string is a non-array JSON value that must also block.
    const result = parseInput(
      '{"toolCalls":[],"subagentSpawns":[],"userMessages":[],"fileChanges":"src/a.ts"}',
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });

  it('fails closed with exit 2 when fileChanges is a number', () => {
    // P0 boundary partner: a number is another non-array primitive that must block.
    const result = parseInput(
      '{"toolCalls":[],"subagentSpawns":[],"userMessages":[],"fileChanges":42}',
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.exitCode).toBe(2);
    }
  });
});

describe('parseInput — fileChanges absence (PRD §4.2, no key fabrication)', () => {
  it('accepts a payload without fileChanges and does not fabricate the key', () => {
    // P0 no-fabrication (CORE-04 timestampMs precedent): a legacy IR with no fileChanges
    // must parse AND the parsed value must not carry a fabricated `fileChanges` key. A
    // fabricated `[]` would be indistinguishable from an explicit empty array downstream.
    // Mutation caught: a default-fill assigning `fileChanges: []` when the key is absent.
    const result = parseInput(
      JSON.stringify({ toolCalls: [], subagentSpawns: [], userMessages: [] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect('fileChanges' in result.value).toBe(false);
    }
  });

  it('preserves an explicitly empty fileChanges array as an empty array', () => {
    // P1 across-boundary partner: an explicit `[]` is a present, valid array and must be
    // preserved distinct from absence. Mutation caught: empty array coerced to absent, or
    // an absence-only branch that also strips an explicit empty array.
    const result = parseInput(
      JSON.stringify({ toolCalls: [], subagentSpawns: [], userMessages: [], fileChanges: [] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value.fileChanges).toEqual([]);
    }
  });
});
