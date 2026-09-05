import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// A break reason carries the entry's `why` appended as `<phrase> — why: <why verbatim>`.
// An absent or empty `why` leaves the phrase byte-for-byte unchanged, separator and all,
// and the reason stays one line however the why was written.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

// Each `why` below is real rationale prose rather than a tag: live entries carry sentences,
// and the appended text must survive verbatim.

const ROOT = '/repo';

const surface: Omit<CompileDisciplinesSpec, 'disciplines'> = {
  rootDir: ROOT,
  shellTools: ['Bash'],
  commandArgs: ['command'],
  readPreState,
};

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

const DECLARE_WHY = 'a lantern in a source file is a leftover debugging marker.';
const DECLARE_CURRENT = "discipline 'no-lantern' broken on lib/a.txt: adds lantern: lantern here";

/** Added-only declaration over `lib/`; `why` is attached per test. */
function declareEntry(why?: string): DisciplineEntry {
  return {
    id: 'no-lantern',
    declare: {
      mechanism: 'added-only',
      scope: { source: 'target.path', include: ['^lib/'] },
      supply: { pre: 'empty', post: 'empty' },
      extract: {
        before: [
          { op: 'source', of: 'pre' },
          { op: 'lines' },
          { op: 'keyByPattern', re: '(lantern)' },
        ],
        after: [
          { op: 'source', of: 'post' },
          { op: 'lines' },
          { op: 'keyByPattern', re: '(lantern)' },
        ],
        added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
      },
      relate: [
        {
          id: 'nothing-added',
          relation: { op: 'empty', of: 'added' },
          message: 'adds {key}: {value}',
        },
      ],
    },
    ...(why !== undefined && { why }),
  } as unknown as DisciplineEntry;
}

/** The break reason of the declaration's compiled body, failing the test if it upheld. */
async function declareBreakReason(why?: string): Promise<string> {
  const regs = compileDisciplineRegistrations({ ...surface, disciplines: [declareEntry(why)] });
  const reg = regs.find((r) => r.label === 'no-lantern' && r.skip === undefined);
  const outcome = (await reg?.body?.(
    inputWithFileChanges([{ path: 'lib/a.txt', pre: null, post: 'lantern here' }]),
  )) as { exitCode: number; reason?: string } | undefined;
  expect(outcome?.exitCode).toBe(1);
  return outcome?.reason ?? '';
}

describe('the break reason — why appended', () => {
  it('is the current phrase plus " — why: " plus the why verbatim', async () => {
    expect(await declareBreakReason(DECLARE_WHY)).toBe(`${DECLARE_CURRENT} — why: ${DECLARE_WHY}`);
  });
});

// Exact `toBe`, never `toContain`: a leaked separator (`… — why: undefined`, or a trailing
// ` — why: `) still CONTAINS the phrase, so only strict equality proves the no-why end is
// untouched.
describe('the break reason — no why leaves the current phrase untouched', () => {
  it('equals the current phrase exactly', async () => {
    expect(await declareBreakReason()).toBe(DECLARE_CURRENT);
  });
});

describe('the break reason — empty why is treated as absent', () => {
  it('why="" yields the current phrase exactly, with no dangling separator', async () => {
    // The schema admits '', so `why !== undefined` alone as the gate leaves the empty
    // string appending a bare trailing separator.
    expect(await declareBreakReason('')).toBe(DECLARE_CURRENT);
  });
});

describe('the break reason stays one line', () => {
  // The newline can come from the why itself: a YAML block scalar (`why: |`) produces one,
  // and neither the JSON Schema nor defineConfig constrains it. The reason is a single line
  // an agent reads off stderr, so the why is normalized on the way in — verbatim yields to
  // the one-line contract wherever verbatim would break the line.
  it('a why carrying newlines is folded to spaces, keeping the reason one line', async () => {
    const multiline = 'archives are frozen\nediting one destroys the record';
    const reason = await declareBreakReason(multiline);

    expect(reason).not.toContain('\n');
    expect(reason).toBe(
      `${DECLARE_CURRENT} — why: archives are frozen editing one destroys the record`,
    );
  });

  it('a why carrying a bare carriage return folds it too', async () => {
    // YAML preserves a lone CR without an LF beside it, and a terminal treats it as a
    // return to column zero — an unfolded CR does not merely survive, it repaints the
    // rationale over the discipline id and the path the reason already named. A `\r?\n`
    // fold requires the LF and passes a bare CR straight through.
    const withCr = 'archives are frozen\rediting one destroys the record';
    const reason = await declareBreakReason(withCr);

    expect(reason).not.toContain('\r');
    expect(reason).toBe(
      `${DECLARE_CURRENT} — why: archives are frozen editing one destroys the record`,
    );
  });

  it('a run of line breaks folds to a single space, not one space each', async () => {
    // A YAML block scalar ends with a trailing newline and separates paragraphs with a
    // blank line, so runs are what a real config produces. Folding each break separately
    // leaves the double space visible in the message.
    const paragraphs = 'first paragraph\n\nsecond paragraph\n';
    const reason = await declareBreakReason(paragraphs);

    expect(reason).toBe(`${DECLARE_CURRENT} — why: first paragraph second paragraph`);
  });

  it('a why of only whitespace is treated as absent, leaving no dangling separator', async () => {
    // A whitespace-only why survives a `why !== undefined` gate and a naive fold alike,
    // emitting the separator with nothing after it. Emptiness is decided after folding.
    expect(await declareBreakReason('   ')).toBe(DECLARE_CURRENT);
  });
});
