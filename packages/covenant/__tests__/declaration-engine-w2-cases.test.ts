import { describe, expect, it } from 'vitest';
import { type DeclarationVerdict, type World, witnessOpens } from '../src/declaration-engine.ts';
import {
  compileOrFail,
  judge,
  loadDeclaration,
  witnessesOf,
} from './declaration-engine-helpers.ts';

// The sixty-two cases a prior spike ran over its four declarations, re-run on this engine
// for the fifty-six in its domain (the six left need a host). The world is supplied inline
// as that spike's host would have: file text as strings, `state: { pre, post }` for the
// ledger, an absent override target as an absent world key, broken JSON as an invalid
// string, the session as a transcript snapshot and the spawn sidecar as JSON text. The
// spike's `blocked` is the engine's `broken`, its `witnessed` the witness valve open on a
// broken verdict, its `not-applicable` a scope miss or a `supply-pass` skip. Each title
// carries declaration · layer · original case name.

// The source names the four fixtures read — values the fixtures fix, not the engine.
const SCOPE_SOURCE = 'target.path';
const SRC_KO = 'ko';
const SRC_EN = 'en';
const SRC_PRE = 'pre';
const SRC_POST = 'post';
const PAIRED_SOURCE = 'state';
const SRC_TRANSCRIPT = 'transcript';
const SRC_SIDECAR = 'sidecar';

function breaksOf(verdict: DeclarationVerdict) {
  if (verdict.kind !== 'broken') throw new Error(`expected broken, got ${JSON.stringify(verdict)}`);
  return verdict.breaks;
}

// i18n-key-parity — key parity (judge 8)

describe('i18n-key-parity · judge', () => {
  const decl = loadDeclaration('i18n-key-parity');
  const ENTRY = 'key-parity';
  const world = (ko: string, en?: string): World =>
    en === undefined ? { [SRC_KO]: ko } : { [SRC_KO]: ko, [SRC_EN]: en };

  it('case 1 — ko/en key sets equal, nesting included → pass', () => {
    const ko = JSON.stringify({
      common: { actions: { save: 'Speichern', cancel: 'Abbrechen' } },
      login: { submit: 'Anmelden' },
    });
    const en = JSON.stringify({
      common: { actions: { save: 'Save', cancel: 'Cancel' } },
      login: { submit: 'Log in' },
    });
    expect(judge(decl, world(ko, en)).kind).toBe('pass');
  });

  it('case 2 — a key only in ko → broken, one witness common.extra on the left', () => {
    const ko = JSON.stringify({ common: { save: 'Speichern', extra: 'Hinzufuegen' } });
    const en = JSON.stringify({ common: { save: 'Save' } });
    const breaks = breaksOf(judge(decl, world(ko, en)));
    expect(breaks).toHaveLength(1);
    expect(breaks[0].id).toBe(ENTRY);
    expect(breaks[0].witnesses).toEqual([
      { key: 'common.extra', value: 'common.extra', side: 'left' },
    ]);
    expect(breaks[0].message).toBe("en.json — missing key 'common.extra' (present in ko.json)");
  });

  it('case 3 — a deep path flattens to one witness', () => {
    const ko = JSON.stringify({ common: { actions: { save: 'Speichern', cancel: 'Abbrechen' } } });
    const en = JSON.stringify({ common: { actions: { save: 'Save' } } });
    const witnesses = witnessesOf(judge(decl, world(ko, en)), ENTRY);
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0].value).toBe('common.actions.cancel');
  });

  it('case 4 — same keys, different values → pass (values are not compared)', () => {
    const ko = JSON.stringify({ common: { save: 'Speichern' } });
    const en = JSON.stringify({ common: { save: 'Save' } });
    expect(judge(decl, world(ko, en)).kind).toBe('pass');
  });

  it('override: virtual content — the injected en state carries the key → pass', () => {
    const ko = JSON.stringify({ common: { save: 'Speichern', extra: 'Hinzufuegen' } });
    const injectedEn = JSON.stringify({ common: { save: 'Save', extra: 'Extra' } });
    expect(judge(decl, world(ko, injectedEn)).kind).toBe('pass');
  });

  it('override: missing tmp — an absent injection target is a supply-error on en, not a silent pass', () => {
    const ko = JSON.stringify({ common: { save: 'Speichern' } });
    expect(judge(decl, world(ko))).toMatchObject({ kind: 'supply-error', source: SRC_EN });
  });

  it('case 5 — broken ko JSON → supply-error on ko, no throw', () => {
    const en = JSON.stringify({ common: { save: 'Save' } });
    expect(judge(decl, world('{ "common": { "save": "Speichern", }', en))).toMatchObject({
      kind: 'supply-error',
      source: SRC_KO,
    });
  });
});

