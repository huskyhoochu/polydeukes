/**
 * `runClaudeCodeHook` — the assembled session-surface judgment runner (DIST-01 §3-c).
 *
 * The session counterpart of {@link runCovenantCheck}, and the one place where the Claude
 * Code adapter (tool vocabulary, up-translation) and the covenant package (dispatcher +
 * judge bodies) meet. Packages stay one-way — each depends only on core — so their
 * composition lives here, in the umbrella, and the repository's PreToolUse hook shrinks to
 * a delegator that calls this function. That is what makes the session surface installable:
 * a consumer registers a hook that resolves this package instead of copying assembly.
 *
 * Wiring shape: COVENANT-03 §4.4 + COVENANT-04d §4.5 registrations consumed through
 * ADAPTER-03 §4.1 `runAdapterPath`, with `dispatchCovenants` bound to the injected dispatch
 * seam. The protection-policy data (protectedPaths / disciplines / witness) is read from the
 * root data config through {@link loadConfig} (CONFIG-03), which also attaches the config
 * file to its own surface.
 *
 * The valve is the TTL witness (COVENANT-06, moved behind the verdict by COVENANT-17)
 * judged over the JSONL transcript provider (ADAPTER-04). The judge body always spawns, and
 * only an outcome that translated to blocked consults the witness — `witnessed` rows are
 * would-block only. Its defence is provenance rather than secrecy: only a real human
 * utterance carries the transcript marking `findUserMessages()` admits.
 *
 * fail-closed: ANY failure — an unbuilt judge body, an unreadable stdin, a missing or
 * invalid config file — resolves to `{ exitCode: 2 }` with one `blocked` record under the
 * `hook` label. Nothing throws: an uncaught rejection would exit the delegator non-blocking,
 * the cheapest bypass vector there is. Recovery from an unbuilt clone is `pnpm build` (it
 * mentions no protected path, so it is never blocked).
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  COMMAND_ARGS,
  evaluatePrecedent,
  MUTATING_TOOLS,
  runAdapterPath,
  SHELL_TOOLS,
  transcriptFromJsonlFile,
  transcriptPathFromPayload,
} from '@polydeukes/adapter-claude-code';
import { appendRecordFailOpen, normalizeProtectedPaths } from '@polydeukes/core';
import {
  type CovenantRegistration,
  compileDisciplineRegistrations,
  dispatchCovenants,
  transcriptModRegistration,
  ttlWitness,
} from '@polydeukes/covenant';
import { loadConfig } from './load-config.js';

/** `runClaudeCodeHook` input (DIST-01 §3-c) — the `CovenantCheckSpec` shape, session side. */
export type ClaudeCodeHookSpec = {
  /** Repository root — config discovery and discipline glob scoping both anchor here. */
  repoRoot: string;
  /** One raw PreToolUse payload. ABSENT means read fd 0 (the hook's real stdin). */
  rawPayload?: string;
  /** Overrides the config's telemetry log path (tests and assembly injection). */
  telemetryPath?: string;
  /** Overrides the resolved covenant dist directory (tests and assembly injection). */
  covenantDist?: string;
};

/**
 * Compose a judge body path and prove it exists (CONFIG-06b §4.2). A body module that was
 * never built makes node exit 1 — the same code a real break verdict returns — so nothing
 * downstream can separate an unjudgeable run from a judged one. The proof therefore belongs
 * to the act of composing the path, and a body this assembly composes no path for is never
 * proven: the throw lands in the fail-closed catch below, one blocked record and exit 2.
 */
function provenBodyPath(distDir: string, fileName: string): string {
  const modulePath = join(distDir, fileName);
  if (!existsSync(modulePath)) {
    throw new Error(`judge body ${modulePath} is missing — run 'pnpm build' to rebuild it`);
  }
  return modulePath;
}

/**
 * Judge one declared tool call before it runs (DIST-01 §3-c). Async because the dispatcher
 * spawns covenant bodies (CORE-01) — a synchronous runner would mean reimplementing the
 * judge, which the single-dispatcher principle forbids.
 */
