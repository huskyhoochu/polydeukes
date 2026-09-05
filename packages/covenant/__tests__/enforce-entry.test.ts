import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DisciplineEntry, parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The enforce level has two owners: the OBSERVER sets one for the whole dispatch, and the
// AUTHOR sets one per entry, carried onto the entry's body-bearing registration. The
// dispatcher composes the two per registration and the lenient side wins:
// effective = (dispatch advise || registration advise) ? advise : block.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import { inputWithArgs, markerThunk, readTelemetryLines } from './helpers.js';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

type EnforceLevel = 'block' | 'advise';
type RegistrationWithEnforce = CovenantRegistration & { enforce?: EnforceLevel };
type EntryWithEnforce = DisciplineEntry & { enforce?: EnforceLevel };

/** The protected entry every dispatch case matches on — subject of each telemetry row. */
const PROTECTED_ENTRY = 'sub/protected/file.txt';

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-enforce-entry-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A registration matching PROTECTED_ENTRY whose body exits with `bodyExitCode`. */
function registration(
  label: string,
  bodyExitCode: number,
  extra: { enforce?: EnforceLevel } = {},
): RegistrationWithEnforce {
  const reg: RegistrationWithEnforce = {
    label,
    protectedPaths: [PROTECTED_ENTRY],
    body: async () => ({ exitCode: bodyExitCode }),
  };
  if (extra.enforce !== undefined) reg.enforce = extra.enforce;
  return reg;
}

/** Every telemetry row as [event, label, subject]. */
function rows(): [string, string, string][] {
  return readTelemetryLines(telemetryPath).map((line) => {
    const record = parseRecordLine(line);
    if (!record) throw new Error(`unparseable telemetry line: ${line}`);
    return [record.event, record.label, record.subject];
  });
}

/** Dispatch the given registrations against one call mentioning PROTECTED_ENTRY. */
function dispatch(registrations: RegistrationWithEnforce[], dispatchEnforce?: EnforceLevel) {
  return dispatchCovenants({
    stdinPayload: JSON.stringify(inputWithArgs({ target: PROTECTED_ENTRY })),
    registrations,
    telemetryPath,
    ...(dispatchEnforce !== undefined && { enforce: dispatchEnforce }),
  });
}

// The cells with no registration level stay pinned by dispatch.test.ts and
// enforce-advise.test.ts; only the composition's own branches are fixtured here. A body
// exiting 1 is a real break throughout.
describe('dispatchCovenants — effective level composes the two axes, lenient wins', () => {
  it("dispatch block (omitted) × registration 'advise' → exit 0 · advised (row 2, THE ticket)", async () => {
    // The session surface has no dispatch level, so a per-entry level is the only way an
    // author can lower one entry.
    const result = await dispatch([registration('soft', 1, { enforce: 'advise' })]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 0, event: 'advised' }]);
    expect(rows()).toEqual([['advised', 'soft', PROTECTED_ENTRY]]);
  });

  it("an upheld body under registration 'advise' lands passed, not advised", async () => {
    // Advise relaxes a break; it does not rename a pass. Recording every verdict as advised
    // would give the consumption rate a denominator that counts upholds as breaks.
    const result = await dispatch([registration('soft', 0, { enforce: 'advise' })]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 0, event: 'passed' }]);
    expect(rows()).toEqual([['passed', 'soft', PROTECTED_ENTRY]]);
  });

  it("dispatch 'advise' × registration 'block' → exit 0 · advised (row 4, the observer's promise stands)", async () => {
    // The decisive cell of lenient-wins: an explicit block entry may NOT raise a surface
    // the observer lowered. A "registration overrides dispatch" implementation passes every
    // other cell and fails only here.
    const result = await dispatch([registration('hard', 1, { enforce: 'block' })], 'advise');

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'hard', exitCode: 0, event: 'advised' }]);
  });
});

