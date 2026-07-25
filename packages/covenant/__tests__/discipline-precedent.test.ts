import { execFileSync, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CanonicalTranscript,
  CovenantInput,
  DisciplineEntry,
  FileChange,
} from '@polydeukes/core';
import { beforeAll, describe, expect, it } from 'vitest';
// COVENANT-13 §4.4 / AC 7–9 — the fourth discipline family (`requirePrecedent`): a
// trigger-matched mutation breaks unless session evidence preceded it. The body is a
// spawned CLI, so evidence is evaluated at ASSEMBLY time and transported as an argv
// flag (--precedent-found / --precedent-missing); `judgeDiscipline` consumes it as
// opts.precedentFound. None of that exists yet, so this file is RED by construction.
import {
  type CompileDisciplinesSpec,
  compileDisciplineRegistrations,
  type DisciplineJudgeOptions,
  judgeDiscipline,
} from '../src/discipline.ts';

// ---------------------------------------------------------------------------
// Fixtures. Shell tool names, command arg names, and evidence vocabularies are
// injected assembly values, never source literals. The `when` trigger pattern is
// a plain token so the added-direction delta is unambiguous in every fixture.
// ---------------------------------------------------------------------------

const ROOT = '/repo';

const judgeOpts: DisciplineJudgeOptions = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
};

/** judgeOpts extended with the new precedentFound option (typed post-GREEN). */
function withPrecedent(found: boolean): DisciplineJudgeOptions {
  return { ...judgeOpts, precedentFound: found } as DisciplineJudgeOptions;
}

/** A context-family entry WITH a `when` trigger (the dogfooding shape, PRD §4.1). */
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

/** Build a CovenantInput whose evidence rides its own tool-call element (CORE-06). */
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

type TranscriptToolCallish = { name: string; args: Record<string, unknown> };

/** Stub the canonical-transcript seam with a fixed tool-call history. */
function transcriptWithToolCalls(calls: TranscriptToolCallish[]): CanonicalTranscript {
  return {
    findSubagentInvocations: () => [],
    findUserMessages: () => [],
    findToolCalls: (name?: string) =>
      name === undefined ? calls : calls.filter((c) => c.name === name),
  } as unknown as CanonicalTranscript;
}

/** Compile-spec base; `extra` carries the new transcript / evaluatePrecedent seams. */
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

// ===========================================================================
// AC 7 — judgeDiscipline: the context-family verdict is trigger ∧ ¬evidence
// ===========================================================================

describe('judgeDiscipline — requirePrecedent context family (AC 7)', () => {
  it('breaks a trigger-matched edit without evidence, naming id, path, and required evidence', () => {
    // P0 core purpose: trigger match + precedentFound=false must break, and the reason
    // must carry the discipline id, the matched path, and the evidence being demanded.
    // Mutation caught: the evidence condition inverted (breaking WITH evidence), or the
    // reason built without id / path / the required-evidence description.
    const verdict = judgeDiscipline(whenEntry, triggeredInput(), withPrecedent(false));

    expect(verdict.upheld).toBe(false);
    if (verdict.upheld === false) {
      expect(verdict.reason).toContain('dep-needs-view');
      expect(verdict.reason).toContain('pkg/dep.json');
      expect(verdict.reason).toContain('npm view');
    }
  });

  it('upholds the same trigger-matched edit when precedentFound is true', () => {
    // P0 pass path: the evidence flag is the ONLY thing separating this fixture from the
    // break above. Mutation caught: precedentFound ignored (the family would block every
    // matched edit, evidence or not — a gate with no legitimate way through).
    expect(judgeDiscipline(whenEntry, triggeredInput(), withPrecedent(true))).toEqual({
      upheld: true,
    });
  });

  it('treats an unspecified precedentFound as missing evidence (breaks)', () => {
    // P0 fail-closed default (PRD: precedentFound !== true): an assembly that forgets the
    // option must land on the blocking side. Mutation caught: a truthiness default of
    // "undefined means found" — the silent fail-open a covenant must never have.
    expect(judgeDiscipline(whenEntry, triggeredInput(), judgeOpts).upheld).toBe(false);
  });
});

