import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { noopTranscript } from '@polydeukes/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
// A `declare` entry compiles into a registration through the declaration engine: an
// assembly fault becomes a SKIP registration that names itself on stderr (never a throw —
// siblings and the valve must survive); otherwise `matches` routes on the first world the
// declaration's scope admits, the body judges every admitted world in input order
// (broken → 1 with witnesses, supply failure → unjudgeable 2, pass/not-applicable → 0),
// a computable shell write is a world the body judges while an uncomputable one lands on a
// skip arm, and the declaration's own witness block joins the TTL witness with OR on the
// registration's valve.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// The shell-write fixtures below route only; the injected pre-state reader answers `null` —
// the file is not there — so every derived write is a create.
const readPreState = () => null;

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PATH_SOURCE = 'target.path';
const ID = 'db-only-under-memory';
const WHY = 'a database file may exist only under memory/knowledge/';
const ENTRY = 'placed';

/** The body of the path-only declaration: `*.db` in scope, breaks outside the memory tree. */
const PATH_ONLY_DECLARE = {
  scope: { source: PATH_SOURCE, include: ['\\.db$'] },
  extract: {
    outside: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'matches', re: '^(?!memory/knowledge/)' },
    ],
  },
  relate: [
    {
      id: ENTRY,
      relation: { op: 'empty', of: 'outside' },
      message: '{value} is outside memory/knowledge/',
    },
  ],
};

/** A declare entry; extra head keys (`why`, `enforce`) ride along. */
function declareEntry(
  declare: Record<string, unknown> = PATH_ONLY_DECLARE,
  head: Record<string, unknown> = {},
): DisciplineEntry {
  return { id: ID, ...head, declare } as unknown as DisciplineEntry;
}

function specWith(
  disciplines: DisciplineEntry[],
  extra: Partial<CompileDisciplinesSpec> = {},
): CompileDisciplinesSpec {
  return {
    disciplines,
    rootDir: ROOT,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState,
    ...extra,
  };
}

/** A CovenantInput whose evidence is one create per path, in the given order. */
function createsAt(paths: string[], post = 'content'): CovenantInput {
  return {
    toolCalls: paths.map((path, index) => ({
      name: `call-${index}`,
      args: { file_path: path },
      fileChange: { kind: 'create', path, post } satisfies FileChange,
    })),
    subagentSpawns: [],
    userMessages: [],
  };
}

