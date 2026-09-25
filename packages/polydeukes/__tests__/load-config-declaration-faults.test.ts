import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigValidationError } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// The loader compiles every `declare` entry of the three lists with the same compiler the
// registration assembly uses, and a config carrying one it cannot compile does not load.
// Core's `defineConfig` checks the grammar's shape; the unary step vocabulary and the
// paired/single discipline live in the umbrella's compiler, so this is the one place a
// wrong step name, a wrong argument, or a relation over the wrong arity can be refused
// before a session starts judging with the entry silently inert.
import { UNARY_STEP_NAMES } from '../src/covenant/declaration-engine.ts';
import { parseConfigSource } from '../src/load-config.ts';

/** Injected fixture values. */
const CONFIG_PATH = 'polydeukes.config.yaml';
const PATH_SOURCE = 'target.path';
const POST = 'post';
const CHANGES = 'changes';
const SPAWNS = 'spawns';
const UNREGISTERED_STEP = 'sha256';
const UNKNOWN_KEY = 'nonsense';
const REPO_CONFIG = resolve(import.meta.dirname, '../../../polydeukes.config.yaml');

/** The compiler's own phrasings — the loader carries them unchanged. */
const UNREGISTERED_REASON = `'${UNREGISTERED_STEP}' is not a registered extract step — the registry carries ${UNARY_STEP_NAMES.join(', ')}`;
const UNKNOWN_KEY_REASON = `'lines' does not take the argument '${UNKNOWN_KEY}'`;
const MISSING_IS_REASON = "'agentType' needs 'is' as a non-empty string";

const LANGUAGES = {
  typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'fake-runner {scope}' },
};

/** The minimal valid config plus the caller's lists, as text — YAML is a JSON superset. */
function configText(lists: Record<string, unknown>): string {
  return JSON.stringify({ languages: LANGUAGES, ...lists });
}

function entry(id: string, declare: Record<string, unknown>): Record<string, unknown> {
  return { id, why: 'fixture', declare };
}

/** Load `source` expecting a refusal; the returned error is what the assertions read. */
function refusal(source: string): ConfigValidationError {
  try {
    parseConfigSource({ source, configPath: CONFIG_PATH });
  } catch (error) {
    if (error instanceof ConfigValidationError) return error;
    throw new Error(`expected ConfigValidationError, got ${String(error)}`);
  }
  throw new Error('expected the config to be refused, but it loaded');
}

function singleFault(id: string, location: string, reason: string): string {
  return `invalid config in ${CONFIG_PATH}: ${id} ${location}: ${reason}`;
}

const VALID_CHANGES_DECLARE = {
  mechanism: 'naming',
  scope: { source: PATH_SOURCE, include: ['\\.ts$'] },
  extract: {
    locks: [{ op: 'source', of: CHANGES }, { op: 'items' }, { op: 'matches', re: '\\.lock$' }],
  },
  relate: [{ id: 'none', relation: { op: 'empty', of: 'locks' }, message: '{value}' }],
};

/** A `disciplines` declaration whose one pipeline ends in `step`, otherwise judgeable. */
function pathDeclareEndingIn(step: Record<string, unknown>): Record<string, unknown> {
  return {
    mechanism: 'naming',
    scope: { source: PATH_SOURCE, include: ['\\.db$'] },
    extract: { own: [{ op: 'source', of: PATH_SOURCE }, step] },
    relate: [{ id: 'placed', relation: { op: 'empty', of: 'own' }, message: '{value}' }],
  };
}

/**
 * The declaration blocks beyond `extract` that reach the compiler: a relation over the wrong
 * arity is refused only if the loader hands over `relate`, and a fault in the witness block
 * only if it hands over `witness`.
 */
const BLOCK_FAULTS: [string, Record<string, unknown>, string, string][] = [
  [
    'unchanged over a single extraction',
    {
      mechanism: 'self-absolution-ban',
      extract: { own: [{ op: 'source', of: POST }, { op: 'lines' }] },
      relate: [{ id: 'kept', relation: { op: 'unchanged', of: 'own' }, message: '{key}' }],
    },
    "relate 'kept'",
    "'unchanged' compares a before/after pair, and 'own' reads a single state",
  ],
  [
    'a fault inside the witness block',
    {
      mechanism: 'scoped-valve',
      extract: { own: [{ op: 'source', of: PATH_SOURCE }] },
      relate: [{ id: 'placed', relation: { op: 'empty', of: 'own' }, message: '{value}' }],
      witness: {
        extract: { token: [{ op: 'source', of: PATH_SOURCE }, { op: UNREGISTERED_STEP }] },
        relate: [{ id: 'opened', relation: { op: 'nonEmpty', of: 'token' }, message: 'm' }],
      },
    },
    'witness.extract token',
    UNREGISTERED_REASON,
  ],
];