export async function runClaudeCodeHook(spec: ClaudeCodeHookSpec): Promise<{ exitCode: 0 | 2 }> {
  // Env-first telemetry precedence (E2E contract), settled BEFORE any failure branch: a
  // config that never loads still has somewhere to write its one blocked row. The config
  // value applies after the load succeeds.
  //
  // Computed INSIDE the try even though it must run first, because `join` throws on a
  // non-string repoRoot and this function's contract is that nothing escapes it — a rejection
  // would exit a delegator non-blocking, which is the cheapest bypass there is. A throw here
  // leaves `telemetryPath` undefined, which the catch tolerates: there is no root to write a
  // row under anyway (PR #46 review).
  let telemetryPath: string | undefined;
  try {
    const envTelemetryPath = process.env.POLYDEUKES_TELEMETRY_PATH;
    telemetryPath =
      spec.telemetryPath ?? envTelemetryPath ?? join(spec.repoRoot, '.polydeukes', 'roi.log');

    // Discovery + parse + validation are the loader's job; a throw here (absent, ambiguous,
    // unparseable, or invalid config) falls into the fail-closed catch.
    const { config } = loadConfig(spec.repoRoot);
    telemetryPath =
      spec.telemetryPath ?? envTelemetryPath ?? resolve(spec.repoRoot, config.telemetry.logPath);
    // Settled for the rest of the happy path. The `let` above exists so the catch can still
    // record when a failure lands before this point; a closure cannot narrow it, so the
    // dispatch seam below takes this const instead.
    const logPath = telemetryPath;

    const rawPayload = spec.rawPayload ?? readFileSync(0, 'utf-8');

    // The transcript path travels in the raw payload only — up-translation drops it, so the
    // adapter reads it from the string. Every failure narrows to `undefined`, which leaves
    // the dispatcher on its `noopTranscript` default: lost evidence closes the valve rather
    // than opening it (ADAPTER-04 §4.4).
    const transcriptPath = transcriptPathFromPayload(rawPayload);
    const transcript =
      transcriptPath === undefined ? undefined : transcriptFromJsonlFile(transcriptPath);

    // The live transcript is the evidence channel the context family reads AND the one the
    // witness reads, so erasing or forging it disables every context discipline while
    // opening or shutting the human valve on the same file. It lives outside the repository,
    // so no config `protectedPaths` entry can reach it — and since COVENANT-07c it does NOT
    // join this list either. A file deep under HOME makes HOME itself a protected ANCESTOR,
    // which measured as the COVENANT-13 over-block: `cd /home/<user>` refused for two weeks,
    // and the 07b attempt to register the home spellings alongside only widened that to
    // `echo $HOME` and every edit whose content carried a bare `~`. Assembly knows the path
    // AND the home value, so assembly registers a dedicated `matches` predicate over that
    // ONE file instead (transcript-mod, below): equality-only — never an ancestor — with the
    // `~`/`$HOME`/`${HOME}`/`~<user>` spellings closed as data, reads absolved by the
    // read-only allowlist, and ancestor destruction outside the repository declared out of
    // observation scope (07c §2: the agent's own deny policy owns what no repo-scoped judge
    // can). The witness valve applies to it like any other registration.
    const protectedPaths = normalizeProtectedPaths({
      protectedPaths: config.protectedPaths ?? [],
    });

    // One witness predicate shared by every registration: a witness is a session-wide
    // permission the human granted, not a per-covenant one. Absent `witness` config leaves
    // this undefined, and no verdict can be witnessed open at all. The predicate receives
    // the transcript as its second argument from the dispatcher (CORE-04 seam), which is why
    // the transcript is injected below rather than captured here.
    const witness =
      config.witness === undefined
        ? undefined
        : ttlWitness({
            token: config.witness.token,
            // Minutes are the human-facing unit in config; the predicate takes milliseconds.
            // Core passes the value through verbatim, so the conversion belongs to assembly.
            ttlMs: config.witness.ttlMinutes * 60_000,
          });

    // The judge bodies are the covenant package's dist executables — resolved through the
    // real package (never a test alias), so the session surface spawns the same judges the
    // commit surface does. An injected directory overrides that resolution: `createRequire`
    // is real Node resolution and always lands on the real build, which no fixture tree can
    // take a body away from.
    const covenantDist =
      spec.covenantDist ?? dirname(createRequire(import.meta.url).resolve('@polydeukes/covenant'));

    // Only the two unconditional registrations compose their paths here. The transcript-mod
    // and discipline bodies are composed inside the conditions that decide whether their
    // registrations exist at all — proving a body this run will never spawn would close a
    // call over a file it was never going to use (CONFIG-06b §4.2 corollary).
    const selfModBody = provenBodyPath(covenantDist, 'self-mod-body.js');
    const shellModBody = provenBodyPath(covenantDist, 'shell-mod-body.js');
    const disciplines = config.disciplines ?? [];
    const pathArgs = protectedPaths.flatMap((path) => ['--protected-path', path]);

    const registrations: CovenantRegistration[] = [
      {
        label: 'self-mod',
        protectedPaths,
        body: {
          command: process.execPath,
          args: [
            selfModBody,
            ...pathArgs,
            ...MUTATING_TOOLS.flatMap((tool) => ['--mutating-tool', tool]),
          ],
        },
        witness,
      },
      {
        label: 'shell-mod',
        protectedPaths,
        body: {
          command: process.execPath,
          args: [
            shellModBody,
            ...pathArgs,
            ...SHELL_TOOLS.flatMap((tool) => ['--shell-tool', tool]),
            ...COMMAND_ARGS.flatMap((arg) => ['--command-arg', arg]),
          ],
        },
        witness,
      },
      // The transcript's own registration (COVENANT-07c). Routing is the matches predicate,
      // never path mention, so the home directory cannot become a protected ancestor. No
      // transcript in the payload means nothing to protect — the valve and the context
      // family already forfeited on the same absence.
      ...(transcriptPath === undefined
        ? []
        : [
            transcriptModRegistration({
              transcriptPath,
              // The env value first, since that is what the judged shell expands `~` and
              // `$HOME` from. `homedir()` reads the same passwd entry bash falls back to when
              // HOME is unset, so a hook spawned without an environment (a service manager,
              // `env -i`) keeps judging the home spellings instead of silently going
              // absolute-only — an inert spelling closure looks identical to a passing call.
              home: process.env.HOME ?? homedir(),
              bodyCommand: process.execPath,
              bodyModulePath: provenBodyPath(covenantDist, 'transcript-mod-body.js'),
              shellTools: SHELL_TOOLS,
              commandArgs: COMMAND_ARGS,
              mutatingTools: MUTATING_TOOLS,
              witness,
            }),
          ]),
      // The body path is passed as a thunk, so the proof fires only where the compiler
      // actually composes a body. Entry count cannot stand in for that: an entry may compile
      // to a body-less skip (a `requirePrecedent` one whenever no transcript came with the
      // payload), and the compiler appends the body-less `shell-unjudgeable` backstop even
      // for zero entries — gating the call itself would drop that record and turn an
      // uncomputable shell write back into a silent pass, undoing COVENANT-10b.
      ...compileDisciplineRegistrations({
        disciplines,
        rootDir: spec.repoRoot,
        bodyCommand: process.execPath,
        bodyModulePath: () => provenBodyPath(covenantDist, 'discipline-body.js'),
        shellTools: SHELL_TOOLS,
        commandArgs: COMMAND_ARGS,
        witness,
        // Context-family evidence is evaluated here, at assembly: a spawned body cannot hold
        // a transcript, and passing a path would leak JSONL knowledge into covenant
        // (COVENANT-13 §4.4). The adapter brings the evaluator for its own `subagent`/`tool`
        // vocabulary; core owns `command`, which the compiler judges directly.
        transcript,
        evaluatePrecedent,
      }),
    ];

    // This assembly is versioned with the umbrella; the covenant dist it composes against is
    // resolved from the installation graph, so a workspace nobody rebuilt pairs a new
    // assembly with an old compiler — and an old compiler stores the body-path thunk itself
    // where a string belongs. `spawn` does not reject a non-string argv entry — it
    // stringifies it — so the judge would be spawned on the thunk's own source text, exit 1,
    // and be recorded as a VERDICT under a discipline's label. Assert the shape and let the
    // fail-closed catch answer instead.
    for (const registration of registrations) {
      if (registration.body !== undefined && typeof registration.body.args?.[0] !== 'string') {
        throw new Error(
          `covenant dist predates the lazy body-path convention (registration '${registration.label}') — run 'pnpm build'`,
        );
      }
    }

    return await runAdapterPath({
      rawPayload,
      telemetryPath: logPath,
      dispatch: (stdinPayload) =>
        dispatchCovenants({ stdinPayload, registrations, telemetryPath: logPath, transcript }),
    });
  } catch (error) {
    process.stderr.write(
      `covenant hook failed closed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    // Honor the one-call-one-record invariant with a blocked record under the assembly's own
    // label (COVENANT-07 §4.3) — never a judge's, since no judge answered. `undefined` means
    // the failure landed before a path could even be composed (a non-string repoRoot), where
    // there is nowhere to write and nothing to attribute the row to.
    if (telemetryPath !== undefined) {
      appendRecordFailOpen(telemetryPath, { event: 'blocked', label: 'hook', subject: '-' });
    }
    return { exitCode: 2 };
  }
}
