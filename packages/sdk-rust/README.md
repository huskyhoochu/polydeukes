# `polydeukes-sdk`

**English** · [한국어](./README.ko.md)

This crate hands a covenant input to the Polydeukes judge from Rust. It locates the
`polydeukes` install of the project being judged, spawns `pdks covenant check` under `node`
with the input on stdin, and returns the verdict as a value. No judgment logic lives here, and
no telemetry row is written here — the child process writes it.

```sh
cargo add polydeukes-sdk
```

The project being judged installs `polydeukes` from npm (`pnpm add -D polydeukes`), and `node`
must be on `PATH`.

<a id="overview"></a>
## Overview

Public items include:

- `check_covenant`
- `CheckCovenantSpec`
- `CheckCovenantVerdict`
- `Enforce`
- `SpawnSpec` and `SpawnOutcome`
- `CovenantInput` and its parts, generated from `@polydeukes/core/covenant-input.schema.json`

<a id="examples"></a>
## Examples

```rust
use polydeukes_sdk::{check_covenant, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, ToolCall};
use std::path::Path;

let input = CovenantInput {
    tool_calls: vec![ToolCall { name: "exec".into(), args: Default::default(), file_change: None }],
    subagent_spawns: vec![],
    user_messages: vec![],
    tools: None,
    actor: None,
    session: None,
};

// Spawns `node <bin> covenant check --enforce block` in repo_root with the input on stdin.
let verdict = check_covenant(CheckCovenantSpec {
    repo_root: Path::new("."),
    input: &input,
    enforce: None,
    config_layer: None,
    telemetry_path: None,
    spawn: None,
});

if let CheckCovenantVerdict::Blocked { reason } = verdict {
    // `reason` is the judge's own stderr — the caller decides where it goes.
    eprintln!("{reason}");
}
```

The call blocks until the judge exits; an async host runs it with
`tokio::task::spawn_blocking`. `enforce` defaults to `Block`. The three verdicts are `Upheld`,
`Blocked`, and `Unjudged`; `Unjudged` covers a project with no `polydeukes` installed, a failed
spawn, and any child status that is not a verdict.

<a id="see-also"></a>
## See also

- [`polydeukes-sdk` reference](https://github.com/huskyhoochu/polydeukes/blob/main/docs/reference/packages/sdk-rust.md)
- [`@polydeukes/sdk-ts`, the TypeScript SDK](https://github.com/huskyhoochu/polydeukes/blob/main/docs/reference/packages/sdk-ts.md)
