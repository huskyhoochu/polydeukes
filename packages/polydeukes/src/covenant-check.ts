/**
 * `pdks covenant check` — the assembled commit-surface judgment runner (ADAPTER-git §4.3).
 *
 * This is the commit-surface counterpart of the session hook's composition root: the one
 * umbrella-owned place where the git adapter (staged-diff vocabulary), the covenant
 * dispatcher, and the config loader meet. Assembly order mirrors the session hook —
 * loadConfig → normalizeProtectedPaths → collect/translate → dispatchCovenants — and the
 * judge bodies it spawns are the very same covenant dist executables, so a staged change
 * receives the same verdict a session tool call would (AC-4 same-judge).
 *
 * Each staged change is dispatched as its own single-change input: one staged file is
 * the commit surface's analogue of one session tool call, so telemetry stays N:N (AC-6)
 * and `gain` reads a per-file subject rather than one opaque batch line.
 *
 * The valve is a TTY prompt (PRD §4.4 decision A): the injected `ttyPrompt` seam returns
 * the line a human typed at the terminal, compared against the config witness token in
 * FULL (COVENANT-15 — substring acceptance is forbidden). The seam's absence models a
 * non-interactive environment (CI, an AI-spawned git commit): no prompt, no witness —
 * the valve is structurally reachable only by a human at a terminal, which is the
 * commit-surface translation of "only a human utterance opens the session valve". The
 * answer is cached so one commit prompts at most once, and nothing is ever persisted —
 * a state file would be an agent-forgeable surface (PRD §7).
 *
 * fail-closed: a missing/invalid config, an unbuilt judge body, or a collector failure
 * exits 2 with one blocked record. The telemetry path is settled before the first failure
 * branch can be taken (ADAPTER-git-b §4.1), so the record has somewhere to land even when
 * the config that names its path never loaded. An empty staging area is an explicit pass
 * (nothing to judge — the dispatcher precedent of zero matches, zero records).
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import {
  collectStagedChanges,
  covenantInputFromStagedChanges,
  resolveGitAdapterSettings,
  STAGED_DELETE,
  STAGED_WRITE,
} from '@polydeukes/adapter-git';
import {
  appendRecordFailOpen,
  DEFAULT_TELEMETRY_LOG_PATH,
  normalizeProtectedPaths,
} from '@polydeukes/core';
import {
  type CovenantRegistration,
  compileDisciplineRegistrations,
  dispatchCovenants,
} from '@polydeukes/covenant';
import { loadConfig } from './load-config.js';

/** `runCovenantCheck` input (ADAPTER-git §4.3 — the contract covenant-check tests pin). */
export type CovenantCheckSpec = {
  /** Repository root — config discovery and staged collection both anchor here. */
  repoRoot: string;
  /**
   * Overrides where telemetry is written (tests and assembly injection) — the first term
   * of the precedence, ahead of the config's `telemetry.logPath` and of the default this
   * runner settles before the config loads (ADAPTER-git-b §4.1). Absent, both of those
   * apply in that order.
   */
  telemetryPath?: string;
  /** Overrides the resolved covenant dist directory (tests and assembly injection). */
  covenantDist?: string;
  /**
   * TTY valve seam: writes the given prompt and returns the line a human typed, or null
   * for no input. ABSENT means a non-TTY environment — the valve never opens (AC-3
   * human-only arming).
   */
  ttyPrompt?: (prompt: string) => string | null;
};

/**
 * Build the witness predicate for the TTY valve, or undefined when no valve can exist
 * (no witness configured, or no TTY seam — both leave the dispatcher with no way to open
 * one at all). The valve IS the witness: the judge has already broken, and the human at
 * the terminal supplies the pass condition themselves, sudo-style. The prompt fires
 * lazily on the first registration that actually BROKE and names it from the dispatcher's
 * context (COVENANT-17 §4.5) — the label and the MATCHED entry, the same subject the
 * telemetry row carries, so screen and log never disagree. The human reads what broke,
 * on what, and how far one answer reaches. The verdict is cached: one commit, at most
 * one prompt, full-token equality only — and the token itself is never printed, or
 * typing it from memory would become copying it off the screen.
 *
 * Both comparison sides are trimmed, mirroring the session valve: `ttlWitness` trims the
 * config token at assembly precisely because config validation accepts a padded value,
 * and it compares the utterance's first line trimmed — without the same normalisation
 * here, one padded token would open the session surface and permanently shut this one
 * (PR #41 review). The cache latches CLOSED before the seam is consulted: a throwing
 * seam must not retry on the next broken registration, or the prompt's own commit-wide
 * promise becomes a lie (AC §5.3 one commit, at most one prompt).
 */
