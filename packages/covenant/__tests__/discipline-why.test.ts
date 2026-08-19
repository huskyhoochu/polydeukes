import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// COVENANT-19 §4 — the four families' break reasons carry the entry's `why` appended
// as `<current phrase> — why: <why verbatim>`. An absent or empty `why` leaves the
// current phrase byte-for-byte unchanged, separator and all (§4.1); the context
// family keeps its recovery hint BEFORE the why (violation → recovery → rationale,
// §4.2); the reason stays one line (§7 invariant 5). The appending does not exist
// yet, so the with-why assertions here are RED by construction, while the
// without-why assertions pin the current phrases the ticket promises not to touch.
import { type DisciplineJudgeOptions, judgeDiscipline } from '../src/discipline.ts';

// ---------------------------------------------------------------------------
// Fixtures. Judge options mirror the assembled values (shell tool and command-arg
// names are injected here, never source literals). Each family's entry and payload
// mirrors a live-config shape, and each `why` is real rationale prose — the live
// entries carry sentences, not tags, and the appended text must survive verbatim.
// ---------------------------------------------------------------------------

const ROOT = '/repo';

const judgeOpts: DisciplineJudgeOptions = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
};

const DELTA_WHY =
  'raw hex colors bypass the design token layer; every color must resolve through a token';
const PATH_WHY =
  'the lockfile is generated output; a hand edit desyncs it from the manifest silently';
const COMMAND_WHY =
  'disabling lefthook drops the commit surface, so the staged diff lands unjudged';
const CONTEXT_WHY =
  'a dependency bumped without checking the registry has shipped a broken major before';

// The four current phrases, frozen by COVENANT-19 §4.3 (every current phrase is
// kept byte-for-byte) — the literals the without-why end must still produce.
const DELTA_CURRENT =
  "discipline 'no-hex' broken on src/a.css: edit adds new forbidden match(es): #123456";
const PATH_CURRENT = "discipline 'lockfile' broken: immutable file config/a.lock mutated";
const COMMAND_CURRENT = "discipline 'hooks-armed' broken: command matches forbidden pattern";
const CONTEXT_HINT =
  'only a call that ran and succeeded counts, matched at the start of a simple command — if it was part of a chain or a compound that failed, run it on its own';
const CONTEXT_CURRENT = `discipline 'dep-needs-view' broken on pkg/dep.json: requires prior session evidence (command "npm view "). ${CONTEXT_HINT}`;

/** Delta-family entry; `why` is attached per test. */
function deltaEntry(why?: string): DisciplineEntry {
  return {
    id: 'no-hex',
    in: ['src/**'],
    forbid: '#[0-9a-f]{6}',
    ...(why !== undefined && { why }),
  };
}

/** Path-family entry; `why` is attached per test. */
function pathEntry(why?: string): DisciplineEntry {
  return { id: 'lockfile', immutable: ['config/*.lock'], ...(why !== undefined && { why }) };
}

/** Command-family entry; `why` is attached per test. */
function commandEntry(why?: string): DisciplineEntry {
  return {
    id: 'hooks-armed',
    forbidCommand: 'LEFTHOOK=(0|false)\\b',
    ...(why !== undefined && { why }),
  };
}

/** Context-family entry (the dogfooding `when` shape); `why` is attached per test. */
function contextEntry(why?: string): DisciplineEntry {
  return {
    id: 'dep-needs-view',
    in: ['pkg/**'],
    when: 'needs-precedent',
    requirePrecedent: { command: 'npm view ' },
    ...(why !== undefined && { why }),
  };
}

/** Build a CovenantInput whose evidence rides its own tool-call element (CORE-06). */
function inputWithFileChanges(
  fileChanges: { path: string; pre: string | null; post: string }[],
): CovenantInput {
  return {
    toolCalls: fileChanges.map(({ path, pre, post }, index) => ({
      name: `call-${index}`,
      args: { file_path: path },
      fileChange:
        pre === null ? { kind: 'create', path, post } : { kind: 'modify', path, pre, post },
    })),
    subagentSpawns: [],
    userMessages: [],
  };
}

