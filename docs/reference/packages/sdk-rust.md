# `polydeukes-sdk` (Rust)

**English** · [한국어](sdk-rust.ko.md)

> **Call the judge from Rust.** Pass a covenant input to `check_covenant`, or a unified diff to
> `check_change_set`, and receive the verdict from `pdks covenant check` as a value.
>
> Beta. Published on crates.io as `polydeukes-sdk`. The judged project installs `polydeukes`
> from npm, and `node` must be on `PATH`.

<a id="ownership"></a>
## What this crate owns

The crate finds `polydeukes` in the project being judged, runs its bin under `node` with the
input on stdin, and converts the child process's exit status into a verdict. The child process
performs the judgment, so a discipline judged from Rust and from Node gets the same verdict.

| Unit | What it does |
|---|---|
| `check_covenant` | Spawns `pdks covenant check` in the judged project and returns the verdict |
| `check_change_set` | The same for a finished change set: spawns `pdks covenant check --diff` with the diff on stdin |
| `CovenantInput` and its parts | The input types, generated from `@polydeukes/core/covenant-input.schema.json` |
| Umbrella resolution | Walks up from `repo_root` to the nearest `node_modules/polydeukes` directory, as Node does, and reads its manifest's `bin.pdks` |
| Verdict translation | Exit `0` is `Upheld`, exit `2` is `Blocked`, everything else is `Unjudged` |

The child process writes telemetry during judgment. The crate adds no rows of its own.

<a id="install"></a>
## Install

```sh
cargo add polydeukes-sdk
```

In the project being judged:

```sh
pnpm add -D polydeukes
pnpm exec pdks init
```

<a id="verb"></a>
## `check_covenant`

```rust
use polydeukes_sdk::{
    check_covenant, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, FileChange, ToolCall,
    Tools,
};
use std::path::Path;

let mut args = serde_json::Map::new();
args.insert("path".into(), "src/index.ts".into());

let input = CovenantInput {
    tool_calls: vec![ToolCall {
        name: "writeFile".into(),
        args,
        file_change: Some(FileChange::Create {
            path: "src/index.ts".into(),
            post: "export const answer = 42;\n".into(),
        }),
    }],
    subagent_spawns: vec![],
    user_messages: vec![],
    tools: Some(Tools {
        mutating: vec!["writeFile".into(), "rm".into()],
        shell: vec!["exec".into()],
        command_args: vec!["command".into()],
    }),
    actor: None,
    session: None,
};

let verdict = check_covenant(CheckCovenantSpec {
    repo_root: Path::new("/path/to/the/project"),
    input: &input,
    enforce: None,
    config_layer: None,
    telemetry_path: None,
    spawn: None,
});

match verdict {
    CheckCovenantVerdict::Upheld { advisories } => { /* proceed */ }
    CheckCovenantVerdict::Blocked { reason } => { /* do not proceed */ }
    CheckCovenantVerdict::Unjudged { reason } => { /* no judgment happened */ }
}
```

The call blocks until the child exits. An async host runs it on a blocking thread, for example
`tokio::task::spawn_blocking`.

The input is the caller's. The crate serializes it and sends it verbatim; it adds no `session`,
no `actor`, and no roster of its own. `CovenantInput` has no `world` field: the runner reads
the world from the project on disk and refuses an input that carries one.

<a id="spec"></a>
## The spec

```rust
pub struct CheckCovenantSpec<'a> {
    pub repo_root: &'a Path,
    pub input: &'a CovenantInput,
    pub enforce: Option<Enforce>,
    pub config_layer: Option<&'a Path>,
    pub telemetry_path: Option<&'a Path>,
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> std::io::Result<SpawnOutcome>>,
}

pub enum Enforce { Advise, Block }
pub struct SpawnSpec { pub command: String, pub args: Vec<String>, pub cwd: PathBuf, pub stdin: String }
pub struct SpawnOutcome { pub status: Option<i32>, pub stderr: String }
```

