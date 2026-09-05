import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAlgebraDeclaration } from '../src/algebra.ts';
import { deriveShape, MECHANISM_NAMES, MECHANISM_SHAPES } from '../src/catalogue.ts';
import { FIXED_SOURCE_NAMES } from '../src/source-names.ts';
import { ConfigValidationError } from '../src/validation.ts';

// The mechanism catalogue: seventeen judgment-mechanism names as a closed tuple, each
// carrying a shape spec (the axes it reads, the relations it admits, and a structural
// marker). `deriveShape` reads a declaration's shape from its syntax alone — the source
// names its `source` steps name (fixed names → change, `sources` entries → world), the
// relation ops of the body's relate entries, and whether a `witness` block is present — and
// `validateMechanism` refuses a declaration whose derived shape falls outside the spec of
// the name it carries. Nothing here runs an extraction or opens a world.
//
// Mechanism names, source names, and extract names are fixture values; the catalogue's
// own list is asserted once against the seventeen and read from `MECHANISM_NAMES` after.

const LOCATION = 'disciplines[3].declare';
const PATH_SOURCE = 'target.path';
const SOURCE_PRE = 'pre';
const SOURCE_POST = 'post';
const SOURCE_STATE = 'state';
const FILE_EN = 'en';
const FILE_KO = 'ko';
const FILE_EN_PATH = 'locales/en.json';
const FILE_KO_PATH = 'locales/ko.json';
const CHANNEL = 'spawns';
const SESSION = 'session';
const UNDECLARED_SOURCE = 'transcript';

/** Parse one declaration fixture from the algebra fixture directory. */
function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** A change-axis declaration: `implies` between two `target.path` projections. */
const companionDeclaration = {
  discipline: 'probe',
  mechanism: 'companion',
  scope: { source: PATH_SOURCE, include: ['\\.md$'] },
  extract: {
    en: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'keyByPattern', re: '^(.+)\\.md$' },
    ],
    ko: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'keyByPattern', re: '^(.+)\\.ko\\.md$' },
    ],
  },
  relate: [
    { id: 'ko-follows', relation: { op: 'implies', of: 'en', requires: 'ko' }, message: 'm' },
  ],
};

/** A world-axis declaration: `equal` between two file sources. */
const pairingDeclaration = {
  discipline: 'probe',
  mechanism: 'pairing',
  sources: { [FILE_EN]: { file: FILE_EN_PATH }, [FILE_KO]: { file: FILE_KO_PATH } },
  extract: {
    enKeys: [{ op: 'source', of: FILE_EN }, { op: 'json' }, { op: 'flattenKeys' }],
    koKeys: [{ op: 'source', of: FILE_KO }, { op: 'json' }, { op: 'flattenKeys' }],
  },
  relate: [{ id: 'parity', relation: { op: 'equal', of: ['enKeys', 'koKeys'] }, message: 'm' }],
};

/** A change-axis declaration: `empty` over a `target.path` match, scoped on `target.path`. */
const namingDeclaration = {
  discipline: 'probe',
  mechanism: 'naming',
  scope: { source: PATH_SOURCE, include: ['\\.db$'] },
  extract: {
    outside: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'matches', re: '^(?!store/)' },
    ],
  },
  relate: [{ id: 'placed', relation: { op: 'empty', of: 'outside' }, message: 'm' }],
};

/** A change-axis declaration over `pre`/`post`: `subset` of pre in post. */
const markerDeclaration = {
  discipline: 'probe',
  mechanism: 'one-way-marker',
  extract: {
    preMarks: [{ op: 'source', of: SOURCE_PRE }, { op: 'lines' }],
    postMarks: [{ op: 'source', of: SOURCE_POST }, { op: 'lines' }],
  },
  relate: [
    { id: 'kept', relation: { op: 'subset', of: 'preMarks', in: 'postMarks' }, message: 'm' },
  ],
};

/** The valve block used wherever a fixture needs one; it relates a body extract name. */
function valveOver(name: string) {
  return { relate: [{ id: 'valve', relation: { op: 'nonEmpty', of: name }, message: 'w' }] };
}

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

