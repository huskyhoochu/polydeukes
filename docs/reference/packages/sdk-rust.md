# `polydeukes-sdk` (Rust)

**English** · [한국어](sdk-rust.ko.md)

<a id="ownership"></a>
## What this crate owns

Four blocking verbs execute a separately installed `pdks`: `check_covenant`, `check_change_set`,
`memory_ingest`, and `memory_search`. The CLI owns judgment, configuration, telemetry, and
indexing. The crate sends caller-built inputs and returns results as values.

Every verb shares one resolver and process runner. A root becomes absolute relative to the
caller's cwd and becomes the child's cwd. An explicit `executable` is a file path relative to the
caller's cwd, even for a bare filename, and preserves symlink spelling. Otherwise the first
executable regular file `pdks` in an absolute `PATH` directory is selected. Empty and relative
entries are skipped. Failure of the selected file never triggers another candidate.

<a id="install"></a>
## Install

```sh
cargo add polydeukes-sdk
```

Install the standalone `pdks` for Linux x64 or macOS arm64 from
[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases), give it execute permission,
and name it in `executable` or put it on `PATH` as `pdks`. The crate runs that file directly and
needs neither Node nor an npm installation. Memory verbs require a CLI with memory support;
missing memory dependencies, configuration, or an index return `Unavailable`.

<a id="verb"></a>
## `check_covenant`

```rust
use polydeukes_sdk::{
    check_covenant, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, FileChange, ToolCall, Tools,
};
use std::{path::Path, time::Duration};

let input = CovenantInput {
    tool_calls: vec![ToolCall {
        name: "writeFile".into(),
        args: Default::default(),
        file_change: Some(FileChange::Create {
            path: "src/index.ts".into(),
            post: "export const answer = 42;\n".into(),
        }),
    }],
    subagent_spawns: vec![],
    user_messages: vec![],
    tools: Some(Tools {
        mutating: vec!["writeFile".into()],
        shell: vec!["exec".into()],
        command_args: vec!["command".into()],
    }),
    actor: None,
    session: None,
};
let verdict = check_covenant(CheckCovenantSpec {
    repo_root: Path::new("/path/to/project"),
    input: &input,
    enforce: None,
    config_layer: None,
    telemetry_path: None,
    executable: Some(Path::new("/opt/tools/pdks")),
    timeout: Some(Duration::from_secs(2)),
    spawn: None,
});
match verdict {
    CheckCovenantVerdict::Upheld { .. } => { /* Perform the proposed action here. */ }
    CheckCovenantVerdict::Blocked { reason } | CheckCovenantVerdict::Unjudged { reason } => {
        eprintln!("{reason}");
    }
}
```

The host supplies each call's evidence. `FileChange::Create` has `path` and `post`, `Modify` has
`path`, `pre`, and `post`, and `Delete` has `path` and optional `pre`. Missing evidence stays
missing; the SDK adds no actor, session, or tool roster. `CovenantInput` and its parts are
generated from core's input schema. The CLI supplies `world`, which is absent from this input.

<a id="spec"></a>
## The spec

| Field | `CheckCovenantSpec` | `CheckChangeSetSpec` |
|---|---|---|
| `repo_root: &Path` | Project root and child cwd | Same |
| `input: &CovenantInput` | Caller-built IR | Replaced by `diff: &str` |
| `enforce: Option<Enforce>` | `None` means `Enforce::Block` | Same |
| `config_layer: Option<&Path>` | `--config-layer`; relative paths use child cwd | Same |
| `telemetry_path: Option<&Path>` | `--telemetry-path`; relative paths use child cwd | Same |
| `executable: Option<&Path>` | Explicit executable ahead of `PATH` | Same |
| `timeout: Option<Duration>` | `None` means no deadline | Same |
| `spawn` | Optional `&dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>` | Same |

`MemoryIngestSpec` takes `root: &Path`, `executable`, `timeout`, and `spawn`.
`MemorySearchSpec` also takes `query: &str` and `limit: Option<NonZeroU32>`; `None` uses the CLI
default. Memory commands receive no enforcement, config-layer, or telemetry flags.

The timeout measures communication after spawn: writing stdin and draining both output pipes,
including descendant-held pipes after the direct child exits. Zero expires after spawn. Expiry
kills and reaps the direct child and ends pipe collection; descendants remain the host's
responsibility. Resolution, serialization, and OS spawn delay precede the deadline. An injected
spawn must enforce its supplied timeout and return `io::ErrorKind::TimedOut` on expiry.

