import { describe, expect, it } from 'vitest';
// The adapter's own evidence vocabularies (`tool`, `subagent`) take the same execution rule
// as core's `command`: a call is evidence only when the transcript shows it ran and reported
// success. A call the covenant blocked, a call the human rejected, and a call that simply
// failed all carry the same marker, and none of them is precedent. The spawn axis reads the
// same join — a spawn that never happened cannot have done the work the discipline demands.
import { evaluatePrecedent } from '../src/precedent.ts';
import { transcriptFromJsonl } from '../src/transcript.ts';

const SPAWN_KIND = 'tdd-implementer';
const OTHER_SPAWN_KIND = 'code-reviewer';
const MCP_TOOL = 'mcp__context7__get-library-docs';
const MCP_PATTERN = '^mcp__';
const SHELL_TOOL = 'Bash';
const SHELL_PATTERN = '^Bash$';

/** What a human rejection really leaves behind — the shape a refused spawn takes. */
const USER_REJECTED_CONTENT =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

/** What a failed MCP query leaves behind. */
const MCP_FAILURE_CONTENT = 'Error: MCP server "context7" request failed: fetch failed';

function assistantEntry(uuid: string, blocks: unknown[]) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: blocks },
    timestamp: '2026-07-28T03:00:00.000Z',
    uuid,
  };
}

function resultEntry(uuid: string, blocks: unknown[]) {
  return {
    type: 'user',
    message: { role: 'user', content: blocks },
    timestamp: '2026-07-28T03:00:01.000Z',
    uuid,
  };
}

/** A subagent spawn: a tool_use block identified by input.subagent_type. */
function spawnBlock(id: string, kind: string) {
  return { type: 'tool_use', id, name: 'Task', input: { subagent_type: kind } };
}

/** A plain tool call. */
function toolBlock(id: string, name: string) {
  return { type: 'tool_use', id, name, input: {} };
}

function okResult(id: string, content: string) {
  return { type: 'tool_result', tool_use_id: id, content };
}

function errorResult(id: string, content: string) {
  return { type: 'tool_result', tool_use_id: id, is_error: true, content };
}

/** Build a transcript from entry objects, as JSONL. */
function transcriptOf(entries: unknown[]) {
  return transcriptFromJsonl(entries.map((entry) => JSON.stringify(entry)).join('\n'));
}

describe('evaluatePrecedent — tool evidence requires a successful call', () => {
  it('stays shut on a tool call that failed, while a successful sibling still opens', () => {
    // Without the outcome, the mere REQUEST of an MCP query opens the gate, so a query that
    // never returned a single word of documentation satisfies "consult the docs first". The
    // shell assertion is not decoration: without it this expectation would also hold if the
    // result join were broken outright (no result at all also yields a shut gate), and the
    // test would go green while verifying nothing.
    const transcript = transcriptOf([
      assistantEntry('a-1', [toolBlock('toolu_01', MCP_TOOL), toolBlock('toolu_02', SHELL_TOOL)]),
      resultEntry('u-1', [
        errorResult('toolu_01', MCP_FAILURE_CONTENT),
        okResult('toolu_02', 'ok'),
      ]),
    ]);

    expect(evaluatePrecedent({ tool: MCP_PATTERN }, transcript)).toBe(false);
    expect(evaluatePrecedent({ tool: SHELL_PATTERN }, transcript)).toBe(true);
  });
});

describe('evaluatePrecedent — subagent evidence requires a successful spawn', () => {
  it('stays shut on a spawn the human rejected, while a successful spawn of another kind opens', () => {
    // A rejected spawn is the case where a human explicitly said no, so counting it as
    // precedent makes the refusal itself into the key. It also catches the likeliest
    // implementation slip — reading the spawn-invocation query, which carries no outcome,
    // instead of the joined tool calls, which reads true here. The other-kind assertion pins
    // the branch, so this cannot pass merely because spawn evidence stopped working.
    const transcript = transcriptOf([
      assistantEntry('a-1', [
        spawnBlock('toolu_01', SPAWN_KIND),
        spawnBlock('toolu_02', OTHER_SPAWN_KIND),
      ]),
      resultEntry('u-1', [
        errorResult('toolu_01', USER_REJECTED_CONTENT),
        okResult('toolu_02', 'the review report'),
      ]),
    ]);

    expect(evaluatePrecedent({ subagent: SPAWN_KIND }, transcript)).toBe(false);
    expect(evaluatePrecedent({ subagent: OTHER_SPAWN_KIND }, transcript)).toBe(true);
  });

  it('opens when a rejected spawn is followed by a successful spawn of the same kind', () => {
    // The recovery path: a first attempt refused or crashed must not poison the kind for the
    // rest of the session. An evaluator that finds the FIRST spawn of the required kind and
    // returns its outcome would keep the gate shut however many times the subagent is
    // spawned and finishes, leaving the witness as the only way forward. The rejected spawn
    // is deliberately first, because with the success first that mistake answers true and
    // hides.
    const transcript = transcriptOf([
      assistantEntry('a-1', [spawnBlock('toolu_01', SPAWN_KIND)]),
      resultEntry('u-1', [errorResult('toolu_01', USER_REJECTED_CONTENT)]),
      assistantEntry('a-2', [spawnBlock('toolu_02', SPAWN_KIND)]),
      resultEntry('u-2', [okResult('toolu_02', 'the subagent report')]),
    ]);

    expect(evaluatePrecedent({ subagent: SPAWN_KIND }, transcript)).toBe(true);
  });
});