// task-ledger-self-pardon — no self-pardon (scope 2 · judge 10)

type Task = Record<string, unknown>;

function task(overrides: Task = {}): Task {
  return {
    id: 'S1',
    title: 'a task',
    scope_paths: ['apps/server/src/x.ts'],
    verification_actions: ['pnpm test'],
    passes: false,
    retries: 0,
    status: 'todo',
    risk: 'interior',
    ...overrides,
  };
}

function ledgerJson(tasks: Task[]): string {
  return JSON.stringify({ ticket: 'MQ-300', depends_on: [], tasks }, null, 2);
}

const LEDGER_PATH = 'docs/ledger/mq-300.json';

/** The world the spike host built: a null disk is supplied as a ledger with no tasks. */
function ledgerWorld(post: string, disk: string | null, path = LEDGER_PATH): World {
  const pre = disk ?? ledgerJson([]);
  return {
    [SCOPE_SOURCE]: path,
    [SRC_PRE]: pre,
    [SRC_POST]: post,
    [PAIRED_SOURCE]: { pre, post },
  };
}

describe('task-ledger-self-pardon · scope', () => {
  const decl = loadDeclaration('task-ledger-self-pardon');
  const benign = ledgerJson([task()]);

  it('isLedgerPath: matches docs/ledger/*.json — relative and absolute', () => {
    for (const path of ['docs/ledger/mq-258.json', '/abs/repo/docs/ledger/mq-300.json']) {
      expect(judge(decl, ledgerWorld(benign, benign, path)).kind).toBe('pass');
    }
  });

  it('isLedgerPath: rejects non-ledger — prd markdown, source file, outcomes.jsonl', () => {
    for (const path of [
      'docs/prd/mq-258.md',
      'apps/server/src/x.ts',
      'docs/ledger/outcomes.jsonl',
    ]) {
      expect(judge(decl, ledgerWorld(benign, benign, path))).toMatchObject({
        kind: 'not-applicable',
        reason: 'scope',
      });
    }
  });
});

