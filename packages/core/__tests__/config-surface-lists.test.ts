import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfig } from '../src/config.ts';

// The three discipline lists. Which list an entry belongs in is a function of the channels
// its declaration binds — `disciplines` for none, `sessionDisciplines` for at least one of
// transcript · channel · command · actor and no `changes`, `changeSetDisciplines` for
// `changes` and no session channel — and `defineConfig` refuses a placement that disagrees,
// naming the entry and the list it belongs in. There is no key an author sets to choose.
// Every rejection is asserted on the message, because the message is what sends the author
// to the right list; every acceptance is asserted on the resolved shape, because an
// over-strict validator empties a surface as surely as an over-lenient one fills it.

const baseConfig = {
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
} as const;

type Resolved = ReturnType<typeof defineConfig> & {
  disciplines?: unknown[];
  sessionDisciplines?: unknown[];
  changeSetDisciplines?: unknown[];
  drafts?: unknown[];
};

/** Injected fixture values — the source names the grammar fixes and the meta labels. */
const TARGET_PATH = 'target.path';
const COMMAND = 'command';
const ACTOR = 'actor';
const CHANGES = 'changes';
const HISTORY = 'history';
const SPAWNS = 'spawns';
const SELF_MOD_LABEL = 'self-mod';
const SHELL_MOD_LABEL = 'shell-mod';

/** A file-shaped delta entry: reads `pre` · `post` under a path scope — no channel. */
function fileEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'added-only',
      scope: { source: TARGET_PATH, include: ['^src/'] },
      supply: { pre: 'empty', post: 'empty' },
      extract: {
        before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: '(x)' }],
        after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: '(x)' }],
        added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
      },
      relate: [{ id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'm' }],
    },
  };
}

/** A world-binding entry: reads a repository file through `sources.<k>.file` — no channel. */
function fileSourceEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'companion',
      scope: { source: TARGET_PATH, include: ['^agents/'] },
      sources: { tiers: { file: 'tiers.md' } },
      supply: { post: 'empty' },
      extract: {
        named: [
          { op: 'source', of: 'post' },
          { op: 'lines' },
          { op: 'keyByPattern', re: '^m: (\\w+)$' },
        ],
        allowed: [
          { op: 'source', of: 'tiers' },
          { op: 'lines' },
          { op: 'keyByPattern', re: '^(\\w+)$' },
        ],
      },
      relate: [
        {
          id: 'listed',
          relation: { op: 'implies', of: 'named', requires: 'allowed' },
          message: 'm',
        },
      ],
    },
  };
}

/** A transcript entry: `sources.<k>.transcript` under a path scope. */
function transcriptEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'precedent',
      scope: { source: TARGET_PATH, include: ['^package\\.json$'] },
      sources: { [HISTORY]: { transcript: true } },
      supply: { [HISTORY]: 'pass' },
      extract: {
        reads: [
          { op: 'source', of: HISTORY },
          { op: 'toolUses' },
          { op: 'select', path: 'args.command' },
        ],
      },
      relate: [{ id: 'read-first', relation: { op: 'nonEmpty', of: 'reads' }, message: 'm' }],
    },
  };
}

/** A command entry: `scope.source: command`. */
function commandEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'forbidden-command',
      scope: { source: COMMAND },
      extract: {
        hits: [{ op: 'source', of: COMMAND }, { op: 'lines' }, { op: 'matches', re: 'rm -rf' }],
      },
      relate: [{ id: 'no-hit', relation: { op: 'empty', of: 'hits' }, message: 'm' }],
    },
  };
}

/** A command scope beside a transcript binding — two session channels at once. */
function commandAndTranscriptEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'turn-locality',
      scope: { source: COMMAND, include: ['merge'] },
      sources: { [HISTORY]: { transcript: true } },
      supply: { [HISTORY]: 'pass' },
      extract: {
        asked: [
          { op: 'source', of: HISTORY },
          { op: 'userTexts', re: 'merge' },
          { op: 'ageMs' },
          { op: 'filter', when: [{ field: 'ageMs', lte: 600000 }] },
        ],
      },
      relate: [{ id: 'fresh', relation: { op: 'nonEmpty', of: 'asked' }, message: 'm' }],
    },
  };
}