describe('judgeDiscipline — requirePrecedent trigger non-match (AC 8)', () => {
  it('upholds an out-of-scope edit regardless of missing evidence', () => {
    // P0 scoping: `in: pkg/**` must not judge a docs/ file even with no evidence.
    // Mutation caught: the in glob dropped, turning the entry into a global gate.
    const input = inputWithEvidence([
      { kind: 'modify', path: 'docs/dep.json', pre: 'a;', post: 'a;\nneeds-precedent;' },
    ]);

    expect(judgeDiscipline(whenEntry, input, withPrecedent(false))).toEqual({ upheld: true });
  });

  it('upholds an in-scope edit whose added lines do not match when', () => {
    // P0 trigger filter: an unrelated in-scope edit is not the declared trigger.
    // Mutation caught: the when pattern never tested (every in-scope edit judged).
    const input = inputWithEvidence([
      { kind: 'modify', path: 'pkg/dep.json', pre: 'a;', post: 'a;\nunrelated;' },
    ]);

    expect(judgeDiscipline(whenEntry, input, withPrecedent(false))).toEqual({ upheld: true });
  });

  it('upholds a debt-only edit — when matches pre content but nothing added matches', () => {
    // P0 added-direction semantics (COVENANT-05 delta layer, inherited verbatim): a file
    // already carrying the trigger token, edited without adding a new one, must pass.
    // Mutation caught: when evaluated against the full post instead of the added delta
    // (every later edit to a matched file would demand fresh evidence forever).
    const input = inputWithEvidence([
      {
        kind: 'modify',
        path: 'pkg/dep.json',
        pre: 'needs-precedent;',
        post: 'needs-precedent;\nunrelated;',
      },
    ]);

    expect(judgeDiscipline(whenEntry, input, withPrecedent(false))).toEqual({ upheld: true });
  });
});

// ===========================================================================
// AC 8 — kind disposition, fixed as fixtures (the pre-GREEN decision of §4.4)
// ===========================================================================

// The modify arm of this matrix is covered by the reason-shape test above, which judges
// the very same triggeredInput() fixture — it is not repeated here.
describe('judgeDiscipline — when-present trigger kind disposition (AC 8)', () => {
  it('create: the whole post is added, so a matching post triggers (breaks without evidence)', () => {
    // P0 create arm: pre-less evidence must feed the added direction as all-added.
    // Mutation caught: the create arm skipped by the trigger (authoring a matched file
    // fresh would never demand evidence — a hole at first authorship).
    const input = inputWithEvidence([
      { kind: 'create', path: 'pkg/new.json', post: 'needs-precedent;' },
    ]);

    expect(judgeDiscipline(whenEntry, input, withPrecedent(false)).upheld).toBe(false);
  });

  it('delete: never triggers a when entry — deletion adds no content (upholds without evidence)', () => {
    // P0 kind decision (breaking direction): pre is deliberately FULL of trigger matches,
    // yet a when entry judges the added direction only. Mutation caught: the delete arm
    // feeding pre as post into the when evaluation (every deletion of a matched file
    // would demand evidence a when entry never asked for).
    const input = inputWithEvidence([
      { kind: 'delete', path: 'pkg/dep.json', pre: 'needs-precedent;\nneeds-precedent;' },
    ]);

    expect(judgeDiscipline(whenEntry, input, withPrecedent(false))).toEqual({ upheld: true });
  });
});

