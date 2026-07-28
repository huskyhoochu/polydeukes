import type { CanonicalTranscript, DisciplineEntry } from '@polydeukes/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
// COVENANT-13 §4.5 (revised 2026-07-26) — evaluation yields THREE results, not two:
// found, missing, and unjudgeable. An unjudgeable entry compiles into a SKIP
// registration: no body, so the dispatcher records one `skipped` instead of spawning.
// Assembly never throws — one entry's failure used to take down every registration and
// the witness valve with it, leaving no in-session recovery.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';

const ROOT = '/repo';

/** Stub the canonical-transcript seam with a fixed tool-call history. */
function transcriptWithToolCalls(
  calls: { name: string; args: Record<string, unknown> }[],
): CanonicalTranscript {
  return {
    findSubagentInvocations: () => [],
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
    bodyCommand: '/usr/bin/node',
    bodyModulePath: '/repo/discipline-body.js',
    shellTools: ['Bash'],
    commandArgs: ['command'],
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

// ===========================================================================
// The five unjudgeable causes. None of them throws; all of them skip.
// ===========================================================================

describe('compileDisciplineRegistrations — unjudgeable evidence compiles to a skip registration', () => {
  it('skips when the evaluator does not recognize the evidence key', () => {
    // Was a throw. The throw took down every sibling registration AND the witness valve,
    // so a single typo left no way to edit the config that caused it.
    const [registration] = compileDisciplineRegistrations(
      contextSpec([typoEntry], {
        transcript: transcriptWithToolCalls([]),
        evaluatePrecedent: () => undefined,
      }),
    );

    expectSkip(registration);
  });

  it('skips QUIETLY when no evaluator is injected — the surface cannot speak the vocabulary', () => {
    // Not an author's mistake. A surface that does not speak adapter vocabulary declines
    // to supply an evaluator, and `pdks covenant check` never supplies one — announcing
    // it would put a line on stderr for every commit. Mutation caught: this case merged
    // back into the loud configFault branch, which is what the repo actually observed the
    // day it first configured a `tool` entry.
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
    // With a session to read but no surface to read it through, command evidence can
    // never be found. Transporting `missing` would forge a block with no pass path.
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
    // channel are the same fact, so they now get the same disposition. This is the
    // asymmetry that produced eleven of the third review's fifteen findings.
    const [registration] = compileDisciplineRegistrations(contextSpec([commandEntry]));

    expectSkip(registration);
  });
});

describe('compileDisciplineRegistrations — a non-compilable pattern skips in every family', () => {
  // Containing only the context family left the other three able to take down the whole
  // assembly through the same door (third review F13).
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

// ===========================================================================
// What a skip registration must keep, and what it must not disturb.
// ===========================================================================

describe('compileDisciplineRegistrations — a skip registration stays a first-class registration', () => {
  it('keeps its routing predicate so an out-of-scope change never reaches it', () => {
    const [registration] = compileDisciplineRegistrations(contextSpec([commandEntry]));

    expectSkip(registration);
    expect(registration.matches).toBeDefined();
    expect(registration.label).toBe('dep-needs-view');
  });

  it('carries the witness like any other registration', () => {
    // Not because a skip needs witnessing — the dispatcher answers `skipped` before it ever
    // reaches the witness — but because the registration shape stays uniform, which is what
    // lets the dispatcher treat skips as ordinary matches rather than a second kind.
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
    expect(registrations[1].body?.args).toBeDefined();
  });
});

describe('compileDisciplineRegistrations — a configuration fault names itself on stderr', () => {
  it('writes the entry id and the cause when the evidence vocabulary is unrecognized', () => {
    // A silent skip is how a discipline goes inert while its verdict still reads passed —
    // the failure this project already shipped once with a `^` anchor.
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