describe('task-ledger-self-pardon · judge', () => {
  const decl = loadDeclaration('task-ledger-self-pardon');
  const ID_D4 = 'schema-d4';
  const ID_PASSES = 'passes-runner-owned';
  const ID_RETRIES = 'retries-runner-owned';
  const ID_NEW_PASSES = 'new-task-passes-start';
  const ID_NEW_RETRIES = 'new-task-retries-start';

  it('schema: valid new-file Write → pass', () => {
    expect(judge(decl, ledgerWorld(ledgerJson([task(), task({ id: 'S2' })]), null)).kind).toBe(
      'pass',
    );
  });

  it('schema: Write with empty verification_actions → broken on D4 naming S1', () => {
    const post = ledgerJson([task({ verification_actions: [], status: 'todo' })]);
    const breaks = breaksOf(judge(decl, ledgerWorld(post, null)));
    expect(breaks.map((b) => b.id)).toEqual([ID_D4]);
    expect(breaks[0].witnesses.map((w) => w.key)).toEqual(['S1']);
    expect(breaks[0].message).toMatch(/verification_actions/);
  });

  it('schema: Edit producing broken JSON → supply-error naming post, reason mentions JSON', () => {
    const disk = ledgerJson([task()]);
    const post = disk.replace('}', '');
    expect(judge(decl, ledgerWorld(post, disk))).toMatchObject({
      kind: 'supply-error',
      source: SRC_POST,
      reason: expect.stringMatching(/JSON/i),
    });
  });

  it('D3: new file with passes:true → broken on the new-task passes entry', () => {
    const breaks = breaksOf(judge(decl, ledgerWorld(ledgerJson([task({ passes: true })]), null)));
    expect(breaks.map((b) => b.id)).toEqual([ID_NEW_PASSES]);
    expect(breaks[0].witnesses.map((w) => w.key)).toEqual(['S1']);
    expect(breaks[0].message).toMatch(/passes/);
  });

  it('D3: existing task passes false→true → broken on Unchanged with witness S1', () => {
    const post = ledgerJson([task({ passes: true })]);
    const disk = ledgerJson([task({ passes: false })]);
    const breaks = breaksOf(judge(decl, ledgerWorld(post, disk)));
    expect(breaks.map((b) => b.id)).toEqual([ID_PASSES]);
    expect(breaks[0].witnesses).toEqual([{ key: 'S1', value: true }]);
    expect(breaks[0].message).toMatch(/passes/);
  });

  it('D3: retries 0→1 → broken on Unchanged with witness S1', () => {
    const post = ledgerJson([task({ retries: 1 })]);
    const disk = ledgerJson([task({ retries: 0 })]);
    const breaks = breaksOf(judge(decl, ledgerWorld(post, disk)));
    expect(breaks.map((b) => b.id)).toEqual([ID_RETRIES]);
    expect(breaks[0].witnesses).toEqual([{ key: 'S1', value: 1 }]);
    expect(breaks[0].message).toMatch(/retries/);
  });

  it('D3: title-only edit → pass', () => {
    const post = ledgerJson([task({ title: 'new title' })]);
    const disk = ledgerJson([task({ title: 'old' })]);
    expect(judge(decl, ledgerWorld(post, disk)).kind).toBe('pass');
  });

  it('D3: done task scope edited, passes stays true → pass (a constant check would misfire)', () => {
    const post = ledgerJson([
      task({ passes: true, status: 'done', scope_paths: ['a.ts', 'b.ts'] }),
    ]);
    const disk = ledgerJson([task({ passes: true, status: 'done', scope_paths: ['a.ts'] })]);
    expect(judge(decl, ledgerWorld(post, disk)).kind).toBe('pass');
  });

  it('D3: new task added with passes:false retries:0 → pass', () => {
    const post = ledgerJson([task(), task({ id: 'S2' })]);
    expect(judge(decl, ledgerWorld(post, ledgerJson([task()]))).kind).toBe('pass');
  });

  it('D3: new task added with retries:5 → broken on the new-task retries entry naming S2', () => {
    const post = ledgerJson([task(), task({ id: 'S2', retries: 5 })]);
    const breaks = breaksOf(judge(decl, ledgerWorld(post, ledgerJson([task()]))));
    expect(breaks.map((b) => b.id)).toEqual([ID_NEW_RETRIES]);
    expect(breaks[0].witnesses.map((w) => w.key)).toEqual(['S2']);
    expect(breaks[0].message).toMatch(/retries/);
  });
});

// tdd-agent-required — required precedent (scope 7 · valve 6 · judge 9)

// The spike's clock and its session vocabulary — tool names, the agent name, the arg the
// spawn type rides under — are that host's values.
const NOW = 1_700_000_000_000;
const PRODUCTION_FILE = 'apps/app/src/foo.tsx';
const AGENT_TOOL = 'Agent';
const SUBAGENT_ARG = 'subagent_type';
const WRITER = 'tdd-test-writer';
const GENERAL = 'general-purpose';
const ENTRY_PRECEDENT = 'writer-precedent';

type Turn = { index: number; text: string; timestampMs?: number };
type Call = { index: number; name: string; args: Record<string, unknown>; succeeded?: boolean };