/** An actor entry: `supply.actor` under a path scope. */
function actorEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'producer-owned',
      scope: { source: TARGET_PATH, include: ['\\.test\\.ts$'] },
      supply: { [ACTOR]: 'pass' },
      extract: {
        implementer: [
          { op: 'source', of: ACTOR },
          { op: 'select', path: 'agentType' },
          { op: 'matches', re: '^implementer$' },
        ],
      },
      relate: [{ id: 'not-them', relation: { op: 'empty', of: 'implementer' }, message: 'm' }],
    },
  };
}

/** A change-set entry: a `changes` source step under a path scope. */
function changesEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'companion',
      scope: { source: TARGET_PATH, include: ['\\.md$'] },
      extract: {
        en: [
          { op: 'source', of: TARGET_PATH },
          { op: 'keyByPattern', re: '^(.+?)(?<!\\.ko)\\.md$' },
        ],
        koChanged: [
          { op: 'source', of: CHANGES },
          { op: 'items' },
          { op: 'keyByPattern', re: '^(.+)\\.ko\\.md$' },
        ],
      },
      relate: [
        {
          id: 'ko-follows',
          relation: { op: 'implies', of: 'en', requires: 'koChanged' },
          message: 'm',
        },
      ],
    },
  };
}

/** A body reading `changes` and a transcript binding at once — no surface observes both. */
function changesAndTranscriptEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'companion',
      scope: { source: TARGET_PATH, include: ['\\.md$'] },
      sources: { [HISTORY]: { transcript: true } },
      supply: { [HISTORY]: 'pass' },
      extract: {
        changed: [{ op: 'source', of: CHANGES }, { op: 'items' }],
        asked: [
          { op: 'source', of: HISTORY },
          { op: 'userTexts', re: 'docs' },
        ],
      },
      relate: [{ id: 'r', relation: { op: 'empty', of: 'changed' }, message: 'm' }],
    },
  };
}

/** A channel entry: `sources.<k>.sidecar` — the host's spawn-record channel. */
function sidecarEntry(id: string) {
  return {
    id,
    declare: {
      mechanism: 'precedent',
      scope: { source: TARGET_PATH, include: ['^src/'] },
      sources: { [SPAWNS]: { sidecar: true } },
      supply: { [SPAWNS]: 'pass' },
      extract: { spawned: [{ op: 'source', of: SPAWNS }, { op: 'json' }] },
      relate: [{ id: 'r', relation: { op: 'nonEmpty', of: 'spawned' }, message: 'm' }],
    },
  };
}

function draftEntry(id: string) {
  return { id, why: 'registered as prose ahead of promotion', draft: true };
}

function configWith(lists: Record<string, unknown>): unknown {
  return { ...baseConfig, ...lists };
}

/** Asserts the concrete error instance and returns it so callers can assert on the message. */
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

