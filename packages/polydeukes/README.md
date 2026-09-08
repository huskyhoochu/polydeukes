# `polydeukes`

**English** · [한국어](./README.ko.md)

Polydeukes is the umbrella package. Install this package; it ships the `pdks` bin, the judge,
both surfaces' composition roots, the session-surface runner subpath, and the bundled schema
artifact.

<a id="overview"></a>
## Overview

Public contract entry points:

- `pdks` / `polydeukes` — the bin
- `polydeukes/claude-code` → `runClaudeCodeHook`
- `polydeukes/schema.json`

CLI commands:

- `pdks covenant check`
- `pdks init`
- `pdks-grok init` (ships with `@polydeukes/adapter-grok`)
- `pdks explain`
- `pdks docs [topic]`

<a id="public-symbols"></a>
## Public symbols

```ts
import { runClaudeCodeHook } from 'polydeukes/claude-code';

function runClaudeCodeHook(spec: {
  repoRoot: string;
  rawPayload?: string;
  telemetryPath?: string;
}): Promise<{ exitCode: 0 | 2 }>;
```

<a id="see-also"></a>
## See also

- [`polydeukes` package reference](../../docs/reference/packages/polydeukes.md)
- [`Configuration reference`](../../docs/reference/configuration/index.md)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.md)
- [`pdks init`](../../docs/reference/cli/init.md)
- [`pdks explain`](../../docs/reference/cli/explain.md)
