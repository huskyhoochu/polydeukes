#!/usr/bin/env node
/**
 * Polydeukes dogfooding assembly — the PreToolUse covenant hook (composition root).
 *
 * This is the one place where the adapter (Claude Code vocabulary) and the covenant
 * package (dispatcher + judge bodies) meet: packages stay one-way (each depends only
 * on core), so their composition lives here, outside the package graph. Wiring shape:
 * COVENANT-03 §4.4 + COVENANT-04d §4.5 registrations consumed through ADAPTER-03 §4.1
 * runAdapterPath, with dispatchCovenants bound to the injected dispatch seam. Since
 * CONFIG-03 the protection-policy data (protectedPaths / adapters / disciplines) is
 * no longer inlined here — it is read from the root data config via the umbrella
 * loader (`loadConfig`), which also attaches the config file to its own surface.
 *
 * The escape hatch is the TTL waiver (COVENANT-06) judged over the JSONL transcript
 * provider (ADAPTER-04), configured from the root config's `waiver` block (CONFIG-05).
 * The env valve it replaces had no expiry: armed once, it stayed open for the rest of
 * the session and measured 562 bypasses in a single day. A waiver is typed by a human
 * into the conversation and lapses on its own, so "forgot to disarm" stops existing as
 * a failure mode. Its defence is provenance rather than secrecy — only a real human
 * utterance carries the transcript marking `findUserMessages()` admits, and no agent
 * can forge that marking, which is why the token is safe to keep in plain config.
 *
 * fail-closed: ANY failure here — unbuilt dist, import error, unreadable stdin, a
 * missing or invalid config file — exits 2 (blocking). A dead hook that exits
 * non-blocking would be the cheapest bypass vector. Recovery from an unbuilt clone is
 * `pnpm build` (mentions no protected path, so it is never blocked). A config with no
 * `waiver` block stays valid and simply arms no valve at all.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Assembly wiring. Agent/tool vocabulary is injected HERE — never in package
// source (CORE-01 grep gate's counterpart). Protection-policy DATA lives in the
// root config file (CONFIG-03); only agent vocabulary and dist import paths
// remain in this file.
// ---------------------------------------------------------------------------

const MUTATING_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash'];
const COMMAND_ARGS = ['command'];

// Env-first telemetry precedence (E2E contract); the config value applies after load.
const envTelemetryPath = process.env.POLYDEUKES_TELEMETRY_PATH;
let telemetryPath = envTelemetryPath ?? join(repoRoot, '.polydeukes', 'roi.log');

let core;
try {
  core = await import(pathToFileURL(join(repoRoot, 'packages/core/dist/index.js')).href);
  const covenant = await import(
    pathToFileURL(join(repoRoot, 'packages/covenant/dist/index.js')).href
  );
  const adapter = await import(
    pathToFileURL(join(repoRoot, 'packages/adapter-claude-code/dist/index.js')).href
  );
  const umbrella = await import(
    pathToFileURL(join(repoRoot, 'packages/polydeukes/dist/index.js')).href
  );

  // Discovery + parse + validation are the loader's job; a throw here (absent,
  // ambiguous, unparseable, or invalid config) falls into the fail-closed catch.
  const { config } = umbrella.loadConfig(repoRoot);
  telemetryPath = envTelemetryPath ?? resolve(repoRoot, config.telemetry.logPath);

  const protectedPaths = core.normalizeProtectedPaths({
    protectedPaths: config.protectedPaths,
    adapters: config.adapters,
  });

  const rawPayload = readFileSync(0, 'utf-8');

  // The transcript path travels in the raw payload only — up-translation drops it, so
  // it is read here and nowhere else. Every failure narrows to `undefined`, which leaves
  // the dispatcher on its `noopTranscript` default: lost evidence closes the valve
  // rather than opening it (ADAPTER-04 §4.4).
  let transcript;
  try {
    const parsed = JSON.parse(rawPayload);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof parsed.transcript_path === 'string'
    ) {
      transcript = adapter.transcriptFromJsonlFile(parsed.transcript_path);
    }
  } catch {
    // A payload this hook cannot parse is still dispatched: runAdapterPath owns that
    // verdict (one blocked record). Only the valve is forfeited here.
  }

  // One waiver predicate shared by every registration: a waiver is a session-wide
  // permission the human granted, not a per-covenant one. Absent `waiver` config leaves
  // this undefined, and the dispatcher then has no bypass path at all. The predicate
  // receives the transcript as its second argument from the dispatcher (CORE-04 seam),
  // which is why the transcript is injected below rather than captured here.
  const escapeHatch =
    config.waiver === undefined
      ? undefined
      : covenant.ttlWaiverHatch({
          token: config.waiver.token,
          // Minutes are the human-facing unit in config; the predicate takes milliseconds.
          // Core passes the value through verbatim, so the conversion belongs to assembly.
          ttlMs: config.waiver.ttlMinutes * 60_000,
        });

  const selfModBody = join(repoRoot, 'packages/covenant/dist/self-mod-body.js');
  const shellModBody = join(repoRoot, 'packages/covenant/dist/shell-mod-body.js');
  const disciplineBody = join(repoRoot, 'packages/covenant/dist/discipline-body.js');
  const pathArgs = protectedPaths.flatMap((p) => ['--protected-path', p]);

  const registrations = [
    {
      label: 'self-mod',
      protectedPaths,
      body: {
        command: process.execPath,
        args: [selfModBody, ...pathArgs, ...MUTATING_TOOLS.flatMap((t) => ['--mutating-tool', t])],
      },
      escapeHatch,
    },
    {
      label: 'shell-mod',
      protectedPaths,
      body: {
        command: process.execPath,
        args: [
          shellModBody,
          ...pathArgs,
          ...SHELL_TOOLS.flatMap((t) => ['--shell-tool', t]),
          ...COMMAND_ARGS.flatMap((a) => ['--command-arg', a]),
        ],
      },
      escapeHatch,
    },
    ...covenant.compileDisciplineRegistrations({
      disciplines: config.disciplines ?? [],
      rootDir: repoRoot,
      bodyCommand: process.execPath,
      bodyModulePath: disciplineBody,
      shellTools: SHELL_TOOLS,
      commandArgs: COMMAND_ARGS,
      escapeHatch,
    }),
  ];

  const { exitCode } = await adapter.runAdapterPath({
    rawPayload,
    telemetryPath,
    dispatch: (stdinPayload) =>
      covenant.dispatchCovenants({ stdinPayload, registrations, telemetryPath, transcript }),
  });
  process.exit(exitCode);
} catch (error) {
  console.error(`covenant hook failed closed: ${error?.message ?? error}`);
  // If core imported before the failure, honor the one-call-one-record invariant with a
  // blocked record (COVENANT-07 §4.3). If core import itself failed, no record is possible.
  if (core?.appendRecord) {
    try {
      mkdirSync(dirname(telemetryPath), { recursive: true });
      core.appendRecord(telemetryPath, {
        timestamp: new Date().toISOString(),
        event: 'blocked',
        label: 'hook',
        subject: '-',
      });
    } catch {
      // A telemetry failure must never convert the blocking exit into a bypass.
    }
  }
  process.exit(2);
}
