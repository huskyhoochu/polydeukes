import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DisciplineEntry, parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// CONFIG-11 §4.2 / §4.3 — the enforce level gains a second owner. CONFIG-06 gave the
// OBSERVER one level for the whole dispatch (`dispatchCovenants({ enforce })`); this ticket
// gives the AUTHOR one per entry, carried onto the entry's body-bearing registrations as
// `CovenantRegistration.enforce`. The dispatcher composes the two per registration and the
// lenient side wins: effective = (dispatch advise || registration advise) ? advise : block.
// Neither the registration field nor the compiler copy nor the composition exists yet, so
// the advise-bearing cases here are RED by construction; the block-end cases pin what must
// not move. `runCovenant`/`translateExitCode` are untouched — the level value already
// reaches them, only its origin widens.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import { echoToFileScript, inputWithArgs, readTelemetryLines } from './helpers.js';

// ---------------------------------------------------------------------------
// Fixtures. `enforce` is on neither shipped type yet, so both are widened here — the
// file compiles today and every assertion stays a runtime failure. Protected entries,
// tool names, and command-arg names are injected values, never source literals.
// ---------------------------------------------------------------------------

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
    body: { command: process.execPath, args: ['-e', `process.exit(${bodyExitCode})`] },
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

// ===========================================================================
// §4.2 — the composition table, one row per case (body exit 1 = a real break)
// ===========================================================================

// Rows 1 and 3 of the table (no registration level) are the CONFIG-06 cells and stay
// pinned by dispatch.test.ts and enforce-advise.test.ts; only the two cells this ticket's
// composition adds a branch for are fixtured here.
describe('CONFIG-11 §4.2 dispatchCovenants — effective level composes the two axes, lenient wins', () => {
  it("dispatch block (omitted) × registration 'advise' → exit 0 · advised (row 2, THE ticket)", async () => {
    // The session surface has no dispatch level, so this is the only way an author can
    // lower one entry. Mutation caught: the registration field accepted but never read
    // by the dispatcher (stays exit 2 · blocked), or read but mislabeled passed.
    const result = await dispatch([registration('soft', 1, { enforce: 'advise' })]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 0, event: 'advised' }]);
    expect(rows()).toEqual([['advised', 'soft', PROTECTED_ENTRY]]);
  });

  it("an upheld body under registration 'advise' lands passed, not advised", async () => {
    // advise relaxes a break; it does not rename a pass. Mutation caught: the advise
    // registration recording every verdict as advised (a consumption-rate denominator
    // that counts upholds as breaks).
    const result = await dispatch([registration('soft', 0, { enforce: 'advise' })]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 0, event: 'passed' }]);
    expect(rows()).toEqual([['passed', 'soft', PROTECTED_ENTRY]]);
  });

  it("dispatch 'advise' × registration 'block' → exit 0 · advised (row 4, the observer's promise stands)", async () => {
    // The lenient-wins rule's decisive cell: an explicit block entry may NOT raise a
    // surface the observer lowered. A "registration overrides dispatch" implementation
    // passes rows 1–3 and fails only here. Mutation caught: precedence instead of
    // composition (registration value taken whenever present).
    const result = await dispatch([registration('hard', 1, { enforce: 'block' })], 'advise');

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'hard', exitCode: 0, event: 'advised' }]);
  });
});

// ===========================================================================
// §4.3 — the axis is per registration, not per dispatch
// ===========================================================================