describe('defineConfig — each list accepts the entries whose channels it observes', () => {
  it('a transcript entry in sessionDisciplines loads and resolves into sessionDisciplines', () => {
    const entry = transcriptEntry('manifest-needs-evidence');

    const resolved = defineConfig(configWith({ sessionDisciplines: [entry] })) as Resolved;

    expect(resolved.sessionDisciplines).toEqual([entry]);
  });

  it('a command entry, an actor entry, and a command+transcript entry all load in sessionDisciplines', () => {
    // Each session channel on its own must satisfy the "at least one" side; a validator
    // keyed on transcript alone refuses the command-line and actor entries.
    const entries = [
      commandEntry('pnpm-only'),
      actorEntry('tests-are-the-writers'),
      commandAndTranscriptEntry('merge-is-the-users-call'),
    ];

    const resolved = defineConfig(configWith({ sessionDisciplines: entries })) as Resolved;

    expect(resolved.sessionDisciplines).toEqual(entries);
  });

  it('a sidecar entry loads in sessionDisciplines', () => {
    // The channel binding is the fourth session channel; a validator keyed on the other
    // three refuses it everywhere and the entry has no list to live in.
    const entry = sidecarEntry('spawns-are-recorded');

    const resolved = defineConfig(configWith({ sessionDisciplines: [entry] })) as Resolved;

    expect(resolved.sessionDisciplines).toEqual([entry]);
  });

  it('a changes entry in changeSetDisciplines loads and resolves into changeSetDisciplines', () => {
    const entry = changesEntry('docs-stay-bilingual');

    const resolved = defineConfig(configWith({ changeSetDisciplines: [entry] })) as Resolved;

    expect(resolved.changeSetDisciplines).toEqual([entry]);
  });

  it('a file-shaped entry and a `file`-binding entry both stay accepted in disciplines', () => {
    // The shared list is where every entry lived before the split; a `file` binding is a
    // world source both surfaces read, and a validator that treats every `sources` key as
    // a channel evicts the companion and pairing entries.
    const entries = [fileEntry('covenant-vocabulary'), fileSourceEntry('agent-models-in-tiers')];

    const resolved = defineConfig(configWith({ disciplines: entries })) as Resolved;

    expect(resolved.disciplines).toEqual(entries);
  });

  it('all three lists load side by side, each resolving to its own entries in order', () => {
    const shared = [fileEntry('shared-a'), fileEntry('shared-b')];
    const session = [transcriptEntry('session-a'), commandEntry('session-b')];
    const changeSet = [changesEntry('change-set-a')];

    const resolved = defineConfig(
      configWith({
        disciplines: shared,
        sessionDisciplines: session,
        changeSetDisciplines: changeSet,
      }),
    ) as Resolved;

    expect(resolved.disciplines).toEqual(shared);
    expect(resolved.sessionDisciplines).toEqual(session);
    expect(resolved.changeSetDisciplines).toEqual(changeSet);
  });

  it('a draft in disciplines still moves to drafts when the session list is present too', () => {
    // The split is only over `disciplines`; the other lists must not swallow or drop it.
    const draft = draftEntry('verbs-take-one-spec');

    const resolved = defineConfig(
      configWith({
        disciplines: [fileEntry('shared-a'), draft],
        sessionDisciplines: [commandEntry('session-a')],
      }),
    ) as Resolved;

    expect(resolved.disciplines).toEqual([fileEntry('shared-a')]);
    expect(resolved.drafts).toEqual([draft]);
  });
});

describe('defineConfig — an absent list stays absent', () => {
  it('neither surface list is fabricated when only disciplines is given', () => {
    // A default-fill of `[]` makes an absent list indistinguishable from an explicit empty
    // one, and the assembly and `explain` read presence.
    const resolved = defineConfig(configWith({ disciplines: [fileEntry('a')] })) as Resolved;

    expect('sessionDisciplines' in resolved).toBe(false);
    expect('changeSetDisciplines' in resolved).toBe(false);
  });

  it('disciplines is not fabricated when only a surface list is given', () => {
    const resolved = defineConfig(
      configWith({ sessionDisciplines: [commandEntry('a')] }),
    ) as Resolved;

    expect('disciplines' in resolved).toBe(false);
    expect('changeSetDisciplines' in resolved).toBe(false);
  });

  it('an explicitly empty surface list resolves to [] — presence mirrors the input', () => {
    const resolved = defineConfig(
      configWith({ sessionDisciplines: [], changeSetDisciplines: [] }),
    ) as Resolved;

    expect(resolved.sessionDisciplines).toEqual([]);
    expect(resolved.changeSetDisciplines).toEqual([]);
  });
});

