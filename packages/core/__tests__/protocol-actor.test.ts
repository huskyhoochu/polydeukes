import { describe, expect, expectTypeOf, it } from 'vitest';
import { type CovenantInput, parseInput } from '../src/protocol.ts';

// The IR's actor: `CovenantInput.actor?: { agentType?: string }`. One observation has one
// actor. `{}` is a positive value — the host saw the actor and it is not a subagent — and an
// absent field is the host being unable to prove one. The parser checks the shape as a
// closed one-key object and refuses the whole input on a miss, the way `world` is checked:
// a misspelt supply must not become a supply. The type lock bites under `tsc --noEmit`.

// The agent name is a fixture value: the core carries the field, never a name.
const SUBAGENT = 'tdd-implementer';

/** The three required collections, empty, with the caller's `actor` beside them. */
function payloadWith(actor: unknown): string {
  return JSON.stringify({ toolCalls: [], subagentSpawns: [], userMessages: [], actor });
}

describe('CovenantInput.actor — type lock', () => {
  it('is exactly the one-key actor shape, the key optional, and itself optional', () => {
    // Catches a `kind` or `agentId` field added beside `agentType` (no declaration reads
    // one), `agentType` widened past string, and the field or its key made required —
    // which would refuse every commit-surface input, where the actor is unprovable.
    expectTypeOf<CovenantInput['actor']>().toEqualTypeOf<{ agentType?: string } | undefined>();
  });
});

describe('parseInput — the actor is carried verbatim', () => {
  it('round-trips { agentType } and the empty {} as given', () => {
    // A parser that whitelists the three collections and `world` drops the actor, and
    // every actor-reading declaration then lands supply-pass on a session that proved one.
    for (const actor of [{ agentType: SUBAGENT }, {}]) {
      const result = parseInput(payloadWith(actor));

      expect(result.ok, `actor: ${JSON.stringify(actor)}`).toBe(true);
      if (result.ok === true) expect(result.value.actor).toEqual(actor);
    }
  });

  it('an input without actor parses with no actor key — absence is not turned into {}', () => {
    // `{}` says "the host saw the actor"; a parser defaulting an absent field to `{}`
    // makes the commit surface claim a main-session actor it never observed, and the
    // `supply: pass` row that should say skipped says passed instead.
    const result = parseInput(
      JSON.stringify({ toolCalls: [], subagentSpawns: [], userMessages: [] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok === true) expect(result.value).not.toHaveProperty('actor');
  });
});

describe('parseInput — the actor is shape-checked, not merely carried', () => {
  it('refuses an actor that is not a plain object: null, a string, an array', () => {
    // `actor: null` carried through reaches `select` as a non-object and projects to no
    // item — the subagent check then holds for a payload that said nothing about the actor.
    for (const actor of [null, SUBAGENT, []]) {
      expect(parseInput(payloadWith(actor)), `actor: ${JSON.stringify(actor)}`).toEqual({
        ok: false,
        exitCode: 2,
      });
    }
  });

  it('refuses an agentType that is not a string: a number, null, an object', () => {
    // A non-string reaches `matches` as a value no regex matches: `^tdd-implementer$` over
    // `{ name: 'tdd-implementer' }` finds nothing, and the implementer passes as no one.
    for (const agentType of [1, null, { name: SUBAGENT }]) {
      expect(
        parseInput(payloadWith({ agentType })),
        `agentType: ${JSON.stringify(agentType)}`,
      ).toEqual({ ok: false, exitCode: 2 });
    }
  });

  it('refuses an actor carrying a key the shape does not define', () => {
    // The shape is closed at one key. A host writing `agent_type` (the payload spelling)
    // under `actor` supplies nothing while looking like a supply; a parser ignoring the
    // key lets the main-session reading stand for a subagent call.
    expect(parseInput(payloadWith({ agent_type: SUBAGENT }))).toEqual({ ok: false, exitCode: 2 });
    expect(parseInput(payloadWith({ agentType: SUBAGENT, agentId: 'a-1' }))).toEqual({
      ok: false,
      exitCode: 2,
    });
  });
});
