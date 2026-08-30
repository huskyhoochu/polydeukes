import type {
  CanonicalTranscript,
  CovenantInput,
  DisciplineEntry,
  FileChange,
} from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// The context discipline family (`requirePrecedent`): a trigger-matched mutation breaks
// unless session evidence preceded it. Evidence is evaluated at assembly time and reaches
// `judgeDiscipline` as opts.precedentFound.
import {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  type JudgeDisciplineSpec,
  judgeDiscipline,
} from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// The `when` trigger pattern is a plain token so the added-direction delta is unambiguous
// in every fixture.

const ROOT = '/repo';

const judgeOpts: Omit<JudgeDisciplineSpec, 'entry' | 'input'> = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
};

/** judgeOpts extended with the precedentFound option. */
function withPrecedent(found: boolean): Omit<JudgeDisciplineSpec, 'entry' | 'input'> {
  return { ...judgeOpts, precedentFound: found };
}

/** A context-family entry WITH a `when` trigger. */
const whenEntry: DisciplineEntry = {
  id: 'dep-needs-view',
  in: ['pkg/**'],
  when: 'needs-precedent',
  requirePrecedent: { command: 'npm view ' },
} as DisciplineEntry;

/** A context-family entry WITHOUT `when` — every in-scope mutation is the trigger. */
const anyMutationEntry: DisciplineEntry = {
  id: 'consult-before-touch',
  in: ['sacred/**'],
  requirePrecedent: { command: 'npm view ' },
} as DisciplineEntry;

/** Build a CovenantInput whose evidence rides its own tool-call element. */
function inputWithEvidence(changes: FileChange[]): CovenantInput {
  return {
    toolCalls: changes.map((fileChange, index) => ({
      name: `call-${index}`,
      args: { file_path: fileChange.path },
      fileChange,
    })),
    subagentSpawns: [],
    userMessages: [],
  };
}

/** A modify in `pkg/**` that ADDS a line matching the `when` trigger. */
function triggeredInput(): CovenantInput {
  return inputWithEvidence([
    { kind: 'modify', path: 'pkg/dep.json', pre: 'left: 1;', post: 'left: 1;\nneeds-precedent;' },
  ]);
}

// `succeeded` is stated on every call fixture below because a successful execution is part
// of what evidence means: an outcome-less call is refused before any pattern is consulted,
// which would let each negative here pass for the wrong reason. The outcome axis itself is
// pinned in discipline-precedent-anchor.test.ts.
type TranscriptToolCallish = { name: string; args: Record<string, unknown>; succeeded?: boolean };

/** Stub the canonical-transcript seam with a fixed tool-call history. */
function transcriptWithToolCalls(calls: TranscriptToolCallish[]): CanonicalTranscript {
  return {
    findSubagentInvocations: () => [],
    findUserMessages: () => [],
    findToolCalls: (name?: string) =>
      name === undefined ? calls : calls.filter((c) => c.name === name),
  } as unknown as CanonicalTranscript;
}

/** Compile-spec base; `extra` carries the transcript / evaluatePrecedent seams. */
function contextSpec(
  disciplines: DisciplineEntry[],
  extra: Record<string, unknown> = {},
): CompileDisciplinesSpec {
  return {
    disciplines,
    rootDir: ROOT,
    shellTools: ['Bash'],
    commandArgs: ['command'],
    ...extra,
  } as CompileDisciplinesSpec;
}

/**
 * The evidence decision the compiled thunk carries, read from the verdict it answers for a
 * call that FIRES the entry's trigger — an out-of-scope input never triggers, and an
 * untriggered entry upholds, which would read as `found` whatever the seam answered.
 */
async function precedentDecision(
  reg: CovenantRegistration,
  input: CovenantInput = triggeredInput(),
): Promise<'found' | 'missing'> {
  const outcome = await reg.body?.(input);
  return outcome?.exitCode === 0 ? 'found' : 'missing';
}

describe('judgeDiscipline — requirePrecedent context family', () => {
  it('breaks a trigger-matched edit without evidence, naming id, path, and required evidence', () => {
    // The reason must carry the discipline id, the matched path, and the evidence being
    // demanded — those three are what tells the reader how to get through the gate.
    const verdict = judgeDiscipline({
      ...withPrecedent(false),
      entry: whenEntry,
      input: triggeredInput(),
    });

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('dep-needs-view');
      expect(verdict.reason).toContain('pkg/dep.json');
      expect(verdict.reason).toContain('npm view');
    }
  });

  it('upholds the same trigger-matched edit when precedentFound is true', () => {
    // The evidence flag is the ONLY thing separating this fixture from the break above.
    // Ignoring it makes the family block every matched edit — a gate with no way through.
    expect(
      judgeDiscipline({ ...withPrecedent(true), entry: whenEntry, input: triggeredInput() }),
    ).toEqual({
      upheld: true,
    });
  });

  it('treats an unspecified precedentFound as missing evidence (breaks)', () => {
    // The rule is `precedentFound !== true`: an assembly that forgets the option must land
    // on the blocking side, never on a silent fail-open.
    expect(
      judgeDiscipline({ ...judgeOpts, entry: whenEntry, input: triggeredInput() }).upheld,
    ).toBe(false);
  });
});

