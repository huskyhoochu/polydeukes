import { parseInput } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { buildCovenantInput } from '../src/up-translate.ts';

// The actor comes from the hook envelope alone: the top-level `agent_type` the host writes
// when the hook fires inside a subagent. Present as a string → `{ agentType }`; absent (the
// main session) → `{}`; a non-string is evidence reduced, not a failure → `{}`. Nothing
// under `tool_input` — the agent's own arguments — is ever read as the actor.

const SUBAGENT = 'tdd-implementer';

const editPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Edit',
  tool_input: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' },
};

/** The IR the adapter built, or a thrown setup error when the build failed. */
function actorOf(payloads: unknown[]) {
  const result = buildCovenantInput(payloads);
  if (result.ok !== true) throw new Error(`build failed: ${result.reason}`);
  return result.value.actor;
}

describe('buildCovenantInput — the actor from the envelope', () => {
  it('a payload with a string agent_type builds actor { agentType }', () => {
    // A build that never reads the envelope leaves every subagent call as the main
    // session's, and the implementer's test edit passes as no one's.
    expect(actorOf([{ ...editPayload, agent_type: SUBAGENT }])).toEqual({ agentType: SUBAGENT });
  });

  it('a payload without agent_type builds actor {} — the main session is a positive value', () => {
    // An absent field is what the main session looks like on this host, and `{}` says so;
    // a build that omits the key makes every main-session call land supply-pass instead of
    // a judged pass. `toStrictEqual` so `{ agentType: undefined }` fails too.
    const result = buildCovenantInput([editPayload]);

    expect(result.ok).toBe(true);
    if (result.ok === true) expect(result.value.actor).toStrictEqual({});
  });

  it('a payload whose agent_type is not a string builds actor {} rather than failing', () => {
    // Evidence reduced, not a classification failure: a build that fails closed on a
    // numeric `agent_type` blocks the call with exit 2 for a field no declaration can
    // read; one that carries the number through is refused by the core's shape check.
    for (const agentType of [42, null, { name: SUBAGENT }, [SUBAGENT]]) {
      expect(
        actorOf([{ ...editPayload, agent_type: agentType }]),
        `agent_type: ${JSON.stringify(agentType)}`,
      ).toStrictEqual({});
    }
  });

  it('an empty-string agent_type builds actor {} — an empty name proves no subagent', () => {
    // `''` passes a string check and `select` projects it as one item, so an actor-scope
    // declaration with no pattern would read every commit from such a host as a break.
    expect(actorOf([{ ...editPayload, agent_type: '' }])).toStrictEqual({});
  });

  it('an empty payload list builds no actor — no observation proves a main session', () => {
    const built = buildCovenantInput([]);
    expect(built.ok).toBe(true);
    if (built.ok) expect('actor' in built.value).toBe(false);
  });

  it('an agent_type under tool_input is not the actor', () => {
    // The actor is provenance and only the host writes it; a build reading the agent's own
    // arguments lets a call name any actor it likes, including none.
    const payload = {
      ...editPayload,
      tool_input: { ...editPayload.tool_input, agent_type: SUBAGENT },
    };

    expect(actorOf([payload])).toStrictEqual({});
  });

  it('the built IR with an actor round-trips through JSON and core parseInput', () => {
    // The wire contract: the adapter's `actor` must be the shape the core's parser admits,
    // or a subagent call is refused at the boundary as a malformed payload.
    const built = buildCovenantInput([{ ...editPayload, agent_type: SUBAGENT }]);
    expect(built.ok).toBe(true);
    if (built.ok !== true) return;

    const roundTripped = parseInput(JSON.stringify(built.value));

    expect(roundTripped.ok).toBe(true);
    if (roundTripped.ok === true) expect(roundTripped.value).toEqual(built.value);
  });
});