| Field | What it is |
|---|---|
| `repo_root` | The project being judged: config discovery, the world axis, the child's cwd, and the directory the umbrella search starts from. A relative path is taken from the current directory |
| `input` | The caller's input, serialized as the child's stdin |
| `enforce` | The observer's posture for the whole run. **`None` is `Block`** |
| `config_layer` | A [config layer](../configuration/index.md#config-layer) judged alongside the project's config, sent as `--config-layer`. A relative path resolves against `repo_root` |
| `telemetry_path` | The file this run's rows are appended to, sent as `--telemetry-path`. A relative path resolves against `repo_root`, the child's cwd |
| `spawn` | An injected spawn seam. `None` runs `node` from `PATH`. `SpawnOutcome::status` is `None` when a signal ended the child |

**`enforce` defaults to `Block`,** as it does in `@polydeukes/sdk-ts`: protected paths and
entries carrying `enforce: block` stop the call, and every other break is recorded `advised` at
exit 0.

The default spawn pipes all three standard streams and inherits none. stderr is collected and
returned; stdout is read and dropped, because the judge writes no verdict there.

<a id="change-set"></a>
## `check_change_set`

`check_change_set` judges a finished change set rather than one call. It spawns
`pdks covenant check --diff --enforce <level>` in `repo_root` with the unified diff on stdin and
returns the same three verdicts as `check_covenant`, through the same resolution, spawn, and
status mapping.

```rust
use polydeukes_sdk::{check_change_set, CheckChangeSetSpec};

let verdict = check_change_set(CheckChangeSetSpec {
    repo_root: Path::new("/path/to/the/project"),
    diff: &git_diff_output, // see below for a `git diff` that keeps the a/ b/ form
    enforce: None,
    config_layer: None,
    telemetry_path: None,
    spawn: None,
});
```

```rust
pub struct CheckChangeSetSpec<'a> {
    pub repo_root: &'a Path,
    pub diff: &'a str,
    pub enforce: Option<Enforce>,
    pub config_layer: Option<&'a Path>,
    pub telemetry_path: Option<&'a Path>,
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> std::io::Result<SpawnOutcome>>,
}
```

`diff` is sent verbatim as the child's stdin. Its paths are relative to `repo_root` behind `a/`
and `b/`, as `git diff` prints them from a repository whose top is `repo_root`; the crate neither
runs `git` nor checks the text. A user's git config can change that form — `diff.mnemonicPrefix`
writes `c/` and `w/`, `color.diff = always` adds escape codes, `diff.external` replaces the
output — and a path the translation cannot strip routes to no protected entry. Pin the form on
the command line:

```sh
git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ HEAD
```

`git diff` leaves out untracked files until `git add -N` marks them.

The other fields mean what they mean for `check_covenant`, and
`enforce` again defaults to `Block` — unlike the CLI, whose `--diff` default is `advise`.

<a id="verdicts"></a>
## The three verdicts

```rust
pub enum CheckCovenantVerdict {
    Upheld { advisories: String },
    Blocked { reason: String },
    Unjudged { reason: String },
}
```

| Verdict | Child status | What it means for the caller |
|---|---|---|
| `Upheld` | `0` | The call was judged and nothing blocked it. `advisories` is the child's stderr verbatim |
| `Blocked` | `2` | The call was judged and something blocked it. `reason` is the child's stderr verbatim |
| `Unjudged` | anything else, a signal, a failed spawn, or no umbrella | No judgment happened. `reason` says which. Reading it as an uphold would let an uninstalled judge pass every call |

Both verbs return a verdict, never a `Result`: every failure comes back as `Unjudged`.

`reason` and `advisories` are text for a person. To read which paths and disciplines a run
judged as values, pass `telemetry_path` and read its rows as
[`pdks covenant check`](../cli/covenant-check.md#reading-rows) describes: a new file per change
set, one file for the whole session for session inputs. The verdict still comes from the exit
status.

<a id="limits"></a>
## Declared limits

- **The API is blocking.** An async host wraps the call in a blocking task.
- **`node` comes from `PATH`.** A host without it gets `Unjudged` with the spawn error.
- **The crate does not check the umbrella's version.** An input the installed umbrella cannot
  parse comes back `Blocked` (exit 2, fail-closed), not `Unjudged`. Keep the crate's version
  and the project's `polydeukes` version on the same minor release.
- **A roster with a non-empty `shell` and an empty `command_args` is refused by the runner**
  (`Blocked`). The schema forbids that pair, but the generated `Tools` type cannot express it.
- **An `Unjudged` verdict is not a pass.** The consumer decides what a project without a judge
  is allowed to do.

<a id="see-also"></a>
## See also

- [`@polydeukes/sdk-ts`](sdk-ts.md)
- [`pdks covenant check`](../cli/covenant-check.md)
- [`@polydeukes/core`](core.md#consumer-contract)