/** Build a CovenantInput carrying a single tool call. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return { toolCalls: [{ name, args }], subagentSpawns: [], userMessages: [] };
}

/** The payload that breaks the delta entry: an in-scope edit ADDING a hex literal. */
function deltaBreakInput(): CovenantInput {
  return inputWithFileChanges([{ path: 'src/a.css', pre: 'a: 0;', post: 'a: 0;\nb: #123456;' }]);
}

/** The payload that breaks the path entry: a modify of the glob-matched lockfile. */
function pathBreakInput(): CovenantInput {
  return inputWithFileChanges([{ path: 'config/a.lock', pre: 'old', post: 'new' }]);
}

/** The payload that breaks the command entry: a shell call disarming the hooks. */
function commandBreakInput(): CovenantInput {
  return inputWithToolCall('Bash', { command: 'LEFTHOOK=0 git push' });
}

/** The payload that triggers the context entry: an in-scope edit ADDING the trigger. */
function contextBreakInput(): CovenantInput {
  return inputWithFileChanges([
    { path: 'pkg/dep.json', pre: 'left: 1;', post: 'left: 1;\nneeds-precedent;' },
  ]);
}

const noPrecedent: DisciplineJudgeOptions = { ...judgeOpts, precedentFound: false };

/** Judge and return the break reason, failing the test if the entry upheld. */
function breakReason(
  entry: DisciplineEntry,
  input: CovenantInput,
  opts: DisciplineJudgeOptions = judgeOpts,
): string {
  const verdict = judgeDiscipline(entry, input, opts);
  expect(verdict.upheld).toBe(false);
  return verdict.upheld === false ? verdict.reason : '';
}

// ===========================================================================
// Axis 1 — every family appends the entry's why verbatim (§4.1 form)
// ===========================================================================

describe('judgeDiscipline — why appended to the break reason (COVENANT-19 §4.1)', () => {
  it('delta family: the reason is the current phrase plus " — why: " plus the why verbatim', () => {
    // P0 core purpose: the delta break carries the rationale on the same line, in the
    // §4.1 form exactly. Mutation caught: why dropped, a different separator, why
    // paraphrased/truncated, or why placed before the violation fact.
    expect(breakReason(deltaEntry(DELTA_WHY), deltaBreakInput())).toBe(
      `${DELTA_CURRENT} — why: ${DELTA_WHY}`,
    );
  });

  it('path family: the reason is the current phrase plus " — why: " plus the why verbatim', () => {
    // P0: same contract on the immutable-path break site. Mutation caught: the append
    // implemented on only some of the four sites (this family's site skipped).
    expect(breakReason(pathEntry(PATH_WHY), pathBreakInput())).toBe(
      `${PATH_CURRENT} — why: ${PATH_WHY}`,
    );
  });

  it('command family: the reason is the current phrase plus " — why: " plus the why verbatim', () => {
    // P0: same contract on the forbidden-command break site. Mutation caught: the
    // append skipped where the current phrase carries no path interpolation.
    expect(breakReason(commandEntry(COMMAND_WHY), commandBreakInput())).toBe(
      `${COMMAND_CURRENT} — why: ${COMMAND_WHY}`,
    );
  });

  it('context family: the reason is the current phrase (hint included) plus " — why: " plus the why verbatim', () => {
    // P0: same contract on the family that already ends in a recovery hint. Mutation
    // caught: the why REPLACING the hint instead of joining it (§4.2 says coexist).
    expect(breakReason(contextEntry(CONTEXT_WHY), contextBreakInput(), noPrecedent)).toBe(
      `${CONTEXT_CURRENT} — why: ${CONTEXT_WHY}`,
    );
  });
});

// ===========================================================================
// Axis 2 — an entry WITHOUT why produces the current phrase byte-for-byte
// ===========================================================================