describe('defineConfig — a misplaced entry is refused with its id and its destination', () => {
  it('a transcript entry in disciplines: names the id and sessionDisciplines', () => {
    // The fail-open end of the split: an entry accepted here compiles on the change-set
    // surface, where it has no transcript and records nothing that reads as a placement.
    const error = expectConfigValidationError(
      configWith({ disciplines: [transcriptEntry('manifest-needs-evidence')] }),
    );

    expect(error.message).toContain('manifest-needs-evidence');
    expect(error.message).toMatch(/belongs in sessionDisciplines/);
  });

  it('a command+transcript entry in disciplines: the message lists both channels it reads', () => {
    // Half a reason sends the author to fix one binding and meet the same error again.
    const error = expectConfigValidationError(
      configWith({ disciplines: [commandAndTranscriptEntry('merge-is-the-users-call')] }),
    );

    expect(error.message).toContain('merge-is-the-users-call');
    expect(error.message).toContain('transcript');
    expect(error.message).toContain('command');
    expect(error.message).toMatch(/belongs in sessionDisciplines/);
  });

  it('an actor entry in disciplines: names sessionDisciplines', () => {
    // `supply.actor` with no `source` step over it is the form a step-only walk misses.
    const error = expectConfigValidationError(
      configWith({ disciplines: [actorEntry('tests-are-the-writers')] }),
    );

    expect(error.message).toContain('tests-are-the-writers');
    expect(error.message).toMatch(/belongs in sessionDisciplines/);
  });

  it('a sidecar entry in disciplines: names sessionDisciplines', () => {
    // The change-set surface injects no channel reader, so a sidecar entry accepted into
    // the shared list reads an absent channel there on every dispatch.
    const error = expectConfigValidationError(
      configWith({ disciplines: [sidecarEntry('spawns-are-recorded')] }),
    );

    expect(error.message).toContain('spawns-are-recorded');
    expect(error.message).toMatch(/belongs in sessionDisciplines/);
  });

  it('a transcript entry in changeSetDisciplines: names sessionDisciplines', () => {
    const error = expectConfigValidationError(
      configWith({ changeSetDisciplines: [transcriptEntry('manifest-needs-evidence')] }),
    );

    expect(error.message).toContain('manifest-needs-evidence');
    expect(error.message).toMatch(/belongs in sessionDisciplines/);
  });

  it('an actor entry in changeSetDisciplines: names sessionDisciplines', () => {
    // The change-set surface proves no actor; the entry's `supply: pass` would let every
    // dispatch through as a skip that reads like a placement.
    const error = expectConfigValidationError(
      configWith({ changeSetDisciplines: [actorEntry('tests-are-the-writers')] }),
    );

    expect(error.message).toContain('tests-are-the-writers');
    expect(error.message).toMatch(/belongs in sessionDisciplines/);
  });

  it('a changes entry in disciplines: names changeSetDisciplines', () => {
    const error = expectConfigValidationError(
      configWith({ disciplines: [changesEntry('docs-stay-bilingual')] }),
    );

    expect(error.message).toContain('docs-stay-bilingual');
    expect(error.message).toMatch(/belongs in changeSetDisciplines/);
  });

  it('a changes entry in sessionDisciplines: names changeSetDisciplines', () => {
    const error = expectConfigValidationError(
      configWith({ sessionDisciplines: [changesEntry('docs-stay-bilingual')] }),
    );

    expect(error.message).toContain('docs-stay-bilingual');
    expect(error.message).toMatch(/belongs in changeSetDisciplines/);
  });

  it('a command entry in changeSetDisciplines: names sessionDisciplines', () => {
    const error = expectConfigValidationError(
      configWith({ changeSetDisciplines: [commandEntry('pnpm-only')] }),
    );

    expect(error.message).toContain('pnpm-only');
    expect(error.message).toMatch(/belongs in sessionDisciplines/);
  });

  it('a file-shaped entry in sessionDisciplines: names disciplines', () => {
    // The "at least one session channel" side. A validator that checks only "no changes"
    // lets a shared entry hide in a surface list, where the other surface never sees it.
    const error = expectConfigValidationError(
      configWith({ sessionDisciplines: [fileEntry('covenant-vocabulary')] }),
    );

    expect(error.message).toContain('covenant-vocabulary');
    expect(error.message).toMatch(/belongs in disciplines/);
  });

  it('a file-shaped entry in changeSetDisciplines: names disciplines', () => {
    const error = expectConfigValidationError(
      configWith({ changeSetDisciplines: [fileEntry('covenant-vocabulary')] }),
    );

    expect(error.message).toContain('covenant-vocabulary');
    expect(error.message).toMatch(/belongs in disciplines/);
  });

  it('the message locates the entry by list and index', () => {
    // Two entries share a shape; only the index tells the author which line to move.
    const error = expectConfigValidationError(
      configWith({ disciplines: [fileEntry('ok'), transcriptEntry('misplaced')] }),
    );

    expect(error.message).toContain('disciplines[1]');
  });
});

describe('defineConfig — a draft belongs in disciplines alone', () => {
  it('a draft in sessionDisciplines is refused with `a draft belongs in disciplines`', () => {
    const error = expectConfigValidationError(
      configWith({ sessionDisciplines: [draftEntry('verbs-take-one-spec')] }),
    );

    expect(error.message).toContain('verbs-take-one-spec');
    expect(error.message).toContain('a draft belongs in disciplines');
  });

  it('a draft in changeSetDisciplines is refused with the same sentence', () => {
    const error = expectConfigValidationError(
      configWith({ changeSetDisciplines: [draftEntry('verbs-take-one-spec')] }),
    );

    expect(error.message).toContain('verbs-take-one-spec');
    expect(error.message).toContain('a draft belongs in disciplines');
  });
});

