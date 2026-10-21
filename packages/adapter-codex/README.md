# `@polydeukes/adapter-codex`

**English** · [한국어](./README.ko.md)

Translates Codex events into covenant input IR. It is included in the installed `pdks` executable.
Connect a project with:

```sh
pdks adapter codex init
```

The single executable includes all three adapters and the Node runtime. It works without a separate
Node, npm, or adapter installation. The npm package supports JavaScript module integrations.

<a id="overview"></a>
## Overview

All three adapters provide the same three functions. Each accepts one spec object and returns a
named outcome.

| Function | Role |
|---|---|
| `prepareHook` | Translate host events and collect available evidence |
| `registerHook` | Merge project hook registrations |
| `renderHookResponse` | Render the host’s allow or deny response |

The common `pdks` runtime invokes `covenant check` through the current executable. The shared judge
owns judgment and telemetry; the adapter owns translation and registration.

<a id="examples"></a>
## Examples

```ts
import { prepareHook } from '@polydeukes/adapter-codex';

const outcome = prepareHook({
  repoRoot: process.cwd(),
  rawPayload: JSON.stringify(event),
});
```

`event` is the complete event received from the host. The outcome is `check`, `recorded`, or
`unavailable`; this call does not execute the tool.

<a id="code-mode-coverage"></a>
## Code Mode coverage

Coverage depends on the host version. After approval through `/hooks`, check real file and shell
calls in `.polydeukes/roi.log`. An active registration alone does not prove nested-call coverage.

Shell paths use the event's cwd. In Codex CLI 0.163.0, one nested `exec_command` with a
`workdir` override did not block a protected file's mtime change. The raw hook payload was not
captured, so coverage of per-tool directory overrides remains unverified. Recheck it when
that payload can be inspected.

<a id="see-also"></a>
## See also

- [Package reference](../../docs/reference/packages/adapter-codex.md)
