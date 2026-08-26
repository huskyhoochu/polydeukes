import { describe, expect, it } from 'vitest';
// The adapter-owned evidence evaluator for the `subagent` and `tool` vocabularies. The hook
// assembly injects it into compileDisciplineRegistrations; core owns only the `command`
// vocabulary and validates the container shape, while the adapter validates and judges its
// own keys.
import { evaluatePrecedent } from '../src/precedent.ts';
import { transcriptFromJsonl } from '../src/transcript.ts';

const SPAWN_KIND = 'tdd-implementer';
const MCP_TOOL = 'mcp__context7__get-library-docs';

/**
 * An assistant entry carrying the given content blocks, followed by a clean result for each.
 * Evidence means a call that RAN and succeeded, so a resultless call proves nothing and every
 * fixture here would answer false for the wrong reason. The outcome axis itself is pinned in
 * precedent-execution.test.ts; these calls are plain successes so each assertion below stays
 * about the vocabulary it names.
 */
function transcriptWith(blocks: { id: string }[]) {
  return transcriptFromJsonl(
    [
      {
        type: 'assistant',
        message: { role: 'assistant', content: blocks },
        timestamp: '2026-07-26T02:00:00.000Z',
        uuid: 'a-1',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: blocks.map((block) => ({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'ok',
          })),
        },
        timestamp: '2026-07-26T02:00:01.000Z',
        uuid: 'u-1',
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n'),
  );
}

/**
 * A subagent spawn: a tool_use block identified by input.subagent_type.
 *
 * The caller supplies `id`: transcriptWith stamps one tool_result per block keyed on it, and
 * the join keeps the FIRST result per id, so two blocks sharing a literal would hand one
 * outcome to both.
 */
function spawnBlock(id: string, kind: string) {
  return { type: 'tool_use', id, name: 'Task', input: { subagent_type: kind } };
}

/** A plain tool call with the given tool name. `id` is the caller's, as above. */
function toolBlock(id: string, name: string) {
  return { type: 'tool_use', id, name, input: {} };
}

describe('COVENANT-13 §4.4 evaluatePrecedent — subagent evidence (exact spawn-kind match)', () => {
  it('returns true when a spawn of exactly the required kind exists in the transcript', () => {
    const transcript = transcriptWith([spawnBlock('toolu_spawn', SPAWN_KIND)]);

    expect(evaluatePrecedent({ subagent: SPAWN_KIND }, transcript)).toBe(true);
  });

  it('requires exact kind equality — substring and regex-shaped values stay false', () => {
    // The two vocabularies differ on purpose: `subagent` is a kind equality check, `tool` is
    // a regex. Reusing the tool-side matcher here would let 'tdd' or 'tdd-.*' claim a
    // 'tdd-implementer' spawn as evidence, widening the gate.
    const transcript = transcriptWith([spawnBlock('toolu_spawn', SPAWN_KIND)]);

    expect(evaluatePrecedent({ subagent: 'tdd' }, transcript)).toBe(false);
    expect(evaluatePrecedent({ subagent: 'tdd-.*' }, transcript)).toBe(false);
  });

  it('returns false — not undefined — when the required kind was never spawned', () => {
    // A recognized key with no evidence is a judged miss, which blocks. `undefined` is
    // reserved for unknown keys and makes assembly throw, so answering it here would turn
    // every unsatisfied discipline into a crash instead of a verdict.
    const transcript = transcriptWith([spawnBlock('toolu_spawn', 'code-reviewer')]);

    expect(evaluatePrecedent({ subagent: SPAWN_KIND }, transcript)).toBe(false);
  });

  it('answers undefined for a malformed value of the KNOWN subagent key — evaluation impossibility, not key recognition, drives the handshake', () => {
    // Core validates only the container and passes values verbatim, so a non-string value
    // arrives here and cannot be evaluated at all; the adapter declines with the same
    // undefined signal that makes assembly fail closed. `false` would be worse than a crash —
    // a gate no amount of actually spawning the subagent could ever open, with nothing
    // diagnosing why.
    const transcript = transcriptWith([spawnBlock('toolu_spawn', SPAWN_KIND)]);

    expect(evaluatePrecedent({ subagent: 123 }, transcript)).toBeUndefined();
  });
});

describe('COVENANT-13 §4.4 evaluatePrecedent — tool evidence (tool-name regex)', () => {
  it('returns true when an observed tool name matches the value as a regular expression', () => {
    // The value is honoured as a regex, not compared as a literal. Comparing with === here
    // (subagent semantics leaking into tool) makes every regex-valued discipline
    // unsatisfiable — a permanent block with no legitimate pass path.
    const transcript = transcriptWith([
      toolBlock('toolu_bash', 'Bash'),
      toolBlock('toolu_mcp', MCP_TOOL),
    ]);

    expect(evaluatePrecedent({ tool: '^mcp__' }, transcript)).toBe(true);
    expect(evaluatePrecedent({ tool: 'mcp__.*__get-library-docs' }, transcript)).toBe(true);
  });

  it('returns false — not undefined — when no observed tool name matches the pattern', () => {
    // The miss is a judged false, not the unknown-key signal — undefined here would crash
    // assembly instead of blocking the edit.
    const transcript = transcriptWith([toolBlock('toolu_bash', 'Bash')]);

    expect(evaluatePrecedent({ tool: '^mcp__' }, transcript)).toBe(false);
  });

  it('answers undefined for a non-compiling tool regex — an unevaluatable KNOWN key declines here and fails closed at assembly, never throws mid-judgment', () => {
    // '(' does not compile, so an unguarded `new RegExp` throws during evidence evaluation —
    // a crash, not a verdict. Declining with undefined lets assembly turn it into a loud,
    // diagnosable failure; `false` would instead bury a broken pattern as a gate that can
    // never open.
    const transcript = transcriptWith([toolBlock('toolu_mcp', MCP_TOOL)]);

    let verdict: boolean | undefined;
    expect(() => {
      verdict = evaluatePrecedent({ tool: '(' }, transcript);
    }).not.toThrow();
    expect(verdict).toBeUndefined();
  });
});

describe('COVENANT-13 §4.4 evaluatePrecedent — vocabulary boundary', () => {
  it('returns undefined for an evidence key outside the adapter vocabulary', () => {
    // undefined is the exact signal that makes compileDisciplineRegistrations throw on an
    // unrecognized key. Answering false for a typo'd key would silently convert a
    // misconfigured discipline into a permanent, unexplained block.
    const transcript = transcriptWith([
      spawnBlock('toolu_spawn', SPAWN_KIND),
      toolBlock('toolu_mcp', MCP_TOOL),
    ]);

    expect(evaluatePrecedent({ bogus: 'x' }, transcript)).toBeUndefined();
  });
});

// Each fixture call needs its own call id.

const SHELL_TOOL = 'Bash';
const SHELL_PATTERN = '^Bash$';
const MCP_FAILURE_CONTENT = 'Error: MCP server "context7" request failed: fetch failed';

/**
 * The two entries transcriptWith builds, with each result's outcome chosen by the caller.
 * Real transcripts carry no duplicate tool_use_id within one file, so the id collision this
 * exposes is a fixture artifact — which is why it stays invisible until a fixture mixes
 * outcomes, and why this one is built for discrimination rather than realism.
 */
function transcriptWithOutcomes(blocks: { id: string }[], failed: boolean[]) {
  return transcriptFromJsonl(
    [
      {
        type: 'assistant',
        message: { role: 'assistant', content: blocks },
        timestamp: '2026-08-12T02:00:00.000Z',
        uuid: 'a-1',
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: blocks.map((block, index) =>
            failed[index]
              ? {
                  type: 'tool_result',
                  tool_use_id: block.id,
                  is_error: true,
                  content: MCP_FAILURE_CONTENT,
                }
              : { type: 'tool_result', tool_use_id: block.id, content: 'ok' },
          ),
        },
        timestamp: '2026-08-12T02:00:01.000Z',
        uuid: 'u-1',
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n'),
  );
}

describe("COVENANT-13b §4.4 evaluatePrecedent — this file's fixture helpers under mixed outcomes", () => {
  it('attributes each outcome to its own call when one of two sibling tool calls failed', () => {
    // Each call needs its own id. Two calls sharing one id collide, and the join in
    // transcript.ts keeps the FIRST result per id, so the failure landing first stamps
    // `succeeded: false` onto BOTH calls — the shell call that really returned ok reads as
    // failed and its gate can never open, while the reverse order would stamp `true` onto
    // the failed MCP call and open a gate on a query that returned nothing. Every other
    // fixture here succeeds, which is what keeps the misattribution invisible.
    const transcript = transcriptWithOutcomes(
      [toolBlock('toolu_mcp', MCP_TOOL), toolBlock('toolu_bash', SHELL_TOOL)],
      [true, false],
    );

    // The failed call is not evidence, even though its name matches the pattern.
    expect(evaluatePrecedent({ tool: '^mcp__' }, transcript)).toBe(false);
    // Its successful sibling is evidence, and the failure beside it does not taint it.
    expect(evaluatePrecedent({ tool: SHELL_PATTERN }, transcript)).toBe(true);
  });
});
