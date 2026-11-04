# Install Polydeukes

**English** · [한국어](./install.ko.md)

Install the `pdks` judge, then choose the extensions you need. You can judge Git diffs without an
agent integration. Claude Code, Codex, and project memory each have their own executable.

<a id="choose"></a>
## Choose an installation route

| Route      | Use it when                                                | What runs                                                                 |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Homebrew   | You manage command-line tools with brew                    | Prebuilt Rust executables                                                 |
| crates.io  | You have a Rust toolchain                                  | Rust executables built locally; cargo-binstall can fetch release archives |
| npm / pnpm | You want project-local, versioned development dependencies | A Node launcher selects the packaged Rust executable                      |
| PyPI       | You manage tools with uv or Python environments            | Platform wheels install Rust executables                                  |

Prebuilt releases support macOS arm64, Linux x64, and Linux arm64. Choose a route you already use;
you do not need all four. Native executables need no Node runtime. npm launchers require Node; the
TypeScript SDK requires Node 24 or newer. Source installation requires Rust 1.89 or newer.

<a id="homebrew"></a>
## Homebrew

```sh
brew install huskyhoochu/polydeukes/pdks
```

Add only the extensions you want:

```sh
brew install huskyhoochu/polydeukes/pdks-claude-code
brew install huskyhoochu/polydeukes/pdks-codex
brew install huskyhoochu/polydeukes/pdks-memory
```

The extension formulae depend on the judge. Installing a formula does not register project hooks.

<a id="cargo"></a>
## crates.io

```sh
cargo install --locked pdks
cargo install --locked pdks-claude-code
cargo install --locked pdks-codex
cargo install --locked pdks-memory
```

Each line installs one executable; the last three are optional. Put Cargo's bin directory on PATH.
If you already use cargo-binstall, `cargo binstall pdks` fetches the matching release archive; the
same command accepts each extension name. On other targets it can fall back to compiling source.

<a id="npm"></a>
## npm or pnpm

From your project root:

```sh
npm install --save-dev polydeukes
npm install --save-dev @polydeukes/adapter-claude-code
npm install --save-dev @polydeukes/adapter-codex
npm install --save-dev @polydeukes/memory
```

Or use `pnpm add -D` with the same package names. Keep the extensions you use and commit your
lockfile. Use `npx --no-install pdks` or `pnpm exec pdks` wherever this guide says `pdks`; use
`npx --no-install pdks-claude-code init` or `pnpm exec pdks-claude-code init` for host registration.
A local installation is available through these package-manager commands, not necessarily your
interactive shell's PATH.

Local npm/pnpm registration points at the installed platform executables. Rerun init if you move the
project or switch installation routes. Keep the development dependencies installed wherever those
registered hooks run.

<a id="pypi"></a>
## PyPI

```sh
uv tool install polydeukes
uv tool install polydeukes-claude-code
uv tool install polydeukes-codex
uv tool install polydeukes-memory
```

Each extension is a separate tool installation. Run `uv tool update-shell` if the tool bin directory
is not on PATH, then start a new shell. Alternatively, install the same names with pip in an
activated virtual environment. Keep that environment available to the registered hook paths. The
Python SDK is a different package, `polydeukes-sdk`.

<a id="verify"></a>
## Verify before connecting an agent

```sh
pdks --version
pdks docs
```

Both commands work without project configuration. If your shell cannot find `pdks`, check the
installation route's bin directory or use the npm/pnpm command above. If an extension cannot be
found, install that extension and check its directory is on PATH as well.

Continue with [your first judgment](../tutorials/first-judgment.md), then
[connect your host or
Git](./connect-surfaces.md).
Existing installations should follow
[the migration
guide](./migrate-to-rust.md)
before replacing hook registrations.

<a id="releases"></a>
## Direct release archives and upgrades

[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases) also provide
`<executable>-<target>-v<version>.tar.gz`. Targets are `aarch64-apple-darwin`,
`x86_64-unknown-linux-musl`, and `aarch64-unknown-linux-musl`. Extract the archive and place its
executable on PATH; retain its license files. Each archive contains one executable.

Upgrade through the package manager you installed with. After upgrading, check `pdks --version`, run
`pdks explain` in the project, and verify a real host call in `.polydeukes/roi.log`. Installed
`pdks docs` describes its executable's build; the website may describe a newer release.
