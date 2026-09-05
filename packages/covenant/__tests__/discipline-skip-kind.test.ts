import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Every skip registration names WHY it cannot judge with a token from the closed
// `SKIP_REASONS` vocabulary, beside the sentence it already carried: `no-observation` when
// the surface has no channel for what the entry reads (the one-call session surface for a
// change-set declaration, a shell line whose write this layer cannot compute),
// `config-fault` when assembly could not compile the entry. The dispatcher writes the token into the `skipped` row's fifth field. A
// declaration whose `supply: pass` waved an absent source through is the third token,
// `supply-pass`, recorded as `skipped` rather than as a `passed` judgment.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import { type CovenantRegistration, dispatchCovenants } from '../src/dispatch.ts';
import { runCovenant } from '../src/run-covenant.ts';

const readPreState = () => null;

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PATH_SOURCE = 'target.path';
const CHANGES = 'changes';
// Ids, paths, and patterns are fixture values the live config carries.
const BILINGUAL_ID = 'docs-stay-bilingual';
const EN_DOC = 'docs/a.md';
const EN_PATTERN = '^(.+?)(?<!\\.ko)\\.md$';
const KO_PATTERN = '^(.+)\\.ko\\.md$';
const FAULTY_ID = 'dep-needs-view';
const PKG_FILE = 'pkg/index.ts';
const LOCALE_ID = 'locale-keys';
const EN = 'en';
const EN_FILE = 'locales/en.json';
const OTHER_FILE = 'docs/readme.md';
const COMMON_SHELL_LABEL = 'shell-unjudgeable';

/** The live bilingual declaration: antecedent over `target.path`, consequent over `changes`. */
const BILINGUAL_DECLARE = {
  mechanism: 'companion',
  scope: { source: PATH_SOURCE, include: ['\\.md$'] },
  extract: {
    en: [
      { op: 'source', of: PATH_SOURCE },
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
      id: 'ko-follows',
      relation: { op: 'implies', of: 'en', requires: 'koChanged' },
      message: '{value} changed without {key}.ko.md',
    },
  ],
};

/** Reads a named file source and lets its absence pass. */
const READS_EN_PASS = {
  mechanism: 'controlled-vocabulary',
  sources: { [EN]: { file: EN_FILE } },
  supply: { [EN]: 'pass' },
  extract: {
    own: [{ op: 'source', of: PATH_SOURCE }],
    allowed: [{ op: 'source', of: EN }, { op: 'json' }, { op: 'flattenKeys' }],
  },
  relate: [{ id: 'known', relation: { op: 'subset', of: 'own', in: 'allowed' }, message: 'm' }],
};

function declareEntry(declare: Record<string, unknown>, id: string): DisciplineEntry {
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

/** A CovenantInput of the given creates, in order. */
function createsAt(paths: string[]): CovenantInput {
  return {
    toolCalls: paths.map((path, index) => ({
      name: `call-${index}`,
      args: { file_path: path },
      fileChange: { kind: 'create', path, post: 'content' } satisfies FileChange,
    })),
    subagentSpawns: [],
    userMessages: [],
  };
}

/** The skip registrations compiled under `label`. */
function skipsOf(regs: CovenantRegistration[], label: string): CovenantRegistration[] {
  return regs.filter((reg) => reg.label === label && reg.skip !== undefined);
}

/** The skip registration under `label` that routes a file create at `path`. */
function fileSkipOf(
  regs: CovenantRegistration[],
  label: string,
  path: string,
): CovenantRegistration | undefined {
  return skipsOf(regs, label).find((reg) => reg.matches?.(createsAt([path])) !== null);
}

/** Every telemetry row under `label` as `{ event, subject, reason }`. */
function rowsOf(telemetryPath: string, label: string) {
  return readRecords(telemetryPath)
    .records.filter((record) => record.label === label)
    .map(({ event, subject, reason }) => ({ event, subject, reason }));
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-skip-kind-'));
  telemetryPath = join(dir, 'roi.log');
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('compileDisciplineRegistrations — each skip site names its kind', () => {
  it('the change-set surface skip is no-observation', () => {
    // An environment fact, not the author's mistake: filed as `config-fault` it would send
    // the author to fix a declaration the commit surface judges correctly.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE, BILINGUAL_ID)], { observesChangeSet: false }),
    );

    expect(fileSkipOf(regs, BILINGUAL_ID, EN_DOC)?.skip?.kind).toBe('no-observation');
  });

  it('a declaration with an unregistered step is config-fault', () => {
    // The compile-fault skip routes nothing, so its kind is asserted on the registration.
    const faulty = {
      ...BILINGUAL_DECLARE,
      extract: {
        ...BILINGUAL_DECLARE.extract,
        en: [{ op: 'source', of: PATH_SOURCE }, { op: 'sha256' }],
      },
    };
    const regs = compileDisciplineRegistrations(specWith([declareEntry(faulty, BILINGUAL_ID)]));

    const kinds = skipsOf(regs, BILINGUAL_ID).map((reg) => reg.skip?.kind);
    expect(kinds).toContain('config-fault');
  });

  it('the per-entry shell arm and the common shell-unjudgeable registration are no-observation', () => {
    // A shell write this layer cannot compute is a channel it does not have, on every
    // entry and on the common backstop alike.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE, BILINGUAL_ID)]),
    );

    const entryShellArm = skipsOf(regs, BILINGUAL_ID);
    expect(entryShellArm.map((reg) => reg.skip?.kind)).toEqual(['no-observation']);
    expect(skipsOf(regs, COMMON_SHELL_LABEL).map((reg) => reg.skip?.kind)).toEqual([
      'no-observation',
    ]);
  });
});

