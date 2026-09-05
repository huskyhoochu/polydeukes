# `@polydeukes/core`

**English** · [한국어](./README.ko.md)

The core package is the vocabulary layer. It exports the covenant protocol, config validation,
telemetry helpers, and shared types used by the judge and adapters.

<a id="overview"></a>
## Overview

Public contract symbols include:

- `defineConfig`
- `parseInput`
- `verdictToExitCode`
- `normalizeProtectedPaths`
- `appendRecordFailOpen`
- `readRecords`
- `noopTranscript`
- `ResolvedConfig`
- `CovenantInput`
- `CovenantVerdict`
- `EXIT_UPHOLD`
- `EXIT_BREAK_NON_BLOCKING`
- `EXIT_BREAK_BLOCKING`

<a id="examples"></a>
## Examples

```ts
import { defineConfig, parseInput } from '@polydeukes/core';

const config = defineConfig({
  languages: {
    typescript: {
      productionGlob: 'packages/*/src/**/*.ts',
      testCmd: 'pnpm --filter {scope} test',
    },
  },
});

const payload = parseInput('{"toolCalls":[],"subagentSpawns":[],"userMessages":[]}');
```

<a id="see-also"></a>
## See also

- [`@polydeukes/core` package reference](../../docs/reference/packages/core.md)
- [`Configuration reference`](../../docs/reference/configuration/index.md)
- [`@polydeukes/covenant`](../../docs/reference/packages/covenant.md)
