# `@polydeukes/adapter-codex`

**English** · [한국어](./README.ko.md)

This adapter is the install unit for the Codex session surface. It translates Codex
`PreToolUse` payloads into covenant input IR, spawns the judge, and ships the `pdks-codex` bin
that registers the surface in a project.

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

Codex normalises every file edit into one tool name, `apply_patch`, whose input is the patch
text itself rather than a file argument. This adapter parses that text and carries one IR
element per file the patch touches, so a patch spanning several files is judged file by file
and blocks as a whole. `Edit` and `Write` are matcher aliases the host never sends as a tool
name; the roster names `apply_patch` and `Bash`.

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

The host documents these, and no adapter can narrow them:

- `write_stdin` sends input to a unified-exec session that already passed `PreToolUse`, and
  does not run it again.
- Hosted tools such as web search do not take the local function-tool hook path.
- The transcript a payload names is not a stable interface, so no judgment reads it.

<a id="see-also"></a>
## See also

- [`@polydeukes/adapter-codex` package
reference](../../docs/reference/packages/adapter-codex.md)
- [The judge (`covenant` module)](../../docs/reference/packages/polydeukes.md#covenant-module)
