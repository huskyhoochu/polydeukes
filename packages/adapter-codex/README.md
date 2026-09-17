# `@polydeukes/adapter-codex`

**English** · [한국어](./README.ko.md)

This adapter is the install unit for the Codex session surface. It records stable Codex
lifecycle evidence, translates `PreToolUse` payloads into covenant input IR, spawns the judge,
and ships the `pdks-codex` bin that registers the surface in a project.

Install it next to `polydeukes`, which it names as a `peerDependency`:

```sh
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-codex
npx pdks-codex init
```

Writing the registration is not the end of the install: Codex records trust against the hash
of a hook's definition, so the generated hook is skipped until you approve it with `/hooks`.
Re-running `init` writes the same command string for that reason — a changed one needs
approving again.

Installing this adapter beside `@polydeukes/adapter-claude-code` or
`@polydeukes/adapter-grok` in one project can run the judge twice per call.

<a id="overview"></a>
## Overview

Codex normalises every file edit that reaches the hook into one tool name, `apply_patch`, whose
input is the patch text itself rather than a file argument. This adapter parses that text and
carries one IR element per file the patch touches, so a patch spanning several files is judged
file by file and blocks as a whole. `Edit` and `Write` are matcher aliases the host never sends
as a tool name; the roster names `apply_patch` and `Bash`.

The same generated delegator receives four events. `UserPromptSubmit` appends timestamped human
messages, `PostToolUse` appends the tool name and object-shaped input, `PreToolUse` reads that
evidence into `session`, and `SessionEnd` removes the session file. Evidence lives under
`.polydeukes/codex-sessions/` with a SHA-256 name; the raw session id never becomes a path.

Public contract symbols include:

- `runHook`
- `COMMAND_ARGS`
- `MUTATING_TOOLS`
- `SHELL_TOOLS`

<a id="examples"></a>
## Examples

```ts
import { runHook } from '@polydeukes/adapter-codex';

// Reads the payload from stdin, spawns `pdks covenant check --enforce block` in repoRoot,
// and returns that child's exit code. This is what the generated hook delegator calls.
const { exitCode } = runHook({ repoRoot: process.cwd() });
```

<a id="limits"></a>
## What this surface does not observe

The first is measured, the rest the host documents, and no adapter can narrow them:

- A Code Mode `exec` dispatch, and every `tools.apply_patch` / `tools.exec_command` call nested
  in its JavaScript, does not reach `PreToolUse` in codex-cli 0.154
  ([openai/codex#23411](https://github.com/openai/codex/issues/23411),
  [#38850](https://github.com/openai/codex/issues/38850)). An approved hook — `/hooks` showing
  it Active — does not observe that surface.
- The roster, not the matcher, decides what is judged. This adapter translates `apply_patch`
  and `Bash` and refuses every other name with exit 2 before the judge runs — a Code Mode
  name, an MCP tool, `write_stdin`. Widening the matcher in `.codex/hooks.json` to such a name
  therefore blocks every call under it rather than judging it, and the edit changes the trust
  hash, so the hook is skipped until `/hooks` approves it again.
- `write_stdin` sends input to a unified-exec session that already passed `PreToolUse`, and
  does not run it again.
- Hosted tools such as web search do not take the local function-tool hook path.
- The transcript a payload names is not a stable interface, so no judgment reads it. Session
  evidence comes only from the registered lifecycle events. If `UserPromptSubmit` evidence is
  missing or cannot be stored, a witness retry cannot release a blocked call; use the user
  terminal named by the recovery message.

<a id="see-also"></a>
## See also

- [`@polydeukes/adapter-codex` package
reference](../../docs/reference/packages/adapter-codex.md)
- [The judge (`covenant` module)](../../docs/reference/packages/polydeukes.md#covenant-module)
