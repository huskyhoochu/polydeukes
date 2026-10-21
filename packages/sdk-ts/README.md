# `@polydeukes/sdk-ts`

**English** · [한국어](./README.ko.md)

Four TypeScript verbs send caller-built inputs to a standalone `pdks` and return results as
values. The CLI owns judgment, configuration, telemetry, and memory indexing.

```sh
pnpm add @polydeukes/sdk-ts
```

The SDK host needs Node >=24. Install a platform-specific standalone `pdks` from
[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases), make it executable, and
select it through `executable` or an absolute `PATH` directory. Existing npm installations do
not select the CLI; the SDK runs the executable directly. Runtime and peer dependencies on
`@polydeukes/core` and `polydeukes` are unnecessary. Transport types ship in the SDK.

<a id="overview"></a>
## Overview

- `checkCovenant(CheckCovenantSpec)` sends a `CovenantInput` as UTF-8 JSON.
- `checkChangeSet(CheckChangeSetSpec)` sends a unified diff verbatim.
- Both return `CheckCovenantVerdict`: `upheld`, `blocked`, or `unjudged`.
- `memoryIngest(MemoryIngestSpec)` returns `MemoryIngestOutcome`: `ingested` or `unavailable`.
- `memorySearch(MemorySearchSpec)` returns `MemorySearchOutcome`: `found` with ranked
  `MemorySearchResult` hits, `empty`, or `unavailable`.
- All four accept `executable`, `timeoutMs`, and `spawn: Spawn`, using `SpawnSpec` and
  `SpawnOutcome` byte transport.

Explicit executable paths and roots resolve from the caller's cwd; symlink spelling is
preserved. Otherwise the first executable file named `pdks` in an absolute `PATH` directory is
selected. Failure never retries another candidate. `timeoutMs` is finite nonnegative
milliseconds; absent means no deadline, and zero expires after spawn. The deadline covers pipe
communication, including descendant-held pipes; expiry kills and reaps the direct child and
closes the pipes without killing descendants.

<a id="examples"></a>
## Examples

```ts
import { checkCovenant, type CovenantInput } from '@polydeukes/sdk-ts';

const input: CovenantInput = {
  toolCalls: [{
    name: 'writeFile',
    fileChange: { kind: 'create', path: 'src/index.ts', post: 'export const answer = 42;\n' },
  }],
  subagentSpawns: [],
  userMessages: [],
  tools: { mutating: ['writeFile'], shell: [], commandArgs: [] },
};
const verdict = await checkCovenant({
  repoRoot: process.cwd(), input, executable: '/opt/tools/pdks', timeoutMs: 2000,
});
if (verdict.verdict !== 'upheld') throw new Error(verdict.reason);
// Perform the proposed action here.
```

Only `upheld` authorizes the action. Status `0` is `upheld`, `2` is `blocked`, and all other
statuses, signals, and execution failures are `unjudged`. Enforcement defaults to `block`.
`checkChangeSet` takes `diff` instead of `input`, with `a/` and `b/` paths relative to `repoRoot`.

Memory specs use `root`; search adds `query` and optional positive safe-integer `limit`.
Only a valid empty search response means `empty`. Missing memory support, malformed responses,
and execution failures mean `unavailable`.

For migration, import input types from this SDK instead of core. Custom process implementations
use `SpawnSpec` with `Uint8Array` stdin, stdout, and stderr, and enforce `timeoutMs` themselves.
Preserve stdout bytes for strict search decoding.

<a id="see-also"></a>
## See also

- [Complete API, memory examples, and migration](../../docs/reference/packages/sdk-ts.md)
- [Rust SDK](../../docs/reference/packages/sdk-rust.md)
