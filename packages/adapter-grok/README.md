# `@polydeukes/adapter-grok`

**English** · [한국어](./README.ko.md)

This adapter is the install unit for the Grok session surface. It translates Grok PreToolUse
payloads into covenant input IR, spawns the judge, and ships the `pdks-grok` bin that registers
the surface in a project.

Install it next to `polydeukes`, which it names as a `peerDependency`:

```sh
npm install --save-dev polydeukes @polydeukes/adapter-grok
npx pdks-grok init
```

Installing both this adapter and `@polydeukes/adapter-claude-code` in one project can run the
judge twice per call.

<a id="overview"></a>
## Overview

Public contract symbols include:

- `runHook`
- `COMMAND_ARGS`
- `MUTATING_TOOLS`
- `SHELL_TOOLS`

<a id="examples"></a>
## Examples

```ts
import { runHook } from '@polydeukes/adapter-grok';

// Reads the payload from stdin, spawns `pdks covenant check --enforce block` in repoRoot,
// and returns that child's exit code. This is what the generated hook delegator calls.
const { exitCode } = runHook({ repoRoot: process.cwd() });
```

<a id="see-also"></a>
## See also

- [`@polydeukes/adapter-grok` package
reference](../../docs/reference/packages/adapter-grok.md)
- [The judge (`covenant` module)](../../docs/reference/packages/polydeukes.md#covenant-module)