describe('judgeDiscipline — requirePrecedent trigger non-match', () => {
  it('upholds an out-of-scope edit regardless of missing evidence', () => {
    // Dropping the `in` glob turns a scoped entry into a global gate.
    const input = inputWithEvidence([
      { kind: 'modify', path: 'docs/dep.json', pre: 'a;', post: 'a;\nneeds-precedent;' },
    ]);

    expect(judgeDiscipline({ ...withPrecedent(false), entry: whenEntry, input: input })).toEqual({
      upheld: true,
    });
  });

  it('upholds an in-scope edit whose added lines do not match when', () => {
    // An unrelated in-scope edit is not the declared trigger; without the `when` test every
    // in-scope edit would be judged.
    const input = inputWithEvidence([
      { kind: 'modify', path: 'pkg/dep.json', pre: 'a;', post: 'a;\nunrelated;' },
    ]);

    expect(judgeDiscipline({ ...withPrecedent(false), entry: whenEntry, input: input })).toEqual({
      upheld: true,
    });
  });

  it('upholds a debt-only edit — when matches pre content but nothing added matches', () => {
    // The trigger is evaluated against the added delta, not the full post: a file already
    // carrying the token, edited without adding one, must pass, or every later edit to a
    // matched file demands fresh evidence forever.
    const input = inputWithEvidence([
      {
        kind: 'modify',
        path: 'pkg/dep.json',
        pre: 'needs-precedent;',
        post: 'needs-precedent;\nunrelated;',
      },
    ]);

    expect(judgeDiscipline({ ...withPrecedent(false), entry: whenEntry, input: input })).toEqual({
      upheld: true,
    });
  });
});

// The modify arm of this matrix is covered by the reason-shape test above, which judges
// the very same triggeredInput() fixture.
describe('judgeDiscipline — when-present trigger kind disposition', () => {
  it('create: the whole post is added, so a matching post triggers (breaks without evidence)', () => {
    // Pre-less evidence feeds the added direction as all-added; skipping the create arm
    // leaves a hole at first authorship.
    const input = inputWithEvidence([
      { kind: 'create', path: 'pkg/new.json', post: 'needs-precedent;' },
    ]);

    expect(
      judgeDiscipline({ ...withPrecedent(false), entry: whenEntry, input: input }).upheld,
    ).toBe(false);
  });

  it('delete: never triggers a when entry — deletion adds no content (upholds without evidence)', () => {
    // The pre is deliberately FULL of trigger matches, yet a `when` entry judges the added
    // direction only. Feeding pre as post makes every deletion of a matched file demand
    // evidence the entry never asked for.
    const input = inputWithEvidence([
      { kind: 'delete', path: 'pkg/dep.json', pre: 'needs-precedent;\nneeds-precedent;' },
    ]);

    expect(judgeDiscipline({ ...withPrecedent(false), entry: whenEntry, input: input })).toEqual({
      upheld: true,
    });
  });
});

describe('judgeDiscipline — when-absent trigger kind disposition', () => {
  it('create in scope triggers without when (breaks without evidence)', () => {
    // An absent `when` means every in-scope mutation is the trigger, creation included;
    // defaulting to "trigger nothing" leaves the entry inert.
    const input = inputWithEvidence([{ kind: 'create', path: 'sacred/x.ts', post: 'seed' }]);

    expect(
      judgeDiscipline({ ...withPrecedent(false), entry: anyMutationEntry, input: input }).upheld,
    ).toBe(false);
  });

  it('modify in scope triggers without when (breaks without evidence)', () => {
    // A when-absent entry routed through the delta path with an undefined pattern would
    // throw or uphold blanket.
    const input = inputWithEvidence([
      { kind: 'modify', path: 'sacred/x.ts', pre: 'old', post: 'new' },
    ]);

    expect(
      judgeDiscipline({ ...withPrecedent(false), entry: anyMutationEntry, input: input }).upheld,
    ).toBe(false);
  });

  it('delete in scope triggers without when — erasing without precedent is judged (breaks)', () => {
    // A when-absent context entry covers deletion too, and needs no pre baseline. Excluding
    // the delete kind opens a fail-open erase channel around the whole family.
    const input = inputWithEvidence([{ kind: 'delete', path: 'sacred/x.ts' }]);

    expect(
      judgeDiscipline({ ...withPrecedent(false), entry: anyMutationEntry, input: input }).upheld,
    ).toBe(false);
  });
});

