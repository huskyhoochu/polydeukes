/**
 * @polydeukes/adapter-codex — records Codex lifecycle evidence, up-translates PreToolUse
 * payloads, `apply_patch` text included, into the agent-neutral covenant input IR, and
 * registers the session surface.
 *
 * Beta. Agent and tool literals live here by design: this package is the boundary where
 * Codex's vocabulary is translated away before it reaches the core.
 */

export { type RunHookOutcome, type RunHookSpec, runHook } from './hook.ts';
export { COMMAND_ARGS, MUTATING_TOOLS, SHELL_TOOLS } from './session-vocabulary.ts';