describe('dispatchCovenants — the registration level stays on its own registration', () => {
  it('an advise registration lands advised while its enforce-less neighbour in the same dispatch blocks', async () => {
    // One dispatch, two breaks, two different outcomes. A level that leaks from the first
    // registration into the dispatch is a fail-open on every other entry.
    const result = await dispatch([
      registration('soft', 1, { enforce: 'advise' }),
      registration('plain', 1),
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.results).toEqual([
      { label: 'soft', exitCode: 0, event: 'advised' },
      { label: 'plain', exitCode: 2, event: 'blocked' },
    ]);
    expect(rows()).toEqual([
      ['advised', 'soft', PROTECTED_ENTRY],
      ['blocked', 'plain', PROTECTED_ENTRY],
    ]);
  });
});

describe('a registration at advise does not soften an unjudgeable body', () => {
  it('a judge that crashes stays exit 2 · blocked under registration advise', async () => {
    // A crash is not a verdict, so no entry level relaxes it.
    const result = await dispatch([
      {
        label: 'soft',
        protectedPaths: [PROTECTED_ENTRY],
        body: async () => {
          throw new Error('the judge could not run at all');
        },
        enforce: 'advise',
      },
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 2, event: 'blocked' }]);
    expect(rows()).toEqual([['blocked', 'soft', PROTECTED_ENTRY]]);
  });

  it("a body's own fail-closed exit 2 stays exit 2 · blocked under registration advise", async () => {
    // The other unjudgeable shape: a body refusing to judge says so with 2, and the entry's
    // level has no say.
    const result = await dispatch([registration('soft', 2, { enforce: 'advise' })]);

    expect(result.exitCode).toBe(2);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 2, event: 'blocked' }]);
  });

  it('a witness that would open the valve is never consulted: the break lands advised, not witnessed', async () => {
    // The valve stands AFTER a blocked translation, and an advise break never translates to
    // blocked, so a witness answering true has nothing to open. Consulted before the level
    // is applied, the row would read `witnessed` — a human-attributed event nobody
    // performed.
    const result = await dispatch([
      {
        label: 'soft',
        protectedPaths: [PROTECTED_ENTRY],
        body: markerThunk(join(dir, 'body-ran.txt'), 1),
        witness: () => true,
        enforce: 'advise',
      },
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 0, event: 'advised' }]);
    expect(rows()).toEqual([['advised', 'soft', PROTECTED_ENTRY]]);
  });
});

describe('a routing that could not answer stays outside the level axis', () => {
  it('a body-bearing registration at advise whose predicate throws still exits 2 · blocked', async () => {
    // matchRegistrations routes a throwing predicate fail-closed with subject '-', and a
    // body-bearing arm carries that verdict out by judging and breaking. Every compiled
    // entry carries a level, so the dispatcher must not let the entry's advise relax that
    // break: the unjudgeable call would proceed with an `advised` row.
    const throwing: RegistrationWithEnforce = {
      ...registration('uncertain', 1, { enforce: 'advise' }),
      matches: () => {
        throw new Error('predicate could not answer');
      },
    };

    const result = await dispatch([throwing]);

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([['blocked', 'uncertain', '-']]);
  });
});

