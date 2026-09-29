import { ConfigValidationError } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { parseConfigSource } from '../src/load-config.ts';

// `parseConfigSource` with a `layer`: a second discipline file, read by the caller from a
// path outside the judged tree, whose three lists are appended after the target config's
// own before `defineConfig` and the declaration compile run once over the whole. The
// loader parses, appends, delegates, and attaches self-protection for the target file
// alone — the layer's shape is core's `defineConfigLayer`'s to refuse, and every failure
// names the file it came from, because the author of a layer never sees the target tree.

/** Injected fixture values — the two files and the source names the grammar fixes. */
const CONFIG_PATH = 'polydeukes.config.json';
const LAYER_PATH = '/host/policy/discipline-layer.json';
const TARGET_PATH = 'target.path';
const COMMAND = 'command';
const CHANGES = 'changes';
/** The compiler's own text for a step outside the registry; the loader carries it unchanged. */
const UNREGISTERED_STEP = 'sha256';
const COMPILE_REASON = `'${UNREGISTERED_STEP}' is not a registered extract step`;

const LANGUAGES = {
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
};

/** A file-shaped delta entry: reads `pre` · `post` under a path scope — no channel. */
function fileEntry(id: string, lastStep: Record<string, unknown> = { op: 'lines' }) {
  return {
    id,
    declare: {
      mechanism: 'added-only',
      scope: { source: TARGET_PATH, include: ['^src/'] },
      supply: { pre: 'empty', post: 'empty' },
      extract: {
        before: [{ op: 'source', of: 'pre' }, lastStep, { op: 'keyByPattern', re: '(x)' }],
        after: [{ op: 'source', of: 'post' }, lastStep, { op: 'keyByPattern', re: '(x)' }],
        added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
      },
      relate: [{ id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'm' }],
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
        hits: [{ op: 'source', of: COMMAND }, { op: 'lines' }, { op: 'matches', re: 'FLUSHALL' }],
      },
      relate: [{ id: 'no-hit', relation: { op: 'empty', of: 'hits' }, message: 'm' }],
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

function parseWithLayer(target: Record<string, unknown>, layerSource: string) {
  return parseConfigSource({
    source: JSON.stringify({ ...LANGUAGES, ...target }),
    configPath: CONFIG_PATH,
    layer: { source: layerSource, path: LAYER_PATH },
  });
}

function ids(entries: readonly { id: string }[] | undefined): string[] {
  return (entries ?? []).map((entry) => entry.id);
}

/** Runs the parse, asserts it threw, and returns the error for message assertions. */
function expectThrow(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('parseConfigSource should have thrown');
}

describe('a layer’s lists are appended after the target’s, list by list', () => {
  it('when both files carry all three lists, each resolved list is target entries then layer entries', () => {
    // Order is the contract the assembly reads registrations in. A loader that prepends
    // the layer, or concatenates into one list, changes which entry judges first and on
    // which surface.
    const { config } = parseWithLayer(
      {
        disciplines: [fileEntry('target-shared')],
        sessionDisciplines: [commandEntry('target-session')],
        changeSetDisciplines: [changesEntry('target-change-set')],
      },
      JSON.stringify({
        disciplines: [fileEntry('host-shared')],
        sessionDisciplines: [commandEntry('host-session')],
        changeSetDisciplines: [changesEntry('host-change-set')],
      }),
    );

    expect(ids(config.disciplines)).toEqual(['target-shared', 'host-shared']);
    expect(ids(config.sessionDisciplines)).toEqual(['target-session', 'host-session']);
    expect(ids(config.changeSetDisciplines)).toEqual(['target-change-set', 'host-change-set']);
  });

  it('a list only the layer carries appears, and a list only the target carries stays', () => {
    // A merge written as "for each list the target has, append the layer's" drops a host
    // list the target never opened — the session list here, the usual shape of a host
    // policy over a repository whose own config has only shared entries.
    const { config } = parseWithLayer(
      { disciplines: [fileEntry('target-shared')] },
      JSON.stringify({ sessionDisciplines: [commandEntry('host-session')] }),
    );

    expect(ids(config.disciplines)).toEqual(['target-shared']);
    expect(ids(config.sessionDisciplines)).toEqual(['host-session']);
    expect('changeSetDisciplines' in config).toBe(false);
  });
});

describe('a layer id already in the target is a load failure naming both files', () => {
  it('the same id in target sessionDisciplines and layer sessionDisciplines throws with both paths and the id', () => {
    // Two entries under one label write rows nobody can attribute. The message must name
    // the layer path too: the target author sees only their own file, and a message naming
    // it alone sends them to remove an entry that is not the duplicate.
    const error = expectThrow(() =>
      parseWithLayer(
        { sessionDisciplines: [commandEntry('flush-ban')] },
        JSON.stringify({ sessionDisciplines: [commandEntry('flush-ban')] }),
      ),
    );

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error.message).toContain('flush-ban');
    expect(error.message).toContain(CONFIG_PATH);
    expect(error.message).toContain(LAYER_PATH);
  });
});

describe('a layer that does not load is a load failure, never a config without the layer', () => {
  it('a layer entry the engine cannot compile throws naming the step and the layer path', () => {
    // The compile runs over the merged lists; a loader that compiles the target alone and
    // appends the layer afterwards assembles a registration the judge cannot run.
    const error = expectThrow(() =>
      parseWithLayer(
        {},
        JSON.stringify({ disciplines: [fileEntry('host-hashed', { op: UNREGISTERED_STEP })] }),
      ),
    );

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error.message).toContain(COMPILE_REASON);
    expect(error.message).toContain(LAYER_PATH);
  });

  it('a layer text that does not parse throws naming the layer path', () => {
    // The parse failure of the layer must not read as a parse failure of the target file,
    // and must never fall back to loading the target alone.
    const error = expectThrow(() =>
      parseWithLayer({}, 'sessionDisciplines: [unterminated\n  broken: : :'),
    );

    expect(error.message).toContain('failed to parse');
    expect(error.message).toContain(LAYER_PATH);
  });

  it('a layer carrying protectedPaths is refused naming the key and the layer path', () => {
    // The loader must hand the layer to core’s layer validator before merging: a loader
    // that spreads the layer object into the target would take the host's protected list
    // as the target's and silently reconcile two files' values.
    const error = expectThrow(() =>
      parseWithLayer(
        {},
        JSON.stringify({ protectedPaths: ['pipeline/'], disciplines: [fileEntry('host-shared')] }),
      ),
    );

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error.message).toContain('protectedPaths');
    expect(error.message).toContain('invalid config layer in');
    expect(error.message).toContain(LAYER_PATH);
  });
});

describe('self-protection attaches the target config path alone', () => {
  it('protectedPaths gains configPath and not the layer path', () => {
    // The protected list is read relative to the repository root, and the layer lives
    // outside it: attaching the layer path would register an entry the baseline comparison
    // can never read, and it would land an `unattributed` row on every call.
    const { config, configPath } = parseWithLayer(
      {},
      JSON.stringify({ sessionDisciplines: [commandEntry('host-session')] }),
    );

    expect(configPath).toBe(CONFIG_PATH);
    expect(config.protectedPaths).toEqual([CONFIG_PATH]);
  });
});
