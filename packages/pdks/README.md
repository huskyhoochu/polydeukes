# `pdks`

**English** · [한국어](./README.ko.md)

The Rust `pdks` executable is the covenant judge, with `covenant check`, `init`, `explain`, and
`docs`. It also runs `pdks-<name>` executables on `PATH` as `pdks <name>`.

Choose Homebrew, crates.io, npm, or PyPI in the [installation guide](../../docs/how-to/install.md).
The [documentation home](../../docs/README.md) connects installation with the next steps.

<a id="install"></a>
## Install

`cargo install --locked pdks` builds the executable from crates.io with the dependency versions the
release was tested with (the `Cargo.lock` in the crate). `cargo binstall pdks` downloads the Release
archive described below for `aarch64-apple-darwin`, `x86_64-unknown-linux-musl` and
`aarch64-unknown-linux-musl`, and falls back to a source build on other targets.

```sh
cargo install --locked pdks
```

Each [GitHub Release](https://github.com/huskyhoochu/polydeukes/releases) carries
`pdks-<target>-v<version>.tar.gz` for `aarch64-apple-darwin`, `x86_64-unknown-linux-musl` and
`aarch64-unknown-linux-musl`. Each archive holds one directory with the same name, containing the
executable and `LICENSE`. Extract it and place the executable on `PATH`.

Or clone the [repository](https://github.com/huskyhoochu/polydeukes) and build from its root:

```sh
cargo build --release -p pdks
```

The built executable is `target/release/pdks`.

<a id="commands"></a>
## Commands

- [`pdks covenant check`](../../docs/reference/cli/covenant-check.md) judges input IR on stdin, or a
  unified diff with `--diff`. `--input-failure` accepts a producer failure. Choose at most one of
  those two flags. Optional flags are `--enforce advise|block` (default `advise`), `--unattended`,
  `--config-layer <path>`, and `--telemetry-path <path>`.
- [`pdks init`](../../docs/reference/cli/init.md#init-common) creates project configuration and adds
  the telemetry directory to `.gitignore`.
- [`pdks explain`](../../docs/reference/cli/explain.md) prints the assembled registrations.
- [`pdks docs`](../../docs/reference/cli/docs.md) reads the embedded documentation:
  `pdks docs [topic]`, `pdks docs search <query>`, or `pdks docs show <document-id>`. Topics accept
  `--lang en|ko`; search adds `--lang en|ko`, `--limit N`, and `--json`; show adds `--lang en|ko`,
  `--section <section-id>`, and `--json`.
- `pdks --version` prints the executable version.
- `pdks <name> [args...]` runs `pdks-<name>` from `PATH`, passing the remaining arguments and
  inheriting standard input, output, and error. An extension name contains only ASCII letters,
  digits, `_`, or `-`, and does not start with `-` or name a built-in command.

Run project commands from the project root. For configuration, see the
[project
guide](../../docs/how-to/configure-project.md).

<a id="license"></a>
## License

MIT. See [LICENSE](./LICENSE).
