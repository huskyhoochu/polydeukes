import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CovenantInput } from '../src/protocol.ts';
import { allFileChanges, parseInput } from '../src/protocol.ts';

// The IR's world axis: `CovenantInput.world?: { files?, changes? }`.
// `files` is what the supply layer read (key = repo-relative path, absent key = absent
// file — never `null`, which is `FileChange.pre`'s creation marker); `changes` is the
// observation unit's change set when the root sees wider than one dispatch. The type lock
// bites under the package typecheck (`tsc --noEmit`), not the vitest runtime; the runtime
// assertions pin that the parser carries the axis through untouched.

// Paths and contents are fixture values: the core transports the axis, never reads it.
const FILE_KO = 'locales/ko.json';
const FILE_EN = 'locales/en.json';
const TARGET = 'src/a.ts';

const worldInput: CovenantInput = {
  toolCalls: [{ name: 'edit', fileChange: { kind: 'create', path: TARGET, post: 'export {};\n' } }],
  subagentSpawns: [],
  userMessages: [],
  world: {
    files: { [FILE_KO]: '{"a":1}', [FILE_EN]: '{"a":1}' },
    changes: [TARGET, FILE_EN],
  },
};

describe('CovenantInput.world — type locks', () => {
  it('is exactly the two-field world axis, both fields optional, and itself optional', () => {
    // An exact lock: catches `files` widened to admit `null` values (the creation-marker
    // collision the header names), `changes` typed as anything but an ordered string list, and
    // either field or the axis itself made required — which would break every embedder
    // that builds an input without a supply layer.
    expectTypeOf<CovenantInput['world']>().toEqualTypeOf<
      { files?: Record<string, string>; changes?: string[] } | undefined
    >();
  });
});

describe('CovenantInput.world — the parser carries the axis through', () => {
  it('round-trips an input carrying world.files and world.changes verbatim', () => {
    // A parser that whitelists the three collections and rebuilds the object drops the
    // axis silently; every declaration over a source then sees only absent files.
    const result = parseInput(JSON.stringify(worldInput));

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toEqual(worldInput);
      expect(result.value.world?.changes).toEqual([TARGET, FILE_EN]);
    }
  });

  it('leaves the change evidence untouched by the presence of world', () => {
    // The world axis sits beside the calls, not inside them: a traversal that folds
    // `world.files` into the file changes would judge a source as if it were an edit.
    expect(allFileChanges(worldInput)).toEqual([
      { kind: 'create', path: TARGET, post: 'export {};\n' },
    ]);
  });
});

/** The three required collections, empty, with the caller's `world` beside them. */
function payloadWith(world: unknown): string {
  return JSON.stringify({ toolCalls: [], subagentSpawns: [], userMessages: [], world });
}

describe('parseInput — the world axis is shape-checked, not merely carried', () => {
  it('refuses a world that is not a plain object: null, a string, an array', () => {
    // A parser that checks the three collections alone carries `world: null` through, and
    // the first `input.world.files` lookup throws inside a judge body — a crash the wrapper
    // records as a verdict about the change instead of a refusal of the payload.
    for (const world of [null, 'x', []]) {
      expect(parseInput(payloadWith(world)), `world: ${JSON.stringify(world)}`).toEqual({
        ok: false,
        exitCode: 2,
      });
    }
  });

  it('refuses world.files that is not a record of strings: a string, a numeric value, a null value', () => {
    // `null` under a path is the one value the axis forbids outright: it would pass the
    // engine's key-presence test as a supplied file and run the extract steps over
    // nothing, so the declaration's `supply` policy never fires for a file that is absent.
    for (const files of ['x', { a: 1 }, { a: null }]) {
      expect(parseInput(payloadWith({ files })), `files: ${JSON.stringify(files)}`).toEqual({
        ok: false,
        exitCode: 2,
      });
    }
  });

  it('refuses world.changes that is not a list of strings: a bare path, a numeric element, a null element', () => {
    // A bare path string iterates character by character and a non-string element reaches
    // the change-set relations as a value no path can match — `Implies` over the set
    // becomes vacuous, which is the pairing declaration never finding a missing pair.
    for (const changes of ['src/a.ts', [1], [null]]) {
      expect(parseInput(payloadWith({ changes })), `changes: ${JSON.stringify(changes)}`).toEqual({
        ok: false,
        exitCode: 2,
      });
    }
  });

  it('refuses a world carrying a key the axis does not define', () => {
    // The axis is closed at two fields. A supplier writing under a misspelt key supplies
    // nothing while looking like a supply; a parser that ignores the key lets it stand.
    expect(parseInput(payloadWith({ extra: 1 }))).toEqual({ ok: false, exitCode: 2 });
  });

  it('accepts the empty forms — {}, { files: {} }, { changes: [] } — and returns each verbatim', () => {
    // The shape check must not become a presence check: a root with an empty plan sends
    // `{ files: {} }`, and a session root sends `files` without `changes`. Rejecting an
    // empty form refuses every call in a repository that declares nothing.
    for (const world of [{}, { files: {} }, { changes: [] }]) {
      const result = parseInput(payloadWith(world));

      expect(result.ok, `world: ${JSON.stringify(world)}`).toBe(true);
      if (result.ok === true) expect(result.value.world).toEqual(world);
    }
  });
});