/** The spike's `user(text, iso(offset))`: a turn `offsetMs` before NOW, or untimed. */
function user(index: number, text: string, offsetMs?: number): Turn {
  return offsetMs === undefined ? { index, text } : { index, text, timestampMs: NOW + offsetMs };
}

/** The spike's `assistant_tool_use('Agent', subagent_type=…)`: a spawn call, no result block. */
function spawn(index: number, subagentType: string): Call {
  return { index, name: AGENT_TOOL, args: { [SUBAGENT_ARG]: subagentType, prompt: 'x' } };
}

/** The transcript snapshot the supply arm hands the world, observed at NOW. */
function session(userMessages: Turn[] = [], toolCalls: Call[] = []) {
  return { observedAtMs: NOW, userMessages, toolCalls };
}

/**
 * The spike's `host.world_tdd(path, messages, sidecar)`: a target, the session snapshot
 * (absent when the spike passed `None`), and the sidecar as the JSON text the channel
 * carries (`[]` when the spike passed none — a session that observed no spawn).
 */
function tddWorld(
  path: string,
  snapshot: ReturnType<typeof session> | undefined,
  sidecar: unknown[] = [],
): World {
  return {
    [SCOPE_SOURCE]: path,
    ...(snapshot !== undefined && { [SRC_TRANSCRIPT]: snapshot }),
    [SRC_SIDECAR]: JSON.stringify(sidecar),
  };
}

describe('tdd-agent-required · scope', () => {
  const decl = loadDeclaration('tdd-agent-required');
  // In scope, a writer spawn on record: the body is judged and holds.
  const writerSession = session([], [spawn(0, WRITER)]);
  const world = (path: string): World => tddWorld(path, writerSession);

  const inScope = (paths: string[]): void => {
    for (const path of paths) expect(judge(decl, world(path)).kind, path).toBe('pass');
  };
  const outOfScope = (paths: string[]): void => {
    for (const path of paths) {
      expect(judge(decl, world(path)), path).toMatchObject({
        kind: 'not-applicable',
        reason: 'scope',
      });
    }
  };

  it('isProductionSourceFile: apps/<name>/src ts(x) and packages/<name>/src', () => {
    inScope([
      'apps/app/src/foo.tsx',
      'apps/server/src/db/schema.foo.ts',
      'packages/shared/src/api.ts',
    ]);
  });

  it('isProductionSourceFile: test / d.ts / __tests__ / _lib excluded', () => {
    outOfScope([
      'apps/app/src/foo.test.ts',
      'apps/app/src/foo.spec.tsx',
      'apps/app/src/types.d.ts',
      'apps/app/src/__tests__/foo.test.tsx',
      'dev-tools/src/_lib/transcript.ts',
    ]);
  });

  it('isProductionSourceFile: config and non-src excluded', () => {
    outOfScope([
      'apps/app/babel.config.ts',
      'docs/dev-log/foo.md',
      'lefthook.yml',
      'apps/app/src/foo.json',
    ]);
  });

  it('isProductionSourceFile: build output excluded', () => {
    outOfScope(['apps/app/dist/foo.ts', 'apps/app/.expo/types/router.d.ts']);
  });

  it('isProductionSourceFile: absolute and worktree paths normalise', () => {
    inScope([
      '/Users/x/repo/apps/app/src/foo.tsx',
      '/Users/x/memoriq-wt-mq-198/apps/app/src/foo.tsx',
      '/Users/x/memoriq-wt-mq-198/packages/shared/src/api.ts',
    ]);
  });

  it('isProductionSourceFile: pipeline ml/*.py and api.py', () => {
    inScope([
      'apps/pipeline/ml/run.py',
      'apps/pipeline/ml/lib_audio.py',
      'apps/pipeline/ml/companion.py',
      'apps/pipeline/api.py',
    ]);
  });

  it('isProductionSourceFile: pipeline test infrastructure / venv / other excluded', () => {
    outOfScope([
      'apps/pipeline/__tests__/test_lib_audio.py',
      'apps/pipeline/conftest.py',
      'apps/pipeline/.venv/lib/foo.py',
      'apps/pipeline/scripts/run_local.py',
      'apps/pipeline/seeds/companion-templates/_system.md',
    ]);
  });
});

