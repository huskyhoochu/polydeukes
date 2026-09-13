# `@polydeukes/sdk-ts`

**English** · [한국어](./README.ko.md)

This package hands a covenant input IR to the judge from TypeScript. It locates the
`polydeukes` install of the project being judged, spawns `pdks covenant check` with the input
on stdin, and returns the verdict as a value. No judgment logic lives here, and no telemetry
row is written here — the child process writes it.

Install it next to `polydeukes` and `@polydeukes/core`, which it names as `peerDependencies`:

```sh
pnpm add @polydeukes/sdk-ts polydeukes @polydeukes/core
```

There is no bin and no install step.

<a id="overview"></a>
## Overview

Public contract symbols include:

- `checkCovenant`
- `CheckCovenantSpec`
- `CheckCovenantSpawnSpec`
- `CheckCovenantVerdict`

<a id="examples"></a>
## Examples

```ts
import { checkCovenant } from '@polydeukes/sdk-ts';

// Spawns `pdks covenant check --enforce block` in repoRoot with the IR on stdin.
// The IR is the caller's: this package adds nothing to it.
const verdict = await checkCovenant({
  repoRoot: process.cwd(),
  input: {
    toolCalls: [{ name: 'writeFile', args: { path: 'src/index.ts' } }],
    subagentSpawns: [],
    userMessages: [],
    tools: { mutating: ['writeFile', 'rm'], shell: ['exec'], commandArgs: ['command'] },
  },
});

if (verdict.verdict === 'blocked') {
  // `reason` is the judge's own stderr — the caller decides where it goes.
  console.error(verdict.reason);
}
```

`enforce` defaults to `block`. The three verdicts are `upheld`, `blocked`, and `unjudged`;
`unjudged` covers a project with no `polydeukes` installed and any child status that is not a
verdict.

<a id="see-also"></a>
## See also

- [`@polydeukes/sdk-ts` package reference](../../docs/reference/packages/sdk-ts.md)
- [The judge (`covenant` module)](../../docs/reference/packages/polydeukes.md#covenant-module)
