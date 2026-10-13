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

<a id="code-mode-coverage"></a>
## Code Mode coverage by version

Code Mode hook coverage varies by CLI version. On 2026-10-13, a macOS/zsh measurement of
codex-cli **0.162.1** explicitly enabled the under-development `code_mode` and `code_mode_only`
options in two sessions using workspace 0.19.0 packages and existing approved hooks. Three
nested calls were measured: `tools.exec_command`, an ordinary-file same-content
`tools.apply_patch`, and a protected-config same-content `tools.apply_patch`. The shell call
was judged through `Bash` and the patches through `apply_patch`. The first two produced
judgment rows; the protected patch was rejected by `PreToolUse` before execution and logged
as `blocked self-mod`.

A local **0.156.1** measurement also observed nested shell calls and blocked a protected
patch. The **0.154.0** measurement observed neither the outer `exec` dispatch nor its nested
calls ([original report and version follow-up](https://github.com/huskyhoochu/polydeukes/issues/64)).
The outer `exec` is outside the adapter's tool roster; the later measurements do not establish
an outer `exec` hook payload. The [host's hook documentation](https://learn.chatgpt.com/docs/hooks)
describes hook decisions applying to nested Code Mode calls.

After approving the hook, verify actual judgments in `.polydeukes/roi.log` on your installed
host. `/hooks` showing Active alone does not establish coverage. `pdks-codex init` prints this
version-dependent scope and verification advice as a `note:` line.

<a id="limits"></a>
## What this surface does not observe

The adapter's roster and the host's tool paths set these limits:

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