describe('tdd-agent-required · valve', () => {
  // The spike's `waiver` layer: whether the witness block holds on a world, asked alone.
  const compiled = compileOrFail(loadDeclaration('tdd-agent-required'));
  const opens = (turns: Turn[]): boolean =>
    witnessOpens({ compiled, world: tddWorld(PRODUCTION_FILE, session(turns)) });

  it('a fresh /tdd skip → open', () => {
    // The whole chain — userTexts → first → ageMs → filter lte — on the happy path: a
    // valve reading the age the wrong way round, or a `first` that drops the item, shuts it.
    expect(opens([user(0, 'just /tdd skip — legacy bug fix', -60_000)])).toBe(true);
  });

  it('/tdd skip inside array content → open', () => {
    // The spike's turn carried the text as a content block list; the snapshot already
    // flattens a turn to one string, so the case is a text that contains the token
    // mid-sentence — an expression anchored at the start of the turn shuts the valve.
    expect(opens([user(0, 'cleanup time, /tdd skip', -30_000)])).toBe(true);
  });

  it('a prose mention without the slash → closed', () => {
    expect(opens([user(0, 'we should skip TDD this time', 0)])).toBe(false);
  });

  it('a later user turn still inside the window → open', () => {
    // `first` must take the FIRST matching turn, not the last turn of the session: the
    // permission is five minutes old and the latest turn says nothing about it.
    expect(
      opens([
        user(0, '/tdd skip — quick cleanup', -5 * 60_000),
        user(1, 'now keep going on the same task', -60_000),
      ]),
    ).toBe(true);
  });

  it('TTL exceeded (15 min) → closed', () => {
    // The other end of the `lte 600000` bound; a valve without the filter opens on any
    // permission ever uttered.
    expect(
      opens([
        user(0, '/tdd skip — earlier permission', -15 * 60_000),
        user(1, 'continue please', -60_000),
      ]),
    ).toBe(false);
  });

  it('a turn without a timestamp → closed (fail-closed)', () => {
    // `ageMs` drops the untimed turn; a valve that reads a missing timestamp as age 0
    // opens on a permission nobody can date.
    expect(opens([user(0, '/tdd skip — no timestamp')])).toBe(false);
  });
});

