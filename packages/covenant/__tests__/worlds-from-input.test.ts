import type { CovenantInput, FileChange } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// `worldsFromInput` turns each FileChange into one World, in `allFileChanges` order, keyed
// by the fixed source names: `target.path` (repo-relative), `pre`, `post`, `state`
// (`{ pre, post }`, modify only), and `changes` (the observation unit's change set, on
// every world). A side the change does not carry is an ABSENT key — the host never invents
// a default; what an absent source does is the declaration's `supply` policy.
import { worldsFromInput } from '../src/discipline.ts';

const ROOT = '/repo';
/** No shell tool is named, so no call here is a shell call and no world carries `command`. */
const NO_SHELL = { shellTools: [], commandArgs: [] };
const PATH_SOURCE = 'target.path';

/** A CovenantInput whose evidence rides each call's own element, in the given order. */
function inputWithChanges(changes: (FileChange | undefined)[]): CovenantInput {
  return {
    toolCalls: changes.map((fileChange, index) => ({
      name: `call-${index}`,
      args: { file_path: fileChange?.path ?? 'no-evidence' },
      ...(fileChange !== undefined && { fileChange }),
    })),
    subagentSpawns: [],
    userMessages: [],
  };
}

describe('worldsFromInput — one world per change, keyed by the three kinds', () => {
  it('a create carries exactly target.path and post', () => {
    // An invented `pre` (empty string) on a create would let `Unchanged` and `state`
    // readers judge a baseline that never existed; the exact key set forbids it.
    const worlds = worldsFromInput({
      input: inputWithChanges([{ kind: 'create', path: 'lib/new.db', post: 'body' }]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds).toHaveLength(1);
    expect(worlds[0]?.path).toBe('lib/new.db');
    expect(Object.keys(worlds[0]?.world ?? {}).sort()).toEqual(['changes', 'post', PATH_SOURCE]);
    expect(worlds[0]?.world).toEqual({
      [PATH_SOURCE]: 'lib/new.db',
      post: 'body',
      changes: ['lib/new.db'],
    });
  });

  it('a modify carries target.path, pre, post, and state = { pre, post }', () => {
    // `state` is the paired source; dropping it makes every `Unchanged` declaration a
    // supply failure, and mis-pairing it (post under pre) inverts the comparison.
    const worlds = worldsFromInput({
      input: inputWithChanges([{ kind: 'modify', path: 'lib/a.db', pre: 'before', post: 'after' }]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(Object.keys(worlds[0]?.world ?? {}).sort()).toEqual([
      'changes',
      'post',
      'pre',
      'state',
      PATH_SOURCE,
    ]);
    expect(worlds[0]?.world).toEqual({
      [PATH_SOURCE]: 'lib/a.db',
      pre: 'before',
      post: 'after',
      state: { pre: 'before', post: 'after' },
      changes: ['lib/a.db'],
    });
  });

  it('a delete with a baseline carries target.path and pre, never post or state', () => {
    // A deletion with a `post` key is the impossible state the IR forbids; `state` needs
    // both sides, and the host must not pair `pre` with a fabricated empty post.
    const worlds = worldsFromInput({
      input: inputWithChanges([{ kind: 'delete', path: 'lib/old.db', pre: 'gone' }]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(Object.keys(worlds[0]?.world ?? {}).sort()).toEqual(['changes', 'pre', PATH_SOURCE]);
    expect(worlds[0]?.world).toEqual({
      [PATH_SOURCE]: 'lib/old.db',
      pre: 'gone',
      changes: ['lib/old.db'],
    });
  });

  it('a delete without a baseline carries target.path alone', () => {
    // A binary deletion has no readable text; supplying `pre: ''` or `pre: undefined` as a
    // present key would turn the declaration's supply policy into a dead branch.
    const worlds = worldsFromInput({
      input: inputWithChanges([{ kind: 'delete', path: 'lib/blob.db' }]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(Object.keys(worlds[0]?.world ?? {})).toEqual([PATH_SOURCE, 'changes']);
    expect(worlds[0]?.world).toEqual({ [PATH_SOURCE]: 'lib/blob.db', changes: ['lib/blob.db'] });
  });
});

describe('worldsFromInput — path relativization and order', () => {
  it('relativizes an absolute path under rootDir to its repo-relative form', () => {
    // A declaration's scope regex is written repo-relative; an absolute `target.path`
    // silently misses every `^lib/` include.
    const worlds = worldsFromInput({
      input: inputWithChanges([{ kind: 'create', path: `${ROOT}/lib/abs.db`, post: 'x' }]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds.map((w) => w.path)).toEqual(['lib/abs.db']);
    expect(worlds[0]?.world[PATH_SOURCE]).toBe('lib/abs.db');
  });

  it('omits a change whose path resolves outside rootDir while a sibling relative one stays', () => {
    // Feeding a `../…` path to the scope regex would let a file outside the repo be judged
    // (and blocked) under a discipline declared repo-relative; dropping the sibling too
    // would leave the in-root change unjudged.
    const worlds = worldsFromInput({
      input: inputWithChanges([
        { kind: 'create', path: '/elsewhere/lib/out.db', post: 'x' },
        { kind: 'create', path: 'lib/in.db', post: 'y' },
      ]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds.map((w) => w.path)).toEqual(['lib/in.db']);
  });

  it('preserves allFileChanges order when two changes arrive in reverse path order', () => {
    // The first in-scope world is the telemetry subject and the first broken world is the
    // reported one; sorting by path would swap both across surfaces.
    const worlds = worldsFromInput({
      input: inputWithChanges([
        { kind: 'create', path: 'z/second.db', post: '2' },
        { kind: 'create', path: 'a/first.db', post: '1' },
      ]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds.map((w) => w.path)).toEqual(['z/second.db', 'a/first.db']);
  });

  it('a change of a kind this host does not know contributes no world', () => {
    // A stale adapter dist can emit evidence with no `kind`; a world with `post` present
    // but undefined would satisfy the engine's source check and bypass the supply policy.
    const worlds = worldsFromInput({
      input: inputWithChanges([
        { path: 'lib/stale.db', pre: 'a', post: 'b' } as unknown as FileChange,
        { kind: 'create', path: 'lib/ok.db', post: 'x' },
      ]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds.map((w) => w.path)).toEqual(['lib/ok.db']);
  });

  it('a tool call without fileChange contributes no world', () => {
    // An unproven call is not evidence; minting a world with only `target.path` from its
    // args would judge a path the adapter never attested to.
    const worlds = worldsFromInput({
      input: inputWithChanges([undefined, { kind: 'create', path: 'lib/only.db', post: 'x' }]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds.map((w) => w.path)).toEqual(['lib/only.db']);
  });
});