describe('judgeDiscipline — when-absent trigger kind disposition (AC 8)', () => {
  it('create in scope triggers without when (breaks without evidence)', () => {
    // P0: absent when = every in-scope mutation is the trigger, creation included.
    // Mutation caught: absent when defaulting to "trigger nothing" (the entry inert).
    const input = inputWithEvidence([{ kind: 'create', path: 'sacred/x.ts', post: 'seed' }]);

    expect(judgeDiscipline(anyMutationEntry, input, withPrecedent(false)).upheld).toBe(false);
  });

  it('modify in scope triggers without when (breaks without evidence)', () => {
    // P0 modify arm of the when-absent matrix. Mutation caught: a when-absent entry
    // routed through the delta path with an undefined pattern (throw or blanket uphold).
    const input = inputWithEvidence([
      { kind: 'modify', path: 'sacred/x.ts', pre: 'old', post: 'new' },
    ]);

    expect(judgeDiscipline(anyMutationEntry, input, withPrecedent(false)).upheld).toBe(false);
  });

  it('delete in scope triggers without when — erasing without precedent is judged (breaks)', () => {
    // P0 kind decision, the sharp edge: a when-absent context entry covers deletion too,
    // and the evidence needs no pre baseline (binary-blob lesson). Mutation caught: the
    // delete kind excluded from the when-absent trigger — deleting a covered file would
    // silently bypass the family (fail-open through the erase channel).
    const input = inputWithEvidence([{ kind: 'delete', path: 'sacred/x.ts' }]);

    expect(judgeDiscipline(anyMutationEntry, input, withPrecedent(false)).upheld).toBe(false);
  });
});

// ===========================================================================
// AC 9 — precedentFound is inert for the existing three families
// ===========================================================================

describe('judgeDiscipline — precedentFound does not leak into other families (AC 9)', () => {
  it('existing family verdicts ignore the precedentFound option in both directions', () => {
    // P0 regression fence: the new option can neither open nor close the other families'
    // gates. Mutation caught: precedentFound consulted in the shared judged body (true
    // would wave a forbid break through; false would break a debt-only forbid uphold).
    const forbidHex: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
    const breaking = inputWithEvidence([
      { kind: 'modify', path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);
    const debtOnly = inputWithEvidence([
      { kind: 'modify', path: 'src/a.css', pre: 'a: #123456;', post: 'a: #123456;\nm: 0;' },
    ]);

    expect(judgeDiscipline(forbidHex, breaking, withPrecedent(true)).upheld).toBe(false);
    expect(judgeDiscipline(forbidHex, debtOnly, withPrecedent(false))).toEqual({ upheld: true });

    const forbidCmd: DisciplineEntry = { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=0\\b' };
    const cmdInput: CovenantInput = {
      toolCalls: [{ name: 'Bash', args: { command: 'LEFTHOOK=0 git push' } }],
      subagentSpawns: [],
      userMessages: [],
    };

    expect(judgeDiscipline(forbidCmd, cmdInput, withPrecedent(true)).upheld).toBe(false);
  });
});

// ===========================================================================
// AC 7 — compileDisciplineRegistrations: assembly-time evidence → argv transport
// ===========================================================================

describe('compileDisciplineRegistrations — command evidence transport (AC 7)', () => {
  it('transports --precedent-found when a shell tool call command matches the pattern', () => {
    // P0 transport, found direction: matching shell history must arrive at the body as
    // the found flag (and never both flags). No evaluatePrecedent is injected — the
    // compiler owns the command vocabulary itself. Mutation caught: the compiler
    // delegating command to the absent seam (throw), or transporting missing regardless
    // of the transcript (evidence could never open the gate).
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { command: 'npm view react version' } },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(reg.body.args).toContain('--precedent-found');
    expect(reg.body.args).not.toContain('--precedent-missing');
  });

  it('transports --precedent-missing when no shell command matches', () => {
    // P0 transport, missing direction: unrelated shell history is not evidence.
    // Mutation caught: the pattern test dropped (any Bash call at all counts as found).
    const transcript = transcriptWithToolCalls([{ name: 'Bash', args: { command: 'git status' } }]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(reg.body.args).toContain('--precedent-missing');
    expect(reg.body.args).not.toContain('--precedent-found');
  });

  it('ignores a matching command on a tool outside shellTools (not evidence)', () => {
    // P0 shell filter: findToolCalls returns every call, so the compiler MUST re-filter
    // by the injected shellTools before reading command args. Mutation caught: the name
    // filter dropped — any tool whose args happen to carry the string would open the gate.
    const transcript = transcriptWithToolCalls([
      { name: 'NotShell', args: { command: 'npm view react version' } },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(reg.body.args).toContain('--precedent-missing');
  });

  it('ignores a matching value under an arg name outside commandArgs (not evidence)', () => {
    // P0 command-arg filter: only the injected commandArgs names carry a command string.
    // Mutation caught: the compiler scanning every arg value of a shell call (a mention
    // of the pattern in an unrelated arg would forge the evidence).
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { script: 'npm view react version' } },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(reg.body.args).toContain('--precedent-missing');
  });

  it('matches the command as a regex, not a substring', () => {
    // P0 match semantics (PRD §4.1: the command string matches the pattern as a REGEX —
    // the forbidCommand precedent): an alternation only matches under regex semantics.
    // Mutation caught: the evidence check implemented as String.includes — this
    // alternation would never find evidence.
    const regexEntry = {
      id: 'dep-needs-view',
      in: ['pkg/**'],
      when: 'needs-precedent',
      requirePrecedent: { command: 'npm (view|info) ' },
    } as DisciplineEntry;
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { command: 'npm info react' } },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([regexEntry], { transcript }));

    expect(reg.body.args).toContain('--precedent-found');
  });

  it('transports --precedent-missing when no transcript is injected', () => {
    // P0 sessionless default (PRD §4.4): no transcript = no evidence = missing, same as
    // the noop seam. Mutation caught: an absent transcript short-circuiting to found
    // (every sessionless assembly would wave the family through — fail-open).
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry]));

    expect(reg.body.args).toContain('--precedent-missing');
    expect(reg.body.args).not.toContain('--precedent-found');
  });
});

