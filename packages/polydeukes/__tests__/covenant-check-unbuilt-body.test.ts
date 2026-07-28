import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// CONFIG-06b §4.1/§4.2 RED phase. A judge body that was never built makes a run
// UNJUDGEABLE, but it arrives as body exit 1 — the same number a real break verdict
// returns — so `advise` translates a judgment that never happened into { exit 0, advised }
// and the commit proceeds. translateExitCode cannot separate the two (its only input is
// that number, §4.1), so the ambiguity is removed upstream: the assembly proves each body
// module exists and throws into the umbrella's existing fail-closed catch when one does not.
//
// New injection seam asserted here (it does NOT exist yet, so every absent-body case below
// is RED by construction):
//   runCovenantCheck({ ..., covenantDist?: string })
//     absent  → the current createRequire resolution of the real package dist, so existing
//               call sites stay unmodified (§4.2).
//     present → the directory the judge body paths are composed under.
// The seam is required rather than convenient: createRequire is real Node resolution and
// ignores this package's vitest alias, so without it the umbrella always points at the real
// build, where a body file cannot be removed.
import { runCovenantCheck } from '../src/index.ts';

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
/** The two judge bodies the umbrella composes paths for — one per assembly site. */
const SELF_MOD_BODY = 'self-mod-body.js';
const DISCIPLINE_BODY = 'discipline-body.js';
/** A body of the session surface's shell axis — one this surface never composes a path for. */
const SHELL_MOD_BODY = 'shell-mod-body.js';
/** The label the umbrella's fail-closed catch records under — never a judge's label. */
const FAIL_CLOSED_LABEL = 'covenant-check';
/** A discipline whose evidence this surface cannot speak — it compiles to a body-less skip. */
const PRECEDENT_ID = 'needs-precedent';
const PRECEDENT_TOOL = 'WebFetch';
/** The recovery command a locked-out operator must be told (§4.2). */
const RECOVERY_COMMAND = 'pnpm build';
/** The real built dist — the "body present" end of the axis. */
const REAL_COVENANT_DIST = resolve(import.meta.dirname, '../../covenant/dist');

let repoRoot: string;
let telemetryPath: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
}

function write(relPath: string, content: string): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

/** Minimal valid config (languages is required) plus the caller's extra keys. */
function writeConfig(extra: Record<string, unknown>): void {
  const config = {
    languages: {
      typescript: { productionGlob: DISCIPLINE_SCOPE, testCmd: 'echo {scope}' },
    },
    telemetry: { logPath: telemetryPath },
    ...extra,
  };
  writeFileSync(join(repoRoot, 'polydeukes.config.json'), JSON.stringify(config, null, 2));
}

/**
 * A covenant dist mirroring the real build entry-by-entry with exactly ONE judge body
 * omitted — the state a source-side addition leaves behind when nobody rebuilt. Every
 * other file is present, so only a per-FILE existence proof tells this apart from a good
 * build.
 *
 * The entries are SYMLINKS, not copies: Node resolves a module to its real path before
 * looking up `node_modules`, so a symlinked body still reaches the real build's
 * dependencies and actually runs. A copied body cannot — it dies at import with
 * ERR_MODULE_NOT_FOUND, which is body exit 1, which `advise` records as a verdict. That
 * would make every "present body" row here a fabricated judgment and leave the fixture
 * green even if body execution broke entirely. Same mirroring the session e2e uses.
 */