function ttyWitnessValve(
  witness: { token: string } | undefined,
  ttyPrompt: ((prompt: string) => string | null) | undefined,
): CovenantRegistration['witness'] | undefined {
  if (witness === undefined || ttyPrompt === undefined) return undefined;
  const token = witness.token.trim();
  let verdict: boolean | undefined;
  return (_input, _transcript, context) => {
    if (verdict === undefined) {
      const prompt =
        `covenant: '${context.label}' broke on the staged change matching '${context.subject}'.\n` +
        'answering opens the valve for the whole commit, not just this change.\n' +
        'type the agreed token in full to open it (enter to refuse): ';
      verdict = false;
      const answer = ttyPrompt(prompt);
      verdict = answer !== null && answer.trim() === token;
    }
    return verdict;
  };
}

/**
 * Compose a judge body's module path and prove the file is there (CONFIG-06b §4.2).
 * Spawning an absent module succeeds and its child exits 1 — the code a break verdict
 * returns — so a judge that ran no line would arrive as a violation and, under `advise`,
 * be waved through. Nothing downstream can separate the two (`translateExitCode` sees
 * that number alone), so the proof happens here, before the spawn. Producing the path
 * and proving it are one step on purpose: a path that skipped the proof cannot be
 * constructed, and only the bodies this surface actually composes are proven.
 */
function provenBodyPath(distDir: string, fileName: string): string {
  const modulePath = join(distDir, fileName);
  if (!existsSync(modulePath)) {
    throw new Error(`judge body ${modulePath} is missing — run 'pnpm build' to rebuild it`);
  }
  return modulePath;
}

/**
 * One blocked record for a run that failed closed before any dispatch could judge.
 *
 * The write goes through `appendRecordFailOpen` rather than the mkdir-free `appendRecord`:
 * a repository that has never been judged has no `.polydeukes/` directory — the shape
 * `pdks init` leaves every consumer in — and the raw append would fail open on ENOENT,
 * turning the very first fail-closed run into an unrecorded block. The wrapper carries both
 * the parent-directory guarantee and the fail-open contract, so a telemetry failure still
 * never softens the blocking exit. An undefined path is tolerated here because a non-string
 * `repoRoot` leaves no root to write a row under.
 */
function recordFailClosed(telemetryPath: string | undefined): void {
  if (telemetryPath === undefined) return;
  appendRecordFailOpen(telemetryPath, {
    event: 'blocked',
    label: 'covenant-check',
    subject: '-',
  });
}

/**
 * Judge the staged changes of `repoRoot` exactly as the session surface would
 * (ADAPTER-git §4.3). Async because the dispatcher spawns covenant bodies (CORE-01) —
 * a synchronous runner would mean reimplementing the judge, which the single-dispatcher
 * principle forbids.
 */
