import type { CovenantInput, FileChange } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// The world axis of `worldsFromInput`: every world gains a `changes` key carrying the
// observation unit's change set — derived from the input (every change's repo-relative
// `target.path`, input order) unless `input.world.changes` is present, in which case that
// list stands as given. The four existing keys (`target.path`, `pre`, `post`, `state`) are
// untouched by the addition.
import { worldsFromInput } from '../src/discipline.ts';

const ROOT = '/repo';
/** No shell tool is named, so no call here is a shell call and no world carries `command`. */
const NO_SHELL = { shellTools: [], commandArgs: [] };
const PATH_SOURCE = 'target.path';

/** A CovenantInput whose evidence rides each call's own element, in the given order. */
function inputWithChanges(
  changes: FileChange[],
  world?: NonNullable<CovenantInput['world']>,
): CovenantInput {
  return {
    toolCalls: changes.map((fileChange, index) => ({
      name: `call-${index}`,
      args: { file_path: fileChange.path },
      fileChange,
    })),
    subagentSpawns: [],
    userMessages: [],
    ...(world !== undefined && { world }),
  };
}

describe('worldsFromInput — the changes key, derived from the input', () => {
  it('every world of a three-change input carries all three repo-relative paths in input order', () => {
    // A per-world `changes: [own path]` makes every `Implies` over the change set hold
    // vacuously; a raw (absolute) entry never matches a repo-relative regex; a sorted list
    // moves the first witness between surfaces.
    const worlds = worldsFromInput({
      input: inputWithChanges([
        { kind: 'create', path: 'docs/z.md', post: '1' },
        { kind: 'modify', path: `${ROOT}/docs/a.md`, pre: 'x', post: 'y' },
        { kind: 'delete', path: 'docs/m.ko.md' },
      ]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds).toHaveLength(3);
    for (const supplied of worlds) {
      expect(supplied.world.changes).toEqual(['docs/z.md', 'docs/a.md', 'docs/m.ko.md']);
    }
  });

  it('omits a change outside rootDir from changes while the in-root sibling stays', () => {
    // The world for the outside path is dropped already; leaking its path into `changes`
    // would feed a `../` path to a declaration written repo-relative.
    const worlds = worldsFromInput({
      input: inputWithChanges([
        { kind: 'create', path: '/elsewhere/docs/out.md', post: 'x' },
        { kind: 'create', path: 'docs/in.md', post: 'y' },
      ]),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds.map((w) => w.world.changes)).toEqual([['docs/in.md']]);
  });

  it('derives changes when input.world is present without a changes list', () => {
    // A root that ships `world.files` alone (the session surface) must still see the
    // derived set; `if (input.world) use input.world.changes` leaves it undefined.
    const worlds = worldsFromInput({
      input: inputWithChanges([{ kind: 'create', path: 'docs/a.md', post: 'x' }], {
        files: { 'locales/en.json': '{}' },
      }),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds[0]?.world.changes).toEqual(['docs/a.md']);
  });
});

describe('worldsFromInput — the changes key, supplied by the root', () => {
  it('a present input.world.changes stands as given, replacing the derivation rather than joining it', () => {
    // The commit surface dispatches one staged change at a time and hands the whole staged
    // set here; a derivation that ignores the list sees a one-element set, a union adds
    // the dispatched change to a list the root already assembled.
    const supplied = ['docs/a.md', 'docs/a.ko.md', 'docs/b.md'];
    const worlds = worldsFromInput({
      input: inputWithChanges(
        [{ kind: 'modify', path: 'locales/en.json', pre: '{}', post: '{}' }],
        {
          changes: supplied,
        },
      ),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds).toHaveLength(1);
    expect(worlds[0]?.world.changes).toEqual(supplied);
  });

  it('an empty input.world.changes is the empty set, not a fallback to derivation', () => {
    // The degenerate list: a truthiness test (`world.changes?.length ? … : derive`) turns
    // "the root observed no changes" into "this one change", and an `Implies` that should
    // have found nothing to pair now finds a witness.
    const worlds = worldsFromInput({
      input: inputWithChanges([{ kind: 'create', path: 'docs/a.md', post: 'x' }], { changes: [] }),
      rootDir: ROOT,
      ...NO_SHELL,
    });

    expect(worlds[0]?.world.changes).toEqual([]);
  });
});

describe('worldsFromInput — the four existing keys are unchanged by the addition', () => {
  // The exact shape per change kind, pinned. `toStrictEqual` so a key holding
  // `undefined` (which passes the engine's presence test) fails here.
  it('create, modify, and delete keep their exact key sets plus changes', () => {
    const worlds = worldsFromInput({
      input: inputWithChanges([
        { kind: 'create', path: 'lib/new.db', post: 'body' },
        { kind: 'modify', path: 'lib/a.db', pre: 'before', post: 'after' },
        { kind: 'delete', path: 'lib/old.db', pre: 'gone' },
      ]),
      rootDir: ROOT,
      ...NO_SHELL,
    });
    const changes = ['lib/new.db', 'lib/a.db', 'lib/old.db'];

    expect(worlds.map((w) => w.world)).toStrictEqual([
      { [PATH_SOURCE]: 'lib/new.db', post: 'body', changes },
      {
        [PATH_SOURCE]: 'lib/a.db',
        pre: 'before',
        post: 'after',
        state: { pre: 'before', post: 'after' },
        changes,
      },
      { [PATH_SOURCE]: 'lib/old.db', pre: 'gone', changes },
    ]);
  });
});
