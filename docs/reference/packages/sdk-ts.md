# `@polydeukes/sdk-ts`

**English** · [한국어](sdk-ts.ko.md)

> **Call the judge from TypeScript.** Pass a covenant input IR to `checkCovenant`, or a
> unified diff to `checkChangeSet`, and receive the verdict from `pdks covenant check` as a
> value.
>
> Beta. Install it next to `polydeukes` and `@polydeukes/core`, which it names as
> `peerDependencies`.

<a id="ownership"></a>
## What this package owns

The package finds `polydeukes` in the project being judged, runs its bin with the input on
stdin, and converts the child process's exit status into a verdict. The child process performs
the judgment.

| Unit | What it does |
|---|---|
| `checkCovenant` | Spawns `pdks covenant check` in the judged project and returns the verdict |
| `checkChangeSet` | Spawns `pdks covenant check --diff` in the judged project and returns the verdict |
| Umbrella resolution | Finds `polydeukes` in the install graph of `repoRoot` and reads its `pdks` bin |
| Verdict translation | Exit `0` is `upheld`, exit `2` is `blocked`, everything else is `unjudged` |

The child process writes telemetry during judgment. The SDK does not add duplicate rows.

<a id="install"></a>
## Install

```sh
pnpm add @polydeukes/sdk-ts polydeukes @polydeukes/core
```

No separate initialization command is needed. The umbrella supplies the judge the SDK spawns, and the
core supplies the `CovenantInput` type the caller fills in.

<a id="the-verb"></a>
<a id="verb"></a>
## `checkCovenant`

The package is ESM only (`"type": "module"`, an `import` condition and no `require`): the calling
file is a `.mjs`, or its `package.json` declares `"type": "module"`.

```ts
import { checkCovenant } from '@polydeukes/sdk-ts';

const verdict = await checkCovenant({
  repoRoot: '/path/to/the/project',
  input: {
    toolCalls: [
      {
        name: 'writeFile',
        args: { path: 'src/index.ts', content: 'export const answer = 42;\n' },
        fileChange: {
          kind: 'modify',
          path: 'src/index.ts',
          pre: 'export const answer = 41;\n',
          post: 'export const answer = 42;\n',
        },
      },
    ],
    subagentSpawns: [],
    userMessages: [],
    tools: { mutating: ['writeFile', 'rm'], shell: ['exec'], commandArgs: ['command'] },
  },
});
```

The IR is the caller's. This package neither reads it nor completes it: it adds no `session`,
no `actor`, and no roster of its own, and the `tools` values above are the caller's own tool
names. `subagentSpawns` and `userMessages` are required collections, so a caller with neither
sends the empty arrays. A `world` key is refused by the judge — the runner reads the world from
the project on disk, and a client choosing the world would be choosing what is judged.

<a id="spec"></a>
## The spec

```ts
type CheckCovenantSpec = {
  repoRoot: string;
  input: CovenantInput;
  enforce?: 'advise' | 'block';
  configLayer?: string;
  telemetryPath?: string;
  spawn?: (spec: CheckCovenantSpawnSpec) => Promise<{ status: number | null; stderr: string }>;
};

type CheckCovenantSpawnSpec = { command: string; args: string[]; cwd: string; stdin: string };
```

