/**
 * Session-surface tool vocabulary.
 *
 * The PreToolUse surface's tool names, owned by the adapter that speaks them. Assembly
 * consumes these values; the core never sees them.
 */

/**
 * Tool names whose calls mutate a file and carry `fileChange` evidence.
 *
 * A tool absent from this list is judged by nobody. Removing an entry that looks
 * unused silently stops judging that tool, and no test in this repository catches it.
 */
export const MUTATING_TOOLS = ['write', 'search_replace'];

/** Tool names that carry a shell command line instead of a file target. */
export const SHELL_TOOLS = ['run_terminal_command'];

/** `tool_input` keys a shell tool's command line travels in. */
export const COMMAND_ARGS = ['command'];
