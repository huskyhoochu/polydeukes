/**
 * Polydeukes — a development discipline framework for building alongside an AI
 * coding partner.
 *
 * Pre-alpha. This package reserves the unscoped `polydeukes` name and is the umbrella /
 * `pdks` CLI entry point. It owns the config discovery loader (CONFIG-03) and both
 * surfaces' composition roots — `runCovenantCheck` for the commit surface and
 * `runClaudeCodeHook` for the session one — because assembly needs an adapter and the
 * covenant package at once, which no sibling is allowed to depend on. The covenant,
 * ledger, memory, and verify modules live in their own `@polydeukes/*` packages.
 *
 * This file is a barrel and nothing more. ESM re-exports are eager, so anything defined
 * here would be instantiated by every consumer of any other export — which is exactly how
 * the session adapter ended up on the commit surface's load path (PR #46 review). Keep
 * definitions in their own modules and let importers reach them directly.
 *
 * The mirror of that coupling is closed as of DIST-02. `exports` publishes `./claude-code`
 * alongside `"."`, and both delegators — this repository's and the one `pdks init
 * claude-code` generates — enter through it, so a session call no longer instantiates
 * `covenant-check.js` or `@polydeukes/adapter-git`. The window DIST-01 §3-d declared (a
 * workspace missing only that dist failing closed with no telemetry row) is gone with it.
 * See https://github.com/huskyhoochu/polydeukes
 */

export type { ResolvedConfig } from '@polydeukes/core';
export { type ClaudeCodeHookSpec, runClaudeCodeHook } from './claude-code-hook.js';
export { type CovenantCheckSpec, runCovenantCheck } from './covenant-check.js';
export { type LoadedConfig, loadConfig } from './load-config.js';