describe('compileDisciplineRegistrations — adapter evidence via the injected seam (AC 7)', () => {
  const subagentEntry = {
    id: 'plan-before-touch',
    in: ['sacred/**'],
    requirePrecedent: { subagent: 'planner' },
  } as DisciplineEntry;

  it('transports --precedent-found when the evaluator affirms, passing the evidence verbatim', () => {
    // P0 delegation contract: a non-command key goes to the injected evaluator, which
    // receives the ENTRY'S evidence object (not the whole entry) and whose true becomes
    // the found flag. Mutation caught: the compiler passing the wrong object to the seam,
    // or dropping the seam's answer and transporting missing unconditionally.
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

    expect(reg.body.args).toContain('--precedent-found');
    expect(seen).toEqual([{ subagent: 'planner' }]);
  });

  it('transports --precedent-missing when the evaluator denies', () => {
    // P0 delegation, missing direction: false from the seam must land as missing (not be
    // confused with undefined/unrecognized). Mutation caught: false and undefined merged
    // into one branch — a legitimate "no evidence" answer would throw instead of block.
    const [reg] = compileDisciplineRegistrations(
      contextSpec([subagentEntry], {
        transcript: transcriptWithToolCalls([]),
        evaluatePrecedent: () => false,
      }),
    );

    expect(reg.body.args).toContain('--precedent-missing');
  });
});