describe('the catalogue — closed tuples', () => {
  it('every name in MECHANISM_NAMES has a shape entry, and no shape entry lacks a name', () => {
    // The Record type pins the keys at build time; at runtime the two are still two
    // literals, and a name added to the tuple without a shape reaches validateMechanism as
    // an undefined spec — which reads as "admits nothing" and refuses every declaration
    // carrying that name.
    expect(new Set(Object.keys(MECHANISM_SHAPES))).toEqual(new Set(MECHANISM_NAMES));
  });

  it('a mechanism outside the enumeration is rejected with a message listing every admitted name', () => {
    // The free-string era: a validator that only checks `typeof mechanism === 'string'`
    // still loads a label nothing reads. The message must show what IS admitted.
    const error = expectRejection({ ...namingDeclaration, mechanism: 'pair parity' });

    expect(error.message).toContain('pair parity');
    for (const name of MECHANISM_NAMES) {
      expect(error.message).toContain(name);
    }
  });
});

describe('deriveShape — axes from source names', () => {
  it('a fixed source name derives the change axis', () => {
    // `pre` is one of FIXED_SOURCE_NAMES; a derivation that only knows `target.path` reads
    // a pre/post declaration as axis-less and admits it under a world-only name.
    expect(FIXED_SOURCE_NAMES).toContain(SOURCE_PRE);
    const shape = deriveShape(validateAlgebraDeclaration(markerDeclaration));

    expect([...shape.axes]).toEqual(['change']);
  });

  it('a `sources` entry of the file kind derives the world axis', () => {
    expect([...deriveShape(validateAlgebraDeclaration(pairingDeclaration)).axes]).toEqual([
      'world',
    ]);
  });

  it('a `sources` entry of the sidecar kind derives the world axis too', () => {
    // A channel is outside the target like a file is; a derivation keyed on `.file` alone
    // leaves a sidecar-only declaration axis-less.
    const declaration = {
      discipline: 'probe',
      mechanism: 'scoped-valve',
      sources: { [CHANNEL]: { sidecar: true } },
      extract: { records: [{ op: 'source', of: CHANNEL }] },
      relate: [{ id: 'present', relation: { op: 'nonEmpty', of: 'records' }, message: 'm' }],
      witness: valveOver('records'),
    };

    expect([...deriveShape(validateAlgebraDeclaration(declaration)).axes]).toEqual(['world']);
  });

  it('a body reading a fixed source and a file source derives both change and world', () => {
    // The set is a union over every pipeline, not the first pipeline's axis.
    const declaration = {
      discipline: 'probe',
      mechanism: 'controlled-vocabulary',
      sources: { [FILE_EN]: { file: FILE_EN_PATH } },
      extract: {
        used: [{ op: 'source', of: SOURCE_POST }, { op: 'lines' }],
        allowed: [{ op: 'source', of: FILE_EN }, { op: 'lines' }],
      },
      relate: [
        { id: 'known', relation: { op: 'subset', of: 'used', in: 'allowed' }, message: 'm' },
      ],
    };

    expect(deriveShape(validateAlgebraDeclaration(declaration)).axes).toEqual(
      new Set(['change', 'world']),
    );
  });

  it('a source step inside witness.extract contributes its axis', () => {
    // The valve reads a world too: a derivation walking only the body's extract block
    // admits a world-reading valve under a change-only name.
    const declaration = {
      ...namingDeclaration,
      mechanism: 'scoped-valve',
      sources: { [FILE_EN]: { file: FILE_EN_PATH } },
      witness: {
        extract: { override: [{ op: 'source', of: FILE_EN }, { op: 'lines' }] },
        relate: [{ id: 'valve', relation: { op: 'nonEmpty', of: 'override' }, message: 'w' }],
      },
    };

    expect(deriveShape(validateAlgebraDeclaration(declaration)).axes).toEqual(
      new Set(['change', 'world']),
    );
  });

  it('a source name that is neither fixed nor declared is rejected, naming both sets', () => {
    // Skipping an unknown name would derive no axis at all, and the empty set is a subset
    // of every spec — an axis-restricted name such as `precedent` would pass on a typo.
    // The universe of source names is the fixed five plus the `sources` block.
    const declaration = {
      discipline: 'probe',
      mechanism: 'precedent',
      extract: { uses: [{ op: 'source', of: UNDECLARED_SOURCE }, { op: 'toolUses' }] },
      relate: [{ id: 'seen', relation: { op: 'nonEmpty', of: 'uses' }, message: 'm' }],
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain(`'${UNDECLARED_SOURCE}'`);
    expect(error.message).toContain("'target.path'");
  });

  it('the fixed source `changes` derives the change axis', () => {
    // The change set is the one fixed source that is a list rather than a string; a
    // derivation keyed on the string-valued names alone would leave it axis-less.
    const declaration = validateAlgebraDeclaration({
      discipline: 'probe',
      mechanism: 'companion',
      extract: {
        en: [{ op: 'source', of: PATH_SOURCE }],
        changed: [{ op: 'source', of: 'changes' }, { op: 'items' }],
      },
      relate: [
        { id: 'ko', relation: { op: 'implies', of: 'en', requires: 'changed' }, message: 'm' },
      ],
    });

    expect(deriveShape(declaration).axes).toEqual(new Set(['change']));
  });
});

describe('deriveShape — relations and the valve marker', () => {
  it('relations is the set of body relate ops, deduplicated', () => {
    // Two entries relating `empty` and one `unchanged` derive the two-element set; a list
    // (not a set) or a first-entry read both fail the equality.
    const declaration = {
      discipline: 'probe',
      mechanism: 'self-absolution-ban',
      extract: {
        preTasks: [{ op: 'source', of: SOURCE_PRE }, { op: 'json' }],
        postTasks: [{ op: 'source', of: SOURCE_POST }, { op: 'json' }],
        owned: [{ op: 'source', of: SOURCE_STATE }, { op: 'json' }],
      },
      relate: [
        { id: 'a', relation: { op: 'empty', of: 'preTasks' }, message: 'm' },
        { id: 'b', relation: { op: 'unchanged', of: 'owned' }, message: 'm' },
        { id: 'c', relation: { op: 'empty', of: 'postTasks' }, message: 'm' },
      ],
    };

    const shape = deriveShape(validateAlgebraDeclaration(declaration));

    expect(shape.relations).toEqual(new Set(['empty', 'unchanged']));
    expect(shape.witness).toBe(false);
  });

  it('witness.relate ops are not part of the relation set, and witness reads true', () => {
    // The valve's own relation is not the judgment's: counting it would refuse `naming`
    // (empty · nonEmpty) the moment its valve relates `subset`, and a witness marker read
    // from `witness.relate.length` instead of the block's presence misses the block.
    const declaration = {
      ...markerDeclaration,
      mechanism: 'scoped-valve',
      witness: {
        relate: [
          { id: 'valve', relation: { op: 'equal', of: ['preMarks', 'postMarks'] }, message: 'w' },
        ],
      },
    };

    const shape = deriveShape(validateAlgebraDeclaration(declaration));

    expect(shape.relations).toEqual(new Set(['subset']));
    expect(shape.witness).toBe(true);
  });
});

describe('validateMechanism — the derived shape must fall inside the name’s spec', () => {
  it('companion + implies on the change axis is accepted', () => {
    expect(() => validateAlgebraDeclaration(companionDeclaration, LOCATION)).not.toThrow();
  });

  it('a name admitting two relations accepts a declaration using only one of them', () => {
    // The rule is subset, not equality: `self-absolution-ban` admits unchanged · empty, and
    // a declaration relating `unchanged` alone must load.
    const declaration = {
      discipline: 'probe',
      mechanism: 'self-absolution-ban',
      extract: { owned: [{ op: 'source', of: SOURCE_STATE }, { op: 'json' }] },
      relate: [{ id: 'kept', relation: { op: 'unchanged', of: 'owned' }, message: 'm' }],
    };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });

  it('pairing carrying implies on the change axis is rejected, naming the derived shape and the spec', () => {
    // A `pairing` label on a companion-shaped declaration loads when nothing reads the
    // name. The message must carry both sides so the author sees the mismatch, not only
    // that one exists.
    const error = expectRejection({ ...companionDeclaration, mechanism: 'pairing' });

    expect(error.message).toContain(LOCATION);
    expect(error.message).toContain("'pairing'");
    expect(error.message).toContain("'equal'");
    expect(error.message).toContain("'world'");
    expect(error.message).toContain("'implies'");
    expect(error.message).toContain("'change'");
  });

  it('pairing carrying equal on the change axis is rejected — the axis alone decides', () => {
    // A check that compares relations only passes this one: equal is admitted, change is
    // not.
    const declaration = {
      ...markerDeclaration,
      mechanism: 'pairing',
      relate: [
        { id: 'same', relation: { op: 'equal', of: ['preMarks', 'postMarks'] }, message: 'm' },
      ],
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain("'pairing'");
    expect(error.message).toContain("'change'");
  });

  it('a history-axis name is rejected for a declaration whose sources derive change', () => {
    // No source derives `history` today, so `precedent` on a pre/post declaration is a
    // mismatch; a derivation that maps an unknown axis onto the spec's axis admits it.
    const declaration = {
      ...markerDeclaration,
      mechanism: 'precedent',
      relate: [{ id: 'seen', relation: { op: 'nonEmpty', of: 'postMarks' }, message: 'm' }],
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain("'precedent'");
    expect(error.message).toContain("'history'");
  });

  it('scoped-valve without a witness block is rejected', () => {
    // The marker is the whole spec for this name: skipping the marker check makes
    // `scoped-valve` the name that admits any declaration at all.
    const error = expectRejection({ ...markerDeclaration, mechanism: 'scoped-valve' });

    expect(error.message).toContain("'scoped-valve'");
    expect(error.message).toContain('witness');
  });

  it('scoped-valve with a witness block is accepted whatever the axes and relations', () => {
    // The name admits every axis and relation; a shape table that lists none for it
    // refuses every real valve declaration.
    const declaration = {
      ...pairingDeclaration,
      mechanism: 'scoped-valve',
      extract: { ...pairingDeclaration.extract, own: [{ op: 'source', of: PATH_SOURCE }] },
      relate: [
        ...pairingDeclaration.relate,
        { id: 'placed', relation: { op: 'nonEmpty', of: 'own' }, message: 'm' },
      ],
      witness: valveOver('own'),
    };

    expect(() => validateAlgebraDeclaration(declaration, LOCATION)).not.toThrow();
  });

  it('delegated-scope is rejected even with a witness block, naming what reserves it', () => {
    // Reserved is not "empty shape": a validator that reads the empty axis/relation sets
    // as a plain mismatch rejects too, but with a message that sends the author to fix a
    // shape rather than to the milestone that defines the name.
    const error = expectRejection({
      ...markerDeclaration,
      mechanism: 'delegated-scope',
      witness: valveOver('postMarks'),
    });

    expect(error.message).toContain("'delegated-scope'");
    expect(error.message).toContain('definition-time');
  });

  it('naming with scope.source other than target.path is rejected', () => {
    // The marker `scopeSource: 'target.path'` is what makes naming a path convention; a
    // file-source scope passes the axis and relation checks and only this marker catches it.
    const declaration = {
      ...namingDeclaration,
      sources: { [FILE_EN]: { file: FILE_EN_PATH } },
      scope: { source: FILE_EN, include: ['.'] },
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain("'naming'");
    expect(error.message).toContain(PATH_SOURCE);
  });

  it('naming without a scope block is rejected', () => {
    // Absence is not target.path: a check written `scope?.source !== 'target.path'` is
    // right, one written `scope !== undefined && …` admits the scope-less form.
    const { scope: _scope, ...withoutScope } = namingDeclaration;

    expectRejection(withoutScope);
  });

  it('runs after the reference checks: a dangling reference is reported before the shape', () => {
    // The order is part of the contract — shape derivation assumes references resolve, so a
    // mechanism mismatch reported on a declaration with a dangling name would be a second
    // error the author cannot act on until the first is fixed.
    const declaration = {
      ...companionDeclaration,
      mechanism: 'pairing',
      relate: [
        {
          id: 'ko-follows',
          relation: { op: 'implies', of: 'en', requires: 'nowhere' },
          message: 'm',
        },
      ],
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain('nowhere');
    expect(error.message).not.toContain("'pairing'");
  });
});

describe('deriveShape — the history axis from a transcript binding', () => {
  /** A history-axis declaration: `nonEmpty` over the user turns of a transcript source. */
  const groundDeclaration = {
    discipline: 'probe',
    mechanism: 'stated-ground',
    sources: { [SESSION]: { transcript: true } },
    extract: {
      plans: [
        { op: 'source', of: SESSION },
        { op: 'userTexts', re: '^/plan\\b' },
      ],
    },
    relate: [{ id: 'stated', relation: { op: 'nonEmpty', of: 'plans' }, message: 'm' }],
  };

  it('a `sources` entry of the transcript kind derives the history axis, not world', () => {
    // A derivation that maps every binding to `world` (the rule the two older kinds share)
    // admits a history declaration under `pairing` and refuses it under the four history
    // names; the kind of the binding decides the axis.
    expect([...deriveShape(validateAlgebraDeclaration(groundDeclaration)).axes]).toEqual([
      'history',
    ]);
  });

  it('tdd-agent-required validates under precedent and derives exactly {history, world}', () => {
    // The W2 precedent fixture reads a transcript AND a sidecar: the two kinds derive two
    // axes, and `precedent` admits exactly that pair. A derivation folding the sidecar
    // into history, or the transcript into world, yields one axis and still passes the
    // subset check — so the set is asserted whole, not by membership.
    const declaration = validateAlgebraDeclaration(loadFixture('tdd-agent-required'));

    expect(declaration.mechanism).toBe('precedent');
    expect(deriveShape(declaration).axes).toEqual(new Set(['history', 'world']));
  });

  it.each([
    ['phase-order-writer-before-implementer', 'phase-order', 'ordered'],
    ['turn-locality-fresh-permission', 'turn-locality', 'nonEmpty'],
    ['stated-ground-plan-before-edit', 'stated-ground', 'nonEmpty'],
  ])('the %s fixture validates under %s and derives history with %s', (name, mechanism, relation) => {
    // The three history mechanisms each get a real declaration; a catalogue that still
    // reads history as underivable refuses all three, and a fixture whose relation drifted
    // (say `nonEmpty` under `phase-order`) is caught here rather than in the engine.
    const declaration = validateAlgebraDeclaration(loadFixture(name));

    expect(declaration.mechanism).toBe(mechanism);
    expect(deriveShape(declaration)).toEqual({
      axes: new Set(['history']),
      relations: new Set([relation]),
      witness: false,
    });
  });

  it('phase-order carrying nonEmpty is rejected, naming the mismatch without the underivable note', () => {
    // The negative probe: history now derives, so the axis matches and the relation alone
    // fails. The "no registered source derives … yet" note must be gone from this message —
    // a catalogue that still lists history as underivable keeps telling the author the
    // name admits no declaration today, which is now false.
    const error = expectRejection({ ...groundDeclaration, mechanism: 'phase-order' });

    expect(error.message).toContain("'phase-order'");
    expect(error.message).toContain("'ordered'");
    expect(error.message).toContain("'nonEmpty'");
    expect(error.message).not.toContain('no registered source derives');
  });

  it('precedent on a change-only declaration is a plain mismatch, no longer an underivable note', () => {
    // The other end of the note: before this ticket the precedent rejection carried it.
    const declaration = {
      ...markerDeclaration,
      mechanism: 'precedent',
      relate: [{ id: 'seen', relation: { op: 'nonEmpty', of: 'postMarks' }, message: 'm' }],
    };

    const error = expectRejection(declaration);

    expect(error.message).toContain("'history'");
    expect(error.message).not.toContain('no registered source derives');
  });

  it('a transcript source read only inside witness.extract still derives history', () => {
    // The valve reads a history too: a derivation walking the body alone leaves the
    // history-only valve declaration axis-less, and the empty set passes every spec.
    const declaration = {
      ...markerDeclaration,
      mechanism: 'scoped-valve',
      sources: { [SESSION]: { transcript: true } },
      witness: {
        extract: {
          skip: [
            { op: 'source', of: SESSION },
            { op: 'userTexts', re: 'skip' },
          ],
        },
        relate: [{ id: 'valve', relation: { op: 'nonEmpty', of: 'skip' }, message: 'w' }],
      },
    };

    expect(deriveShape(validateAlgebraDeclaration(declaration)).axes).toEqual(
      new Set(['change', 'history']),
    );
  });
});

describe('deriveShape — the actor axis from the fixed source `actor`', () => {
  // The seventh fixed name. Its value is the input's actor object, so it is the one fixed
  // name that derives `actor` rather than `change`; the two authority-family names that
  // ask for that axis (`producer-owned` · `actor-scope`) admit a declaration for the
  // first time. Agent names and the location are fixture values.
  const ACTOR_SOURCE = 'actor';
  const COMMAND_SOURCE = 'command';
  const IMPLEMENTER = 'tdd-implementer';

  /** The live shape: a test file is not the implementer's output. */
  const producerOwnedDeclaration = {
    discipline: 'probe',
    mechanism: 'producer-owned',
    scope: { source: PATH_SOURCE, include: ['\\.test\\.ts$'] },
    supply: { [ACTOR_SOURCE]: 'pass' },
    extract: {
      implementer: [
        { op: 'source', of: ACTOR_SOURCE },
        { op: 'select', path: 'agentType' },
        { op: 'matches', re: `^${IMPLEMENTER}$` },
      ],
    },
    relate: [
      { id: 'not-the-implementer', relation: { op: 'empty', of: 'implementer' }, message: 'm' },
    ],
  };

  /** The live shape: a commit command is the main session's. */
  const actorScopeDeclaration = {
    discipline: 'probe',
    mechanism: 'actor-scope',
    scope: { source: COMMAND_SOURCE, include: ['^git commit\\b'] },
    supply: { [ACTOR_SOURCE]: 'pass' },
    extract: {
      subagent: [
        { op: 'source', of: ACTOR_SOURCE },
        { op: 'select', path: 'agentType' },
      ],
    },
    relate: [
      { id: 'main-session-only', relation: { op: 'empty', of: 'subagent' }, message: '{value}' },
    ],
  };

  it('a producer-owned declaration reading actor derives { axes: actor, relations: empty }', () => {
    // The rule "fixed name → change" applied to `actor` derives `change`, and the
    // producer-owned spec (axes: actor) refuses the declaration written exactly as the
    // catalogue asks for it.
    expect(deriveShape(validateAlgebraDeclaration(producerOwnedDeclaration, LOCATION))).toEqual({
      axes: new Set(['actor']),
      relations: new Set(['empty']),
      witness: false,
    });
  });

  it('an actor-scope declaration scoped on command and reading actor validates with the actor axis', () => {
    // The scope names `command` (change-valued, a string) while the pipeline reads
    // `actor`; a derivation that folds the scope source into the axes reads `change` too
    // and the actor-only spec refuses it.
    expect(deriveShape(validateAlgebraDeclaration(actorScopeDeclaration, LOCATION)).axes).toEqual(
      new Set(['actor']),
    );
  });

  it('a body reading actor beside target.path derives both actor and change', () => {
    // The actor rule is an exception for one name, not a replacement of the fixed rule:
    // a derivation that sends every fixed name to `actor` once the list carries it leaves
    // the path pipeline axis-less.
    const declaration = {
      ...producerOwnedDeclaration,
      mechanism: 'scoped-valve',
      extract: {
        ...producerOwnedDeclaration.extract,
        own: [{ op: 'source', of: PATH_SOURCE }],
      },
      relate: [
        ...producerOwnedDeclaration.relate,
        { id: 'has-path', relation: { op: 'nonEmpty', of: 'own' }, message: 'm' },
      ],
      witness: valveOver('own'),
    };

    expect(deriveShape(validateAlgebraDeclaration(declaration, LOCATION)).axes).toEqual(
      new Set(['actor', 'change']),
    );
  });

  it('an added-only declaration reading actor is refused for the axis mismatch, naming both', () => {
    // The negative probe of the derivation: `added-only` admits `change` alone. A
    // derivation still sending `actor` to `change` accepts this declaration and the
    // catalogue's axis restriction stops meaning anything for the seventh name.
    const error = expectRejection({ ...producerOwnedDeclaration, mechanism: 'added-only' });

    expect(error.message).toContain("'added-only'");
    expect(error.message).toContain("'actor'");
  });

  it('producer-owned refused for another reason no longer says the actor axis has no source', () => {
    // The note "no registered source derives 'actor' yet" was true while the axis had no
    // source; once `actor` derives it, a message still carrying the note sends the author
    // away from a name that now admits declarations.
    const error = expectRejection({ ...namingDeclaration, mechanism: 'producer-owned' });

    expect(error.message).toContain("'producer-owned'");
    expect(error.message).toContain("'change'");
    expect(error.message).not.toContain('no registered source derives');
  });

  it('scope.source: actor is refused — the actor is an object, and a scope needs a string', () => {
    // A regex over an object matches nothing, so a scope on `actor` admits no world and
    // the declaration lands zero rows while looking like a judgment.
    const error = expectRejection({
      ...producerOwnedDeclaration,
      scope: { source: ACTOR_SOURCE, include: ['.*'] },
    });

    expect(error.message).toContain(`'${ACTOR_SOURCE}'`);
  });

  it('a `sources` binding named actor is refused — it shadows the fixed source', () => {
    // A user binding under the fixed name would replace the host's actor with a file's
    // text, and the subagent check would judge the file.
    const error = expectRejection({
      ...producerOwnedDeclaration,
      sources: { [ACTOR_SOURCE]: { file: FILE_EN_PATH } },
    });

    expect(error.message).toContain(`${LOCATION}.sources.${ACTOR_SOURCE}`);
  });
});
