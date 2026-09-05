# `polydeukes`

**English** · [한국어](./README.ko.md)

Polydeukes is the umbrella package. Install this package; it ships the `pdks` bin, the config
loader, the commit-surface runner, the session-surface runner subpath, and the bundled schema
artifact.

<a id="overview"></a>
## Overview

Public contract symbols and entry points:

- `loadConfig`
- `runCovenantCheck`
- `ResolvedConfig`
- `polydeukes/claude-code` → `runClaudeCodeHook`
- `polydeukes/schema.json`
- `pdks covenant check`
- `pdks init claude-code`
- `pdks init grok`
- `pdks explain`
- `pdks docs [topic]`

<a id="public-symbols"></a>
## Public symbols

```ts
import { loadConfig, runCovenantCheck } from 'polydeukes';
import { runClaudeCodeHook } from 'polydeukes/claude-code';
```

```ts
function loadConfig(spec: { rootDir: string }): {
  config: import('@polydeukes/core').ResolvedConfig;
  configPath: string;
};

function runCovenantCheck(spec: {
  repoRoot: string;
  telemetryPath?: string;
  covenantDist?: string;
  ttyPrompt?: (prompt: string) => string | null;
  domain?: unknown;
}): Promise<{ exitCode: 0 | 2 }>;
```

<a id="see-also"></a>
## See also

- [`polydeukes` package reference](../../docs/reference/packages/polydeukes.md)
- [`Configuration reference`](../../docs/reference/configuration/index.md)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.md)
- [`pdks init`](../../docs/reference/cli/init.md)
- [`pdks explain`](../../docs/reference/cli/explain.md)
