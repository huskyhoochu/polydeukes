# `polydeukes-sdk`

**English** · [한국어](./README.ko.md)

Four blocking Rust verbs run a standalone `pdks` and return results as values. The CLI owns
judgment, configuration, telemetry, and memory indexing.

```sh
cargo add polydeukes-sdk
```

Install the standalone `pdks` for Linux x64 or macOS arm64 from
[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases), give it execute permission,
and select it via `executable` or an absolute `PATH` directory. The crate runs it directly;
Node and npm installations are unnecessary.

<a id="overview"></a>
## Overview

- `check_covenant(CheckCovenantSpec)` sends generated `CovenantInput` as UTF-8 JSON.
- `check_change_set(CheckChangeSetSpec)` sends a unified diff verbatim.
- Both return `CheckCovenantVerdict`: `Upheld`, `Blocked`, or `Unjudged`.
- `memory_ingest(MemoryIngestSpec)` returns `MemoryIngestOutcome`: `Ingested` or `Unavailable`.
- `memory_search(MemorySearchSpec)` returns `MemorySearchOutcome`: ranked `Found` hits,
  `Empty`, or `Unavailable`.
- All four accept `executable`, `timeout`, and `spawn`, using `SpawnSpec` and `SpawnOutcome`
  with `Vec<u8>` stdin, stdout, and stderr.

Roots and explicit executable paths resolve from the caller's cwd, preserving executable
symlink spelling. Otherwise the first executable file `pdks` in an absolute `PATH` directory is
selected; empty and relative entries are skipped. A selected file's failure never retries
another candidate. `timeout: Option<Duration>` covers communication after spawn, including
pipes retained by descendants after child exit. `None` means no deadline; zero expires after
spawn. Expiry kills and reaps the direct child and ends the caller's pipe collection.
Descendants keep their own lifetimes; detached readers finish when their pipes close.

<a id="examples"></a>
## Examples

```rust
use polydeukes_sdk::{check_covenant, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput};
use std::{path::Path, time::Duration};

let input = CovenantInput {
    tool_calls: vec![], subagent_spawns: vec![], user_messages: vec![],
    tools: None, actor: None, session: None,
};
let verdict = check_covenant(CheckCovenantSpec {
    repo_root: Path::new("."), input: &input, enforce: None,
    config_layer: None, telemetry_path: None,
    executable: Some(Path::new("/opt/tools/pdks")),
    timeout: Some(Duration::from_secs(2)), spawn: None,
});
match verdict {
    CheckCovenantVerdict::Upheld { .. } => { /* Perform the proposed action here. */ }
    CheckCovenantVerdict::Blocked { reason } | CheckCovenantVerdict::Unjudged { reason } => {
        eprintln!("{reason}");
    }
}
```

Only `Upheld` authorizes the action. Status `0` is `Upheld`, `2` is `Blocked`, and every other
status, signal, or execution failure is `Unjudged`. Enforcement defaults to `Enforce::Block`.
`check_change_set` takes `diff` in place of `input`, with `a/` and `b/` paths relative to
`repo_root`. The API blocks; async hosts use a blocking task.

Memory specs use `root`; search adds `query` and optional `limit: NonZeroU32`. Only a valid
empty search response is `Empty`. Missing memory support, malformed responses, and execution
failures are `Unavailable`; found hits preserve CLI ranking.

For migration, replace reliance on npm discovery with a standalone executable. Custom spawns
use `Vec<u8>` instead of strings for all three streams, preserve stdout bytes for strict search
decoding, and enforce the supplied timeout with `io::ErrorKind::TimedOut` on expiry.

<a id="see-also"></a>
## See also

- [Complete API, evidence, and migration](../../docs/reference/packages/sdk-rust.md)
- [TypeScript SDK](../../docs/reference/packages/sdk-ts.md)