describe('judgeDiscipline — precedentFound does not leak into other families', () => {
  it('existing family verdicts ignore the precedentFound option in both directions', () => {
    // The option can neither open nor close the other families' gates: consulted in the
    // shared judged body, true would wave a forbid break through and false would break a
    // debt-only uphold.
    const forbidHex: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
    const breaking = inputWithEvidence([
      { kind: 'modify', path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);
    const debtOnly = inputWithEvidence([
      { kind: 'modify', path: 'src/a.css', pre: 'a: #123456;', post: 'a: #123456;\nm: 0;' },
    ]);

    expect(
      judgeDiscipline({ ...withPrecedent(true), entry: forbidHex, input: breaking }).upheld,
    ).toBe(false);
    expect(judgeDiscipline({ ...withPrecedent(false), entry: forbidHex, input: debtOnly })).toEqual(
      { upheld: true },
    );

    const forbidCmd: DisciplineEntry = { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=0\\b' };
    const cmdInput: CovenantInput = {
      toolCalls: [{ name: 'Bash', args: { command: 'LEFTHOOK=0 git push' } }],
      subagentSpawns: [],
      userMessages: [],
    };

    expect(
      judgeDiscipline({ ...withPrecedent(true), entry: forbidCmd, input: cmdInput }).upheld,
    ).toBe(false);
  });
});

describe('compileDisciplineRegistrations — command evidence transport', () => {
  it('transports --precedent-found when a shell tool call command matches the pattern', async () => {
    // No evaluatePrecedent is injected: the compiler owns the command vocabulary itself, so
    // delegating `command` to the absent seam would throw.
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { command: 'npm view react version' }, succeeded: true },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(await precedentDecision(reg)).toBe('found');
  });

  it('transports --precedent-missing when no shell command matches', async () => {
    // Unrelated shell history is not evidence; without the pattern test any Bash call at
    // all would count as found.
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { command: 'git status' }, succeeded: true },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(await precedentDecision(reg)).toBe('missing');
  });

  it('ignores a matching command on a tool outside shellTools (not evidence)', async () => {
    // findToolCalls returns every call, so the compiler must re-filter by the injected
    // shellTools before reading command args — otherwise any tool whose args happen to
    // carry the string opens the gate.
    const transcript = transcriptWithToolCalls([
      { name: 'NotShell', args: { command: 'npm view react version' }, succeeded: true },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(await precedentDecision(reg)).toBe('missing');
  });

  it('ignores a matching value under an arg name outside commandArgs (not evidence)', async () => {
    // Only the injected commandArgs names carry a command string: scanning every arg value
    // of a shell call lets a mention in an unrelated arg forge the evidence.
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { script: 'npm view react version' }, succeeded: true },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(await precedentDecision(reg)).toBe('missing');
  });

  it('matches the command as a regex, not a substring', async () => {
    // The command string matches the pattern as a REGEX, the same as forbidCommand: under
    // String.includes this alternation would never find evidence.
    const regexEntry = {
      id: 'dep-needs-view',
      in: ['pkg/**'],
      when: 'needs-precedent',
      requirePrecedent: { command: 'npm (view|info) ' },
    } as DisciplineEntry;
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { command: 'npm info react' }, succeeded: true },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([regexEntry], { transcript }));

    expect(await precedentDecision(reg)).toBe('found');
  });

  // A sessionless assembly produces a skip registration rather than transporting `missing`;
  // that is pinned in discipline-unjudgeable.test.ts.
});

describe('compileDisciplineRegistrations — adapter evidence via the injected seam', () => {
  const subagentEntry = {
    id: 'plan-before-touch',
    in: ['sacred/**'],
    requirePrecedent: { subagent: 'planner' },
  } as DisciplineEntry;

  /** A change inside THIS entry's scope, so its trigger actually fires. */
  const sacredInput = inputWithEvidence([
    { kind: 'create', path: 'sacred/altar.ts', post: 'export const x = 1;\n' },
  ]);

  it('transports --precedent-found when the evaluator affirms, passing the evidence verbatim', async () => {
    // A non-command key goes to the injected evaluator, which receives the ENTRY'S evidence
    // object rather than the whole entry.
    const seen: Record<string, unknown>[] = [];
    const evaluatePrecedent = (evidence: Record<string, unknown>) => {
      seen.push(evidence);
      return evidence.subagent === 'planner';
    };
    const [reg] = compileDisciplineRegistrations(
      contextSpec([subagentEntry], {
        transcript: transcriptWithToolCalls([]),
        evaluatePrecedent,
      }),
    );

    expect(await precedentDecision(reg, sacredInput)).toBe('found');
    expect(seen).toEqual([{ subagent: 'planner' }]);
  });

  it('transports --precedent-missing when the evaluator denies', async () => {
    // False from the seam must land as missing, never be merged with undefined: the two
    // mean "no evidence" and "vocabulary unrecognized", and merging them makes a legitimate
    // no-evidence answer unjudgeable.
    const [reg] = compileDisciplineRegistrations(
      contextSpec([subagentEntry], {
        transcript: transcriptWithToolCalls([]),
        evaluatePrecedent: () => false,
      }),
    );

    expect(await precedentDecision(reg, sacredInput)).toBe('missing');
  });
});

