import { describe, expect, it } from 'vitest';
// COVENANT-13 RED phase. The adapter-owned evidence evaluator (`subagent`/`tool`
// vocabulary, PRD §4.4) does not exist yet, so this import is unresolvable and the whole
// file is RED by construction. The hook assembly injects this evaluator into
// compileDisciplineRegistrations; core owns only the `command` evidence vocabulary and
// validates the container shape — the adapter validates and judges its own keys
// (resolveGitAdapterSettings namespace precedent).
import { evaluatePrecedent } from '../src/precedent.ts';
import { transcriptFromJsonl } from '../src/transcript.ts';

// ---------------------------------------------------------------------------
// Fixtures — realistic transcript JSONL, mirroring transcript.test.ts conventions.
// Spawn kinds and tool names are ecosystem values injected here, never core literals.
// ---------------------------------------------------------------------------

const SPAWN_KIND = 'tdd-implementer';
const MCP_TOOL = 'mcp__context7__get-library-docs';

/** An assistant entry carrying the given content blocks, as one JSONL line. */
function transcriptWith(blocks: unknown[]) {
  return transcriptFromJsonl(
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: blocks },
      timestamp: '2026-07-26T02:00:00.000Z',
      uuid: 'a-1',
    }),
  );
}

/** A subagent spawn: a tool_use block identified by input.subagent_type. */
function spawnBlock(kind: string) {
  return { type: 'tool_use', id: 's1', name: 'Task', input: { subagent_type: kind } };
}

/** A plain tool call with the given tool name. */
function toolBlock(name: string) {
  return { type: 'tool_use', id: 't1', name, input: {} };
}

// ===========================================================================
// PRD §4.4 — subagent evidence: exact spawn-kind match
// ===========================================================================

describe('COVENANT-13 §4.4 evaluatePrecedent — subagent evidence (exact spawn-kind match)', () => {
  it('returns true when a spawn of exactly the required kind exists in the transcript', () => {
    // P0 gate-opening path: requirePrecedent subagent evidence is satisfied by a real
    // spawn of that kind. Mutation caught: the evaluator reading the wrong query (tool
    // names instead of spawn kinds) or inverting the found/missing verdict.
    const transcript = transcriptWith([spawnBlock(SPAWN_KIND)]);

    expect(evaluatePrecedent({ subagent: SPAWN_KIND }, transcript)).toBe(true);
  });

  it('requires exact kind equality — substring and regex-shaped values stay false', () => {
    // P0 vocabulary boundary (PRD §4.1: subagent is a kind *match*, tool is a *regex*):
    // subagent evidence is an equality check, never a pattern. Mutation caught: the
    // tool-side regex matcher reused for subagent, letting 'tdd' or 'tdd-.*' claim a
    // 'tdd-implementer' spawn as evidence — a fail-open widening of the gate.
    const transcript = transcriptWith([spawnBlock(SPAWN_KIND)]);

    expect(evaluatePrecedent({ subagent: 'tdd' }, transcript)).toBe(false);
    expect(evaluatePrecedent({ subagent: 'tdd-.*' }, transcript)).toBe(false);
  });

  it('returns false — not undefined — when the required kind was never spawned', () => {
    // P0 recognized-key contract: a recognized vocabulary key with no evidence is a
    // judged miss (false → --precedent-missing → block), while undefined is reserved for
    // unknown keys and makes assembly throw. Mutation caught: undefined answered for a
    // miss, turning every unsatisfied discipline into an assembly crash instead of a
    // block verdict.
    const transcript = transcriptWith([spawnBlock('code-reviewer')]);

    expect(evaluatePrecedent({ subagent: SPAWN_KIND }, transcript)).toBe(false);
  });

  it('treats a non-string subagent value as absent evidence (false), fail-closed', () => {
    // P1 adapter-owned validation (core validates only the container, values pass
    // verbatim): a malformed value cannot prove evidence, so the gate stays closed.
    // Mutation caught: a non-string value coerced into a match, or an unguarded
    // comparison throwing at judgment time.
    const transcript = transcriptWith([spawnBlock(SPAWN_KIND)]);

    expect(evaluatePrecedent({ subagent: 123 }, transcript)).toBe(false);
  });
});

// ===========================================================================
// PRD §4.4 — tool evidence: tool-name regular expression
// ===========================================================================

describe('COVENANT-13 §4.4 evaluatePrecedent — tool evidence (tool-name regex)', () => {
  it('returns true when an observed tool name matches the value as a regular expression', () => {
    // P0 the "MCP query required" use case: '^mcp__' must match any MCP tool call, and a
    // metacharacter pattern must be honoured as a regex, not compared as a literal
    // string. Mutation caught: the evaluator comparing with === (subagent semantics
    // leaking into tool), silently making every regex-valued discipline unsatisfiable —
    // a permanent block with no legitimate pass path.
    const transcript = transcriptWith([toolBlock('Bash'), toolBlock(MCP_TOOL)]);

    expect(evaluatePrecedent({ tool: '^mcp__' }, transcript)).toBe(true);
    expect(evaluatePrecedent({ tool: 'mcp__.*__get-library-docs' }, transcript)).toBe(true);
  });

  it('returns false — not undefined — when no observed tool name matches the pattern', () => {
    // P0 gate stays closed without evidence, and the miss is a judged false, not the
    // unknown-key signal. Mutation caught: an inverted or always-true match, or
    // undefined-for-miss crashing assembly instead of blocking the edit.
    const transcript = transcriptWith([toolBlock('Bash')]);

    expect(evaluatePrecedent({ tool: '^mcp__' }, transcript)).toBe(false);
  });

  it('treats a non-compiling tool regex as absent evidence (false), never a throw', () => {
    // P1 judgment-time safety: '(' does not compile; an unguarded `new RegExp` would
    // throw during evidence evaluation — a crash, not a verdict. The adapter validates
    // its own vocabulary and collapses the malformed pattern to "no evidence" (gate
    // closed). Mutation caught: the RegExp construction left unguarded.
    const transcript = transcriptWith([toolBlock(MCP_TOOL)]);

    let verdict: boolean | undefined;
    expect(() => {
      verdict = evaluatePrecedent({ tool: '(' }, transcript);
    }).not.toThrow();
    expect(verdict).toBe(false);
  });
});

// ===========================================================================
// PRD §4.4 — vocabulary boundary: unknown keys are undefined, never false
// ===========================================================================

describe('COVENANT-13 §4.4 evaluatePrecedent — vocabulary boundary', () => {
  it('returns undefined for an evidence key outside the adapter vocabulary', () => {
    // P0 fail-closed handshake with assembly: undefined is the exact signal that makes
    // compileDisciplineRegistrations throw on an unrecognized key. Mutation caught: the
    // evaluator answering false for a typo'd key, silently converting a misconfigured
    // discipline into a permanent, unexplained block instead of a loud assembly failure.
    const transcript = transcriptWith([spawnBlock(SPAWN_KIND), toolBlock(MCP_TOOL)]);

    expect(evaluatePrecedent({ bogus: 'x' }, transcript)).toBeUndefined();
  });
});
