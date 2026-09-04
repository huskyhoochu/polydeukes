import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// A surface tells the compiler whether its input carries the observation unit's whole
// change set (`observesChangeSet`). Absent means today's meaning — true — and a declaration
// reading `changes` judges over the derived set. When the surface answers false, every
// declaration whose body or witness pipeline reads `changes` compiles into a registration
// that KEEPS its scope routing and carries a skip reason instead of a body: the session
// surface dispatches one call at a time, so a change-set judgment there reports every
// `.md` edit as unpaired. It is an environment fact, not a config fault — nothing is named
// on stderr — and a declaration reading only `target.path` is untouched by the flag.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import { type CovenantRegistration, dispatchCovenants } from '../src/dispatch.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PATH_SOURCE = 'target.path';
const CHANGES = 'changes';
// Ids, paths, and the skip sentence are fixture values the live config carries.
const ID = 'docs-stay-bilingual';
const KO_FOLLOWS = 'ko-follows';
const EN_FOLLOWS = 'en-follows';
const EN_DOC = 'docs/a.md';
const KO_DOC = 'docs/a.ko.md';
const STEM = 'docs/a';
const INTERNAL_DOC = 'CLAUDE.md';
const SKIP_REASON = 'a change set needs a surface that observes more than one change';
const EN_PATTERN = '^(.+?)(?<!\\.ko)\\.md$';
const KO_PATTERN = '^(.+)\\.ko\\.md$';

/** The live bilingual declaration: antecedent over `target.path`, consequent over `changes`. */
const BILINGUAL_DECLARE = {
  scope: { source: PATH_SOURCE, include: ['\\.md$'], exclude: ['^\\.claude/', '^CLAUDE\\.md$'] },
  extract: {
    en: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'keyByPattern', re: EN_PATTERN },
    ],
    ko: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'keyByPattern', re: KO_PATTERN },
    ],
    enChanged: [
      { op: 'source', of: CHANGES },
      { op: 'items' },
      { op: 'keyByPattern', re: EN_PATTERN },
    ],
    koChanged: [
      { op: 'source', of: CHANGES },
      { op: 'items' },
      { op: 'keyByPattern', re: KO_PATTERN },
    ],
  },
  relate: [
    {
      id: KO_FOLLOWS,
      relation: { op: 'Implies', of: 'en', requires: 'koChanged' },
      message: '{value} changed without {key}.ko.md',
    },
    {
      id: EN_FOLLOWS,
      relation: { op: 'Implies', of: 'ko', requires: 'enChanged' },
      message: '{value} changed without {key}.md',
    },
  ],
};

/** The body reads only the target path; the witness block alone reads `changes`. */
const WITNESS_READS_CHANGES_DECLARE = {
  scope: { source: PATH_SOURCE, include: ['\\.md$'] },
  extract: {
    en: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'keyByPattern', re: EN_PATTERN },
    ],
  },
  relate: [{ id: KO_FOLLOWS, relation: { op: 'Empty', of: 'en' }, message: '{value}' }],
  witness: {
    extract: {
      koChanged: [
        { op: 'source', of: CHANGES },
        { op: 'items' },
        { op: 'keyByPattern', re: KO_PATTERN },
      ],
    },
    relate: [{ id: 'paired', relation: { op: 'NonEmpty', of: 'koChanged' }, message: 'm' }],
  },
};

/** The live path-only declaration shape: `*.db` in scope, breaks outside the knowledge tree. */
const SQLITE_ID = 'sqlite-only-under-knowledge';
const SQLITE_DECLARE = {
  scope: { source: PATH_SOURCE, include: ['\\.db$'] },
  extract: {
    outside: [
      { op: 'source', of: PATH_SOURCE },
      { op: 'matches', re: '^(?!store/knowledge/)' },
    ],
  },
  relate: [
    {
      id: 'placed',
      relation: { op: 'Empty', of: 'outside' },
      message: '{value} is outside store/knowledge/',
    },
  ],
};

