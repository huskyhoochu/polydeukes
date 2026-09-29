import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfigLayer } from '../src/config.ts';

// A config layer is a second discipline file a host merges over a judged repository's own
// config at call time. It carries the three discipline lists and `$schema`, nothing else:
// every other top-level key would need a merge rule between two files, and a key that is
// silently ignored is a host policy that silently stops applying. The lists themselves take
// the validation `defineConfig` gives — shape, placement, id uniqueness inside the layer —
// so an entry that would be refused in a config is refused in a layer too.

/** Injected fixture values — the source names the grammar fixes. */
const TARGET_PATH = 'target.path';
const COMMAND = 'command';
const CHANGES = 'changes';
/** The sentence every key refusal carries — it tells the author what a layer may hold. */
const ONLY_LISTS_SENTENCE =
  'a config layer carries only disciplines, sessionDisciplines, changeSetDisciplines';

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

/** Asserts the concrete error instance and returns it so callers can assert on the message. */
function expectLayerError(layer: unknown): ConfigValidationError {
  try {
    defineConfigLayer(layer);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfigLayer should have thrown');
}

describe('defineConfigLayer — the three lists come back as given', () => {
  it('returns all three lists unchanged when all three are present', () => {
    // The loader appends what comes back to the target config's lists, so a validator that
    // returns a resolved shape (drafts split out, entries rewritten) hands it something
    // other than the author's entries.
    const layer = {
      disciplines: [fileEntry('host-shared')],
      sessionDisciplines: [commandEntry('host-session')],
      changeSetDisciplines: [changesEntry('host-change-set')],
    };

    expect(defineConfigLayer(layer)).toEqual(layer);
  });

  it('an absent list stays absent — only sessionDisciplines given returns only that key', () => {
    // A default-fill of `[]` makes the loader append an empty list to a target that never
    // had one, and the assembly and `explain` read presence.
    const result = defineConfigLayer({ sessionDisciplines: [commandEntry('host-session')] });

    expect(result).toEqual({ sessionDisciplines: [commandEntry('host-session')] });
    expect('disciplines' in result).toBe(false);
    expect('changeSetDisciplines' in result).toBe(false);
  });

  it('a layer with no list at all is a layer that adds nothing', () => {
    // The degenerate form: nothing to merge is not an error, and a validator that demands
    // at least one list refuses a host file emptied on purpose.
    expect(defineConfigLayer({})).toEqual({});
  });

  it('accepts a string $schema and leaves it out of the result', () => {
    // `$schema` is an editor reference. Refusing it forbids the one key a layer file needs
    // for completion; returning it would put a non-list key into the merge.
    const result = defineConfigLayer({
      $schema: './schema.json',
      disciplines: [fileEntry('host-shared')],
    });

    expect(result).toEqual({ disciplines: [fileEntry('host-shared')] });
  });
});

describe('defineConfigLayer — every other top-level key is refused, naming the key', () => {
  it.each([
    ['protectedPaths', { protectedPaths: ['pipeline/'] }],
    ['disciplnes', { disciplnes: [fileEntry('host-shared')] }],
  ])(
    '%s in a layer is a ConfigValidationError naming the key and the allowed set',
    (key, extra) => {
      // The fail-open end: a layer key the validator ignores is a host list that never
      // reaches the merge (the misspelled list) or a host value the loader would have to
      // reconcile with the target's (a config key). Both must name the key, because
      // the layer file is outside the judged tree and the message is all the author sees.
      const error = expectLayerError({ disciplines: [fileEntry('ok')], ...extra });

      expect(error.message).toContain(key);
      expect(error.message).toContain(ONLY_LISTS_SENTENCE);
    },
  );

  it.each([['null', null]])(
    '%s at the top level is a ConfigValidationError, not a TypeError',
    (_name, layer) => {
      // A layer file whose text parses to a scalar or a list must be refused by the validator
      // itself; a key walk over a non-object throws a TypeError the loader cannot attribute.
      const error = expectLayerError(layer);

      expect(error.message).toContain(ONLY_LISTS_SENTENCE);
    },
  );
});

describe('defineConfigLayer — the entries take the validation defineConfig gives', () => {
  it('a file-shaped entry placed in sessionDisciplines is refused naming disciplines', () => {
    // Placement is a property of the entry, not of the file it sits in — a validator that
    // tests "no changes" alone lets a shared entry hide in the session list, invisible to
    // the change-set surface.
    const error = expectLayerError({ sessionDisciplines: [fileEntry('host-shared')] });

    expect(error.message).toContain('host-shared');
    expect(error.message).toMatch(/belongs in disciplines/);
  });

  it('an id shared by two lists inside the layer is refused naming the id', () => {
    // Uniqueness across the whole layer, before the merge: a per-list scan passes this,
    // and the duplicate would reach the target config carrying two entries one label.
    const error = expectLayerError({
      disciplines: [fileEntry('host-twice')],
      sessionDisciplines: [commandEntry('host-twice')],
    });

    expect(error.message).toContain('host-twice');
  });
});
