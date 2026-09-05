import { describe, expect, it } from 'vitest';
import { validateAlgebraDeclaration } from '../src/algebra.ts';
import { deriveShape, MECHANISM_NAMES, MECHANISM_SHAPES } from '../src/catalogue.ts';
import { ConfigValidationError, defineConfig } from '../src/config.ts';
import { FIXED_SOURCE_NAMES } from '../src/source-names.ts';

// The sixth fixed source `command` — the shell call's command string, a value the world
// carries on its own — and the mechanism that reads it, `forbidden-command`
// (`{ axes: change, relations: empty }`). A discipline entry's closed key set is
// `id` · `why` · `enforce` · `declare`; the five predicate keys of the deleted families are
// unknown keys like any other.
//
// Source names, mechanism names, patterns, and the location are fixture values.

const LOCATION = 'disciplines[2].declare';
const COMMAND_SOURCE = 'command';
const PATH_SOURCE = 'target.path';
const FILE_NAME = 'allow';
const FILE_PATH = 'policy/allow.txt';
const PATTERN = '\\bnpm\\b';

/** The ban on a command-line pattern: matched lines empty. */
const forbiddenCommandDeclaration = {
  discipline: 'probe',
  mechanism: 'forbidden-command',
  scope: { source: COMMAND_SOURCE },
  extract: {
    hits: [{ op: 'source', of: COMMAND_SOURCE }, { op: 'lines' }, { op: 'matches', re: PATTERN }],
  },
  relate: [{ id: 'no-npm', relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
};

/** A declaration reading `command` under the one name whose spec admits every shape. */
const valveOverCommand = {
  discipline: 'probe',
  mechanism: 'scoped-valve',
  extract: { hits: [{ op: 'source', of: COMMAND_SOURCE }, { op: 'lines' }] },
  relate: [{ id: 'seen', relation: { op: 'nonEmpty', of: 'hits' }, message: 'm' }],
  witness: { relate: [{ id: 'valve', relation: { op: 'empty', of: 'hits' }, message: 'w' }] },
};

/** Asserts the concrete error instance and returns it so callers can assert on the message. */
function expectRejection(input: unknown): ConfigValidationError {
  try {
    validateAlgebraDeclaration(input, LOCATION);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('validateAlgebraDeclaration should have thrown');
}

describe('the fixed source `command`', () => {
  it('derives the change axis, like every other fixed name', () => {
    // A fixed list that stayed at five refuses `{ op: 'source', of: 'command' }` as an
    // unbound name; a list widened without the derivation rule leaves the pipeline
    // axis-less, and the empty set satisfies every mechanism spec.
    expect(FIXED_SOURCE_NAMES).toContain(COMMAND_SOURCE);
    const shape = deriveShape(validateAlgebraDeclaration(valveOverCommand));

    expect(shape.axes).toEqual(new Set(['change']));
  });

  it('a `sources` binding named command is refused — it shadows the fixed source', () => {
    // A user binding under the fixed name would replace the call's command string with a
    // file's text, and the ban would judge the file.
    const error = expectRejection({
      ...valveOverCommand,
      sources: { [COMMAND_SOURCE]: { file: FILE_PATH } },
    });

    expect(error.message).toContain(`${LOCATION}.sources.${COMMAND_SOURCE}`);
  });

  it('scope.source: command with a constant include list is accepted', () => {
    // The scope's allowed source set is a separate list from the fixed names; a validator
    // whose scope list was not widened refuses the declaration that gates on the command
    // line, so `tea pr merge` can never be scoped on.
    const declaration = {
      ...valveOverCommand,
      scope: { source: COMMAND_SOURCE, include: ['\\btea\\s+pr\\s+merge\\b'] },
    };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });
});

describe('the mechanism `forbidden-command`', () => {
  it('is in the catalogue with the shape { axes: change, relations: empty, scope on command }', () => {
    // The name absent from the tuple refuses the declaration outright; present with a wider
    // shape, it admits declarations that are not a ban.
    expect(MECHANISM_NAMES).toContain('forbidden-command');
    expect(MECHANISM_SHAPES['forbidden-command' as (typeof MECHANISM_NAMES)[number]]).toEqual({
      axes: new Set(['change']),
      relations: new Set(['empty']),
      scopeSource: 'command',
    });
  });

  it('a ban over the command line — source command → lines → matches, related empty — passes the shape check', () => {
    // The whole path an author takes: a validator that derives `command` correctly but
    // maps the name to a spec without `change` refuses every real ban.
    const declaration = validateAlgebraDeclaration(forbiddenCommandDeclaration, LOCATION);

    expect(deriveShape(declaration)).toEqual({
      axes: new Set(['change']),
      relations: new Set(['empty']),
      witness: false,
    });
  });

  it('the ban without a scope on command is rejected — a scope-less reader refuses every Edit', () => {
    // A world with no shell call carries no `command`; a ban admitting such a world reads an
    // absent source and answers unjudgeable on every mutating call. The catalogue pins the
    // scope so the mistake is a load-time message, not a locked session.
    const { scope: _scope, ...scopeless } = forbiddenCommandDeclaration;
    const error = expectRejection(scopeless);

    expect(error.message).toContain("scopes on 'command'");
  });

  it('the ban related nonEmpty is rejected — a spec admitting the inverse turns a ban into a requirement', () => {
    // `{ relations: { empty, nonEmpty } }` accepts the declaration that breaks when the
    // pattern is ABSENT: the name says forbidden, the judgment says required.
    const error = expectRejection({
      ...forbiddenCommandDeclaration,
      relate: [{ id: 'no-npm', relation: { op: 'nonEmpty', of: 'hits' }, message: 'm' }],
    });

    expect(error.message).toContain("'forbidden-command'");
    expect(error.message).toContain("'nonEmpty'");
  });

  it('the ban reading a file binding beside command is rejected — the axis is change alone', () => {
    // A spec listing `world` too admits a ban that consults a file for its pattern list,
    // and the session surface then supplies a file this mechanism was never meant to read.
    const error = expectRejection({
      ...forbiddenCommandDeclaration,
      sources: { [FILE_NAME]: { file: FILE_PATH } },
      extract: {
        ...forbiddenCommandDeclaration.extract,
        allowed: [{ op: 'source', of: FILE_NAME }, { op: 'lines' }],
      },
      relate: [
        ...forbiddenCommandDeclaration.relate,
        { id: 'none-allowed', relation: { op: 'empty', of: 'allowed' }, message: 'm' },
      ],
    });

    expect(error.message).toContain("'forbidden-command'");
    expect(error.message).toContain("'world'");
  });
});

describe('a discipline entry — the five predicate keys are unknown keys', () => {
  const baseConfig = {
    languages: { typescript: { productionGlob: 'src/**/*', testCmd: 'fake-runner {scope}' } },
  };
  /** A well-formed entry: the only fault each case adds is the extra key. */
  const validEntry = {
    id: 'no-npm',
    declare: {
      mechanism: 'naming',
      scope: { source: PATH_SOURCE, include: ['\\.db$'] },
      extract: {
        outside: [
          { op: 'source', of: PATH_SOURCE },
          { op: 'matches', re: '^(?!store/)' },
        ],
      },
      relate: [{ id: 'placed', relation: { op: 'empty', of: 'outside' }, message: 'm' }],
    },
  };

  it.each([
    ['forbidCommand', 'push\\s+--force'],
    ['requirePrecedent', { command: 'npm view ' }],
    ['in', 'src/**'],
    ['except', 'src/legacy/**'],
    ['when', 'TODO'],
  ])('an entry carrying %s is refused as an unknown key naming it', (key, value) => {
    // An old key silently dropped is a promise the author believes is judged and nothing
    // reads; a key refused under a family-era name sends the author to a validator that
    // no longer exists. The closed set is id · why · enforce · declare.
    let error: unknown;
    try {
      defineConfig({ ...baseConfig, disciplines: [{ ...validEntry, [key]: value }] });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as ConfigValidationError).message).toContain(`unknown key '${key}'`);
  });

  it('an entry carrying an old key alone, with no declare, is refused as that unknown key', () => {
    // The closed key set is checked before the predicate is selected. A key set that still
    // lists the old name refuses this entry for having no declare instead, and the author is
    // sent toward adding one beside dead data.
    let error: unknown;
    try {
      defineConfig({
        ...baseConfig,
        disciplines: [{ id: 'no-npm', forbidCommand: 'push\\s+--force' }],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as ConfigValidationError).message).toContain("unknown key 'forbidCommand'");
  });
});