describe('compileDisciplineRegistrations — entry enforce reaches the body-bearing registration only', () => {
  const ROOT = '/repo';
  const SHELL_TOOL = 'Bash';
  const COMMAND_ARG = 'command';
  const COMMON_SKIP_LABEL = 'shell-unjudgeable';

  function specWith(disciplines: EntryWithEnforce[]): CompileDisciplinesSpec {
    return {
      disciplines,
      rootDir: ROOT,
      shellTools: [SHELL_TOOL],
      commandArgs: [COMMAND_ARG],
      readPreState,
    };
  }

  /** A declare entry — the family that compiles a body arm AND per-entry skip arms. */
  function deltaEntry(enforce?: EnforceLevel): EntryWithEnforce {
    return {
      id: 'no-banned',
      declare: {
        mechanism: 'added-only',
        scope: { source: 'target.path', include: ['^packages/.*\\.ts$'] },
        supply: { pre: 'empty', post: 'empty' },
        extract: {
          before: [
            { op: 'source', of: 'pre' },
            { op: 'lines' },
            { op: 'keyByPattern', re: '(zzz_banned)' },
          ],
          after: [
            { op: 'source', of: 'post' },
            { op: 'lines' },
            { op: 'keyByPattern', re: '(zzz_banned)' },
          ],
          added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
        },
        relate: [
          { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
        ],
      },
      ...(enforce !== undefined && { enforce }),
    } as unknown as EntryWithEnforce;
  }

  function levelsOf(
    regs: CovenantRegistration[],
  ): { label: string; skip: boolean; enforce?: EnforceLevel }[] {
    return regs.map((reg) => ({
      label: reg.label,
      skip: reg.skip !== undefined,
      enforce: (reg as RegistrationWithEnforce).enforce,
    }));
  }

  it("copies enforce: 'advise' onto the entry's body-bearing registration", () => {
    // The wire from config to dispatch: without the copy the schema accepts advise and
    // nothing downstream ever sees it, so the entry keeps blocking against its own config.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry('advise')]));
    const body = levelsOf(regs).find((r) => r.label === 'no-banned' && !r.skip);

    expect(body).toEqual({ label: 'no-banned', skip: false, enforce: 'advise' });
  });

  it("copies enforce: 'block' verbatim — explicit block is distinct from absence on the registration", () => {
    // Explicit block must survive compilation as itself rather than being normalised to
    // absence: absence means advise, so only the explicit value keeps the entry at block.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry('block')]));
    const body = levelsOf(regs).find((r) => r.label === 'no-banned' && !r.skip);

    expect(body).toEqual({ label: 'no-banned', skip: false, enforce: 'block' });
  });

  it("fills enforce: 'advise' on the body-bearing registration when the entry omits it", () => {
    // The default is advise, decided here and nowhere downstream: the dispatcher reads
    // `registration.enforce === 'advise'` and falls back to the surface level otherwise, so
    // an absent field on the registration means block on the session surface. Copying the
    // entry's value as-is leaves every enforce-less discipline blocking.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry()]));
    const body = levelsOf(regs).find((r) => r.label === 'no-banned' && !r.skip);

    expect(body).toEqual({ label: 'no-banned', skip: false, enforce: 'advise' });
  });

  it('fills nothing on the skip arms of an entry that omits the level', () => {
    // The default lands on the body-bearing arm only: a skip arm records the absence of a
    // judgment and sits outside the axis.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry()]));
    const skipArms = levelsOf(regs).filter((r) => r.skip);

    expect(skipArms.length).toBeGreaterThan(0);
    for (const reg of skipArms) {
      expect(reg.enforce, reg.label).toBeUndefined();
    }
  });

  it('fills nothing on the early-return skip arms — a pattern fault and a precedent entry with no transcript', () => {
    // These two arms return before the body composes, on code paths distinct from the
    // appended shell skip arms above. A level on an unjudgeable arm would let the dispatcher
    // relax a routing that could not answer.
    const faulty: EntryWithEnforce = { id: 'bad-pattern', forbidCommand: '(' };
    const precedent: EntryWithEnforce = {
      id: 'needs-read',
      in: ['src/**'],
      requirePrecedent: { command: 'cat ' },
    };
    const regs = compileDisciplineRegistrations(specWith([faulty, precedent]));
    const arms = levelsOf(regs).filter(
      (r) => r.label === 'bad-pattern' || r.label === 'needs-read',
    );

    expect(arms.length).toBeGreaterThan(0);
    for (const reg of arms) {
      expect(reg.skip, reg.label).toBe(true);
      expect(reg.enforce, reg.label).toBeUndefined();
    }
  });

  it('never copies the level onto the skip arms or the common shell-unjudgeable registration', () => {
    // Skip arms record the absence of a judgment, and the common backstop belongs to no
    // entry. Copying the level onto every registration an entry produces would let one
    // entry's advise annotate a row shared by all of them.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry('advise')]));
    const outsideAxis = levelsOf(regs).filter((r) => r.skip || r.label === COMMON_SKIP_LABEL);

    expect(outsideAxis.length).toBeGreaterThan(0);
    for (const reg of outsideAxis) {
      expect(reg.enforce, `${reg.label} (skip=${reg.skip})`).toBeUndefined();
    }
  });
});