describe('parseConfigSource — a declaration the engine cannot compile does not load', () => {
  it('a sessionDisciplines entry reading the spawn sidecar without agentType.is is refused at the step, naming the missing argument', () => {
    // Core admits `agentType` with no `is` because the unary vocabulary is not core's to
    // check; the refusal has to come from the compiler, written here as literal YAML.
    const id = 'writer-spawned';
    const source = [
      'languages:',
      '  typescript:',
      "    productionGlob: 'lib/**/*.ts'",
      "    testCmd: 'fake-runner {scope}'",
      'sessionDisciplines:',
      `  - id: ${id}`,
      '    why: the test writer must have been spawned',
      '    declare:',
      '      mechanism: precedent',
      "      scope: { source: target.path, include: ['^packages/'] }",
      `      sources: { ${SPAWNS}: { sidecar: true } }`,
      '      extract:',
      '        fromSidecar:',
      `          - { op: source, of: ${SPAWNS} }`,
      '          - { op: agentType }',
      "          - { op: matches, re: '^tdd-test-writer$' }",
      '      relate:',
      '        - id: spawned',
      '          relation: { op: nonEmpty, of: fromSidecar }',
      '          message: no test-writer spawn precedes this edit',
      '',
    ].join('\n');

    const error = refusal(source);

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error.message).toBe(singleFault(id, 'extract fromSidecar', MISSING_IS_REASON));
  });

  it.each(BLOCK_FAULTS)(
    'refuses %s with its location and reason',
    (_name, declare, location, reason) => {
      const id = 'faulted';

      const error = refusal(configText({ disciplines: [entry(id, declare)] }));

      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error.message).toBe(singleFault(id, location, reason));
    },
  );

  it.each(['toString', 'constructor', '__proto__'])(
    'refuses a step named %s as unregistered — the registry is not read through its prototype',
    (op) => {
      // The registry is an object literal: a lookup that reads inherited members finds a
      // function with no `validate` for these names and throws a TypeError that names no
      // entry, instead of the fault the loader collects.
      const id = 'faulted';

      const error = refusal(configText({ disciplines: [entry(id, pathDeclareEndingIn({ op }))] }));

      expect(error.message).toBe(
        singleFault(
          id,
          'extract own',
          `'${op}' is not a registered extract step — the registry carries ${UNARY_STEP_NAMES.join(', ')}`,
        ),
      );
    },
  );

  it('a faulted changeSetDisciplines entry after a valid one is refused', () => {
    // The list only the change-set surface reads, with the fault second: a loader that
    // compiles `disciplines` alone, or the first entry of each list, loads this config.
    const id = 'faulted';
    const faulted = {
      ...VALID_CHANGES_DECLARE,
      extract: { locks: [{ op: 'source', of: CHANGES }, { op: UNREGISTERED_STEP }] },
    };

    const error = refusal(
      configText({
        changeSetDisciplines: [entry('no-lock-in-set', VALID_CHANGES_DECLARE), entry(id, faulted)],
      }),
    );

    expect(error.message).toBe(singleFault(id, 'extract locks', UNREGISTERED_REASON));
  });

  it('two faulted entries in one list are reported in one error, one line per entry, under the problems count', () => {
    // A loader that throws at the first fault, or keeps only the first fault of each list,
    // costs one rerun per hidden fault; one that joins them without the count loses the
    // shape the parse-error branch already uses.
    const first = 'first-faulted';
    const second = 'second-faulted';
    const error = refusal(
      configText({
        disciplines: [
          entry(first, pathDeclareEndingIn({ op: UNREGISTERED_STEP })),
          entry(second, pathDeclareEndingIn({ op: 'lines', [UNKNOWN_KEY]: true })),
        ],
      }),
    );

    expect(error.message.startsWith(`invalid config in ${CONFIG_PATH}: 2 problems\n`)).toBe(true);
    expect(error.message).toContain(`\n  - ${first} extract own: ${UNREGISTERED_REASON}`);
    expect(error.message).toContain(`\n  - ${second} extract own: ${UNKNOWN_KEY_REASON}`);
  });

  it("the repository's own config still loads", () => {
    // The other end: a compile check that refuses a judgeable declaration locks every
    // session on this repository at the next hook call.
    const source = readFileSync(REPO_CONFIG, 'utf-8');

    const { config } = parseConfigSource({ source, configPath: CONFIG_PATH });

    expect(config.disciplines?.length).toBeGreaterThan(0);
    expect(config.sessionDisciplines?.length).toBeGreaterThan(0);
    expect(config.changeSetDisciplines?.length).toBeGreaterThan(0);
  });

  it('a config whose only entry is a draft loads — a draft carries nothing to compile', () => {
    // A loader that reads `entry.declare` off every entry hands the compiler `undefined`
    // for a draft and refuses, or throws, on a config core already accepted.
    const { config } = parseConfigSource({
      source: configText({ disciplines: [{ id: 'not-yet', why: 'fixture', draft: true }] }),
      configPath: CONFIG_PATH,
    });

    expect(config.drafts?.map((draft) => draft.id)).toEqual(['not-yet']);
  });
});