// An unresolvable evidence spec becomes a skip registration rather than a throw, pinned in
// discipline-unjudgeable.test.ts: a throw took every sibling registration and the witness
// valve down with it.

describe('compileDisciplineRegistrations — requirePrecedent matches routes on trigger only', () => {
  it('routes a trigger-matched input even when the evidence was found (observation, not waste)', () => {
    // Found evidence must NOT suppress the route: the body runs and records `passed`, which
    // is the family's measurement value. An optimization that skips the judgment when
    // evidence exists erases the gate's checks from the telemetry record.
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { command: 'npm view react version' }, succeeded: true },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(reg.matches?.(triggeredInput())).toBe('pkg/dep.json');
  });

  it('returns null for out-of-scope and when-nonmatching inputs', () => {
    // A transcript is injected so this compiles to a body-bearing registration: without one
    // the entry becomes a skip, and the routing suite would only ever exercise registrations
    // the dispatcher never runs.
    const [reg] = compileDisciplineRegistrations(
      contextSpec([whenEntry], { transcript: transcriptWithToolCalls([]) }),
    );
    const outOfScope = inputWithEvidence([
      { kind: 'modify', path: 'docs/dep.json', pre: 'a;', post: 'a;\nneeds-precedent;' },
    ]);
    const nonMatchingDelta = inputWithEvidence([
      { kind: 'modify', path: 'pkg/dep.json', pre: 'a;', post: 'a;\nunrelated;' },
    ]);

    expect(reg.matches?.(outOfScope)).toBeNull();
    expect(reg.matches?.(nonMatchingDelta)).toBeNull();
  });

  it('returns null for a delete under a when entry (kind disposition applies to routing)', () => {
    // The delete non-trigger of a `when` entry must hold at the routing layer too, or the
    // judge runs for inputs it can never break and writes phantom `passed` rows.
    // A transcript is injected so this compiles to a body-bearing registration.
    const [reg] = compileDisciplineRegistrations(
      contextSpec([whenEntry], { transcript: transcriptWithToolCalls([]) }),
    );
    const input = inputWithEvidence([
      { kind: 'delete', path: 'pkg/dep.json', pre: 'needs-precedent;' },
    ]);

    expect(reg.matches?.(input)).toBeNull();
  });

  it('routes a delete under a when-absent entry with its relativized path', () => {
    // A when-absent entry judges deletions, so routing must carry them to the body:
    // over-extending the forbid family's delete filter reopens the erase channel here.
    const [reg] = compileDisciplineRegistrations(
      contextSpec([anyMutationEntry], { transcript: transcriptWithToolCalls([]) }),
    );
    const input = inputWithEvidence([{ kind: 'delete', path: '/repo/sacred/x.ts' }]);

    expect(reg.matches?.(input)).toBe('sacred/x.ts');
  });
});

describe('compiled discipline thunk — precedent gate', () => {
  /** Judge one entry's thunk against `input`, with the evidence decision the spec implies. */
  async function judgeEntry(
    entry: DisciplineEntry,
    input: CovenantInput,
    extra: Record<string, unknown> = {},
  ): Promise<{ exitCode: number; reason?: string }> {
    const [reg] = compileDisciplineRegistrations(contextSpec([entry], extra));
    return (await reg?.body?.(input)) ?? { exitCode: 2 };
  }

  it('missing evidence on a matching trigger breaks, naming the id in the reason', async () => {
    // A judged break is exit 1 in the outcome protocol; what the wrapper translates it into
    // depends on the entry's enforce level — advise (the default) becomes exit 0, an explicit
    // block becomes 2. The id in the REASON is what reaches the agent's stderr either way,
    // and no sibling probe in this file asserts it.
    const result = await judgeEntry(whenEntry, triggeredInput(), {
      transcript: transcriptWithToolCalls([]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain('dep-needs-view');
  });

  it('a forbid entry is untouched by the precedent gate (still breaks on its own axis)', async () => {
    // The precedent gate is context-family-only: applied to every family, every discipline
    // thunk would answer the unjudgeable outcome on arrival.
    const forbidHex: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
    const input = inputWithEvidence([
      { kind: 'modify', path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);

    const result = await judgeEntry(forbidHex, input);

    expect(result.exitCode).toBe(1);
  });
});
