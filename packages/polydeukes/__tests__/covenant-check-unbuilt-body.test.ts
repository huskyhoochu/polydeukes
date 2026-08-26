import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// CONFIG-06b §4.3 — the `covenantDist` seam, from the side that must keep WORKING. The
// fail-closed half of this axis moved to covenant-dist-module-missing.test.ts when
// DISPATCH-01 folded the judges in-process: with no body file left to stat, the existence
// proof became the package import, and a per-FILE absence no longer means anything. What
// survives here is the seam's other obligation — an injected dist that CAN be resolved is
// judged exactly as the real one, so a `passed` row is unforgeable proof a judge ran.
//
// The seam is required rather than convenient: createRequire is real Node resolution and
// ignores this package's vitest alias, so without it the umbrella always points at the real
// build, which no fixture tree can vary.
import { runCovenantCheck } from '../src/index.ts';
import {
  type CheckRepo,
  createCheckRepo,
  REAL_COVENANT_DIST,
  distWithout as sharedDistWithout,
} from './helpers.ts';

// ---------------------------------------------------------------------------
// Each test builds a real throwaway git repo AND writes its own tmp config file, so
// no protected path from THIS repository is ever referenced — the fixture configs are
// absolute tmp paths and safe to author. The fixture dists are symlink mirrors of the real
// build living INSIDE the throwaway repo, so they die with it and are never staged.
// ---------------------------------------------------------------------------

/** Injected fixture values: the config entries and the body filenames under test. */
const PROTECTED_ENTRY = 'secret.txt';
const DISCIPLINE_ID = 'no-todo';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_SOURCE = 'lib/a.ts';
const FORBIDDEN_TOKEN = 'TODO';
/** A body of the session surface's shell axis — one this surface never composes a path for. */
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
 * to a skip carrying no body — measured: one `skipped` row, identical at both enforce levels.
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

describe('CONFIG-06b §4.3 covenant check — a resolvable dist is judged exactly as before', () => {
  it('an injected COMPLETE mirror judges the protected change exactly as the real dist', async () => {
    // The over-blocking end of the same axis, and the only case that observes §4.2's form
    // constraint — "the function that PRODUCES a path proves it" — from the outside. Every
    // other absent-body fixture removes a body the umbrella really composes a path for, so
    // nothing tells "prove each path you produce" apart from "check a fixed list of four
    // filenames". The commit surface has no shell axis and never spawns this body; a list
    // check would fail the commit closed over a file it was never going to run, which is
    // the failure that sends people to the witness. Mutation caught: the existence proof
    // written as a manifest over the dist rather than as the path constructor itself.
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
    // The same over-block one level subtler than the sibling above. A config with no
    // `disciplines` still compiles one registration — the body-less `shell-unjudgeable`
    // backstop — so this surface never spawns that body, and demanding it closes a commit
    // over a judge it was never going to run. A config declaring no disciplines is the
    // common shape, not an exotic one. Mutation caught: the body path obtained eagerly
    // rather than at the one place the compiler composes a body.
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
    // F2, the review's second finding. Declaring a discipline is not the same as spawning
    // one: this entry's evidence vocabulary is one the commit surface does not speak, so it
    // compiles to a skip with no body and nothing will ever run. An assembly that reads
    // `disciplines.length > 0` as "a body is needed" fails the commit closed over a file it
    // was never going to execute — today exactly that, exit 2 with a covenant-check row.
    // The skipped row is the load-bearing half: it proves the compiler was still called and
    // the entry still reached a registration, so a "fix" that simply stops compiling when
    // the body is absent cannot pass this. Mutation caught: the spawn question answered at
    // the assembly, where the answer is not known.
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
    // The control for the block case above: same level, same staging, only the dist differs.
    // A valid injected dist must reach the real judge and the rows must carry the JUDGE's
    // label — if this landed on covenant-check, the two absent-body pins would be proving
    // nothing but "any injected covenantDist throws". Mutation caught: the existence proof
    // rejecting a file that is present (a reversed join, or a check against a body name the
    // build does not emit), which fails every commit closed in a healthy repository.
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
    // The control for the discipline case above, and the one assertion in this file that
    // proves a body actually EXECUTED: `passed` can only come from a process that started
    // and exited 0, which a missing module can never produce. That is what makes the sibling
    // pin's fixture honest rather than merely red. Mutation caught: the existence proof
    // throwing on a present discipline body, which turns every commit in a repository that
    // declares disciplines into exit 2.
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
    // F3, fixture honesty. Every over-block pin above reads `advised` rows out of a mirror,
    // and `advised` is forgeable: a body that dies at import also exits 1, so a mirror that
    // stopped producing runnable bodies would leave those pins green while the surface
    // judged nothing at all. Only `passed` cannot be forged — a module that never loaded
    // can only exit 1. The sibling control proves execution out of the REAL dist, which is
    // a different object; this proves it out of the fixture the pins actually use. Mutation
    // caught: the mirror reverted to copies (relative imports resolve inside the fixture
    // directory and die), or an entry the per-file mirroring mishandles.
    //
    // What this proves is the MIRRORING MECHANISM, not every body that rides it. The
    // self-mod axis the `advised` pins read cannot be proven the same way here: self-mod
    // routes by protectedPaths, so a matched call always breaks and `passed/self-mod` is
    // unreachable, while the body's own break reason goes to inherited fd 2 rather than
    // through a spyable `process.stderr.write`. One omitted symlink is the only difference
    // between the mirrors, so a mechanism that runs one body runs the others.
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
