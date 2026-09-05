# `@polydeukes/adapter-claude-code`

**English** · [한국어](./README.ko.md)

This adapter translates Claude Code PreToolUse payloads into covenant input IR and provides the
session-side reader factories the umbrella injects.

<a id="overview"></a>
## Overview

Public contract symbols include:

- `runAdapterPath`
- `sessionSourceReader`
- `sessionChannelReader`
- `transcriptPathFromPayload`
- `transcriptFromJsonlFile`
- `COMMAND_ARGS`
- `MUTATING_TOOLS`
- `SHELL_TOOLS`

<a id="examples"></a>
## Examples

```ts
import { runAdapterPath } from '@polydeukes/adapter-claude-code';

const outcome = await runAdapterPath({
  rawPayload: '{}',
  telemetryPath: '.polydeukes/roi.log',
  dispatch: async () => ({ exitCode: 0, results: [] }),
});
```

<a id="see-also"></a>
## See also

- [`@polydeukes/adapter-claude-code` package
reference](../../docs/reference/packages/adapter-claude-code.md)
- [`polydeukes/claude-code`](../../docs/reference/packages/polydeukes.md#polydeukes-entry-points)
- [`@polydeukes/covenant`](../../docs/reference/packages/covenant.md)
