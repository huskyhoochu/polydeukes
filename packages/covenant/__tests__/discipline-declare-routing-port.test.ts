import type { CovenantInput, DisciplineEntry, FileChange } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// Routing for the two change-axis declarations over file-change evidence: an added-only
// declaration routes an in-scope modify or create by its repo-relative path and nothing out
// of scope or excluded; the frozen-path declaration routes a delete because it judges
// deletions. Routing reads the first admitted world, so a mixed input is routed by whichever
// change comes first and the body still judges every admitted world.
import { compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

const ROOT = '/repo';
const PATH_SOURCE = 'target.path';
const PATTERN = '\\b(lantern)\\b';

const ADDED_ONLY_ID = 'no-lantern';
const addedOnlyEntry = {
  id: ADDED_ONLY_ID,
  declare: {
    mechanism: 'added-only',
    scope: { source: PATH_SOURCE, include: ['^lib/'], exclude: ['^lib/generated/'] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: PATTERN }],
      after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: PATTERN }],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
    relate: [
      { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
    ],
  },
} as unknown as DisciplineEntry;

const FROZEN_ID = 'archive-frozen';
const frozenEntry = {
  id: FROZEN_ID,
  declare: {
    mechanism: 'self-absolution-ban',
    scope: { source: PATH_SOURCE, include: ['^records/archive/'] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      prior: [{ op: 'source', of: 'pre' }],
      here: [{ op: 'source', of: PATH_SOURCE }],
      after: [{ op: 'source', of: 'post' }],
      deleted: [{ op: 'onlyIn', of: 'here', notIn: 'after' }],
      touched: [{ op: 'union', of: ['prior', 'deleted'] }],
    },
    relate: [
      { id: 'frozen', relation: { op: 'empty', of: 'touched' }, message: '{value} is frozen' },
    ],
  },
} as unknown as DisciplineEntry;

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

function compileBody(entry: DisciplineEntry): CovenantRegistration {
  const regs = compileDisciplineRegistrations({
    disciplines: [entry],
    rootDir: ROOT,
    shellTools: ['Bash'],
    commandArgs: ['command'],
    readPreState,
  });
  const reg = regs.find((r) => r.label === entry.id && r.skip === undefined);
  if (reg === undefined) throw new Error(`no body registration compiled for ${entry.id}`);
  return reg;
}

describe('added-only routing — file-change evidence', () => {
  it('returns the relativized path for an in-scope modify under rootDir', () => {
    // The subject is repo-relative; the raw absolute path leaks the machine path into
    // telemetry and never matches a `^lib/` include.
    const reg = compileBody(addedOnlyEntry);
    const input = inputWithEvidence([
      { kind: 'modify', path: `${ROOT}/lib/a.txt`, pre: 'a', post: 'a\nlantern' },
    ]);

    expect(reg.matches?.(input)).toBe('lib/a.txt');
  });

  it('returns the path for an in-scope create', () => {
    // A create has no pre; routing that requires both sides never spawns on a new file.
    const reg = compileBody(addedOnlyEntry);

    expect(
      reg.matches?.(inputWithEvidence([{ kind: 'create', path: 'lib/b.txt', post: 'x' }])),
    ).toBe('lib/b.txt');
  });

  it('returns null for a path outside the include list', () => {
    const reg = compileBody(addedOnlyEntry);

    expect(
      reg.matches?.(
        inputWithEvidence([{ kind: 'modify', path: 'docs/a.txt', pre: 'a', post: 'lantern' }]),
      ),
    ).toBeNull();
  });

  it('returns null for a path the exclude list names', () => {
    // A regenerated file under an excluded tree must not route even though the include
    // matches; a scope that compiles exclude and never tests it judges what the author
    // carved out.
    const reg = compileBody(addedOnlyEntry);

    expect(
      reg.matches?.(
        inputWithEvidence([
          { kind: 'modify', path: 'lib/generated/a.txt', pre: 'a', post: 'lantern' },
        ]),
      ),
    ).toBeNull();
  });
});

describe('added-only routing — a mixed input', () => {
  it('routes by the first admitted change and the body still breaks on a later create', async () => {
    // Routing answers a subject only; a delete in front must not hide the create behind it,
    // which is what a route that also decided the verdict would do.
    const reg = compileBody(addedOnlyEntry);
    const input = inputWithEvidence([
      { kind: 'delete', path: 'lib/old.txt', pre: 'lantern' },
      { kind: 'create', path: 'lib/new.txt', post: 'lantern' },
    ]);

    expect(reg.matches?.(input)).toBe('lib/old.txt');
    const outcome = (await reg.body?.(input)) as { exitCode: number; reason?: string };
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toContain('lib/new.txt');
  });
});

describe('frozen-path routing — a delete is judged', () => {
  it('routes a delete-only input by its path', () => {
    // The delete filter belongs to the added-only shape alone; extended to every
    // declaration, a deletion of a frozen file never reaches a judge.
    const reg = compileBody(frozenEntry);

    expect(
      reg.matches?.(
        inputWithEvidence([{ kind: 'delete', path: 'records/archive/a.bin', pre: 'x' }]),
      ),
    ).toBe('records/archive/a.bin');
  });

  it('a binary delete (no pre) routes and the body breaks at exit 1', async () => {
    // Routing without the verdict is not enough: the body must read an absent post as the
    // deletion, or the row it writes says passed.
    const reg = compileBody(frozenEntry);
    const input = inputWithEvidence([{ kind: 'delete', path: 'records/archive/a.bin' }]);

    expect(reg.matches?.(input)).toBe('records/archive/a.bin');
    const outcome = (await reg.body?.(input)) as { exitCode: number };
    expect(outcome.exitCode).toBe(1);
  });

  it('a create routes and the body passes at exit 0', async () => {
    // The one allowed kind must still pass through the same registration.
    const reg = compileBody(frozenEntry);
    const input = inputWithEvidence([
      { kind: 'create', path: 'records/archive/a.bin', post: 'seed' },
    ]);

    expect(reg.matches?.(input)).toBe('records/archive/a.bin');
    const outcome = (await reg.body?.(input)) as { exitCode: number };
    expect(outcome.exitCode).toBe(0);
  });
});