<a id="change-set"></a>
## `check_change_set`

`check_change_set(CheckChangeSetSpec { ... })` takes `diff` in place of `input` and runs
`pdks covenant check --diff --enforce <level>`. It preserves UTF-8 diff text and newlines.
The `a/` and `b/` paths are relative to `repo_root`. Produce a stable git format with:

```sh
git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ HEAD
```

Untracked files need `git add -N` to appear. Both covenant verbs default to blocking enforcement,
including this change-set command. The crate does not run git.

<a id="verdicts"></a>
## The three verdicts

`CheckCovenantVerdict` has `Upheld { advisories: String }`, `Blocked { reason: String }`, and
`Unjudged { reason: String }`. Status `0` means `Upheld`, `2` means `Blocked`, and every other
status or signal means `Unjudged`. Resolution, serialization, execution, and timeout failures
also return `Unjudged`. Only `Upheld` authorizes the proposed action. Status `2` is not
reclassified using stderr.

Valid stderr is preserved with its whitespace; invalid UTF-8 uses replacement decoding.
`advisories` and completed nonzero responses expose stderr, with a generated status explanation
where appropriate when stderr is absent. Covenant stdout is drained without determining the
verdict. The CLI writes telemetry; `telemetry_path` selects its destination.

<a id="memory"></a>
## `memory_ingest` and `memory_search`

```rust
use polydeukes_sdk::{memory_search, MemorySearchOutcome, MemorySearchSpec};
use std::{num::NonZeroU32, path::Path};

let result = memory_search(MemorySearchSpec {
    root: Path::new("/path/to/project"),
    query: "session report",
    limit: NonZeroU32::new(5),
    executable: Some(Path::new("/opt/tools/pdks")),
    timeout: None,
    spawn: None,
});
match result {
    MemorySearchOutcome::Found { hits } => { /* Consume ranked hits. */ }
    MemorySearchOutcome::Empty => { /* Search succeeded with no matching sections. */ }
    MemorySearchOutcome::Unavailable { reason } => { /* Report the retrieval failure. */ }
}
```

`memory_ingest` runs `pdks memory ingest` and returns `MemoryIngestOutcome::Ingested` only at
status `0`; otherwise it returns `Unavailable { reason }`. Ingest stdout is ignored.
`memory_search` sends the query as one literal argument to `pdks memory search <query> --json`
and adds `--limit <n>` when supplied. Both memory commands send empty stdin.

Search success requires strict UTF-8 JSON with string `ingestedAt` and array `results`.
Every hit needs string `id`, `conceptId`, `docTitle`, `sectionTitle`, `status`, boolean `stale`,
string-array `supersededBy`, `trust` (`human-reviewed`, `machine-verified`, `unverified`), and
`matchPath` (`and`, `or`, `like`). Extra object fields are accepted. Generated Rust fields use
snake case: `concept_id`, `doc_title`, `section_title`, `match_path`, `superseded_by`.
`Found { hits }` preserves CLI ranking and is nonempty. A valid empty results array alone means
`Empty`; invalid JSON, UTF-8, fields, enums, and execution failures mean `Unavailable`.

<a id="migration"></a>
## Process boundary and migration

Consumers that previously relied on npm discovery should install a standalone `pdks` and select
it via `executable` or an absolute `PATH` directory. Existing npm installs do not select the CLI.
Custom spawns now receive and return bytes rather than strings:

```rust
pub struct SpawnSpec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: std::path::PathBuf,
    pub stdin: Vec<u8>,
    pub timeout: Option<std::time::Duration>,
}
pub struct SpawnOutcome {
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}
```

`None` status means signal termination. Preserve output bytes until the SDK decodes them;
converting search stdout with lossy decoding would conceal invalid UTF-8. All four verbs use
this same boundary. Ordinary I/O errors become failure values; host termination and Rust panics
are not caught.

<a id="limits"></a>
## Declared limits

The API blocks. An async host runs it in a blocking task. The crate does not negotiate the CLI
version: select a CLI that understands its input schema and memory enums. Generated transport
types cannot express every semantic constraint, such as a nonempty shell roster needing command
argument names; the CLI checks those constraints. Memory retrieval is not action authorization.

<a id="see-also"></a>
## See also

- [TypeScript SDK](sdk-ts.md)
- [Python SDK](sdk-python.md)
- [`pdks covenant check`](../cli/covenant-check.md)
- [`pdks memory`](../cli/memory.md)