describe('compileDisciplineRegistrations — fail-closed assembly (AC 7)', () => {
  const typoEntry = {
    id: 'typo-vocabulary',
    in: ['sacred/**'],
    requirePrecedent: { subagnet: 'planner' },
  } as DisciplineEntry;

  it('throws when the evaluator does not recognize the evidence key (returns undefined)', () => {
    // P0 fail-closed (resolveGitAdapterSettings precedent): undefined from the seam means
    // "not my vocabulary" — assembly must halt, not guess. Mutation caught: undefined
    // coerced to missing (a typo'd evidence key would silently become an always-blocking
    // entry nobody can satisfy — or worse, always-found).
    expect(() =>
      compileDisciplineRegistrations(
        contextSpec([typoEntry], {
          transcript: transcriptWithToolCalls([]),
          evaluatePrecedent: () => undefined,
        }),
      ),
    ).toThrow();
  });

  it('throws when a non-command evidence key arrives with no evaluator injected', () => {
    // P0 fail-closed: an assembly that cannot evaluate the declared evidence must not
    // produce a registration. Mutation caught: the seam-absent path defaulting to
    // missing/found instead of halting (the entry judged on evidence nobody looked for).
    expect(() =>
      compileDisciplineRegistrations(
        contextSpec([typoEntry], { transcript: transcriptWithToolCalls([]) }),
      ),
    ).toThrow();
  });

  it('throws on a non-compilable requirePrecedent.command regex', () => {
    // P0 fail-fast (existing compiler convention for forbid): a broken pattern halts
    // assembly rather than deferring the crash to evidence-evaluation time. Mutation
    // caught: the compilability probe not extended to the fourth family's pattern.
    const broken = {
      id: 'broken-evidence',
      in: ['pkg/**'],
      requirePrecedent: { command: '(' },
    } as DisciplineEntry;

    expect(() =>
      compileDisciplineRegistrations(
        contextSpec([broken], { transcript: transcriptWithToolCalls([]) }),
      ),
    ).toThrow();
  });
});

describe('compileDisciplineRegistrations — existing families carry no precedent flags (AC 9)', () => {
  it('forbid, immutable, and forbidCommand registrations get neither precedent flag', () => {
    // P0 regression fence: the transport is context-family-only. Mutation caught: the
    // compiler appending a precedent flag unconditionally — every existing discipline
    // body would hit the misassembly gate (or worse, be handed found and judged wrong).
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { command: 'npm view react version' } },
    ]);
    const entries: DisciplineEntry[] = [
      { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' },
      { id: 'lockfile', immutable: ['config/*.lock'] },
      { id: 'hooks-armed', forbidCommand: 'LEFTHOOK=0\\b' },
    ];
    const regs = compileDisciplineRegistrations(contextSpec(entries, { transcript }));

    for (const reg of regs) {
      expect(reg.body.args).not.toContain('--precedent-found');
      expect(reg.body.args).not.toContain('--precedent-missing');
    }
  });
});

// ===========================================================================
// PRD §4.4 — routing: matches fires on the trigger alone, evidence-blind
// ===========================================================================

describe('compileDisciplineRegistrations — requirePrecedent matches routes on trigger only (PRD §4.4)', () => {
  it('routes a trigger-matched input even when the evidence was found (observation, not waste)', () => {
    // P0 counter-intuitive contract: found evidence must NOT suppress the route — the
    // body spawns and records `passed`, which is the family's measurement value.
    // Mutation caught: an "optimization" skipping the spawn when evidence exists
    // (the gate's checks would vanish from the telemetry record).
    const transcript = transcriptWithToolCalls([
      { name: 'Bash', args: { command: 'npm view react version' } },
    ]);
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry], { transcript }));

    expect(reg.matches?.(triggeredInput())).toBe('pkg/dep.json');
  });

  it('returns null for out-of-scope and when-nonmatching inputs', () => {
    // P0 routing filter: a non-trigger must not spawn a body. Mutation caught: the in
    // glob or the when pattern dropped from the matches closure (every input routes).
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry]));
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
    // P0 routing/judgment coherence: the delete non-trigger of a when entry must hold at
    // the routing layer too. Mutation caught: matches routing deletions the judge would
    // never break (spawn waste and phantom `passed` telemetry for a non-trigger).
    const [reg] = compileDisciplineRegistrations(contextSpec([whenEntry]));
    const input = inputWithEvidence([
      { kind: 'delete', path: 'pkg/dep.json', pre: 'needs-precedent;' },
    ]);

    expect(reg.matches?.(input)).toBeNull();
  });

  it('routes a delete under a when-absent entry with its relativized path', () => {
    // P0 partner direction: a when-absent entry judges deletions, so routing must carry
    // them to the body. Mutation caught: the forbid-family delete filter over-extended to
    // the context family (the erase channel would bypass the gate at the routing layer).
    const [reg] = compileDisciplineRegistrations(contextSpec([anyMutationEntry]));
    const input = inputWithEvidence([{ kind: 'delete', path: '/repo/sacred/x.ts' }]);

    expect(reg.matches?.(input)).toBe('sacred/x.ts');
  });
});

