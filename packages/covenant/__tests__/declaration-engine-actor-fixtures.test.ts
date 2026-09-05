import { describe, expect, it } from 'vitest';
import type { World } from '../src/declaration-engine.ts';
import { judge, loadDeclaration, witnessesOf } from './declaration-engine-helpers.ts';

// The two actor-axis fixtures — a test file is not the implementer's (`producer-owned`,
// `select agentType → matches` related `empty`) and a commit command is the main session's
// (`actor-scope`, `select agentType` related `empty`) — judged on this engine. Both read the
// fixed source `actor`, the input's actor object as the world carries it: `{}` is the main
// session, `{ agentType }` a subagent, and an absent key is the declaration's own
// `supply: pass` to dispose of. Agent names, paths, and command lines are fixture values.

const ACTOR = 'actor';
const PATH_SOURCE = 'target.path';
const COMMAND_SOURCE = 'command';
const IMPLEMENTER = 'tdd-implementer';
const WRITER = 'tdd-test-writer';
const REVIEWER = 'code-reviewer';
const TEST_FILE = 'packages/core/__tests__/x.test.ts';
const SOURCE_FILE = 'packages/core/src/x.ts';
const COMMIT = 'git commit -m x';
const PUSH = 'git push origin main';
const MERGE = 'tea pr merge 12';
const STATUS = 'git status';

const MAIN_SESSION = {};

function fileWorld(actor: unknown, path: string = TEST_FILE): World {
  return { [ACTOR]: actor, [PATH_SOURCE]: path };
}

function callWorld(actor: unknown, command: string = COMMIT): World {
  return { [ACTOR]: actor, [COMMAND_SOURCE]: command };
}

describe('producer-owned-tests-by-writer · judge', () => {
  const decl = loadDeclaration('producer-owned-tests-by-writer');
  const ENTRY = 'not-the-implementer';

  it('the main session ({}) writing a test file → pass', () => {
    // `select` over an object without the path projects to nothing, so `empty` holds. A
    // step that answers an item with value undefined breaks every main-session edit.
    expect(judge(decl, fileWorld(MAIN_SESSION)).kind).toBe('pass');
  });

  it('the implementer subagent writing a test file → broken, the agent type is the witness', () => {
    // The whole path: the actor object → `agentType` → the anchored regex → one item under
    // key '0'. A pipeline that keeps the object itself, or reads a key other than
    // `agentType`, produces no match and the implementer passes as no one.
    const verdict = judge(decl, fileWorld({ agentType: IMPLEMENTER }));

    expect(verdict.kind).toBe('broken');
    expect(witnessesOf(verdict, ENTRY)).toEqual([{ key: '0', value: IMPLEMENTER }]);
  });

  it('the test-writer subagent writing a test file → pass', () => {
    // The regex names one agent; a matcher that treats any present `agentType` as a hit
    // blocks the subagent this discipline exists to protect.
    expect(judge(decl, fileWorld({ agentType: WRITER })).kind).toBe('pass');
  });

  it('no actor in the world → not-applicable/supply-pass naming actor', () => {
    // The commit surface's disposition: absence under `supply: pass` is a recorded skip,
    // never a fabricated `{}` that would pass a judgment nobody made.
    expect(judge(decl, { [PATH_SOURCE]: TEST_FILE })).toEqual({
      kind: 'not-applicable',
      reason: 'supply-pass',
      source: ACTOR,
    });
  });

  it('the implementer editing a source file → not-applicable/scope', () => {
    // The scope admits test files alone; a scope that admits every path turns the
    // implementer's own job into a break on every edit.
    expect(judge(decl, fileWorld({ agentType: IMPLEMENTER }, SOURCE_FILE))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });
});

describe('actor-scope-commit-from-main · judge', () => {
  const decl = loadDeclaration('actor-scope-commit-from-main');
  const ENTRY = 'main-session-only';

  it('the main session ({}) running git commit → pass', () => {
    expect(judge(decl, callWorld(MAIN_SESSION)).kind).toBe('pass');
  });

  it.each([
    IMPLEMENTER,
    REVIEWER,
  ])('subagent %s running git commit → broken, the agent type is the witness', (agentType) => {
    // No regex in this pipeline: ANY agent type breaks, and the witness value is the
    // name the message interpolates. A pipeline copied from the producer-owned fixture
    // (anchored on one name) lets every other subagent commit.
    const verdict = judge(decl, callWorld({ agentType }));

    expect(verdict.kind).toBe('broken');
    expect(witnessesOf(verdict, ENTRY)).toEqual([{ key: '0', value: agentType }]);
  });

  it.each([PUSH, MERGE])('subagent running %s → broken', (command) => {
    // The include names three heads; a scope pattern that matches `git commit` alone
    // leaves a push and a merge unjudged.
    expect(judge(decl, callWorld({ agentType: IMPLEMENTER }, command)).kind).toBe('broken');
  });

  it('a subagent running `cd x && git commit` → broken — the scope admits a commit after a separator', () => {
    const world = callWorld({ agentType: IMPLEMENTER }, 'cd packages/core && git commit -m x');
    expect(judge(decl, world).kind).toBe('broken');
  });

  it('a subagent running git status → not-applicable/scope', () => {
    // The scope is what keeps this discipline off every other shell call: a subagent
    // reading the tree must not be judged as if it had committed.
    expect(judge(decl, callWorld({ agentType: IMPLEMENTER }, STATUS))).toMatchObject({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });
});