/** A declare entry under `id`; extra head keys ride along. */
function declareEntry(declare: Record<string, unknown>, id: string = ID): DisciplineEntry {
  return { id, declare } as unknown as DisciplineEntry;
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

/** A CovenantInput of the given creates, in order, with an optional world axis. */
function createsAt(paths: string[], world?: NonNullable<CovenantInput['world']>): CovenantInput {
  return {
    toolCalls: paths.map((path, index) => ({
      name: `call-${index}`,
      args: { file_path: path },
      fileChange: { kind: 'create', path, post: 'content' } satisfies FileChange,
    })),
    subagentSpawns: [],
    userMessages: [],
    ...(world !== undefined && { world }),
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

/** The registrations compiled under an entry id. */
function regsOf(regs: CovenantRegistration[], label: string): CovenantRegistration[] {
  return regs.filter((reg) => reg.label === label);
}

/** The body-bearing registration compiled for an entry id. */
function bodyRegOf(regs: CovenantRegistration[], label: string): CovenantRegistration | undefined {
  return regsOf(regs, label).find((reg) => reg.skip === undefined);
}

/** The registration under `label` that routes a file-change input — never the shell arm. */
function fileRegOf(regs: CovenantRegistration[], label: string): CovenantRegistration | undefined {
  return regsOf(regs, label).find((reg) => reg.matches?.(createsAt([EN_DOC])) !== null);
}

function spyStderr() {
  return vi.spyOn(process.stderr, 'write').mockReturnValue(true);
}

/** Every telemetry row under `label` as `[event, subject]`, plus the parsed witnesses. */
function rowsOf(telemetryPath: string, label: string) {
  return readRecords(telemetryPath)
    .records.filter((record) => record.label === label)
    .map((record) => ({
      event: record.event,
      subject: record.subject,
      witnesses:
        record.witnesses === undefined
          ? undefined
          : (JSON.parse(record.witnesses) as {
              id: string;
              total: number;
              witnesses: { key: string; value: unknown }[];
            }[]),
    }));
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-declare-change-set-surface-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('compileDisciplineRegistrations — a surface that does not observe the change set skips a changes-reading declaration', () => {
  it('compiles the declaration into a skip registration carrying the change-set reason and no body', () => {
    // A body compiled under a one-call surface judges a derived `[own path]` change set
    // and reports every scoped `.md` edit as unpaired — a false `advised` row per edit,
    // which is the measurement this declaration exists to start.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE)], { observesChangeSet: false }),
    );

    expect(bodyRegOf(regs, ID)).toBeUndefined();
    expect(fileRegOf(regs, ID)?.skip).toEqual({ reason: SKIP_REASON });
  });

  it('the skip registration keeps the scope routing: in-scope docs route, an excluded path does not', () => {
    // Routing is what leaves the `skipped` row; a skip compiled like a config fault answers
    // null for everything and the surface passes the edit with no row at all. The exclude
    // list must still subtract, or every CLAUDE.md edit records a skip for an entry whose
    // scope never admitted it.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE)], { observesChangeSet: false }),
    );
    const reg = fileRegOf(regs, ID);

    expect(reg).toBeDefined();
    expect(reg?.matches?.(createsAt([EN_DOC]))).toBe(EN_DOC);
    expect(reg?.matches?.(createsAt([INTERNAL_DOC]))).toBeNull();
  });

  it('the skip registration answers null for a path the include list does not admit', () => {
    // The exclude case above cannot tell an include test from an always-admit `matches`
    // that only subtracts `exclude`; a `.txt` outside `include` must not route, or every
    // non-markdown edit on the session surface records a skip for this id.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE)], { observesChangeSet: false }),
    );

    expect(fileRegOf(regs, ID)?.matches?.(createsAt(['docs/notes.txt']))).toBeNull();
  });

  it('names nothing on stderr — a missing channel is an environment fact, not a config fault', () => {
    // The config-fault path writes the entry id to stderr at every assembly; routed through
    // it, every session call would print a fault for a declaration the author wrote right.
    const stderr = spyStderr();

    compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE)], { observesChangeSet: false }),
    );

    const lines = stderr.mock.calls.map((call) => String(call[0])).filter((s) => s.includes(ID));
    expect(lines).toEqual([]);
  });

  it('a declaration whose witness block alone reads changes is skipped the same way', () => {
    // The check must walk the witness pipelines too: a valve reading a derived change set
    // opens (or stays shut) on a world the surface never observed.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(WITNESS_READS_CHANGES_DECLARE)], { observesChangeSet: false }),
    );

    expect(bodyRegOf(regs, ID)).toBeUndefined();
    expect(fileRegOf(regs, ID)?.skip).toEqual({ reason: SKIP_REASON });
  });

  it('a declaration reading only target.path keeps its body under the same flag', async () => {
    // The flag names one source. A compiler that skips every declaration on a
    // change-set-less surface turns the one live path declaration into a skip on the
    // session surface, where it has judged since it landed.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(SQLITE_DECLARE, SQLITE_ID)], { observesChangeSet: false }),
    );
    const reg = bodyRegOf(regs, SQLITE_ID);

    expect(reg?.body).toBeTypeOf('function');
    expect((await reg?.body?.(createsAt(['lib/x.db'])))?.exitCode).toBe(1);
  });
});

