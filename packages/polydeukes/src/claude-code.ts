/**
 * `polydeukes/claude-code` — the session surface's entry point.
 *
 * The delegator a consumer project's PreToolUse hook imports: one verb and its spec type.
 */

export {
  type ClaudeCodeHookOutcome,
  type ClaudeCodeHookSpec,
  runClaudeCodeHook,
} from './claude-code-hook.ts';