describe('defineConfig — a body no surface can observe', () => {
  it.each(['disciplines', 'sessionDisciplines', 'changeSetDisciplines'])(
    'changes + transcript in %s is refused with `no surface observes both`',
    (list) => {
      // Whichever list it sits in, the entry would read a channel that surface lacks; the
      // per-list destination messages would send the author in a circle.
      const error = expectConfigValidationError(
        configWith({ [list]: [changesAndTranscriptEntry('docs-need-a-turn')] }),
      );

      expect(error.message).toContain('docs-need-a-turn');
      expect(error.message).toContain('no surface observes both');
    },
  );
});

describe('defineConfig — ids are unique across the three lists and the meta labels', () => {
  it('an id shared by disciplines and sessionDisciplines is refused', () => {
    // A per-list uniqueness scan passes this; `explain` would then render one label twice.
    const error = expectConfigValidationError(
      configWith({
        disciplines: [fileEntry('shared-id')],
        sessionDisciplines: [commandEntry('shared-id')],
      }),
    );

    expect(error.message).toContain('shared-id');
  });

  it('an id shared by sessionDisciplines and changeSetDisciplines is refused', () => {
    const error = expectConfigValidationError(
      configWith({
        sessionDisciplines: [commandEntry('shared-id')],
        changeSetDisciplines: [changesEntry('shared-id')],
      }),
    );

    expect(error.message).toContain('shared-id');
  });

  it('an id shared by disciplines and changeSetDisciplines is refused', () => {
    const error = expectConfigValidationError(
      configWith({
        disciplines: [fileEntry('shared-id')],
        changeSetDisciplines: [changesEntry('shared-id')],
      }),
    );

    expect(error.message).toContain('shared-id');
  });

  it('a draft id colliding with a judged entry in another list is refused', () => {
    // Drafts are split out of `disciplines` before the judged entries are compared; a scan
    // that runs after the split never sees the draft beside the session entry.
    const error = expectConfigValidationError(
      configWith({
        disciplines: [draftEntry('shared-id')],
        sessionDisciplines: [commandEntry('shared-id')],
      }),
    );

    expect(error.message).toContain('shared-id');
  });

  it('a session entry claiming the self-mod meta label is refused', () => {
    const error = expectConfigValidationError(
      configWith({ sessionDisciplines: [commandEntry(SELF_MOD_LABEL)] }),
    );

    expect(error.message).toContain(SELF_MOD_LABEL);
  });

  it('a change-set entry claiming the shell-mod meta label is refused', () => {
    const error = expectConfigValidationError(
      configWith({ changeSetDisciplines: [changesEntry(SHELL_MOD_LABEL)] }),
    );

    expect(error.message).toContain(SHELL_MOD_LABEL);
  });
});

describe('defineConfig — the new keys are arrays of entries', () => {
  it.each(['sessionDisciplines', 'changeSetDisciplines'])(
    '%s: a non-array value is refused',
    (list) => {
      expectConfigValidationError(configWith({ [list]: { id: 'x' } }));
    },
  );
});

describe('a structurally malformed declare body meets the located grammar error', () => {
  const shapes: [string, unknown][] = [
    [
      'an extract pipeline written as a mapping',
      { extract: { a: { op: 'source', of: 'changes' } } },
    ],
    ['an extract block that is text', { extract: 'nope' }],
    [
      'a sources binding that is text',
      { sources: { a: 'x' }, extract: { a: [{ op: 'source', of: 'a' }] } },
    ],
    ['a null step', { extract: { a: [null] } }],
  ];

  it.each(shapes)(
    '%s is a ConfigValidationError naming the entry, not a TypeError',
    (_name, declare) => {
      const config = configWith({
        disciplines: [
          {
            id: 'broken',
            declare: {
              mechanism: 'naming',
              scope: { source: TARGET_PATH, include: ['^src/'] },
              ...(declare as object),
            },
          },
        ],
      });
      let caught: unknown;
      try {
        defineConfig(config);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigValidationError);
      expect((caught as Error).message).toContain("disciplines[0] ('broken')");
    },
  );
});
