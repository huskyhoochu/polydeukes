#!/usr/bin/env node
/**
 * Polydeukes dogfooding assembly — the PreToolUse covenant hook (composition root).
 *
 * This is the one place where the adapter (Claude Code vocabulary) and the covenant
 * package (dispatcher + judge bodies) meet: packages stay one-way (each depends only
 * on core), so their composition lives here, outside the package graph. Wiring shape:
 * COVENANT-03 §4.4 + COVENANT-04d §4.5 registrations consumed through ADAPTER-03 §4.1
 * runAdapterPath, with dispatchCovenants bound to the injected dispatch seam.
 *
 * fail-closed: ANY failure here — unbuilt dist, import error, unreadable stdin — exits 2
 * (blocking). A dead hook that exits non-blocking would be the cheapest bypass vector.
 * Recovery from an unbuilt clone is `pnpm build` (mentions no protected path, so it is
 * never blocked). The sanctioned valve is the escape-hatch env var, measured as
 * `bypassed`; it is evaluated inside the dispatcher seam, never up here.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Assembly values. Agent/tool vocabulary is injected HERE — never in package
// source (CORE-01 grep gate's counterpart). The raw entries below are fed
// through core's normalizeProtectedPaths (CONFIG-02): registered adapter
// directories are auto-included, so an adapter can never be left off the
// protection surface. The normalized output is the dispatcher's literal-string
// contract.
// ---------------------------------------------------------------------------

const RAW_PROTECTED_PATHS = [
  'packages/core/src',
  'packages/core/dist',
  'packages/covenant/src',
  'packages/covenant/dist',
  '.claude/hooks',
  '.claude/settings.json',
];
const ADAPTER_DIRS = ['packages/adapter-claude-code/src', 'packages/adapter-claude-code/dist'];
const MUTATING_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash'];
const COMMAND_ARGS = ['command'];
const HATCH_ENV = 'POLYDEUKES_COVENANT_BYPASS';

const telemetryPath =
  process.env.POLYDEUKES_TELEMETRY_PATH ?? join(repoRoot, '.polydeukes', 'roi.log');

let core;
try {
  core = await import(pathToFileURL(join(repoRoot, 'packages/core/dist/index.js')).href);
  const covenant = await import(
    pathToFileURL(join(repoRoot, 'packages/covenant/dist/index.js')).href
  );
  const adapter = await import(
    pathToFileURL(join(repoRoot, 'packages/adapter-claude-code/dist/index.js')).href
  );

  const protectedPaths = core.normalizeProtectedPaths({
    protectedPaths: RAW_PROTECTED_PATHS,
    adapters: ADAPTER_DIRS,
  });

  const selfModBody = join(repoRoot, 'packages/covenant/dist/self-mod-body.js');
  const shellModBody = join(repoRoot, 'packages/covenant/dist/shell-mod-body.js');
  const pathArgs = protectedPaths.flatMap((p) => ['--protected-path', p]);

  const registrations = [
    {
      label: 'self-mod',
      protectedPaths,
      body: {
        command: process.execPath,
        args: [selfModBody, ...pathArgs, ...MUTATING_TOOLS.flatMap((t) => ['--mutating-tool', t])],
      },
      escapeHatch: covenant.envEscapeHatch(HATCH_ENV),
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
      escapeHatch: covenant.envEscapeHatch(HATCH_ENV),
    },
  ];

  const rawPayload = readFileSync(0, 'utf-8');
  const { exitCode } = await adapter.runAdapterPath({
    rawPayload,
    telemetryPath,
    dispatch: (stdinPayload) =>
      covenant.dispatchCovenants({ stdinPayload, registrations, telemetryPath }),
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
