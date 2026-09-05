import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// Every family's break reason carries the entry's `why` appended as
// `<phrase> — why: <why verbatim>`. An absent or empty `why` leaves the phrase
// byte-for-byte unchanged, separator and all; the context family keeps its recovery hint
// BEFORE the why (violation, then recovery, then rationale); the reason stays one line.
import { type JudgeDisciplineSpec, judgeDiscipline } from '../src/discipline.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

// Each `why` below is real rationale prose rather than a tag: live entries carry sentences,
// and the appended text must survive verbatim.

const ROOT = '/repo';

const judgeOpts: Omit<JudgeDisciplineSpec, 'entry' | 'input'> = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
  readPreState,
};

const COMMAND_WHY =
  'disabling lefthook drops the commit surface, so the staged diff lands unjudged';
const CONTEXT_WHY =
  'a dependency bumped without checking the registry has shipped a broken major before';

// The phrases the without-why end must produce byte-for-byte.
const COMMAND_CURRENT = "discipline 'hooks-armed' broken: command matches forbidden pattern";
const CONTEXT_HINT =
  'only a call that ran and succeeded counts, matched at the start of a simple command — if it was part of a chain or a compound that failed, run it on its own';
const CONTEXT_CURRENT = `discipline 'dep-needs-view' broken on pkg/dep.json: requires prior session evidence (command "npm view "). ${CONTEXT_HINT}`;

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

/** Build a CovenantInput whose evidence rides its own tool-call element. */
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

const noPrecedent: Omit<JudgeDisciplineSpec, 'entry' | 'input'> = {
  ...judgeOpts,
  precedentFound: false,
};

/** Judge and return the break reason, failing the test if the entry upheld. */
function breakReason(
  entry: DisciplineEntry,
  input: CovenantInput,
  opts: Omit<JudgeDisciplineSpec, 'entry' | 'input'> = judgeOpts,
): string {
  const verdict = judgeDiscipline({ ...opts, entry: entry, input: input });
  expect(verdict.upheld).toBe(false);
  return verdict.upheld === false ? verdict.reason : '';
}

describe('judgeDiscipline — why appended to the break reason', () => {
  it('path family: the reason is the current phrase plus " — why: " plus the why verbatim', () => {
    expect(breakReason(commandEntry(COMMAND_WHY), commandBreakInput())).toBe(
      `${COMMAND_CURRENT} — why: ${COMMAND_WHY}`,
    );
  });

  it('command family: the reason is the current phrase plus " — why: " plus the why verbatim', () => {
    expect(breakReason(commandEntry(COMMAND_WHY), commandBreakInput())).toBe(
      `${COMMAND_CURRENT} — why: ${COMMAND_WHY}`,
    );
  });

  it('context family: the reason is the current phrase (hint included) plus " — why: " plus the why verbatim', () => {
    // The family that already ends in a recovery hint: the why joins it rather than
    // replacing it.
    expect(breakReason(contextEntry(CONTEXT_WHY), contextBreakInput(), noPrecedent)).toBe(
      `${CONTEXT_CURRENT} — why: ${CONTEXT_WHY}`,
    );
  });
});

// Exact `toBe`, never `toContain`: a leaked separator (`… — why: undefined`, or a trailing
// ` — why: `) still CONTAINS the phrase, so only strict equality proves the no-why end is
// untouched. Every other reason assertion in this suite is a substring check.
describe('judgeDiscipline — no why leaves the current phrase untouched', () => {
  it('delta family: reason equals the current phrase exactly', () => {
    expect(breakReason(commandEntry(), commandBreakInput())).toBe(COMMAND_CURRENT);
  });

  it('context family: reason equals the current phrase (recovery hint intact) exactly', () => {
    // The only byte-level pin of the recovery hint's wording.
    expect(breakReason(contextEntry(), contextBreakInput(), noPrecedent)).toBe(CONTEXT_CURRENT);
  });
});

describe('judgeDiscipline — context family carries hint and why in order', () => {
  it('the recovery hint appears before the why in one reason string', () => {
    // The reader's next action (the hint) must not sit behind the longest sentence.
    const reason = breakReason(contextEntry(CONTEXT_WHY), contextBreakInput(), noPrecedent);

    const hintIndex = reason.indexOf(CONTEXT_HINT);
    const whyIndex = reason.indexOf(CONTEXT_WHY);
    expect(hintIndex).toBeGreaterThanOrEqual(0);
    expect(whyIndex).toBeGreaterThanOrEqual(0);
    expect(hintIndex).toBeLessThan(whyIndex);
  });
});

describe('judgeDiscipline — empty why is treated as absent', () => {
  it('why="" yields the current phrase exactly, with no dangling separator', () => {
    // The schema admits '', so `why !== undefined` alone as the gate leaves the empty
    // string appending a bare trailing separator.
    expect(breakReason(commandEntry(''), commandBreakInput())).toBe(COMMAND_CURRENT);
  });
});

describe('judgeDiscipline — the appended reason stays one line', () => {
  // The newline can come from the why itself: a YAML block scalar (`why: |`) produces one,
  // and neither the JSON Schema nor defineConfig constrains it. The reason is a single line
  // an agent reads off stderr, so the why is normalized on the way in — verbatim yields to
  // the one-line contract wherever verbatim would break the line.
  it('a why carrying newlines is folded to spaces, keeping the reason one line', () => {
    const multiline = 'archives are frozen\nediting one destroys the record';
    const reason = breakReason(commandEntry(multiline), commandBreakInput());

    expect(reason).not.toContain('\n');
    expect(reason).toBe(
      `${COMMAND_CURRENT} — why: archives are frozen editing one destroys the record`,
    );
  });

  it('a why carrying a bare carriage return folds it too', () => {
    // YAML preserves a lone CR without an LF beside it, and a terminal treats it as a
    // return to column zero — an unfolded CR does not merely survive, it repaints the
    // rationale over the discipline id and the path the reason already named. A `\r?\n`
    // fold requires the LF and passes a bare CR straight through.
    const withCr = 'archives are frozen\rediting one destroys the record';
    const reason = breakReason(commandEntry(withCr), commandBreakInput());

    expect(reason).not.toContain('\r');
    expect(reason).toBe(
      `${COMMAND_CURRENT} — why: archives are frozen editing one destroys the record`,
    );
  });

  it('a run of line breaks folds to a single space, not one space each', () => {
    // A YAML block scalar ends with a trailing newline and separates paragraphs with a
    // blank line, so runs are what a real config produces. Folding each break separately
    // leaves the double space visible in the message.
    const paragraphs = 'first paragraph\n\nsecond paragraph\n';
    const reason = breakReason(commandEntry(paragraphs), commandBreakInput());

    expect(reason).toBe(`${COMMAND_CURRENT} — why: first paragraph second paragraph`);
  });

  it('a why of only whitespace is treated as absent, leaving no dangling separator', () => {
    // A whitespace-only why survives a `why !== undefined` gate and a naive fold alike,
    // emitting the separator with nothing after it. Emptiness is decided after folding.
    expect(breakReason(commandEntry('   '), commandBreakInput())).toBe(COMMAND_CURRENT);
  });
});
