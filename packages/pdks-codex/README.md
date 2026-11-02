# `pdks-codex`

**English** · [한국어](./README.ko.md)

The Rust host adapter connects Codex to the `pdks` covenant judge. `init` registers the adapter;
`hook` judges proposed calls and records the session’s tool-call history.

<a id="install"></a>
## Install

`cargo install --locked pdks-codex` builds the executable from crates.io with the dependency
versions the release was tested with (the `Cargo.lock` in the crate). `cargo binstall pdks-codex`
downloads the Release archive described below for `aarch64-apple-darwin` and
`x86_64-unknown-linux-musl`, and falls back to a source build on other targets.

```sh
cargo install --locked pdks-codex
cargo binstall pdks-codex
```

Each [GitHub Release](https://github.com/huskyhoochu/polydeukes/releases) carries
`pdks-codex-<target>-v<version>.tar.gz` for `aarch64-apple-darwin` and `x86_64-unknown-linux-musl`.
Each archive holds one directory with the same name, containing the executable and `LICENSE`.
Extract it and place the executable on `PATH`.

Or clone the [repository](https://github.com/huskyhoochu/polydeukes) and build from its root:

```sh
cargo build --release -p pdks-codex
```

The built executable is `target/release/pdks-codex`.

<a id="commands"></a>
## Commands

Place both `pdks-codex` and `pdks` on `PATH`, then run init from the project root:

```sh
pdks-codex init
```

- `init` runs `pdks init`, registers `PreToolUse`, `PostToolUse`, and `SessionEnd` in
  `.codex/hooks.json`, and adds `.codex/hooks.json` and `.codex/config.toml` to `protectedPaths`.
- `hook --project-root <absolute-path> --pdks <absolute-path>` reads the host event on stdin. Both
  paths must be absolute and the flags must appear in this order.

The same commands are available as `pdks codex init` and `pdks codex hook ...`. For the shared
scaffold, see [`pdks init`](../../docs/reference/cli/init.md#init-common). The
[session connection guide](../../docs/how-to/connect-surfaces.md#codex) describes host setup; its
umbrella adapter commands use a different registration format.

<a id="registration"></a>
## Registration

Registrations pin the absolute project root, adapter executable, and `pdks` path found on `PATH`.
They carry neither `onFailure` nor `|| exit 2`. If the adapter cannot start, the host lets the call
proceed without a message. If the adapter starts but cannot start the judge, it lets the call
proceed with an instruction to install `pdks`.

`hook` translates `apply_patch` and `Bash` calls. `PostToolUse` records tool-call history in
`.polydeukes/codex-sessions/`; `SessionEnd` removes it. Approve changed definitions through Codex
`/hooks`. Current prompts do not supply human evidence.

<a id="license"></a>
## License

MIT. See [LICENSE](./LICENSE).