// ===========================================================================
// AC 9 — the spawned body's precedent-flag gate (real compiled artifact)
// ===========================================================================

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const bodyPath = fileURLToPath(new URL('../dist/discipline-body.js', import.meta.url));

beforeAll(() => {
  execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@polydeukes/covenant'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}, 120_000);

describe('discipline-body CLI — precedent flag gate (AC 9)', () => {
  const baseArgs = [
    bodyPath,
    '--discipline',
    JSON.stringify(whenEntry),
    '--root-dir',
    ROOT,
    '--shell-tool',
    'Bash',
    '--command-arg',
    'command',
  ];

  function spawnBody(extraArgs: string[], input: CovenantInput) {
    return spawnSync(process.execPath, [...baseArgs, ...extraArgs], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
    });
  }

  it('a context entry arriving with neither precedent flag exits 2 (misassembly fail-closed)', () => {
    // P0 misassembly gate (PRD §4.4, the command family's missing-shell-surface shape):
    // a context entry without its evidence verdict is unjudgeable — never exit 0.
    // Mutation caught: an absent flag defaulting to found (fail-open) or to a judged
    // break (masking the assembly bug as a covenant break).
    const result = spawnBody([], triggeredInput());

    expect(result.status).toBe(2);
  });

  it('a context entry with --precedent-found and a matching trigger exits 0', () => {
    // P0 pass path end-to-end: the transported found flag must reach the judge as
    // precedentFound=true. Mutation caught: the flag parsed but never wired into the
    // judge options (evidence could never open the gate at the body).
    const result = spawnBody(['--precedent-found'], triggeredInput());

    expect(result.status).toBe(0);
  });

  it('a context entry with --precedent-missing and a matching trigger exits 1, naming the id on stderr', () => {
    // P0 block path end-to-end: missing evidence + trigger = a judged break, which in the
    // body exit-code protocol is exit 1 (run_covenant translates 1 into the blocking 2 —
    // the same shape the self-mod body pins). Mutation caught: the missing flag treated
    // as uphold (fail-open), or the break reason not surfaced on stderr.
    const result = spawnBody(['--precedent-missing'], triggeredInput());

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dep-needs-view');
  });

  it('a context entry arriving with BOTH precedent flags exits 2 (contradictory assembly)', () => {
    // P0 decision fixture: two contradictory evidence verdicts cannot be judged — the
    // consistent disposition is the misassembly exit, never picking one flag silently.
    // Mutation caught: last-flag-wins parsing (a contradictory assembly judged as if
    // it were coherent, in whichever direction the parser happens to prefer).
    const result = spawnBody(['--precedent-found', '--precedent-missing'], triggeredInput());

    expect(result.status).toBe(2);
  });

  it('a forbid entry without precedent flags is untouched by the gate (still exits 1 on a break)', () => {
    // P0 regression fence at the body: the flag gate is context-family-only. Mutation
    // caught: the gate applied to every family — all existing discipline bodies would
    // exit 2 on arrival, turning the whole standard library into misassembly noise.
    const forbidHex: DisciplineEntry = { id: 'no-hex', in: ['src/**'], forbid: '#[0-9a-f]{6}' };
    const input = inputWithEvidence([
      { kind: 'modify', path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' },
    ]);
    const result = spawnSync(
      process.execPath,
      [
        bodyPath,
        '--discipline',
        JSON.stringify(forbidHex),
        '--root-dir',
        ROOT,
        '--shell-tool',
        'Bash',
        '--command-arg',
        'command',
      ],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(1);
  });
});