// Exact `toBe`, never `toContain`: a leaked separator (`… — why: undefined`, a
// trailing ` — why: `) still CONTAINS the current phrase, so only strict equality
// proves the no-why end is untouched (§7 invariant 2). The suite's existing 98
// reason assertions are all substring checks and would miss exactly that leak
// (core.dev-log: equivalence is a function of fixture coverage, not of the test).
describe('judgeDiscipline — no why leaves the current phrase untouched (COVENANT-19 §7-2)', () => {
  it('delta family: reason equals the current phrase exactly', () => {
    // P0 no-append end: mutation caught — unconditional append leaking
    // " — why: undefined" (or a bare separator) into a why-less delta break.
    expect(breakReason(deltaEntry(), deltaBreakInput())).toBe(DELTA_CURRENT);
  });

  it('context family: reason equals the current phrase (recovery hint intact) exactly', () => {
    // P0 no-append end on the context site. Also the first byte-level pin of the
    // COVENANT-13b recovery hint: mutation caught — the hint reworded or dropped
    // while this ticket touches the same template literal.
    expect(breakReason(contextEntry(), contextBreakInput(), noPrecedent)).toBe(CONTEXT_CURRENT);
  });
});

// ===========================================================================
// Axis 3 — context family orders violation → recovery hint → why (§4.2)
// ===========================================================================

describe('judgeDiscipline — context family carries hint and why in order (COVENANT-19 §4.2)', () => {
  it('the recovery hint appears before the why in one reason string', () => {
    // P0 coexistence order: the reader's next action (the hint) must not sit behind
    // the longest sentence (the why). Mutation caught: why inserted before the hint,
    // or the hint dropped in favor of the why.
    const reason = breakReason(contextEntry(CONTEXT_WHY), contextBreakInput(), noPrecedent);

    const hintIndex = reason.indexOf(CONTEXT_HINT);
    const whyIndex = reason.indexOf(CONTEXT_WHY);
    expect(hintIndex).toBeGreaterThanOrEqual(0);
    expect(whyIndex).toBeGreaterThanOrEqual(0);
    expect(hintIndex).toBeLessThan(whyIndex);
  });
});

// ===========================================================================
// Axis 4 — an empty-string why appends nothing, separator included (§4.1)
// ===========================================================================

describe('judgeDiscipline — empty why is treated as absent (COVENANT-19 §4.1)', () => {
  it('why="" yields the current phrase exactly, with no dangling separator', () => {
    // P0 degenerate form: the schema admits '' and a truthiness-free append would
    // emit a bare trailing " — why: ". Mutation caught: `why !== undefined` used as
    // the only gate, leaving the empty string to append the separator alone.
    expect(breakReason(commandEntry(''), commandBreakInput())).toBe(COMMAND_CURRENT);
  });
});

// ===========================================================================
// Axis 5 — the reason stays one line (§7 invariant 5)
// ===========================================================================

describe('judgeDiscipline — the appended reason stays one line (COVENANT-19 §7-5)', () => {
  // The audit retired the implementation-side newline probe: axis 1 pins each whole
  // reason with toBe, so a body that joined on '\n' already fails there. What no test
  // reached is the other source of a newline — the why *itself* carrying one. A YAML
  // block scalar (`why: |`) produces exactly that, and neither the JSON Schema nor
  // defineConfig constrains it (no minLength, no pattern), so it is a reachable input
  // rather than an invented one. §4.1 resolves the collision with §7-5 in favour of the
  // one-line contract: the reason is a single line an agent reads off stderr, so the why
  // is normalized on the way in, never verbatim when verbatim would break the line.
  it('a why carrying newlines is folded to spaces, keeping the reason one line', () => {
    const multiline = 'archives are immutable\nediting one destroys the record';
    const reason = breakReason(pathEntry(multiline), pathBreakInput());

    expect(reason).not.toContain('\n');
    expect(reason).toBe(
      `${PATH_CURRENT} — why: archives are immutable editing one destroys the record`,
    );
  });

  it('a why of only whitespace is treated as absent, leaving no dangling separator', () => {
    // The neighbouring end of axis 4: '' is caught there, but a whitespace-only why
    // survives a `why !== undefined` gate and a naive fold alike, emitting ' — why: '
    // with nothing after it. Emptiness is decided after folding, not before.
    expect(breakReason(pathEntry('   '), pathBreakInput())).toBe(PATH_CURRENT);
  });
});
