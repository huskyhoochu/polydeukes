import type {
  CanonicalTranscript,
  CovenantInput,
  DisciplineEntry,
  FileChange,
} from '@polydeukes/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Evidence evaluation yields THREE results, not two: found, missing, and unjudgeable. An
// unjudgeable entry compiles into a SKIP registration — no body, so the dispatcher records
// one `skipped` rather than judging. Assembly never throws: one entry's failure would
// otherwise take every registration and the witness valve down with it, leaving no
// in-session recovery.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';

const ROOT = '/repo';

/** Stub the canonical-transcript seam with a fixed tool-call history. */
function transcriptWithToolCalls(
  calls: { name: string; args: Record<string, unknown> }[],
): CanonicalTranscript {
  return {
    findUserMessages: () => [],
    findToolCalls: (name?: string) =>
      name === undefined ? calls : calls.filter((c) => c.name === name),
  } as unknown as CanonicalTranscript;
}

function contextSpec(
  disciplines: DisciplineEntry[],
  extra: Record<string, unknown> = {},
): CompileDisciplinesSpec {
  return {
    disciplines,
    rootDir: ROOT,
    shellTools: ['Bash'],
    commandArgs: ['command'],
    readPreState: () => null,
    ...extra,
  } as CompileDisciplinesSpec;
}

const commandEntry = {
  id: 'dep-needs-view',
  in: ['pkg/**'],
  when: 'needs-precedent',
  requirePrecedent: { command: 'npm view ' },
} as DisciplineEntry;

const typoEntry = {
  id: 'typo-vocabulary',
  in: ['sacred/**'],
  requirePrecedent: { subagnet: 'planner' },
} as DisciplineEntry;

/** A skip registration carries a reason and no body — the dispatcher never spawns it. */
function expectSkip(registration: { skip?: { reason: string }; body?: unknown }): void {
  expect(registration.skip).toBeDefined();
  expect(registration.body).toBeUndefined();
}

afterEach(() => {
  vi.restoreAllMocks();
});