describe('tdd-agent-required · judge', () => {
  const decl = loadDeclaration('tdd-agent-required');
  const compiled = compileOrFail(decl);

  it('a writer Agent call present → pass', () => {
    // The call carries no `succeeded` (the spike's tool_use has no result block); a
    // `toolUses` that admits only succeeded calls breaks the session that did spawn.
    expect(judge(decl, tddWorld(PRODUCTION_FILE, session([], [spawn(0, WRITER)]))).kind).toBe(
      'pass',
    );
  });

  it('only a general-purpose Agent call → broken, one witness, the message names the writer', () => {
    const verdict = judge(decl, tddWorld(PRODUCTION_FILE, session([], [spawn(0, GENERAL)])));
    const breaks = breaksOf(verdict);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].id).toBe(ENTRY_PRECEDENT);
    expect(breaks[0].witnesses).toHaveLength(1);
    expect(`${breaks[0].message} ${JSON.stringify(breaks[0].witnesses)}`).toMatch(
      /tdd-test-writer/,
    );
  });

  it('a spawn recorded only in the sidecar → pass', () => {
    // The union's right side: `source sidecar → json → agentType` on its own is enough,
    // and a pipeline that skips `json` matches nothing in the raw text.
    const world = tddWorld(PRODUCTION_FILE, session(), [{ agentType: WRITER, toolUseId: 't1' }]);
    expect(judge(decl, world).kind).toBe('pass');
  });

  it('the sidecar holds another agent only → broken, one witness', () => {
    const world = tddWorld(PRODUCTION_FILE, session(), [{ agentType: GENERAL }]);
    expect(breaksOf(judge(decl, world))).toHaveLength(1);
  });

  it('no writer but a fresh /tdd skip → broken, and the witness valve opens', () => {
    // The spike's `witnessed`: the body breaks (no writer evidence) and the valve, asked on
    // the same world, holds. A body that reads the valve's turn as writer evidence would
    // answer `pass` here, which is not what happened.
    const world = tddWorld(PRODUCTION_FILE, session([user(0, '/tdd skip — cleanup', -60_000)]));
    expect(judge(decl, world).kind).toBe('broken');
    expect(witnessOpens({ compiled, world })).toBe(true);
  });

  it('a non-production path (docs/dev-log/foo.md) → not-applicable by scope', () => {
    // The spike passed no session for these: the scope must answer before any source is
    // read, or the absent transcript would turn the scope miss into a supply skip.
    expect(judge(decl, tddWorld('docs/dev-log/foo.md', undefined))).toEqual({
      kind: 'not-applicable',
      reason: 'scope',
    });
  });

  it('the transcript absent → not-applicable by supply-pass, naming the source', () => {
    // `supply.transcript: pass` — the commit surface has no session. The verdict must say
    // WHY it did not judge; a `pass` here would record the edit as upheld.
    expect(judge(decl, tddWorld(PRODUCTION_FILE, undefined))).toEqual({
      kind: 'not-applicable',
      reason: 'supply-pass',
      source: SRC_TRANSCRIPT,
    });
  });

  it('only an expired /tdd skip → broken, and the valve stays shut', () => {
    const world = tddWorld(
      PRODUCTION_FILE,
      session([
        user(0, '/tdd skip — earlier permission', -15 * 60_000),
        user(1, 'now please add a real feature', -60_000),
      ]),
    );
    expect(breaksOf(judge(decl, world))).toHaveLength(1);
    expect(witnessOpens({ compiled, world })).toBe(false);
  });
});

// invariant-comment-marker — irreversible marker (scope 2 · judge 12)

const INV = '// INVARIANT(MQ-261): onConflictDoUpdate must win the GET race';

/** One edit unit: the pre and post text of a file at `path`. */
function editWorld(pre: string, post: string, path = '/repo/f.ts'): World {
  return { [SCOPE_SOURCE]: path, [SRC_PRE]: pre, [SRC_POST]: post };
}

describe('invariant-comment-marker · scope', () => {
  const decl = loadDeclaration('invariant-comment-marker');

  it('isInvariantCheckedPath: code files (ts, mjs, py, sql)', () => {
    for (const path of [
      '/r/apps/server/src/routes/route.x.ts',
      '/r/apps/lambda/companion/build.mjs',
      '/r/apps/pipeline/ml/companion.py',
      '/r/infra/scheduler.sql',
    ]) {
      expect(judge(decl, editWorld('', '', path)).kind, path).toBe('pass');
    }
  });

  it('isInvariantCheckedPath: document files excluded (md, mdx, txt, case-folded)', () => {
    for (const path of [
      '/r/docs/prd/mq-263.md',
      '/r/CLAUDE.md',
      '/r/.claude/rules/lambda.mdx',
      '/r/notes.txt',
    ]) {
      expect(judge(decl, editWorld('', '', path)), path).toMatchObject({
        kind: 'not-applicable',
        reason: 'scope',
      });
    }
  });
});

