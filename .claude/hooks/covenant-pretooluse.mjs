#!/usr/bin/env node
/**
 * Polydeukes dogfooding delegator — the PreToolUse covenant hook (DIST-01).
 *
 * Assembly no longer lives here. It moved into the `polydeukes` umbrella as
 * `runClaudeCodeHook`, so this repository consumes the same entry point a consumer
 * project would — the hook a user installs is this file, and nothing in it is
 * specific to this checkout. That is what makes the session surface shippable, and
 * it is also why this repository stays the first consumer of what it ships: the
 * verdicts we meet every day are the shipped artifact being exercised.
 *
 * The session subpath, never the package barrel (DIST-02 §3-c). Barrel re-exports are
 * eager, so entering through `polydeukes` would load the commit surface and its git
 * adapter on every session call. `pdks init claude-code` generates this same import.
 *
 * `repoRoot` comes from this file's own location, never `process.cwd()`. A hook is
 * spawned with whatever working directory the agent happened to hold, and the e2e
 * harnesses spawn copies of this file from fixture trees; both need the root that
 * CONTAINS the hook, which is always `../..` from here.
 *
 * fail-closed: `runClaudeCodeHook` translates every failure it can reach into exit 2
 * with one blocked record. This catch answers only for what it cannot reach — the
 * package failing to resolve or load at all (an uninstalled or unbuilt clone), where
 * no telemetry writer exists yet. Recovery is `pnpm install && pnpm build` (neither
 * mentions a protected path, so neither is ever blocked).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  const { runClaudeCodeHook } = await import('polydeukes/claude-code');
  const { exitCode } = await runClaudeCodeHook({ repoRoot });
  process.exit(exitCode);
} catch (error) {
  console.error(`covenant hook failed closed: ${error?.message ?? error}`);
  process.exit(2);
}