describe('CONFIG-11 §4.3 dispatchCovenants — the registration level stays on its own registration', () => {
  it('an advise registration lands advised while its enforce-less neighbour in the same dispatch blocks', async () => {
    // AC-2's proof that the axis is per registration: one dispatch, two breaks, two
    // different outcomes. Mutation caught: the first registration's level leaking into
    // the dispatch (neighbour also advised → overall exit 0, a fail-open on every other
    // entry), or the level applied to none (the advise entry blocks too).
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

// ===========================================================================
// AC-3 — advise relaxes the verdict only; the unjudgeable stays blocked (CONFIG-06b)
// ===========================================================================

describe('CONFIG-11 AC-3 — a registration at advise does not soften an unjudgeable body', () => {
  it('a body that cannot be spawned stays exit 2 · blocked under registration advise', async () => {
    // Invariant 1: spawn failure is not a verdict. Mutation caught: the registration
    // level threaded into a branch that treats "any non-zero / null" as relaxable.
    const result = await dispatch([
      {
        label: 'soft',
        protectedPaths: [PROTECTED_ENTRY],
        body: { command: join(dir, 'no-such-judge-executable'), args: [] },
        enforce: 'advise',
      },
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 2, event: 'blocked' }]);
    expect(rows()).toEqual([['blocked', 'soft', PROTECTED_ENTRY]]);
  });

  it("a body's own fail-closed exit 2 stays exit 2 · blocked under registration advise", async () => {
    // Invariant 1, the other unjudgeable shape: a body refusing to judge says so with 2,
    // and the entry's level has no say. Mutation caught: the composition relaxing exit 2
    // the way it relaxes exit 1.
    const result = await dispatch([registration('soft', 2, { enforce: 'advise' })]);

    expect(result.exitCode).toBe(2);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 2, event: 'blocked' }]);
  });

  it('a witness that would open the valve is never consulted: the break lands advised, not witnessed', async () => {
    // §4.3 valve idleness: the valve stands AFTER a blocked translation (COVENANT-17), and
    // an advise break never translates to blocked, so a witness answering true has
    // nothing to open. Mutation caught: the witness consulted before the level is
    // applied (row reads witnessed — a human-attributed event nobody performed), or the
    // level applied after the witness rewrote the event.
    const result = await dispatch([
      {
        label: 'soft',
        protectedPaths: [PROTECTED_ENTRY],
        body: { command: process.execPath, args: echoToFileScript(join(dir, 'body-ran.txt'), 1) },
        witness: () => true,
        enforce: 'advise',
      },
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toEqual([{ label: 'soft', exitCode: 0, event: 'advised' }]);
    expect(rows()).toEqual([['advised', 'soft', PROTECTED_ENTRY]]);
  });
});

// ===========================================================================
// §4.3 — compileDisciplineRegistrations copies the entry level onto body-bearing arms
// ===========================================================================

describe('POSTURE-01 review [1] — a routing that could not answer stays outside the level axis', () => {
  it('a body-bearing registration at advise whose predicate throws still exits 2 · blocked', async () => {
    // matchRegistrations routes a throwing predicate fail-closed with subject '-', and a
    // body-bearing arm carries that verdict out by spawning and breaking. Since every
    // compiled entry now carries a level, the dispatcher must not let the entry's advise
    // relax that break — the unjudgeable call would proceed with an `advised` row, the
    // fail-open class. Mutation caught: `effectiveEnforce` ignoring `routingFailed`.
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

describe('CONFIG-11 §4.3 compileDisciplineRegistrations — entry enforce reaches the body-bearing registration only', () => {
  const ROOT = '/repo';
  const SHELL_TOOL = 'Bash';
  const COMMAND_ARG = 'command';
  const COMMON_SKIP_LABEL = 'shell-unjudgeable';

  function specWith(disciplines: EntryWithEnforce[]): CompileDisciplinesSpec {
    return {
      disciplines,
      rootDir: ROOT,
      bodyCommand: '/usr/bin/node',
      bodyModulePath: '/repo/discipline-body.js',
      shellTools: [SHELL_TOOL],
      commandArgs: [COMMAND_ARG],
    };
  }

  /** A delta entry (the family that compiles a body arm AND per-entry skip arms). */
  function deltaEntry(enforce?: EnforceLevel): EntryWithEnforce {
    return {
      id: 'no-banned',
      in: ['packages/**/*.ts'],
      forbid: 'zzz_banned',
      ...(enforce !== undefined && { enforce }),
    };
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
    // The wire from config to dispatch. Mutation caught: the compiler building the
    // registration without the field — the schema accepts advise and nothing downstream
    // ever sees it, so the entry keeps blocking with a config that says otherwise.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry('advise')]));
    const body = levelsOf(regs).find((r) => r.label === 'no-banned' && !r.skip);

    expect(body).toEqual({ label: 'no-banned', skip: false, enforce: 'advise' });
  });

  it("copies enforce: 'block' verbatim — explicit block is distinct from absence on the registration", () => {
    // The ladder's fixed rung must survive compilation as itself, not be normalised to
    // absence: POSTURE-01 flips the default and only the explicit value keeps the entry
    // at block. Mutation caught: the copy gated on `=== 'advise'`.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry('block')]));
    const body = levelsOf(regs).find((r) => r.label === 'no-banned' && !r.skip);

    expect(body).toEqual({ label: 'no-banned', skip: false, enforce: 'block' });
  });

  it("fills enforce: 'advise' on the body-bearing registration when the entry omits it (POSTURE-01 §4.1)", () => {
    // The default rung is advise, decided here and nowhere downstream: the dispatcher
    // reads `registration.enforce === 'advise'` and falls back to the surface level
    // otherwise, so an absent field on the registration means block on the session
    // surface. Mutation caught: the compiler copying the entry's value as-is (absence
    // stays absence → every enforce-less discipline keeps blocking), or defaulting to
    // 'block'.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry()]));
    const body = levelsOf(regs).find((r) => r.label === 'no-banned' && !r.skip);

    expect(body).toEqual({ label: 'no-banned', skip: false, enforce: 'advise' });
  });

  it('fills nothing on the skip arms of an entry that omits the level', () => {
    // POSTURE-01 AC-1: the default lands on the body-bearing arm only — a skip arm
    // records the absence of a judgment and sits outside the axis. Mutation caught: the
    // `?? 'advise'` fill applied at the registration factory shared by every arm.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry()]));
    const skipArms = levelsOf(regs).filter((r) => r.skip);

    expect(skipArms.length).toBeGreaterThan(0);
    for (const reg of skipArms) {
      expect(reg.enforce, reg.label).toBeUndefined();
    }
  });

  it('fills nothing on the early-return skip arms — a pattern fault and a precedent entry with no transcript', () => {
    // POSTURE-01 §4.3 remnant 5: these two arms return before the body composes
    // (`patternFault` and the unjudgeable precedent outcome), on code paths distinct from
    // the appended shell skip arms above. Mutation caught: the fill hoisted onto the
    // shared `routing` object or the top of the map — a level on an unjudgeable arm would
    // let the dispatcher relax a routing that could not answer, the fail-open direction.
    const faulty: EntryWithEnforce = { id: 'bad-pattern', in: ['src/**'], forbid: '(' };
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
    // Skip arms record the absence of a judgment and the common backstop belongs to no
    // entry; a level on either is outside the axis. Mutation caught: the copy applied
    // to every registration the entry produces rather than the body-bearing one — which
    // would let one entry's advise annotate a row shared by all entries.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry('advise')]));
    const outsideAxis = levelsOf(regs).filter((r) => r.skip || r.label === COMMON_SKIP_LABEL);

    expect(outsideAxis.length).toBeGreaterThan(0);
    for (const reg of outsideAxis) {
      expect(reg.enforce, `${reg.label} (skip=${reg.skip})`).toBeUndefined();
    }
  });
});
