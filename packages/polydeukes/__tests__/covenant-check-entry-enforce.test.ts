import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// CONFIG-11 AC-5 — the commit surface honours an entry's own level. The surface stays at
// block (no `adapters.git` namespace), so the only advise in play is the entry's: a staged
// delta breaking it must pass (exit 0), record `advised` under the entry's id, and emit
// the one advisory line — the same visible outcome CONFIG-06 gives a surface-wide advise.
// Without that line an item-level advise would pass silently, which is the new fail-quiet
// path this ticket could open.
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

const SOFT_ID = 'no-todo-softly';
const PLAIN_ID = 'no-todo-plainly';
const HARD_ID = 'no-todo-hardly';

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

beforeEach(() => {
  repo = createCheckRepo('pdks-check-entry-enforce-');
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
  vi.restoreAllMocks();
});

/** Stage a delta that adds a forbidden match under an advise entry, surface at block. */
function stageSoftBreak(): void {
  writeConfig({
    disciplines: [{ id: SOFT_ID, forbid: { added: 'TODO' }, in: 'lib/**/*.ts', enforce: 'advise' }],
  });
  write('lib/a.ts', 'export const x = 1;\n');
  git('add', 'lib/a.ts', 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'initial');
  write('lib/a.ts', 'export const x = 1;\n// TODO fix later\n');
  git('add', 'lib/a.ts');
}

describe('CONFIG-11 AC-5 covenant check — an advise entry under a block surface', () => {
  it('passes (exit 0) and records one advised row under the entry id', async () => {
    // Mutation caught: the entry level dropped at the commit-surface assembly (exit 2 as
    // today), or advised recorded under the dispatcher label instead of the entry's.
    stageSoftBreak();

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    const advised = readRecords(telemetryPath).records.filter((r) => r.event === 'advised');
    expect(advised.map((r) => r.label)).toEqual([SOFT_ID]);
  });

  it('emits exactly one stderr advisory line', async () => {
    // Mutation caught: the advisory gated on the SURFACE level only, so an entry-level
    // advise passes with nothing said.
    stageSoftBreak();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await runCovenantCheck({ repoRoot, telemetryPath });

    const advisoryLines = stderrWrite.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => /covenant advisory/.test(line));
    expect(advisoryLines).toHaveLength(1);
    expect(advisoryLines[0]).toMatch(/commit allowed/);
  });

  it('an advise entry beside a blocking entry exits 2 and the advisory does not claim the commit was allowed', async () => {
    // Per-entry levels can mix within one run (impossible under a surface-wide level).
    // The blocking neighbour says `enforce: block` explicitly — since POSTURE-01 an absent
    // level is advise, so the promotion is what keeps this a mixed run. Mutation caught:
    // the advisory asserting "commit allowed" from the advised count alone while the run
    // returns exit 2.
    writeConfig({
      disciplines: [
        { id: SOFT_ID, forbid: { added: 'TODO' }, in: 'lib/**/*.ts', enforce: 'advise' },
        { id: 'no-fixme', forbid: { added: 'FIXME' }, in: 'lib/**/*.ts', enforce: 'block' },
      ],
    });
    write('lib/a.ts', 'export const x = 1;\n');
    git('add', 'lib/a.ts', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'initial');
    write('lib/a.ts', 'export const x = 1;\n// TODO and FIXME\n');
    git('add', 'lib/a.ts');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    const advisoryLines = stderrWrite.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => /covenant advisory/.test(line));
    expect(advisoryLines).toHaveLength(1);
    expect(advisoryLines[0]).not.toMatch(/commit allowed/);
  });
});

// POSTURE-01 AC-4 — §4.1's two commit-surface columns the CONFIG-11 block above does not
// reach: an absent level under a block surface, and an explicit block under an advise
// surface. The stage helper mirrors stageSoftBreak with the entry as the only variable.
describe('POSTURE-01 AC-4 covenant check — the entry default is advise, explicit block is the promotion', () => {
  function stageBreakUnder(entry: Record<string, unknown>): void {
    writeConfig({ disciplines: [{ forbid: { added: 'TODO' }, in: 'lib/**/*.ts', ...entry }] });
    write('lib/a.ts', 'export const x = 1;\n');
    git('add', 'lib/a.ts', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'initial');
    write('lib/a.ts', 'export const x = 1;\n// TODO fix later\n');
    git('add', 'lib/a.ts');
  }

  /** Every row of the entry under test as [event, label]. */
  function entryRows(id: string): [string, string][] {
    return readRecords(telemetryPath)
      .records.filter((r) => r.label === id)
      .map((r) => [r.event, r.label]);
  }

  it('an entry WITHOUT enforce passes (exit 0) and records one advised row under the entry id', async () => {
    // §4.1 second column: under a block surface the omitted level still lands advise —
    // the default is the entry axis's, not the observer's. Mutation caught: the default
    // filled only when the surface is advise (lenient-wins composed from the surface
    // instead of the compiler), leaving exit 2 · blocked here.
    stageBreakUnder({ id: PLAIN_ID });

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(entryRows(PLAIN_ID)).toEqual([['advised', PLAIN_ID]]);
  });

  it("an explicit enforce: 'block' entry under adapters.git.enforce: advise lands advised (exit 0) — the lenient axis wins", async () => {
    // §4.1 fourth column, this machine's live posture: the observer set advise, so the
    // author's promotion cannot raise the surface back. Assembly-level, not dispatcher-level:
    // the config → git settings → dispatch chain runs for real. Mutation caught: the
    // compiler's explicit block winning over the surface (exit 2 here), or the git
    // namespace no longer read at assembly.
    writeConfig({
      adapters: { git: { enforce: 'advise' } },
      disciplines: [
        { id: HARD_ID, forbid: { added: 'TODO' }, in: 'lib/**/*.ts', enforce: 'block' },
      ],
    });
    write('lib/a.ts', 'export const x = 1;\n');
    git('add', 'lib/a.ts', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'initial');
    write('lib/a.ts', 'export const x = 1;\n// TODO fix later\n');
    git('add', 'lib/a.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(entryRows(HARD_ID)).toEqual([['advised', HARD_ID]]);
  });
});
