import { describe, expect, it } from 'vitest';
import { declarationChannels } from '../src/algebra.ts';
import type { AlgebraDeclarationBody } from '../src/config.ts';

// `declarationChannels(body)` reads a declaration's syntax and names the evidence channels
// it binds: `transcript` · `channel` · `command` · `actor` are what only a live call carries,
// `changes` is what only a finished change set carries, and a body naming none of them
// reads files alone and stands on both surfaces. The derivation is syntactic — it never
// runs the declaration — so every case here is a body shape and the list it must yield.
// The list is compared as a set: order is not part of the contract, repetition is.

/** Injected fixture values — the source names and binding keys the grammar fixes. */
const TARGET_PATH = 'target.path';
const PRE = 'pre';
const POST = 'post';
const COMMAND = 'command';
const ACTOR = 'actor';
const CHANGES = 'changes';
/** The declaration's own binding names — arbitrary, chosen not to collide with a fixed name. */
const HISTORY = 'history';
const SPAWNS = 'spawns';
const ENTRY = 'entry';

const sorted = (channels: readonly string[]): string[] => [...channels].sort();

/** A relate block that names one extraction — every fixture needs one and none judges it. */
function relateEmpty(name: string) {
  return [{ id: 'r', relation: { op: 'empty', of: name }, message: 'm' }];
}

/** A file-shaped delta body: the `pre` · `post` pair over a path scope, no other binding. */
const fileDelta = {
  mechanism: 'added-only',
  scope: { source: TARGET_PATH, include: ['^src/'] },
  supply: { [PRE]: 'empty', [POST]: 'empty' },
  extract: {
    before: [{ op: 'source', of: PRE }, { op: 'lines' }, { op: 'keyByPattern', re: '(x)' }],
    after: [{ op: 'source', of: POST }, { op: 'lines' }, { op: 'keyByPattern', re: '(x)' }],
    added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
  },
  relate: relateEmpty('added'),
} as AlgebraDeclarationBody;