/** A CovenantInput whose single call is one modify of `path` from `pre` to `post`. */
function modifiesAt(path: string, pre: string, post: string): CovenantInput {
  return {
    toolCalls: [
      {
        name: 'call-0',
        args: { file_path: path },
        fileChange: { kind: 'modify', path, pre, post } satisfies FileChange,
      },
    ],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** A CovenantInput whose single call is a shell invocation of `command`, no evidence. */
function bashInput(command: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: command } }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** The body-bearing registration compiled for an entry id. */
function bodyRegOf(regs: CovenantRegistration[], label: string): CovenantRegistration | undefined {
  return regs.find((reg) => reg.label === label && reg.skip === undefined);
}

/** The skip-arm registrations compiled for an entry id. */
function skipArmsOf(regs: CovenantRegistration[], label: string): CovenantRegistration[] {
  return regs.filter((reg) => reg.label === label && reg.skip !== undefined);
}

/** Compile one declare entry and return its body registration; a missing one fails loudly. */
function compileBody(
  entry: DisciplineEntry,
  extra: Partial<CompileDisciplinesSpec> = {},
): CovenantRegistration {
  const reg = bodyRegOf(compileDisciplineRegistrations(specWith([entry], extra)), entry.id);
  if (reg === undefined) throw new Error(`no body registration compiled for ${entry.id}`);
  return reg;
}

/** Run a registration's body; a skip registration has none and that is the failure. */
async function judgeWith(reg: CovenantRegistration, input: CovenantInput) {
  if (reg.body === undefined) throw new Error(`registration ${reg.label} carries no body`);
  return (await reg.body(input)) as {
    exitCode: number;
    reason?: string;
    witnesses?: readonly {
      id: string;
      witnesses: readonly { key: string; value: unknown; before?: unknown }[];
    }[];
  };
}

function spyStderr() {
  return vi.spyOn(process.stderr, 'write').mockReturnValue(true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('compileDisciplineRegistrations — an assembly fault in a declaration skips', () => {
  const unregisteredFirst = declareEntry({
    ...PATH_ONLY_DECLARE,
    extract: { outside: [{ op: 'toolUses' }] },
  });
  const unregisteredLater = declareEntry({
    ...PATH_ONLY_DECLARE,
    extract: { outside: [{ op: 'source', of: PATH_SOURCE }, { op: 'sha256' }] },
  });

  it('compiles an unregistered first step into a skip registration naming the op and the entry', () => {
    // A throw here takes every sibling and the valve down; a silent body would judge with
    // a pipeline that never ran and read `pass`.
    spyStderr();
    const [reg] = compileDisciplineRegistrations(specWith([unregisteredFirst]));

    expect(reg?.label).toBe(ID);
    expect(reg?.body).toBeUndefined();
    expect(reg?.skip?.reason).toContain('toolUses');
    expect(reg?.skip?.reason).toContain(ID);
  });

  it('compiles an unregistered later step the same way', () => {
    // The fault check must walk the whole pipeline, not stop at the source step.
    spyStderr();
    const [reg] = compileDisciplineRegistrations(specWith([unregisteredLater]));

    expect(reg?.body).toBeUndefined();
    expect(reg?.skip?.reason).toContain('sha256');
  });

  it('a fault skip routes nothing — matches answers null for an in-scope change', () => {
    // A skip that still matches would record a `skipped` row per in-scope change for a
    // declaration that could never have judged; the fault belongs to the author, not the call.
    spyStderr();
    const [reg] = compileDisciplineRegistrations(specWith([unregisteredFirst]));

    expect(reg?.matches?.(createsAt(['lib/x.db']))).toBeNull();
    expect(reg?.matches?.(bashInput('echo x > lib/x.db'))).toBeNull();
  });

  it('names the discipline id on stderr exactly once at assembly', () => {
    // A silent skip is how a discipline goes inert while its verdict still reads passed.
    const stderr = spyStderr();

    compileDisciplineRegistrations(specWith([unregisteredFirst]));

    const lines = stderr.mock.calls.map((call) => String(call[0])).filter((s) => s.includes(ID));
    expect(lines).toHaveLength(1);
  });

  it('leaves a sibling declare entry judged as usual', () => {
    // Isolation in the direction that matters: one bad declaration costs only itself.
    spyStderr();
    const healthy = { ...declareEntry(), id: 'healthy' } as DisciplineEntry;
    const regs = compileDisciplineRegistrations(specWith([unregisteredFirst, healthy]));

    expect(bodyRegOf(regs, 'healthy')?.body).toBeTypeOf('function');
  });
});

describe('compileDisciplineRegistrations — declare routing picks the first in-scope world', () => {
  it('returns the repo-relative path of the first world the scope admits', () => {
    // The subject is the first ADMITTED world, not the first change: routing on
    // allFileChanges[0] would name `src/a.ts` for a `*.db` declaration.
    const reg = compileBody(declareEntry());

    expect(reg.matches?.(createsAt(['src/a.ts', 'lib/x.db']))).toBe('lib/x.db');
  });

  it('returns null when no change is in scope', () => {
    // A scope-blind `matches` spawns the body for every edit and writes a phantom row.
    const reg = compileBody(declareEntry());

    expect(reg.matches?.(createsAt(['src/a.ts', 'docs/b.md']))).toBeNull();
  });

  it('routes an absolute path under rootDir as its relative form', () => {
    // The scope regex is repo-relative; matched raw, `/repo/lib/x.db` never hits `\.db$`
    // anchored includes written against `lib/`, and the subject leaks the machine path.
    const reg = compileBody(declareEntry());

    expect(reg.matches?.(createsAt([`${ROOT}/lib/x.db`]))).toBe('lib/x.db');
  });

  it('a declaration without a scope block routes on the first world of any kind', () => {
    // Scope absent means every world, never "match nothing".
    const { scope: _scope, ...unscoped } = PATH_ONLY_DECLARE;
    const reg = compileBody(declareEntry(unscoped));

    expect(reg.matches?.(createsAt(['src/a.ts']))).toBe('src/a.ts');
  });

  it('skips a world the exclude list names and routes on the next included one', () => {
    // `exclude` must subtract from `include`; a scope that compiles the list and never
    // tests it names `vendor/a.db` as the subject and judges a path the author carved out.
    const reg = compileBody(
      declareEntry({
        ...PATH_ONLY_DECLARE,
        scope: { source: PATH_SOURCE, include: ['\\.db$'], exclude: ['^vendor/'] },
      }),
    );

    expect(reg.matches?.(createsAt(['vendor/a.db', 'lib/x.db']))).toBe('lib/x.db');
    expect(reg.matches?.(createsAt(['vendor/a.db']))).toBeNull();
  });
});

describe('compileDisciplineRegistrations — the declare body answers four ways', () => {
  it('pass: an in-scope change under the memory tree exits 0 with no witnesses', async () => {
    // The ordinary operation must pass; a body that reports the scope match itself as a
    // break blocks every *.db write and pushes the author to the valve.
    const reg = compileBody(declareEntry());

    const outcome = await judgeWith(reg, createsAt(['memory/knowledge/y.db']));

    expect(outcome.exitCode).toBe(0);
    expect(outcome.witnesses).toBeUndefined();
  });

  it('broken: exits 1 with the reason naming the id, the path, and the rendered message', async () => {
    // `1`, not `2`: the wrapper owns the 1→2 translation and the `advise` relaxation
    // depends on receiving 1. `{value}` must render as the witness's path.
    const reg = compileBody(declareEntry());

    const outcome = await judgeWith(reg, createsAt(['lib/x.db']));

    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toBe(
      `discipline '${ID}' broken on lib/x.db: lib/x.db is outside memory/knowledge/`,
    );
  });

  it('broken: appends the why after the message when the entry carries one', async () => {
    // The rationale rides the reason; without it an advised break on stderr says only
    // what, never why.
    const reg = compileBody(declareEntry(PATH_ONLY_DECLARE, { why: WHY }));

    const outcome = await judgeWith(reg, createsAt(['lib/x.db']));

    expect(outcome.reason).toBe(
      `discipline '${ID}' broken on lib/x.db: lib/x.db is outside memory/knowledge/ — why: ${WHY}`,
    );
  });

  it('broken: carries the engine breaks as witnesses — one entry, one witness, the path', async () => {
    // The wrapper serializes `witnesses` into the telemetry row; a body that drops them
    // leaves a four-field row that cannot say what broke.
    const reg = compileBody(declareEntry());

    const outcome = await judgeWith(reg, createsAt(['lib/x.db']));

    expect(outcome.witnesses).toHaveLength(1);
    expect(outcome.witnesses?.[0]?.id).toBe(ENTRY);
    expect(outcome.witnesses?.[0]?.witnesses).toHaveLength(1);
    expect(outcome.witnesses?.[0]?.witnesses[0]?.value).toBe('lib/x.db');
  });

  it('not-applicable: a body called on an out-of-scope change exits 0', async () => {
    // Routing and judging are two closures; the body must not treat "scope did not admit"
    // as a break when it is reached directly.
    const reg = compileBody(declareEntry());

    const outcome = await judgeWith(reg, createsAt(['src/a.ts']));

    expect(outcome.exitCode).toBe(0);
  });

  it('supply-error: a declaration reading pre on a create exits 2 and names the source on stderr', async () => {
    // Fail-closed: the host does not invent a `pre` for a create, and the engine's supply
    // failure must not read as pass (0) or as a break the advise level would wave through (1).
    const readsPre = declareEntry({
      scope: PATH_ONLY_DECLARE.scope,
      extract: { baseline: [{ op: 'source', of: 'pre' }] },
      relate: [{ id: ENTRY, relation: { op: 'empty', of: 'baseline' }, message: 'm' }],
    });
    const reg = compileBody(readsPre);
    const stderr = spyStderr();

    const outcome = await judgeWith(reg, createsAt(['lib/x.db']));

    expect(outcome.exitCode).toBe(2);
    const lines = stderr.mock.calls.map((call) => String(call[0])).filter((s) => s.includes(ID));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('pre');
  });

  it('supply-error becomes 0 when the declaration supplies pre as pass', async () => {
    // The author's escape hatch: `supply: { pre: pass }` leaves the call unjudged rather
    // than refused. Ignoring the supply block keeps every create blocked.
    const readsPreOrPasses = declareEntry({
      scope: PATH_ONLY_DECLARE.scope,
      supply: { pre: 'pass' },
      extract: { baseline: [{ op: 'source', of: 'pre' }] },
      relate: [{ id: ENTRY, relation: { op: 'empty', of: 'baseline' }, message: 'm' }],
    });
    const reg = compileBody(readsPreOrPasses);

    const outcome = await judgeWith(reg, createsAt(['lib/x.db']));

    expect(outcome.exitCode).toBe(0);
  });

  it('two worlds: the first in scope is the subject, the second breaking is the one reported', async () => {
    // The body walks every admitted world; stopping at the first (passing) one lets the
    // second slip, and the reason must name the world that broke, not the subject.
    const reg = compileBody(declareEntry());
    const input = createsAt(['memory/knowledge/ok.db', 'lib/bad.db']);

    expect(reg.matches?.(input)).toBe('memory/knowledge/ok.db');
    const outcome = await judgeWith(reg, input);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toContain('broken on lib/bad.db');
    expect(outcome.witnesses?.[0]?.witnesses[0]?.value).toBe('lib/bad.db');
  });

  it('two relate entries both breaking: witnesses carry both ids in declaration order, the reason names the first', async () => {
    // The body must forward every break the engine found, not the first alone: a row
    // that lists only `placed` hides that `quiet` broke on the same world. Order is the
    // declaration's, so the reason and the first witness agree.
    const reg = compileBody(
      declareEntry({
        ...PATH_ONLY_DECLARE,
        extract: {
          ...PATH_ONLY_DECLARE.extract,
          noisy: [
            { op: 'source', of: PATH_SOURCE },
            { op: 'matches', re: 'x' },
          ],
        },
        relate: [
          { id: ENTRY, relation: { op: 'empty', of: 'outside' }, message: 'm1' },
          { id: 'quiet', relation: { op: 'empty', of: 'noisy' }, message: 'm2' },
        ],
      }),
    );

    const outcome = await judgeWith(reg, createsAt(['lib/x.db']));

    expect(outcome.exitCode).toBe(1);
    expect(outcome.witnesses?.map((b) => b.id)).toEqual([ENTRY, 'quiet']);
    expect(outcome.reason).toBe(`discipline '${ID}' broken on lib/x.db: m1`);
  });

  it('a modify reaches the engine as a before/after pair: Unchanged over state breaks on the changed line', async () => {
    // The host must supply `state: { pre, post }` for a modify; a world built with only
    // `pre` and `post` as flat sources leaves `state` absent and every Unchanged declaration
    // refuses (2) on the one change kind it exists to judge.
    const keepsLines = {
      extract: { text: [{ op: 'source', of: 'state' }, { op: 'lines' }] },
      relate: [
        {
          id: 'kept',
          relation: { op: 'unchanged', of: 'text' },
          message: 'line {key} changed (was {before}, now {value})',
        },
      ],
    };
    const reg = compileBody(declareEntry(keepsLines));

    const outcome = await judgeWith(reg, modifiesAt('lib/notes.md', 'a\nb\n', 'a\nc\n'));

    expect(outcome.exitCode).toBe(1);
    expect(outcome.witnesses?.[0]?.id).toBe('kept');
    // The engine strips `before` from the witnesses it hands out; it lives in the rendered
    // message only.
    expect(outcome.witnesses?.[0]?.witnesses).toEqual([{ key: '2', value: 'c' }]);
    expect(outcome.reason).toBe(
      `discipline '${ID}' broken on lib/notes.md: line 2 changed (was b, now c)`,
    );
  });

  it('the same Unchanged declaration on a create exits 2 without a supply rule and 0 with state passed', async () => {
    // A create has no pair; the host must not fabricate one (`state: { post }` or an
    // empty pre reads as "nothing changed" and passes). Only the author's supply rule
    // turns the absence into a pass.
    spyStderr();
    const keepsLines = {
      extract: { text: [{ op: 'source', of: 'state' }, { op: 'lines' }] },
      relate: [{ id: 'kept', relation: { op: 'unchanged', of: 'text' }, message: 'm' }],
    };
    const refuses = compileBody(declareEntry(keepsLines));
    const passes = compileBody(declareEntry({ ...keepsLines, supply: { state: 'pass' } }));

    expect((await judgeWith(refuses, createsAt(['lib/notes.md']))).exitCode).toBe(2);
    expect((await judgeWith(passes, createsAt(['lib/notes.md']))).exitCode).toBe(0);
  });
});

describe('compileDisciplineRegistrations — declare enforce level', () => {
  it('is advise when the entry omits enforce', () => {
    // Absence is advise since the posture narrowing; defaulting to block promotes every
    // new declaration to a blocking covenant the author never asked for.
    expect(compileBody(declareEntry()).enforce).toBe('advise');
  });
});

describe('compileDisciplineRegistrations — declare shell writes: computable to the body, the rest to a skip arm', () => {
  it('a declaration scoped on a content source admits every computable write at routing and lets the body settle the scope', () => {
    // Routing reads the command text alone and an append's content composes onto a
    // pre-state only the body may read, so a scope over `post` cannot be decided here:
    // the write is admitted and the body, holding the real world, applies the scope. A
    // route that answered null for content it could not see would leave a write the body
    // breaks on with no row. An uncomputable write is the skip arm's.
    const regs = compileDisciplineRegistrations(
      specWith([
        declareEntry({ ...PATH_ONLY_DECLARE, scope: { source: 'post', include: ['secret'] } }),
      ]),
    );

    expect(bodyRegOf(regs, ID)?.matches?.(bashInput('echo secret > lib/z.txt'))).toBe('lib/z.txt');
    expect(bodyRegOf(regs, ID)?.matches?.(bashInput('echo x >> lib/z.txt'))).toBe('lib/z.txt');
    expect(bodyRegOf(regs, ID)?.matches?.(bashInput("sed -i 's/a/b/' lib/z.txt"))).toBeNull();
    expect(skipArmsOf(regs, ID)[0]?.matches?.(bashInput("sed -i 's/a/b/' lib/z.txt"))).toBe(
      'lib/z.txt',
    );
  });

  it('a shell write outside scope routes to no registration carrying the entry id', () => {
    // A scope-blind arm — either one — floods the entry's label with rows for files it
    // never covered.
    const regs = compileDisciplineRegistrations(specWith([declareEntry()]));

    for (const command of ['echo x > lib/z.txt', "sed -i 's/a/b/' lib/z.txt"]) {
      for (const reg of regs.filter((r) => r.label === ID)) {
        expect(reg.matches?.(bashInput(command)), command).toBeNull();
      }
    }
  });
});

describe('compileDisciplineRegistrations — the declaration witness block joins the TTL witness with OR', () => {
  const WITNESS_MARK = 'WITNESSED';
  const withWitnessBlock = declareEntry({
    ...PATH_ONLY_DECLARE,
    witness: {
      extract: {
        marker: [
          { op: 'source', of: 'post' },
          { op: 'matches', re: WITNESS_MARK },
        ],
      },
      relate: [{ id: 'marked', relation: { op: 'nonEmpty', of: 'marker' }, message: 'm' }],
    },
  });
  const ctx = { label: ID, subject: 'lib/x.db' };

  it('opens on the declaration witness alone when no TTL witness is in the spec', () => {
    // The declaration's own valve must open without a TTL witness; treating an absent
    // TTL witness as "closed and final" makes the witness block dead configuration.
    const reg = compileBody(withWitnessBlock);
    const input = createsAt(['lib/x.db'], `content ${WITNESS_MARK}`);

    expect(reg.witness).toBeTypeOf('function');
    expect(reg.witness?.(input, noopTranscript, ctx)).toBe(true);
  });

  it('stays closed when the post carries no marker and there is no TTL witness', () => {
    // Fail-closed valve: the OR's left side is false without a TTL witness, and the
    // witness block does not hold, so the block stands.
    const reg = compileBody(withWitnessBlock);

    expect(reg.witness?.(createsAt(['lib/x.db']), noopTranscript, ctx)).toBe(false);
  });

  it('opens on a TTL witness answering true even without the marker', () => {
    // OR, not AND: the human's TTL pass condition alone must still open the valve.
    const reg = compileBody(withWitnessBlock, { witness: () => true });

    expect(reg.witness?.(createsAt(['lib/x.db']), noopTranscript, ctx)).toBe(true);
  });

  it('stays closed when the TTL witness answers false and the marker is absent', () => {
    // Both sides false must close; an OR that short-circuits to the TTL's presence rather
    // than its answer opens on every spec that merely configured a witness.
    const reg = compileBody(withWitnessBlock, { witness: () => false });

    expect(reg.witness?.(createsAt(['lib/x.db']), noopTranscript, ctx)).toBe(false);
  });

  it('stays closed when the first admitted world is unjudgeable, even if a later one breaks with the marker', () => {
    // The valve reads the body's own judgment. Re-judging on its own it would skip the
    // supply failure the body stopped at and open on the second file's marker, recording
    // `witnessed` for a call the discipline never judged.
    const reg = compileBody(
      declareEntry({
        ...PATH_ONLY_DECLARE,
        extract: {
          ...PATH_ONLY_DECLARE.extract,
          parsed: [{ op: 'source', of: 'post' }, { op: 'json' }],
        },
        relate: [
          ...PATH_ONLY_DECLARE.relate,
          { id: 'parses', relation: { op: 'empty', of: 'parsed' }, message: 'p' },
        ],
        witness: withWitnessBlock.declare?.witness,
      }),
    );
    const input: CovenantInput = {
      toolCalls: [
        { name: 'Write', fileChange: { kind: 'create', path: 'lib/a.db', post: 'not json' } },
        {
          name: 'Write',
          fileChange: { kind: 'create', path: 'lib/b.db', post: `"x" ${WITNESS_MARK}` },
        },
      ],
      subagentSpawns: [],
      userMessages: [],
    };

    expect(reg.witness?.(input, noopTranscript, ctx)).toBe(false);
  });

  it('opens on the world the body reported broken, whatever a later broken world carries', () => {
    // The body reports the first break, so the valve is judged there: a second broken
    // world without the marker must not veto a witness the reported break satisfies.
    const reg = compileBody(withWitnessBlock);
    const input: CovenantInput = {
      toolCalls: [
        {
          name: 'Write',
          fileChange: { kind: 'create', path: 'lib/a.db', post: `content ${WITNESS_MARK}` },
        },
        { name: 'Write', fileChange: { kind: 'create', path: 'lib/b.db', post: 'content' } },
      ],
      subagentSpawns: [],
      userMessages: [],
    };

    expect(reg.witness?.(input, noopTranscript, ctx)).toBe(true);
  });

  it('a declaration without a witness block still carries the TTL witness alone', () => {
    // The valve must not vanish for declarations that leave the human path to the TTL
    // witness; dropping it makes every such block unrecoverable in-session.
    const reg = compileBody(declareEntry(), { witness: () => true });

    expect(reg.witness?.(createsAt(['lib/x.db']), noopTranscript, ctx)).toBe(true);
  });
});
