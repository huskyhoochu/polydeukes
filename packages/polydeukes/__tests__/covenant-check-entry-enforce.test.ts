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
    // Mutation caught: the advisory asserting "commit allowed" from the advised count
    // alone while the run returns exit 2.
    writeConfig({
      disciplines: [
        { id: SOFT_ID, forbid: { added: 'TODO' }, in: 'lib/**/*.ts', enforce: 'advise' },
        { id: 'no-fixme', forbid: { added: 'FIXME' }, in: 'lib/**/*.ts' },
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
