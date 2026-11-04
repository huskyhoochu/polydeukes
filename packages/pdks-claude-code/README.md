# `pdks-claude-code`

**English** · [한국어](./README.ko.md)

The Rust host adapter connects Claude Code to the `pdks` covenant judge. `init` registers the
adapter; `hook` translates a host event and runs `pdks covenant check`.

Choose Homebrew, crates.io, npm, or PyPI in the [installation guide](../../docs/how-to/install.md).
The [documentation home](../../docs/README.md) connects installation with the next steps.

<a id="install"></a>
## Install

`cargo install --locked pdks-claude-code` builds the executable from crates.io with the dependency
versions the release was tested with (the `Cargo.lock` in the crate).
`cargo binstall pdks-claude-code` downloads the Release archive described below for
`aarch64-apple-darwin`, `x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl`, and falls back
to a source build on other targets.

```sh
cargo install --locked pdks-claude-code
```

Each [GitHub Release](https://github.com/huskyhoochu/polydeukes/releases) carries
`pdks-claude-code-<target>-v<version>.tar.gz` for `aarch64-apple-darwin`,
`x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl`. Each archive holds one directory with
the same name, containing the executable and `LICENSE`. Extract it and place the executable on
`PATH`.

Or clone the [repository](https://github.com/huskyhoochu/polydeukes) and build from its root:

```sh
cargo build --release -p pdks-claude-code
```

The built executable is `target/release/pdks-claude-code`.

<a id="commands"></a>
## Commands

Place both `pdks-claude-code` and `pdks` on `PATH`, then run init from the project root:

```sh
pdks-claude-code init
```

- `init` runs `pdks init`, registers `PreToolUse` in `.claude/settings.json`, and adds
  `.claude/settings.json` and `.claude/settings.local.json` to `protectedPaths`. It also writes
  `.claude/rules/polydeukes.md` and `.claude/skills/discipline-draft/SKILL.md`, each only if that
  file does not already exist.
- `hook --project-root <absolute-path> --pdks <absolute-path>` reads the host event on stdin. Both
  paths must be absolute and the flags must appear in this order.

The same commands are available as `pdks claude-code init` and `pdks claude-code hook ...`. For the
shared scaffold, see [`pdks init`](../../docs/reference/cli/init.md#init-common). The
[session
connection guide](../../docs/how-to/connect-surfaces.md#claude-code)
describes host setup;


<a id="registration"></a>
## Registration

Registrations pin the absolute project root, adapter executable, and `pdks` path found on `PATH`.
They carry neither `onFailure` nor `|| exit 2`. If the adapter cannot start, the host lets the call
proceed without a message. If the adapter starts but cannot start the judge, it lets the call
proceed with an instruction to install `pdks`.

`hook` translates the proposed tool call and transcript evidence into input IR for the judge.

<a id="license"></a>
## License

MIT. See [LICENSE](./LICENSE).