describe('invariant-comment-marker · judge', () => {
  const decl = loadDeclaration('invariant-comment-marker');
  const ENTRY = 'invariant-preserved';
  const lost = (world: World): unknown[] =>
    witnessesOf(judge(decl, world), ENTRY).map((w) => w.value);

  it('an INVARIANT line only in before → broken, that line is the witness', () => {
    const pre = ['const x = 1;', INV, 'const y = 2;'].join('\n');
    const post = ['const x = 1;', 'const y = 2;'].join('\n');
    const breaks = breaksOf(judge(decl, editWorld(pre, post)));
    expect(breaks).toHaveLength(1);
    expect(breaks[0].witnesses.map((w) => w.value)).toEqual([INV]);
    expect(breaks[0].message).toBe(INV);
  });

  it('preserved verbatim → pass', () => {
    const pre = ['a', '// INVARIANT(MQ-261): keep onConflictDoUpdate', 'b'].join('\n');
    const post = [
      'a',
      '// INVARIANT(MQ-261): keep onConflictDoUpdate',
      'c // changed elsewhere',
    ].join('\n');
    expect(judge(decl, editWorld(pre, post)).kind).toBe('pass');
  });

  it('rewording counts as removal', () => {
    const pre = '// INVARIANT(MQ-261): keep onConflictDoUpdate';
    const post = '// INVARIANT(MQ-261): weakened to DoNothing';
    expect(lost(editWorld(pre, post))).toEqual([pre]);
  });

  it('an identifier without a comment marker is ignored → pass', () => {
    const pre = ['const INVARIANT_NAME = "x";', 'doStuff();'].join('\n');
    expect(judge(decl, editWorld(pre, 'doStuff();')).kind).toBe('pass');
  });

  it('#, --, and JSDoc * markers are recognised — three witnesses, trimmed', () => {
    const pre = [
      '# INVARIANT(MQ-100): python invariant',
      '-- INVARIANT(MQ-101): sql invariant',
      ' * INVARIANT(MQ-102): jsdoc invariant',
    ].join('\n');
    expect(lost(editWorld(pre, ''))).toEqual([
      '# INVARIANT(MQ-100): python invariant',
      '-- INVARIANT(MQ-101): sql invariant',
      '* INVARIANT(MQ-102): jsdoc invariant',
    ]);
  });

  it('only the removed one of several is reported', () => {
    const pre = ['// INVARIANT(MQ-1): keep me', '// INVARIANT(MQ-2): drop me'].join('\n');
    expect(lost(editWorld(pre, '// INVARIANT(MQ-1): keep me'))).toEqual([
      '// INVARIANT(MQ-2): drop me',
    ]);
  });

  it('indentation-only change → pass', () => {
    expect(
      judge(decl, editWorld('  // INVARIANT(MQ-3): indented', '    // INVARIANT(MQ-3): indented'))
        .kind,
    ).toBe('pass');
  });

  it('inspectToolInput: Edit on a routes file → broken with the removed line', () => {
    const world = editWorld(
      '// INVARIANT(MQ-261): race\ncode();',
      'code();',
      '/repo/apps/server/src/routes/route.push-tokens.ts',
    );
    expect(lost(world)).toEqual(['// INVARIANT(MQ-261): race']);
  });

  it('inspectToolInput: MultiEdit aggregates — one world per edit, witnesses concatenated', () => {
    // The spike host split a MultiEdit into one change unit per edit and joined the
    // witnesses; the engine sees one world at a time, so the join happens here.
    const edits: [string, string][] = [
      ['// INVARIANT(MQ-1): a', ''],
      ['noop', 'noop2'],
      ['// INVARIANT(MQ-2): b', ''],
    ];
    const witnesses = edits.flatMap(([pre, post]) => lost(editWorld(pre, post)));
    expect(witnesses).toEqual(['// INVARIANT(MQ-1): a', '// INVARIANT(MQ-2): b']);
  });

  it('inspectToolInput: Write compares against the disk pre-state', () => {
    const world = editWorld('before();\n// INVARIANT(MQ-9): hold\nafter();', 'before();\nafter();');
    expect(lost(world)).toEqual(['// INVARIANT(MQ-9): hold']);
  });

  it('inspectToolInput: a new-file Write has no pre-state to lose → pass', () => {
    // The host supplies an empty pre for a file that did not exist.
    expect(judge(decl, editWorld('', 'fresh();', '/repo/new.ts')).kind).toBe('pass');
  });
});
