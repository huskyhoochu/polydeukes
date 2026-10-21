# `@polydeukes/sdk-ts`

**English** · [한국어](sdk-ts.ko.md)

Four Promise-returning verbs run a separately installed `pdks` executable. The SDK sends the
caller's input and returns a judgment or memory result as a value. The CLI owns judgment,
configuration, telemetry, and indexing.

<a id="ownership"></a>
## What this package owns

| Verb | Command | Result |
|---|---|---|
| `checkCovenant` | `pdks covenant check` | `CheckCovenantVerdict` |
| `checkChangeSet` | `pdks covenant check --diff` | `CheckCovenantVerdict` |
| `memoryIngest` | `pdks memory ingest` | `MemoryIngestOutcome` |
| `memorySearch` | `pdks memory search <query> --json` | `MemorySearchOutcome` |

All four verbs share executable resolution and byte-oriented process communication. Roots become
absolute relative to the caller's current directory and become the child's cwd. An explicit
`executable` is also resolved relative to the caller's cwd, even when it is a bare filename;
symlink spelling is preserved. Otherwise, the first executable regular file named `pdks` in an
absolute `PATH` directory is selected. Empty and relative entries are skipped. A selected
executable's failure returns a failure value without retrying another candidate.

<a id="install"></a>
## Install

```sh
pnpm add @polydeukes/sdk-ts
```

The SDK host needs Node >=24. Install a standalone `pdks` for your platform from
[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases), make it executable, and
supply its path or put it on `PATH` as `pdks`. The supported executable platforms are Linux x64
and macOS arm64. The SDK executes that file directly, without npm installation discovery or a
separate Node child. The SDK has no runtime or peer dependency on `@polydeukes/core` or
`polydeukes`. Its generated transport types ship with the package.

The selected CLI must provide memory support for the memory verbs; a missing memory dependency,
configuration, or index is reported as `unavailable`.

<a id="the-verb"></a>
<a id="verb"></a>
## `checkCovenant`

```ts
import { checkCovenant, type CovenantInput } from '@polydeukes/sdk-ts';

const input: CovenantInput = {
  toolCalls: [{
    name: 'writeFile',
    args: { path: 'src/index.ts' },
    fileChange: {
      kind: 'create',
      path: 'src/index.ts',
      post: 'export const answer = 42;\n',
    },
  }],
  subagentSpawns: [],
  userMessages: [],
  tools: { mutating: ['writeFile'], shell: ['exec'], commandArgs: ['command'] },
};
const verdict = await checkCovenant({
  repoRoot: '/path/to/project', input, executable: '/opt/tools/pdks', timeoutMs: 2000,
});
if (verdict.verdict !== 'upheld') throw new Error(verdict.reason);
// Perform the proposed action here, after an upheld verdict.
```

The host supplies evidence for each tool call. `fileChange` is `create` (`path`, `post`),
`modify` (`path`, `pre`, `post`), or `delete` (`path`, optional `pre`). An absent `fileChange`
means that call has no proven file mutation; another call's evidence does not fill it in.
The SDK sends the input unchanged as UTF-8 JSON and synthesizes no actor, session, or tool roster.
`CovenantInput` has no `world` field: the CLI supplies that axis from the project.

<a id="spec"></a>
## The spec

| Field | `CheckCovenantSpec` | `CheckChangeSetSpec` |
|---|---|---|
| `repoRoot: string` | Project root and child cwd | Same |
| `input: CovenantInput` | Required caller-built IR | Replaced by `diff: string` |
| `enforce?: 'advise' \| 'block'` | Defaults to `block` | Same |
| `configLayer?: string` | Passed as `--config-layer`; relative to child cwd | Same |
| `telemetryPath?: string` | Passed as `--telemetry-path`; relative to child cwd | Same |
| `executable?: string` | Explicit executable, ahead of `PATH` | Same |
| `timeoutMs?: number` | Finite nonnegative milliseconds; absent means no deadline | Same |
| `spawn?: Spawn` | Optional process boundary | Same |

`MemoryIngestSpec` takes `root: string` plus `executable`, `timeoutMs`, and `spawn`.
`MemorySearchSpec` takes those fields plus `query: string` and optional `limit: number`.
The limit must be a positive safe integer. Invalid limits and deadlines return failure values
before spawning. Memory commands receive no enforcement, config-layer, or telemetry flags.

The communication deadline starts after the process is spawned. It includes writing stdin and
collecting both output pipes, including pipes held by descendants after the direct child exits.
Zero expires immediately after spawn. Expiry kills and reaps the direct child and closes the
pipes; it does not kill descendants. Resolution, serialization, and OS spawn delay precede the
deadline. Injected spawns enforce the deadline themselves.

<a id="verdicts"></a>
## The three verdicts

```ts
type CheckCovenantVerdict =
  | { verdict: 'upheld'; advisories: string }
  | { verdict: 'blocked'; reason: string }
  | { verdict: 'unjudged'; reason: string };
```