export async function runCovenantCheck(spec: CovenantCheckSpec): Promise<{ exitCode: 0 | 2 }> {
  // Telemetry precedence settled BEFORE the failure branch (session-hook precedent): a config
  // that never loads still has somewhere to write its one blocked row, and the config value
  // replaces the provisional default once the load succeeds. The provisional default spells
  // itself with the loader's own constant, so both terms converge on one source.
  //
  // Computed INSIDE the try even though it must run first, because `join` throws on a
  // non-string repoRoot and that throw must not escape as a rejection. It leaves
  // `telemetryPath` undefined, which the catch tolerates: there is no root to write a row
  // under anyway.
  let telemetryPath: string | undefined;
  let config: ReturnType<typeof loadConfig>['config'];
  try {
    telemetryPath = spec.telemetryPath ?? join(spec.repoRoot, DEFAULT_TELEMETRY_LOG_PATH);
    ({ config } = loadConfig(spec.repoRoot));
    telemetryPath = spec.telemetryPath ?? resolve(spec.repoRoot, config.telemetry.logPath);
  } catch (error) {
    process.stderr.write(
      `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    recordFailClosed(telemetryPath);
    return { exitCode: 2 };
  }

  let changes: ReturnType<typeof collectStagedChanges>;
  try {
    changes = collectStagedChanges(spec.repoRoot);
  } catch (error) {
    process.stderr.write(
      `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    recordFailClosed(telemetryPath);
    return { exitCode: 2 };
  }
  if (changes.length === 0) {
    return { exitCode: 0 };
  }

  // Everything from here on is judgment assembly and dispatch: any throw (an unbuilt or
  // unresolvable covenant dist, a registration-build failure) is unjudgeable and must
  // both block AND leave one blocked record — the session hook's one-call-one-record
  // invariant, which an unrecorded propagation to the bin's catch would narrow
  // (review F5).
  try {
    // The adapter namespace validator throws on unknown levels/keys (CONFIG-06 §4.2) —
    // resolved inside this try so a misconfiguration fails closed, never softens.
    const { enforce, protectedPaths: gitAdditivePaths } = resolveGitAdapterSettings(
      config.adapters?.git,
    );

    // The commit surface judges the UNION of the common list and the git namespace's
    // additive one (CONFIG-08 §4.2) — common first, so first-occurrence dedupe inside
    // the one normalization pass is deterministic. The session hook reads the common
    // list alone; that asymmetry is the contract, not an omission.
    const protectedPaths = normalizeProtectedPaths({
      protectedPaths: [...(config.protectedPaths ?? []), ...gitAdditivePaths],
    });

    // The judge bodies are the covenant package's dist executables — resolved through
    // the real package (never a test alias), so the commit surface spawns the same
    // judges the session hook does. An injected directory overrides that resolution:
    // `createRequire` is real Node resolution and always lands on the real build, which
    // no fixture can take a body away from.
    const covenantDist =
      spec.covenantDist ?? dirname(createRequire(import.meta.url).resolve('@polydeukes/covenant'));
    // Under advise the TTY valve is structurally absent (CONFIG-06 §4.6): a verdict
    // already passes, so there is nothing to witness and the prompt must never fire.
    const witness =
      enforce === 'advise' ? undefined : ttyWitnessValve(config.witness, spec.ttyPrompt);

    const disciplines = config.disciplines ?? [];

    const registrations: CovenantRegistration[] = [
      {
        label: 'self-mod',
        protectedPaths,
        body: {
          command: process.execPath,
          args: [
            provenBodyPath(covenantDist, 'self-mod-body.js'),
            ...protectedPaths.flatMap((path) => ['--protected-path', path]),
            ...[STAGED_WRITE, STAGED_DELETE].flatMap((tool) => ['--mutating-tool', tool]),
          ],
        },
        witness,
      },
      // Command-family entries are excluded: the commit surface has no shell axis (a
      // staged diff carries no commands), so registering them would be spawn waste by
      // design (PRD §2) — a vacuous exclusion, hence recorded nowhere. Path and delta
      // families judge the staged fileChanges as-is.
      //
      // Context-family entries are NOT filtered out any more. No transcript is injected
      // here, so the compiler gives them skip registrations, and a skip records one
      // `skipped` exactly when its trigger matches a staged change (COVENANT-13 §4.5).
      // The commit surface stopped being a special case: an absent evidence channel gets
      // the same disposition on both surfaces, and the scope gate comes free with the
      // routing every registration already carries.
      //
      // The body path is passed as a thunk, so the proof fires only where the compiler
      // actually composes a body (CONFIG-06b §4.2 corollary). Entry count cannot stand in
      // for that: an entry may compile to a body-less skip — every `requirePrecedent` one
      // does here, since this surface injects neither transcript nor evaluator — and the
      // compiler appends the body-less `shell-unjudgeable` backstop even for zero entries,
      // so gating the call itself would drop that record.
      ...compileDisciplineRegistrations({
        disciplines: disciplines.filter((entry) => entry.forbidCommand === undefined),
        rootDir: spec.repoRoot,
        bodyCommand: process.execPath,
        bodyModulePath: () => provenBodyPath(covenantDist, 'discipline-body.js'),
        shellTools: [],
        commandArgs: [],
        witness,
      }),
    ];

    // The commit surface resolves the compiler through the installed package, so a
    // workspace whose dist predates the lazy body-path convention hands back the thunk
    // itself where a string belongs. `spawn` stringifies rather than rejects it, which
    // would spawn the judge on the thunk's own source text and record the exit 1 as a
    // verdict under a discipline's label — the confusion this ticket removes, arriving
    // through the build-skew door. Assert the shape and let the fail-closed catch answer.
    for (const registration of registrations) {
      if (registration.body !== undefined && typeof registration.body.args?.[0] !== 'string') {
        throw new Error(
          `covenant dist predates the lazy body-path convention (registration '${registration.label}') — run 'pnpm build'`,
        );
      }
    }

    let blocked = false;
    let advisedCount = 0;
    for (const change of changes) {
      const input = covenantInputFromStagedChanges([change]);
      const { exitCode, results } = await dispatchCovenants({
        stdinPayload: JSON.stringify(input),
        registrations,
        telemetryPath,
        dispatcherLabel: 'covenant-check',
        enforce,
      });
      if (exitCode === 2) blocked = true;
      advisedCount += results.filter((result) => result.event === 'advised').length;
    }
    if (advisedCount > 0) {
      process.stderr.write(
        `covenant advisory (enforce: advise): ${advisedCount} verdict(s) recorded, commit allowed\n`,
      );
    }
    return { exitCode: blocked ? 2 : 0 };
  } catch (error) {
    process.stderr.write(
      `covenant check failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    recordFailClosed(telemetryPath);
    return { exitCode: 2 };
  }
}