function distWithout(bodyFileName: string): string {
  const fixtureDist = join(repoRoot, 'covenant-dist-fixture');
  mkdirSync(fixtureDist, { recursive: true });
  for (const entry of readdirSync(REAL_COVENANT_DIST)) {
    if (entry === bodyFileName) continue;
    symlinkSync(join(REAL_COVENANT_DIST, entry), join(fixtureDist, entry));
  }
  return fixtureDist;
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
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-check-unbuilt-'));
  telemetryPath = join(repoRoot, 'roi.log');
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('CONFIG-06b §4.2 covenant check — an unbuilt judge body fails closed at assembly', () => {
  it('under advise: exit 2 and ONE covenant-check blocked row, never an advised verdict', async () => {
    // THE blocker (§3). The body never executes, node exits 1, and 1 is also what a real
    // break verdict returns — so advise records "a verdict was noted, commit allowed" for a
    // judge that ran no line, and the commit proceeds. Today this run exits 0 with two
    // advised self-mod rows. The row set is what refuses a wrong-reason green: any run that
    // still reaches routing leaves a JUDGE's label here, so only the fail-closed label
    // proves the assembly stopped before judging. Mutation caught: the existence proof
    // absent from the self-mod body path, or its throw caught somewhere that records a
    // verdict instead of the one fail-closed row.
    stageProtectedChange('advise');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: distWithout(SELF_MOD_BODY),
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL]]);
  });

  it('under block: the SAME single covenant-check row — the exit code was already right, the label was not', async () => {
    // The label half of the same fact (§3: the verdict is right and the label is wrong).
    // Block already exits 2 here today, but by accident: body exit 1 is translated up, so an
    // assembly that could not judge is written down as a self-mod VERDICT against a
    // protected entry no judge ever compared, and the gate's telemetry counts it as a real
    // block. An exit-code-only assertion cannot see that. Mutation caught: the existence
    // proof wired into the advise branch alone, leaving block to fabricate verdicts out of
    // build failures.
    stageProtectedChange('block');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: distWithout(SELF_MOD_BODY),
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL]]);
  });

  it('a dist missing only the DISCIPLINE body fails closed under advise even though nothing is violated', async () => {
    // The second assembly site, and the direction a violation fixture never reaches: the
    // umbrella composes TWO body paths, so a proof wired at one leaves the other open. Here
    // the staged change breaks nothing — with the discipline body absent and no proof, the
    // spawn's exit 1 becomes { exit 0, advised } and a clean commit is recorded as having
    // broken a discipline whose judge never started. Mutation caught: the existence proof
    // applied to the self-mod path alone (this run would then answer exit 0 with an advised
    // no-todo row, which is the shape the assertion refuses).
    stageCleanScopedChange('advise');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: distWithout(DISCIPLINE_BODY),
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL]]);
  });

  it('names the missing body file and the recovery command on stderr', async () => {
    // Fail-closed at the composition root is a lockout: the operator cannot edit their way
    // out, only rebuild (CLAUDE.md's recovery contract). An error that says nothing but
    // ENOENT leaves them without either half of that. §4.2 makes both halves part of the
    // message. Mutation caught: a bare throw with no filename, or one naming the file while
    // leaving the recovery command to be guessed.
    stageProtectedChange('advise');
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: distWithout(SELF_MOD_BODY),
    });

    const emitted = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(emitted).toContain(SELF_MOD_BODY);
    expect(emitted).toContain(RECOVERY_COMMAND);
  });
});

describe('CONFIG-06b §4.3 covenant check — a present body is judged exactly as before', () => {
  it('a dist missing a body this surface never assembles is left alone (exit 0)', async () => {
    // The over-blocking end of the same axis, and the only case that observes §4.2's form
    // constraint — "the function that PRODUCES a path proves it" — from the outside. Every
    // other absent-body fixture removes a body the umbrella really composes a path for, so
    // nothing tells "prove each path you produce" apart from "check a fixed list of four
    // filenames". The commit surface has no shell axis and never spawns this body; a list
    // check would fail the commit closed over a file it was never going to run, which is
    // the failure that sends people to the waiver. Mutation caught: the existence proof
    // written as a manifest over the dist rather than as the path constructor itself.
    stageProtectedChange('advise');

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: distWithout(SHELL_MOD_BODY),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([
      ['advised', 'self-mod'],
      ['advised', 'self-mod'],
    ]);
  });

  it('a dist missing the discipline body is left alone when no disciplines are declared (exit 0)', async () => {
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
      covenantDist: distWithout(DISCIPLINE_BODY),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([
      ['advised', 'self-mod'],
      ['advised', 'self-mod'],
    ]);
  });

  it('a discipline compiling to a body-less skip does not demand the discipline body (exit 0)', async () => {
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
      covenantDist: distWithout(DISCIPLINE_BODY),
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

  it('a body runs out of a distWithout() mirror too — passed is the only unforgeable proof', async () => {
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
      covenantDist: distWithout(SHELL_MOD_BODY),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', DISCIPLINE_ID]]);
  });
});