Status `0` means `upheld`, `2` means `blocked`, and every other status or signal means
`unjudged`. Resolution, serialization, spawn, and deadline failures also return `unjudged`.
Only `upheld` authorizes the proposed action. The SDK does not reinterpret status `2` using
stderr. Cycles, BigInt, and non-finite JSON numbers fail serialization.

Valid stderr text is preserved, including whitespace; malformed UTF-8 uses replacement decoding.
`advisories` and a blocked response's `reason` are the child's stderr. Other completed nonzero
statuses use stderr when present, with a status explanation when absent. Covenant stdout is
drained but does not determine the verdict. Telemetry rows are written by the CLI; pass
`telemetryPath` to select their destination.

<a id="change-set"></a>
## `checkChangeSet`

```ts
import { checkChangeSet } from '@polydeukes/sdk-ts';

const verdict = await checkChangeSet({
  repoRoot: '/path/to/project', diff, executable: '/opt/tools/pdks',
});
if (verdict.verdict !== 'upheld') throw new Error(verdict.reason);
```

The diff goes to stdin as UTF-8 with its newlines preserved. Its `a/` and `b/` paths are relative
to `repoRoot`. The SDK does not run git. For a stable producer format use:

```sh
git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ HEAD
```

Untracked files need `git add -N` before they appear. SDK enforcement defaults to `block` for
both covenant verbs, including the change-set command.

<a id="memory"></a>
## `memoryIngest` and `memorySearch`

```ts
import { memoryIngest, memorySearch } from '@polydeukes/sdk-ts';

const shared = { root: '/path/to/project', executable: '/opt/tools/pdks', timeoutMs: 2000 };
const ingest = await memoryIngest(shared);
if (ingest.outcome === 'unavailable') throw new Error(ingest.reason);
const result = await memorySearch({ ...shared, query: 'session report', limit: 5 });
switch (result.outcome) {
  case 'found': console.log(result.hits); break;
  case 'empty': console.log('No matching sections'); break;
  case 'unavailable': throw new Error(result.reason);
}
```

`MemoryIngestOutcome` is `{ outcome: 'ingested' }` or
`{ outcome: 'unavailable'; reason: string }`. Ingest succeeds only at status `0`; stdout is ignored.
`MemorySearchOutcome` is `found` with a nonempty `hits` list, `empty`, or `unavailable` with a
`reason`. Search passes the query as one literal argument and `limit` as `--limit <n>`.
Memory stdin is empty.

Successful search stdout must be strict UTF-8 JSON with `ingestedAt: string` and `results`.
Each result requires `id`, `conceptId`, `docTitle`, `sectionTitle`, `status` (strings), `stale`
(boolean), `supersededBy` (string array), `trust` (`human-reviewed`, `machine-verified`, or
`unverified`), and `matchPath` (`and`, `or`, or `like`). Additional object fields are allowed.
`MemorySearchResult` is generated from core's memory output schema. Ranking order is preserved.
Only a valid empty `results` array means `empty`; invalid responses and execution failures mean
`unavailable`.

<a id="failure"></a>
## Failure and migration

An unavailable executable returns `unjudged` for covenant commands and `unavailable` for memory.
Handle those branches explicitly, as the examples above do.

Consumers that previously installed npm peers should install a standalone `pdks` and select it
through `executable` or an absolute `PATH` directory. Import input types from
`@polydeukes/sdk-ts`, replacing imports from `@polydeukes/core`.
The old `CheckCovenantSpawnSpec` name becomes `SpawnSpec`. The process boundary now handles four
verbs and carries binary stdin, stdout, and stderr:

```ts
type SpawnSpec = {
  command: string;
  args: string[];
  cwd: string;
  stdin: Uint8Array;
  timeoutMs?: number;
};
type SpawnOutcome = { status: number | null; stdout: Uint8Array; stderr: Uint8Array };
type Spawn = (spec: SpawnSpec) => Promise<SpawnOutcome>;
```

Decode stderr with replacement semantics, but retain stdout bytes until search decoding.
An injected `Error` named `TimeoutError` maps to the deadline failure branch; ordinary thrown
errors also become failure values.

<a id="limits"></a>
## Declared limits

The SDK does not negotiate CLI versions. Use a CLI that understands the input schema and memory
enums required by the SDK. Generated TypeScript types describe transport shapes; semantic
constraints such as a nonempty shell roster needing command argument names are checked by the
CLI. A valid stderr advisory can accompany `upheld` when the chosen enforcement posture permits
an action. Memory results describe retrieval, not authorization.

<a id="see-also"></a>
## See also

- [Rust SDK](sdk-rust.md)
- [Python SDK](sdk-python.md)
- [`pdks covenant check`](../cli/covenant-check.md)
- [`pdks memory`](../cli/memory.md)