describe('declarationChannels — a body that reads files alone names no channel', () => {
  it('the pre · post delta over a path scope yields []', () => {
    // The over-blocking end: a derivation that counts `target.path` or the pair as a
    // channel would push every file-shaped entry out of the shared list.
    expect(declarationChannels(fileDelta)).toEqual([]);
  });

  it('a `file` binding is a world source, not a channel — still []', () => {
    // `sources.<k>.file` reads the repository, which both surfaces have. Counting every
    // `sources` key as a channel would misplace the pairing and companion entries.
    const body = {
      mechanism: 'pairing',
      scope: { source: TARGET_PATH, include: ['^schema/'] },
      sources: { [ENTRY]: { file: 'schema/a.json' } },
      extract: { names: [{ op: 'source', of: ENTRY }, { op: 'json' }] },
      relate: relateEmpty('names'),
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual([]);
  });
});

describe('declarationChannels — the session channels', () => {
  it("a `transcript: true` binding yields ['transcript']", () => {
    const body = {
      mechanism: 'precedent',
      scope: { source: TARGET_PATH, include: ['^package\\.json$'] },
      sources: { [HISTORY]: { transcript: true } },
      supply: { [HISTORY]: 'pass' },
      extract: { reads: [{ op: 'source', of: HISTORY }, { op: 'toolUses' }] },
      relate: relateEmpty('reads'),
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['transcript']);
  });

  it('a transcript binding read only by the witness block still counts, through `sources`', () => {
    // The valve opens only on the session surface; a derivation that walks the body's
    // extract and not the `sources` block would place a valved entry in the shared list.
    const body = {
      mechanism: 'scoped-valve',
      scope: { source: TARGET_PATH, include: ['^ledger/'] },
      sources: { [HISTORY]: { transcript: true } },
      supply: { [HISTORY]: 'pass', [POST]: 'empty' },
      extract: { lines: [{ op: 'source', of: POST }, { op: 'lines' }] },
      relate: relateEmpty('lines'),
      witness: {
        extract: {
          asked: [
            { op: 'source', of: HISTORY },
            { op: 'userTexts', re: 'ok' },
          ],
        },
        relate: [{ id: 'asked', relation: { op: 'nonEmpty', of: 'asked' }, message: 'm' }],
      },
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['transcript']);
  });

  it("a `sidecar: true` binding — the host's channel — yields ['channel']", () => {
    // The spawn-record channel exists only where a host supplies it; a derivation keyed on
    // `transcript` alone leaves a sidecar entry in the shared list, where the change-set
    // surface has no channel to read.
    const body = {
      mechanism: 'delegated-scope',
      scope: { source: TARGET_PATH, include: ['^src/'] },
      sources: { [SPAWNS]: { sidecar: true } },
      supply: { [SPAWNS]: 'pass' },
      extract: { spawned: [{ op: 'source', of: SPAWNS }, { op: 'json' }] },
      relate: relateEmpty('spawned'),
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['channel']);
  });

  it("`scope.source: command` yields ['command']", () => {
    const body = {
      mechanism: 'forbidden-command',
      scope: { source: COMMAND },
      extract: {
        hits: [
          { op: 'source', of: COMMAND },
          { op: 'matches', re: 'rm -rf' },
        ],
      },
      relate: relateEmpty('hits'),
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['command']);
  });

  it("a `{ op: source, of: command }` step under a path scope yields ['command']", () => {
    // A derivation that reads only `scope.source` misses the step form.
    const body = {
      mechanism: 'forbidden-command',
      scope: { source: TARGET_PATH, include: ['^src/'] },
      extract: {
        hits: [
          { op: 'source', of: COMMAND },
          { op: 'matches', re: 'sudo' },
        ],
      },
      relate: relateEmpty('hits'),
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['command']);
  });

  it("a command step that lives only in the witness block's pipeline yields ['command']", () => {
    // Both pipelines are walked; a derivation over the body's extract alone yields [].
    const body = {
      mechanism: 'scoped-valve',
      scope: { source: TARGET_PATH, include: ['^src/'] },
      supply: { [POST]: 'empty' },
      extract: { lines: [{ op: 'source', of: POST }, { op: 'lines' }] },
      relate: relateEmpty('lines'),
      witness: {
        extract: {
          flag: [
            { op: 'source', of: COMMAND },
            { op: 'matches', re: '--force' },
          ],
        },
        relate: [{ id: 'flag', relation: { op: 'nonEmpty', of: 'flag' }, message: 'm' }],
      },
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['command']);
  });

  it('a `supply.actor` policy with no step reading actor binds nothing — channels are what is read', () => {
    // A supply policy disposes of an absent source; only a read makes the source a channel.
    // Counting the key would push a file-only entry off the change-set surface for dead data.
    const body = {
      mechanism: 'actor-scope',
      scope: { source: COMMAND, include: ['git commit'] },
      supply: { [ACTOR]: 'pass' },
      extract: { hits: [{ op: 'source', of: COMMAND }] },
      relate: relateEmpty('hits'),
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['command']);
  });

  it('a structurally malformed body derives without throwing — the grammar validator names the fault', () => {
    const mapping = {
      extract: { a: { op: 'source', of: 'changes' } },
    } as unknown as AlgebraDeclarationBody;
    const text = { extract: 'nope', sources: { a: 'x' } } as unknown as AlgebraDeclarationBody;
    const nullStep = {
      extract: { a: [null] },
      sources: { a: null },
    } as unknown as AlgebraDeclarationBody;

    expect(declarationChannels(mapping)).toEqual([]);
    expect(declarationChannels(text)).toEqual([]);
    expect(declarationChannels(nullStep)).toEqual([]);
  });

  it("a `{ op: source, of: actor }` step without a supply key yields ['actor']", () => {
    const body = {
      mechanism: 'producer-owned',
      scope: { source: TARGET_PATH, include: ['\\.test\\.ts$'] },
      extract: {
        who: [
          { op: 'source', of: ACTOR },
          { op: 'select', path: 'agentType' },
        ],
      },
      relate: relateEmpty('who'),
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['actor']);
  });

  it('a command scope beside a transcript binding yields both, each once', () => {
    // The turn-locality shape. A derivation that stops at the first channel found reports
    // one and the misplacement message names half the reason.
    const body = {
      mechanism: 'turn-locality',
      scope: { source: COMMAND, include: ['merge'] },
      sources: { [HISTORY]: { transcript: true } },
      supply: { [HISTORY]: 'pass' },
      extract: {
        asked: [
          { op: 'source', of: HISTORY },
          { op: 'userTexts', re: 'merge' },
        ],
        line: [{ op: 'source', of: COMMAND }],
      },
      relate: relateEmpty('asked'),
    } as AlgebraDeclarationBody;

    expect(sorted(declarationChannels(body))).toEqual(['command', 'transcript']);
  });

  it('two steps over the same channel name it once', () => {
    // The list is a set: one push per occurrence would render "reads command, command".
    const body = {
      mechanism: 'forbidden-command',
      scope: { source: COMMAND },
      extract: {
        a: [
          { op: 'source', of: COMMAND },
          { op: 'matches', re: 'a' },
        ],
        b: [
          { op: 'source', of: COMMAND },
          { op: 'matches', re: 'b' },
        ],
      },
      relate: relateEmpty('a'),
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['command']);
  });
});

describe('declarationChannels — the change-set channel', () => {
  it("a `{ op: source, of: changes }` step yields ['changes']", () => {
    const body = {
      mechanism: 'companion',
      scope: { source: TARGET_PATH, include: ['\\.md$'] },
      extract: {
        en: [
          { op: 'source', of: TARGET_PATH },
          { op: 'keyByPattern', re: '^(.+)\\.md$' },
        ],
        changed: [{ op: 'source', of: CHANGES }, { op: 'items' }],
      },
      relate: [
        { id: 'r', relation: { op: 'implies', of: 'en', requires: 'changed' }, message: 'm' },
      ],
    } as AlgebraDeclarationBody;

    expect(declarationChannels(body)).toEqual(['changes']);
  });

  it('a body reading both `changes` and a transcript binding names both', () => {
    // The placement validator refuses this body with "no surface observes both"; that
    // message depends on the derivation reporting both, not the first it meets.
    const body = {
      mechanism: 'companion',
      scope: { source: TARGET_PATH, include: ['\\.md$'] },
      sources: { [HISTORY]: { transcript: true } },
      supply: { [HISTORY]: 'pass' },
      extract: {
        changed: [{ op: 'source', of: CHANGES }, { op: 'items' }],
        asked: [
          { op: 'source', of: HISTORY },
          { op: 'userTexts', re: 'x' },
        ],
      },
      relate: relateEmpty('changed'),
    } as AlgebraDeclarationBody;

    expect(sorted(declarationChannels(body))).toEqual(['changes', 'transcript']);
  });
});
