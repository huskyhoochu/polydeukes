# `pdks-memory`

**English** · [한국어](./README.ko.md)

The Rust memory extension runs as `pdks memory ...` when `pdks-memory` is on `PATH`. It computes
answers from the markdown files on every run and keeps no index file.

<a id="install"></a>
## Install

`cargo install --locked pdks-memory` builds the executable from crates.io with the dependency
versions the release was tested with (the `Cargo.lock` in the crate). `cargo binstall pdks-memory`
downloads the Release archive described below for `aarch64-apple-darwin` and
`x86_64-unknown-linux-musl`, and falls back to a source build on other targets.

```sh
cargo install --locked pdks-memory
cargo binstall pdks-memory
```

Each [GitHub Release](https://github.com/huskyhoochu/polydeukes/releases) carries
`pdks-memory-<target>-v<version>.tar.gz` for `aarch64-apple-darwin` and `x86_64-unknown-linux-musl`.
Each archive holds one directory with the same name, containing the executable and `LICENSE`,
`GARU-LICENSE`, `EN-KO-LICENSE`. Extract it and place the executable on `PATH`.

Or clone the [repository](https://github.com/huskyhoochu/polydeukes) and build from its root:

```sh
cargo build --release -p pdks-memory
```

The built executable is `target/release/pdks-memory`.

<a id="commands"></a>
## Commands

Run from the project root. The executable reads the config's `memory` key and the markdown files
selected by `memory.include` and `memory.exclude`.

- [`search <query…>`](../../docs/reference/cli/memory.md#search) ranks matching sections;
  `--limit <n>` sets the result limit (default 20).
- [`show <id>`](../../docs/reference/cli/memory.md#show) prints a document or section.
- [`obligations <key>`](../../docs/reference/cli/memory.md#obligations) lists obligations for a key.
- [`supersession <doc>`](../../docs/reference/cli/memory.md#supersession) lists replacement links.
- [`lint`](../../docs/reference/cli/memory.md#lint) reports link violations.
- [`stats`](../../docs/reference/cli/memory.md#stats) reports corpus counts.
- [`usage`](../../docs/reference/cli/memory.md#usage) summarizes the memory access log.

Prefix each command with `pdks memory`; all accept `--json`. For example:

```sh
pdks memory search configuration --limit 5 --json
```

`search`, `show`, and `obligations` append to `.polydeukes/memory-log.jsonl`. The linked reference
also describes the TypeScript package's index-based implementation; this executable reads the
markdown anew for each command.

<a id="third-party-data"></a>
## Third-party data

The executable embeds the garu Korean morphological analyzer. Its source under `src/garu/` comes
from `ongjin/garu`; [models/GARU-LICENSE](./models/GARU-LICENSE) is the MIT license covering that
code and the embedded model `models/garu-base.gmdl`.

It also embeds an English-Korean dictionary derived from Wiktionary, `models/en-ko.tsv`.
[models/EN-KO-LICENSE](./models/EN-KO-LICENSE) states its CC BY-SA 4.0 license and attribution; that
license applies to `models/en-ko.tsv` only.

<a id="license"></a>
## License

MIT. See [LICENSE](./LICENSE).
