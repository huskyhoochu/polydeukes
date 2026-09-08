# `@polydeukes/adapter-claude-code`

**English** · [한국어](./README.ko.md)

This adapter is the install unit for the Claude Code session surface. It translates Claude Code
PreToolUse payloads into covenant input IR, spawns the judge, and ships the `pdks-claude-code`
bin that registers the surface in a project. It also provides the session-side reader factories
the umbrella injects.

Install it next to `polydeukes`, which it names as a `peerDependency`:

```sh
npm install --save-dev polydeukes @polydeukes/adapter-claude-code
npx pdks-claude-code init
```

<a id="overview"></a>
## Overview

Public contract symbols include:

- `runHook`
- `sessionSourceReader`
- `sessionChannelReader`
- `sessionEvidenceFromPayload`
- `transcriptPathFromPayload`
- `transcriptFromJsonlFile`
- `COMMAND_ARGS`
- `MUTATING_TOOLS`
- `SHELL_TOOLS`

<a id="examples"></a>
## Examples

```ts
import { runHook } from '@polydeukes/adapter-claude-code';

// Reads the payload from stdin, spawns `pdks covenant check --enforce block` in repoRoot,
// and returns that child's exit code. This is what the generated hook delegator calls.
const { exitCode } = runHook({ repoRoot: process.cwd() });
```

<a id="see-also"></a>
## See also

- [`@polydeukes/adapter-claude-code` package
reference](../../docs/reference/packages/adapter-claude-code.md)
- [The umbrella's entry points](../../docs/reference/packages/polydeukes.md#polydeukes-entry-points)
- [The judge (`covenant` module)](../../docs/reference/packages/polydeukes.md#covenant-module)
