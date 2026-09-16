/**
 * Session-surface tool vocabulary.
 *
 * The PreToolUse surface's tool names, owned by the adapter that speaks them. Assembly
 * consumes these values; the core never sees them.
 */

/**
 * Tool names whose calls mutate a file and carry `fileChange` evidence.
 *
 * This host normalises every file edit into one name, so the list is closed at one entry.
 * Removing it silently stops judging every file edit, and no test in this repository
 * catches that.
 */
export const MUTATING_TOOLS = ['apply_patch'];

/** Tool names that carry a shell command line instead of a file target. */
export const SHELL_TOOLS = ['Bash'];

/**
 * The `tool_input` key a command travels in. Both tool names this host sends use it — a
 * shell line and a patch text arrive under the same key — so the adapter reads it directly
 * as well as declaring it.
 */
export const COMMAND_ARG = 'command';

/** `tool_input` keys a shell tool's command line travels in. */
export const COMMAND_ARGS = [COMMAND_ARG];
