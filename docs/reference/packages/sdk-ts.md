# `@polydeukes/sdk-ts`

**English** · [한국어](sdk-ts.ko.md)

> **One verb from TypeScript to the judge** — hand a covenant input IR to
> `pdks covenant check` and read the verdict back as a value.
>
> Alpha. Install it next to `polydeukes` and `@polydeukes/core`, which it names as
> `peerDependencies`.

<a id="ownership"></a>
## What this package owns

The spawn and the translation of an exit status into a value, and nothing else. It locates the
`polydeukes` install of the project being judged, runs its bin with the input on stdin, and
returns what the child answered. No judgment logic lives here: the branches are whether the
umbrella resolved and what status the child left with.

| Unit | What it does |
|---|---|
| `checkCovenant` | Spawns `pdks covenant check` in the judged project and returns the verdict |
| Umbrella resolution | Finds `polydeukes` in the install graph of `repoRoot` and reads its `pdks` bin |
| Verdict translation | Exit `0` is `upheld`, exit `2` is `blocked`, everything else is `unjudged` |

This package writes no telemetry row. Every row a run leaves is written by the child process,
where the judgment happened, so one call still leaves one row.

<a id="install"></a>
## Install

```sh
pnpm add @polydeukes/sdk-ts polydeukes @polydeukes/core
```

There is no bin and no install step. The umbrella supplies the judge the SDK spawns, and the
core supplies the `CovenantInput` type the caller fills in.

<a id="verb"></a>
## The verb

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

**`enforce` defaults to `block`.** That is the surface's level, not an entry's: protected paths
and entries carrying `enforce: block` stop the call, and every other break is recorded
`advised` at exit 0. An entry's own level composes with it lenient-side-wins, as on every other
surface. `@polydeukes/adapter-claude-code` and `@polydeukes/adapter-grok` spawn the judge at
the same level.

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

**There is no valve, and the reason is the substitute.** An unattended real-time caller has no
TTY and no human turn, so this package takes no witness argument and invents no session.
`blocked.reason` and `upheld.advisories` come back as data instead, and the consumer decides
where the text goes — an issue, a log, or back to the model. The posture rules for a config
author and for a consumer are in [write disciplines](../../how-to/write-disciplines.md#posture).

<a id="failure"></a>
## A failure example

When the project has no `polydeukes` installed there is nothing to spawn, and the verb says so
rather than answering `upheld`:

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
- **The SDK exposes the session surface only.** The input travels as an IR on stdin, which is
  what makes the run a session-surface judgment. A caller that has a finished change set pipes
  a unified diff to `pdks covenant check --diff` from its shell instead.
- **No telemetry row is written here.** Every row comes from the child.
- **An `unjudged` verdict is not a pass.** It records that the judge did not answer, and the
  consumer decides what a project without a judge is allowed to do.

<a id="see-also"></a>
## See also

- [`pdks covenant check`](../cli/covenant-check.md)
- [`polydeukes`](polydeukes.md)
- [`@polydeukes/core`](core.md)
- [Configuration reference](../configuration/index.md)