| Field | What it is |
|---|---|
| `repoRoot` | The project being judged: config discovery, the world axis, the child's cwd, and the install graph the umbrella is found in |
| `input` | The caller's own IR, sent verbatim as the child's stdin |
| `enforce` | The observer's posture for the whole run. **Absent is `block`** |
| `spawn` | An injected spawn seam. Absent, the child runs under this process's node executable |
| `configLayer` | A [config layer](../configuration/index.md#config-layer) judged alongside the project's config, sent as `--config-layer`. A relative path resolves against `repoRoot` |
| `telemetryPath` | The file this run's rows are appended to, sent as `--telemetry-path` |

**`enforce` defaults to `block`.** That is the surface's level, not an entry's: protected paths
and entries carrying `enforce: block` stop the call, and every other break is recorded
`advised` at exit 0. An entry's own level composes with it lenient-side-wins, as on every other
surface. `@polydeukes/adapter-claude-code`, `@polydeukes/adapter-grok`, and
`@polydeukes/adapter-codex` spawn the judge at the same level.

The default spawn inherits no file descriptor. A caller may hold none of its own, and an
inherited stdout that is closed would kill the child with EPIPE before it answered. stderr is
collected and returned; stdout is drained and dropped, because the judge writes no verdict
there.

<a id="verdicts"></a>
## The three verdicts

```ts
type CheckCovenantVerdict =
  | { verdict: 'upheld'; advisories: string }
  | { verdict: 'blocked'; reason: string }
  | { verdict: 'unjudged'; reason: string };
```

| Verdict | Child status | What it means for the caller |
|---|---|---|
| `upheld` | `0` | The call was judged and nothing blocked it. `advisories` is the child's stderr verbatim, carrying any advisory lines the run produced. Proceed |
| `blocked` | `2` | The call was judged and something blocked it. `reason` is the child's stderr verbatim. Do not proceed |
| `unjudged` | anything else, or no umbrella | No judgment happened. `reason` says which. Reading it as an uphold would let an uninstalled judge pass every call |

The SDK returns `blocked.reason` and `upheld.advisories` as data. The consumer decides where
to send them: to the model, an issue, or a log. The SDK accepts no separate witness argument.
See [write disciplines](../../how-to/write-disciplines.md#posture) for handling these results
in an unattended loop.

Both texts are for a person. To read which paths and disciplines a run judged as values, pass
`telemetryPath` and read its rows as
[`pdks covenant check`](../cli/covenant-check.md#reading-rows) describes: a new file per change
set, one file for the whole session for session inputs.

<a id="change-set"></a>
## `checkChangeSet`

`checkChangeSet` judges a finished change set rather than one call. It spawns
`pdks covenant check --diff --enforce <level>` in `repoRoot` with the unified diff on stdin,
and returns the same three verdicts as `checkCovenant`.

```ts
import { checkChangeSet } from '@polydeukes/sdk-ts';

const verdict = await checkChangeSet({
  repoRoot: '/path/to/the/project',
  diff: gitDiffOutput, // e.g. `git diff HEAD` in repoRoot, after `git add -N .` for new files
});
```

```ts
type CheckChangeSetSpec = {
  repoRoot: string;
  diff: string;
  enforce?: 'advise' | 'block';
  configLayer?: string;
  telemetryPath?: string;
  spawn?: (spec: CheckCovenantSpawnSpec) => Promise<{ status: number | null; stderr: string }>;
};
```

| Field | What it is |
|---|---|
| `repoRoot` | The project being judged: config discovery, the working tree that `file` sources read, the child's cwd, and the install graph the umbrella is found in |
| `diff` | The caller's unified diff, sent verbatim as the child's stdin. Paths are relative to `repoRoot` behind `a/` and `b/`, as `git diff` prints them from a repository whose top is `repoRoot`. Any producer of that form works; the SDK neither runs `git` nor checks the text. `git diff` leaves out untracked files until `git add -N` marks them |
| `enforce` | The observer's posture for the whole run. **Absent is `block`** |
| `spawn` | The same injected spawn seam as `checkCovenant`'s |
| `configLayer` | A [config layer](../configuration/index.md#config-layer) judged alongside the project's config, sent as `--config-layer`. A relative path resolves against `repoRoot` |
| `telemetryPath` | The file this run's rows are appended to, sent as `--telemetry-path` |

**The default differs from the CLI's.** `pdks covenant check --diff` without `--enforce` lands
every verdict `advised` at exit 0, so a protected path in the diff never comes back `blocked`.
`checkChangeSet` passes `--enforce block` unless told otherwise, as `checkCovenant` does:
protected paths and entries carrying `enforce: block` come back `blocked`, and every other
break comes back in `upheld.advisories`.

The change set is judged with `disciplines` plus `changeSetDisciplines`, the lists the
change-set surface compiles. See the
[configuration reference](../configuration/index.md#placement-rule) for which entries each
list holds.

<a id="failure"></a>
## A failure example

If the project has no `polydeukes` installed, `checkCovenant` returns `unjudged`:

```ts
const verdict = await checkCovenant({ repoRoot: '/tmp/project-without-polydeukes', input });

// {
//   verdict: 'unjudged',
//   reason: 'no polydeukes in the install graph of /tmp/project-without-polydeukes:
//            install it to have this input judged',
// }
```

No child process runs, and the telemetry log gains nothing: the row is written where the
judgment happens, and no judgment happened.

<a id="limits"></a>
## Declared limits

- **The caller builds the IR.** The tool roster, the pre-state, and the envelope are the
  host's facts, so a consumer that knows them fills them in. This package supplies none of
  them.
- **A change set is judged against the working tree in `repoRoot`.** The diff supplies each
  changed file's `pre` and `post` as its hunk lines, but a `file` source is read from disk. A
  caller that passes a diff while `repoRoot` holds a different tree has those entries judge
  that tree.
- **No telemetry row is written here.** Every row comes from the child.
- **An `unjudged` verdict is not a pass.** It records that the judge did not answer, and the
  consumer decides what a project without a judge is allowed to do.

<a id="see-also"></a>
## See also

- [`pdks covenant check`](../cli/covenant-check.md)
- [`polydeukes`](polydeukes.md)
- [`@polydeukes/core`](core.md)
- [Configuration reference](../configuration/index.md)