// The five unjudgeable causes. None of them throws; all of them skip.
describe('compileDisciplineRegistrations — unjudgeable evidence compiles to a skip registration', () => {
  it('skips when the evaluator does not recognize the evidence key', () => {
    // A throw here took down every sibling registration AND the witness valve, so a single
    // typo left no way to edit the config that caused it.
    const [registration] = compileDisciplineRegistrations(
      contextSpec([typoEntry], {
        transcript: transcriptWithToolCalls([]),
        evaluatePrecedent: () => undefined,
      }),
    );

    expectSkip(registration);
  });

  it('skips QUIETLY when no evaluator is injected — the surface cannot speak the vocabulary', () => {
    // Not an author's mistake. A surface that does not speak adapter vocabulary declines to
    // supply an evaluator, and `pdks covenant check` never supplies one — announcing it
    // would put a line on stderr for every commit. Merging this into the loud config-fault
    // branch is what makes that happen.
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const [registration] = compileDisciplineRegistrations(
      contextSpec([typoEntry], { transcript: transcriptWithToolCalls([]) }),
    );

    expectSkip(registration);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('skips on a non-compilable requirePrecedent.command pattern', () => {
    const broken = {
      id: 'broken-evidence',
      in: ['pkg/**'],
      requirePrecedent: { command: '(' },
    } as DisciplineEntry;

    const [registration] = compileDisciplineRegistrations(
      contextSpec([broken], { transcript: transcriptWithToolCalls([]) }),
    );

    expectSkip(registration);
  });

  it('skips command evidence when a transcript exists but the shell surface is empty', () => {
    // With a session to read but no surface to read it through, command evidence can never
    // be found, so answering `missing` would forge a block with no pass path.
    for (const emptySurface of [{ shellTools: [] }, { commandArgs: [] }]) {
      const [registration] = compileDisciplineRegistrations(
        contextSpec([commandEntry], {
          transcript: transcriptWithToolCalls([]),
          ...emptySurface,
        }),
      );

      expectSkip(registration);
    }
  });

  it('skips when no transcript is injected at all', () => {
    // The session surface's absent transcript and the commit surface's absent evidence
    // channel are the same fact, so they get the same disposition.
    const [registration] = compileDisciplineRegistrations(contextSpec([commandEntry]));

    expectSkip(registration);
  });
});

describe('compileDisciplineRegistrations — a non-compilable pattern skips in every family', () => {
  // Every family reaches assembly through the same door, so confining the skip disposition
  // to the context family leaves the other three able to take the whole assembly down.
  const brokenByFamily: [string, DisciplineEntry][] = [
    ['forbid', { id: 'bad-forbid', in: ['pkg/**'], forbid: '(' } as DisciplineEntry],
    ['forbidCommand', { id: 'bad-command', forbidCommand: '(' } as unknown as DisciplineEntry],
    [
      'when',
      {
        id: 'bad-when',
        in: ['pkg/**'],
        when: '(',
        requirePrecedent: { command: 'npm view ' },
      } as DisciplineEntry,
    ],
  ];

  for (const [family, entry] of brokenByFamily) {
    it(`skips a ${family} entry whose pattern does not compile`, () => {
      const [registration] = compileDisciplineRegistrations(
        contextSpec([entry], { transcript: transcriptWithToolCalls([]) }),
      );

      expectSkip(registration);
    });
  }
});

describe('compileDisciplineRegistrations — a skip registration stays a first-class registration', () => {
  it('keeps its routing predicate so an out-of-scope change never reaches it', () => {
    const [registration] = compileDisciplineRegistrations(contextSpec([commandEntry]));

    expectSkip(registration);
    expect(registration.matches).toBeDefined();
    expect(registration.label).toBe('dep-needs-view');
  });

  it('carries the witness like any other registration', () => {
    // Not because a skip needs witnessing — the dispatcher answers `skipped` before it ever
    // reaches the witness — but because a uniform registration shape is what lets the
    // dispatcher treat skips as ordinary matches rather than a second kind.
    const witness = () => true;
    const [registration] = compileDisciplineRegistrations(contextSpec([commandEntry], { witness }));

    expectSkip(registration);
    expect(registration.witness).toBe(witness);
  });

  it('leaves every sibling entry judged as usual', () => {
    // Isolation in the direction that matters: one bad entry must cost only itself.
    const sibling = { id: 'no-todo', in: ['pkg/**'], forbid: 'TODO' } as DisciplineEntry;

    const registrations = compileDisciplineRegistrations(
      contextSpec([typoEntry, sibling], { transcript: transcriptWithToolCalls([]) }),
    );

    expectSkip(registrations[0]);
    expect((registrations[1] as { skip?: unknown }).skip).toBeUndefined();
    expect(typeof registrations[1].body).toBe('function');
  });
});

describe('compileDisciplineRegistrations — a configuration fault names itself on stderr', () => {
  it('writes the entry id and the cause when the evidence vocabulary is unrecognized', () => {
    // A silent skip is how a discipline goes inert while its verdict still reads passed.
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    compileDisciplineRegistrations(
      contextSpec([typoEntry], {
        transcript: transcriptWithToolCalls([]),
        evaluatePrecedent: () => undefined,
      }),
    );

    const written = stderr.mock.calls.map((call) => String(call[0])).join('');
    expect(written).toContain('typo-vocabulary');
    expect(written).toMatch(/subagnet/);
  });

  it('stays silent when the cause is an absent session rather than a misconfiguration', () => {
    // An environment fact is not the author's mistake; warning on every sessionless
    // assembly would train the reader to ignore the channel that carries real faults.
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const [registration] = compileDisciplineRegistrations(contextSpec([commandEntry]));

    expectSkip(registration);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('compileDisciplineRegistrations — an entry no family judges', () => {
  /** A CovenantInput whose single call is one create of `path`, so the body has a world to see. */
  function inputWithOneCreate(path: string): CovenantInput {
    return {
      toolCalls: [
        {
          name: 'call-0',
          args: { file_path: path },
          fileChange: { kind: 'create', path, post: 'content' } satisfies FileChange,
        },
      ],
      subagentSpawns: [],
      userMessages: [],
    };
  }

  it('an entry core admits but no family judges is unjudgeable, not upheld', async () => {
    // Core's predicate enumeration and covenant's family list are two lists kept in step by
    // hand. An entry carrying no predicate key reaches the judge with nothing to judge it, and
    // a fallback that answers `upheld` there is a `passed` row no judgment ever produced.
    const orphan = { id: 'orphan-family' } as unknown as DisciplineEntry;

    const registration = compileDisciplineRegistrations(contextSpec([orphan]))[0];

    // Judged as unjudgeable, not skipped: a skip registration has no body to fold into 2.
    if (registration?.body === undefined) {
      throw new Error('an orphan entry must compile to a judged registration, not a skip');
    }
    expect(registration.skip).toBeUndefined();
    // The probe must route, or the body below is never spawned in production and this
    // assertion proves nothing about it.
    expect(registration.matches?.(inputWithOneCreate('src/a.ts'))).toBeTypeOf('string');
    const outcome = (await registration.body(inputWithOneCreate('src/a.ts'))) as {
      exitCode: number;
    };
    expect(outcome.exitCode).toBe(2);
  });
});