describe('dispatchCovenants — the skipped row carries the registration’s kind as its reason', () => {
  it('writes reason config-fault for a skip registration of that kind', async () => {
    // The dispatcher is the one writer of skip rows; a dispatch that keeps writing the
    // four-field row leaves every kind the compiler names on the floor.
    const registration: CovenantRegistration = {
      label: FAULTY_ID,
      protectedPaths: [],
      matches: () => PKG_FILE,
      skip: { reason: 'the declaration names an unregistered step', kind: 'config-fault' },
    };

    const { exitCode, results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(createsAt([PKG_FILE])),
      registrations: [registration],
      telemetryPath,
    });

    expect(exitCode).toBe(0);
    expect(results).toEqual([{ label: FAULTY_ID, exitCode: 0, event: 'skipped' }]);
    expect(rowsOf(telemetryPath, FAULTY_ID)).toEqual([
      { event: 'skipped', subject: PKG_FILE, reason: 'config-fault' },
    ]);
  });

  it('a change-set declaration on the one-call surface records skipped with reason no-observation', async () => {
    // End to end: the kind the compiler chose is the token the row carries, under the
    // entry id and the routed path. A dispatcher that hard-codes one token, or the compiler
    // and dispatcher disagreeing on the field name, both fail the equality.
    const regs = compileDisciplineRegistrations(
      specWith([declareEntry(BILINGUAL_DECLARE, BILINGUAL_ID)], { observesChangeSet: false }),
    );

    await dispatchCovenants({
      stdinPayload: JSON.stringify(createsAt([EN_DOC])),
      registrations: regs,
      telemetryPath,
    });

    expect(rowsOf(telemetryPath, BILINGUAL_ID)).toEqual([
      { event: 'skipped', subject: EN_DOC, reason: 'no-observation' },
    ]);
  });
});

describe('dispatchCovenants — a declaration whose supply: pass let a source through records supply-pass', () => {
  it('with the named file absent, the result is skipped and the row carries reason supply-pass', async () => {
    // Today this lands as `passed`: exit 0 reads as a judgment that upheld, when no relation
    // was evaluated at all. The row must say so, and say why.
    const regs = compileDisciplineRegistrations(specWith([declareEntry(READS_EN_PASS, LOCALE_ID)]));

    const { exitCode, results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(createsAt([OTHER_FILE])),
      registrations: regs,
      telemetryPath,
    });

    expect(exitCode).toBe(0);
    expect(results.filter((r) => r.label === LOCALE_ID)).toEqual([
      { label: LOCALE_ID, exitCode: 0, event: 'skipped' },
    ]);
    expect(rowsOf(telemetryPath, LOCALE_ID)).toEqual([
      { event: 'skipped', subject: OTHER_FILE, reason: 'supply-pass' },
    ]);
  });

  it('a supply-passed world does not hide a later world that breaks — the break wins', async () => {
    // Two worlds in one dispatch: the first has no en.json to read (supply-pass), the second
    // IS en.json and its own path is not among its keys. Stopping at the first world would
    // report skipped for a call that broke the relation.
    const regs = compileDisciplineRegistrations(specWith([declareEntry(READS_EN_PASS, LOCALE_ID)]));
    const input: CovenantInput = {
      toolCalls: [
        {
          name: 'call-0',
          args: { file_path: OTHER_FILE },
          fileChange: { kind: 'create', path: OTHER_FILE, post: 'content' } satisfies FileChange,
        },
        {
          name: 'call-1',
          args: { file_path: EN_FILE },
          fileChange: {
            kind: 'create',
            path: EN_FILE,
            post: JSON.stringify({ unrelated: 1 }),
          } satisfies FileChange,
        },
      ],
      subagentSpawns: [],
      userMessages: [],
    };

    const { results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: regs,
      telemetryPath,
    });

    expect(results.filter((r) => r.label === LOCALE_ID).map((r) => r.event)).toEqual(['advised']);
    expect(rowsOf(telemetryPath, LOCALE_ID).map((row) => row.event)).toEqual(['advised']);
  });

  it('with the named file supplied, the same declaration is judged and records passed with no reason', async () => {
    // The other end: a body that answers `skipped` whenever `supply: pass` is written, rather
    // than when a source was actually absent, turns every judged call into a non-judgment.
    const regs = compileDisciplineRegistrations(specWith([declareEntry(READS_EN_PASS, LOCALE_ID)]));

    const { results } = await dispatchCovenants({
      stdinPayload: JSON.stringify(createsAt([OTHER_FILE])),
      registrations: regs,
      telemetryPath,
      world: { files: { [EN_FILE]: JSON.stringify({ [OTHER_FILE]: 1 }) } },
    });

    expect(results.filter((r) => r.label === LOCALE_ID)).toEqual([
      { label: LOCALE_ID, exitCode: 0, event: 'passed' },
    ]);
    expect(rowsOf(telemetryPath, LOCALE_ID)).toEqual([
      { event: 'passed', subject: OTHER_FILE, reason: undefined },
    ]);
  });
});

describe('runCovenant — a skip token beside a break does not downgrade the verdict', () => {
  it('records the break, not skipped, when the body answers exit 1 with a skip token', async () => {
    // The outcome type admits both fields; a wrapper that keys on the token alone would turn
    // a reported break into an upheld call with no witness consulted.
    const verdict = await runCovenant({
      body: async () => ({ exitCode: 1, reason: 'broke', skipped: 'supply-pass' }),
      label: LOCALE_ID,
      subject: OTHER_FILE,
      telemetryPath,
      enforce: 'advise',
    });

    expect(verdict.event).toBe('advised');
    expect(rowsOf(telemetryPath, LOCALE_ID)).toEqual([
      { event: 'advised', subject: OTHER_FILE, reason: undefined },
    ]);
  });
});