describe('compileDisciplineRegistrations — the flag absent or true keeps judging the change set', () => {
  it('flag omitted: a lone docs/a.md create lands advised with ko-follows over the derived change set', async () => {
    // Absent is not false. An embedder compiling without the flag must still judge the
    // derived `[own path]` set: a compiler reading `spec.observesChangeSet === true` skips
    // every existing fixture that never set it.
    const regs = compileDisciplineRegistrations(specWith([declareEntry(BILINGUAL_DECLARE)]));

    const { results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(createsAt([EN_DOC])),
      registrations: regs,
      telemetryPath,
    });

    expect(results.filter((r) => r.label === ID)).toEqual([
      { label: ID, exitCode: 0, event: 'advised' },
    ]);
    const [row] = rowsOf(telemetryPath, ID);
    expect(row?.subject).toBe(EN_DOC);
    expect(row?.witnesses).toEqual([
      { id: KO_FOLLOWS, total: 1, witnesses: [{ key: STEM, value: EN_DOC }] },
    ]);
  });

  it('flag true with both sides of the pair in world.changes: the lone dispatched change passes', async () => {
    // The flag's true end must not be read as the skip end (an inverted comparison), and
    // the supplied change set — not the derived one — must be what the consequent reads:
    // both mutations turn a paired commit into a break or a skip.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE)], { observesChangeSet: true }),
    );

    const { results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(createsAt([EN_DOC])),
      registrations: regs,
      telemetryPath,
      world: { changes: [EN_DOC, KO_DOC] },
    });

    expect(results.filter((r) => r.label === ID)).toEqual([
      { label: ID, exitCode: 0, event: 'passed' },
    ]);
    expect(rowsOf(telemetryPath, ID).map((row) => row.event)).toEqual(['passed']);
  });
});

describe('dispatchCovenants — the skipped declaration leaves a skipped row, never a verdict', () => {
  it('flag false: a docs/a.md create records skipped under the entry id and the path, and no advised row', async () => {
    // Who answered, not only what: exit 0 with an `advised` row is the false positive the
    // skip exists to prevent, and exit 0 with no row is a declaration that went inert.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE)], { observesChangeSet: false }),
    );

    const { exitCode, results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(createsAt([EN_DOC])),
      registrations: regs,
      telemetryPath,
    });

    expect(exitCode).toBe(0);
    expect(results.filter((r) => r.label === ID)).toEqual([
      { label: ID, exitCode: 0, event: 'skipped' },
    ]);
    expect(rowsOf(telemetryPath, ID).map((row) => [row.event, row.subject])).toEqual([
      ['skipped', EN_DOC],
    ]);
  });

  it('flag false: a shell write of an in-scope .md lands exactly one skipped row under the id', async () => {
    // The shell arm routes a Bash write; the change-set skip keeps the body's routing,
    // which derives no world from a call carrying no fileChange and answers null. Two skip
    // registrations that both route the same line leave two rows for one call.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE)], { observesChangeSet: false }),
    );

    const { exitCode } = await dispatchCovenants({
      stdinPayload: JSON.stringify(bashInput(`echo x > ${EN_DOC}`)),
      registrations: regs,
      telemetryPath,
    });

    expect(exitCode).toBe(0);
    expect(rowsOf(telemetryPath, ID).map((row) => [row.event, row.subject])).toEqual([
      ['skipped', EN_DOC],
    ]);
  });
});

describe('compileDisciplineRegistrations — the skip registration keeps its source bindings', () => {
  it('flag false: a declaration scoped on a named source still routes, and records skipped', async () => {
    // Routing on a named source needs the binding planned and supplied. A skip registration
    // that drops `sources` leaves that name unsupplied, scope admits nothing, and the entry
    // vanishes from telemetry — a silent pass, not the recorded limit.
    const NOTE = 'note';
    const NOTE_PATH = 'docs/note.txt';
    const declare = {
      ...BILINGUAL_DECLARE,
      scope: { source: NOTE, include: ['^pair$'] },
      sources: { [NOTE]: { file: NOTE_PATH } },
    };
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(declare)], { observesChangeSet: false }),
    );

    expect(regsOf(regs, ID).find((reg) => reg.skip !== undefined)?.sources).toEqual([
      { name: NOTE, file: NOTE_PATH },
    ]);
    const { exitCode } = await dispatchCovenants({
      stdinPayload: JSON.stringify(createsAt([EN_DOC])),
      registrations: regs,
      telemetryPath,
      world: { files: { [NOTE_PATH]: 'pair' } },
    });

    expect(exitCode).toBe(0);
    expect(rowsOf(telemetryPath, ID).map((row) => [row.event, row.subject])).toEqual([
      ['skipped', EN_DOC],
    ]);
  });
});
