import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The `covenantDist` seam from the side that must keep WORKING: an injected dist that
// CAN be resolved is judged exactly as the real one, so a `passed` row is unforgeable
// proof a judge ran. The seam is required rather than convenient — createRequire is real
// Node resolution and ignores this package's vitest alias, so without it the umbrella
// always points at the real build, which no fixture tree can vary.
//
// Each test builds a real throwaway git repo and writes its own tmp config, so no
// protected path of THIS repository is ever referenced. The fixture dists are symlink
// mirrors of the real build living INSIDE the throwaway repo, so they die with it.
import { runCovenantCheck } from '../src/index.ts';
import {
  type CheckRepo,
  createCheckRepo,
  REAL_COVENANT_DIST,
  distWithout as sharedDistWithout,
} from './helpers.ts';

/** Injected fixture values: the config entries and the body filenames under test. */
const PROTECTED_ENTRY = 'secret.txt';
const DISCIPLINE_ID = 'no-todo';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_SOURCE = 'lib/a.ts';
const FORBIDDEN_TOKEN = 'TODO';
/** A discipline whose evidence this surface cannot speak — it compiles to a body-less skip. */
const PRECEDENT_ID = 'needs-precedent';
const PRECEDENT_TOOL = 'WebFetch';

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

/** A complete covenant dist mirror rooted at the current throwaway repository. */
function mirroredDist(): string {
  return sharedDistWithout(repoRoot, null);
}

/** Every telemetry row as [event, label] — the label separates a verdict from a fail-closed. */
function rows(): [string, string][] {
  return readRecords(telemetryPath).records.map((record) => [record.event, record.label]);
}

/** Stage a change touching the protected entry: the self-mod judge's scenario. */
function stageProtectedChange(enforce: string): void {
  writeConfig({
    protectedPaths: [PROTECTED_ENTRY],
    adapters: { git: { enforce } },
  });
  write(PROTECTED_ENTRY, 'sensitive\n');
  git('add', PROTECTED_ENTRY, 'polydeukes.config.json');
}

/**
 * Stage a CLEAN change inside the discipline's scope: the discipline judge's scenario.
 * The config is committed first so the staged batch is the scoped source alone.
 */
function stageCleanScopedChange(enforce: string): void {
  writeConfig({
    disciplines: [{ id: DISCIPLINE_ID, forbid: { added: FORBIDDEN_TOKEN }, in: DISCIPLINE_SCOPE }],
    adapters: { git: { enforce } },
  });
  write(SCOPED_SOURCE, 'export const y = 1;\n');
  git('add', SCOPED_SOURCE, 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'initial');
  write(SCOPED_SOURCE, 'export const y = 2;\n');
  git('add', SCOPED_SOURCE);
}

/**
 * Stage a scoped change under a config whose ONLY discipline is a requirePrecedent entry.
 * This surface injects neither a transcript nor an evaluator, so that entry always compiles
 * to a skip carrying no body: one `skipped` row, identical at both enforce levels.
 */
function stagePrecedentScopedChange(enforce: string): void {
  writeConfig({
    disciplines: [
      { id: PRECEDENT_ID, requirePrecedent: { tool: PRECEDENT_TOOL }, in: DISCIPLINE_SCOPE },
    ],
    adapters: { git: { enforce } },
  });
  write(SCOPED_SOURCE, 'export const y = 1;\n');
  git('add', SCOPED_SOURCE, 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'initial');
  write(SCOPED_SOURCE, 'export const y = 2;\n');
  git('add', SCOPED_SOURCE);
}

beforeEach(() => {
  repo = createCheckRepo('pdks-check-unbuilt-', DISCIPLINE_SCOPE);
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
  vi.restoreAllMocks();
});

describe('covenant check — a resolvable dist is judged exactly as before', () => {
  it('an injected COMPLETE mirror judges the protected change exactly as the real dist', async () => {
    // The existence proof belongs to the function that PRODUCES a path, not to a manifest
    // over the dist: the commit surface has no shell axis, so a fixed-list check would
    // fail the commit closed over a body it was never going to run.
    stageProtectedChange('advise');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: mirroredDist(),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([
      ['advised', 'self-mod'],
      ['advised', 'self-mod'],
    ]);
  });

  it('a config declaring no disciplines still judges and still compiles the backstop (exit 0)', async () => {
    // A config with no `disciplines` still compiles one registration, the body-less
    // `shell-unjudgeable` backstop, and this surface never spawns that body. Demanding it
    // would close every commit in a repository that simply declares no disciplines — the
    // common config shape, not an exotic one.
    stageProtectedChange('advise');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: mirroredDist(),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([
      ['advised', 'self-mod'],
      ['advised', 'self-mod'],
    ]);
  });

  it('a discipline compiling to a body-less skip records skipped, not a fail-closed (exit 0)', async () => {
    // Declaring a discipline is not the same as spawning one: this entry's evidence
    // vocabulary is one the commit surface does not speak, so it compiles to a skip with
    // no body and nothing will ever run. Reading `disciplines.length > 0` as "a body is
    // needed" fails the commit closed over a file it was never going to execute. The
    // skipped row is the load-bearing half — it proves the compiler was still called and
    // the entry still reached a registration, so a fix that simply stops compiling when
    // the body is absent cannot pass this.
    stagePrecedentScopedChange('advise');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: mirroredDist(),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['skipped', PRECEDENT_ID]]);
  });

  it('block with the REAL dist injected still blocks through a self-mod verdict, not a fail-closed', async () => {
    // The control for the block case above: same level, same staging, only the dist
    // differs. A valid injected dist must reach the real judge and the rows must carry the
    // JUDGE's label — landing on covenant-check instead would mean the sibling cases prove
    // nothing but "any injected covenantDist throws".
    stageProtectedChange('block');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      ['blocked', 'self-mod'],
      ['blocked', 'self-mod'],
    ]);
  });

  it('advise with the REAL dist injected runs the discipline body and records it passed', async () => {
    // The control for the discipline case above: `passed` can only come from a body that
    // started and exited 0, which a missing module can never produce.
    stageCleanScopedChange('advise');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: REAL_COVENANT_DIST,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', DISCIPLINE_ID]]);
  });

  it('a judge runs out of an injected mirror too — passed is the only unforgeable proof', async () => {
    // `advised` is forgeable — a body that dies at import also exits 1 — so a mirror that
    // stopped producing runnable bodies would leave the cases above green while the
    // surface judged nothing. Only `passed` cannot be forged, and the sibling control
    // proves execution out of the REAL dist, a different object than the mirror these
    // cases use.
    //
    // What this proves is the MIRRORING MECHANISM, not every body that rides it. The
    // self-mod axis cannot be proven the same way: self-mod routes by protectedPaths, so
    // a matched call always breaks and `passed/self-mod` is unreachable. One omitted
    // symlink is the only difference between the mirrors, so a mechanism that runs one
    // body runs the others.
    stageCleanScopedChange('advise');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: mirroredDist(),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', DISCIPLINE_ID]]);
  });
});
