---
paths:
  - "Cargo.toml"
  - "packages/*/Cargo.toml"
  - "schema/**"
  - "package.json"
  - "packages/*/package.json"
  - "pnpm-workspace.yaml"
  - "turbo.json"
  - "packages/*/turbo.json"
  - "packages/*/tsconfig*.json"
---

# Workspace structure — non-obvious constraints

Things about this monorepo's layout that the files themselves don't explain. Package internals live
in their own rules (`memory-package.md`, `sdk-packages.md`); adding a package or touching release
registrations is `new-package-checklist.md`.

## Package roles

- **`packages/pdks`** (crate `pdks`) is the Rust judge providing `covenant check` over both surfaces
  (stdin IR and `--diff`), `init`, `explain`, `docs` and `--version`. Any other first argument that
  is a plain name (`[A-Za-z0-9_-]`, not starting with `-`) runs `pdks-<name>` from PATH with the
  remaining arguments and inherited stdio, and exits with its code; the crate names no extension.
  `build.rs` embeds the bundled documents of `docs/catalog.json`, so `docs` reads no file at run
  time; `packages/pdks/docs` is a git symbolic link to the root `docs/`, and `build.rs` reads
  through it, so `cargo package` copies the documents into the crate package. Its behavior contract
  is `conformance/covenant/`, run through `scripts/verify-covenant-fixtures.mjs`. Like `sdk-rust` it
  has no `package.json`, so pnpm and turbo skip it; Forgejo CI runs its `cargo fmt`, `clippy` and
  `test`. It and `sdk-rust` are members of the Cargo workspace in the root `Cargo.toml`. Its
  constraints are in `rust.md`.
- **`packages/pdks-claude-code`** (crate) is the Claude Code adapter as a `pdks-<name>` extension:
  `init` pins itself and the `pdks` found on PATH by absolute path in one `PreToolUse` registration
  without `onFailure`, and adds the two Claude settings files to `protectedPaths`; `hook` translates
  the payload into the input IR and runs `<pdks> covenant check`. A missing judge lets the call
  proceed with an install hint. Its translation is pinned by `conformance/adapter/claude-code/`, run
  through `scripts/verify-adapter-fixtures.mjs`.
- **`packages/pdks-codex`** (crate) is the Codex adapter in the same shape: `init` writes
  `PreToolUse`, `PostToolUse` and `SessionEnd` registrations to `.codex/hooks.json` as single-quoted
  command strings without `|| exit 2`, and adds `.codex/hooks.json` and `.codex/config.toml` to
  `protectedPaths`. `hook` translates `apply_patch` and `Bash` calls, and keeps the session's
  tool-call history in `.polydeukes/codex-sessions/` from the two lifecycle events. Its cases are
  `conformance/adapter/codex/`, run with `--cases-dir`.
- **`packages/pdks-memory`** (crate) is memory as a `pdks-<name>` extension:
  `pdks memory search | show | obligations | supersession | lint | stats | usage`, each with
  `--json`; `search` also takes `--limit <n>`. It reads only the `memory` key of the one config file
  in the working directory and recomputes every answer from the markdown files `memory.include`
  reaches on each run; it keeps no index file. `search` reduces the query with the `garu-core`
  Korean morphological analyzer, whose model is embedded in the executable (source vendored as
  `src/garu/` from one pinned commit of `ongjin/garu`, MIT, changed only for a source header per
  file, `crate::` paths, removed test modules and one closure pattern rejected by edition 2024;
  workspace lints and rustfmt are disabled for the module; `models/GARU-LICENSE` covers it and the
  embedded model), and ranks sections by one bm25 formula over passages split at blank lines, line
  breaks, then whitespace to at most 2,000 characters where whitespace allows, with a proximity
  adjustment and title occurrences counted twice. When the query has no Hangul, each query word is
  searched together with up to three Korean translations, taken first from `Korean(english)` glosses
  written in the searched documents and then from `models/en-ko.tsv`, an English-to-Korean word list
  built from Wiktionary (CC-BY-SA 4.0, built by `models/en-ko.py`) and embedded in the executable; a
  section matches the word if any of them matches, and scores by the best one. `search`, `show` and
  `obligations` append one line each to `.polydeukes/memory-log.jsonl`, which `usage` reads. Its
  tests are process tests in `tests/process/`.
- **`packages/sdk-ts`**, **`packages/sdk-rust`** (crate `polydeukes-sdk`), and
  **`packages/sdk-python`** (PyPI `polydeukes-sdk`) are process clients over a standalone `pdks`;
  see `sdk-packages.md`.
- **`packages/documentation`** (`@polydeukes/documentation`) is **`private`** and publishes nothing:
  it builds the public site at <https://polydeukes.vercel.app> from `docs/`. It carries no judgment
  logic and no internal dependency, so `workspace:^` and the catalog do not apply. It
  **reads
  `docs/` and never writes there**:
  the same files `pdks docs` bundles, generated into `src/content/docs/` at build time by
  `scripts/sync-docs.mjs`, which is gitignored.

## Dependency direction

The adapters invoke `pdks covenant check` through the process protocol. SDKs consume that protocol
with generated types. `pdks-memory` reads the configured markdown independently of judgment. What a
package exports is governed by `package-contract.md`.

## The executables and their distribution channels

`publish.yml`'s `rust-executables` job tests the release build for each shipped target with
`cargo test --release --locked --target` before building `pdks`, `pdks-claude-code`, `pdks-codex`
and `pdks-memory` for `aarch64-apple-darwin`, `x86_64-unknown-linux-musl` and
`aarch64-unknown-linux-musl` (musl is statically linked); `aarch64-unknown-linux-musl` is built on
`ubuntu-24.04-arm`. `scripts/pack-rust-executable.sh` packs each executable as
`<name>-<target>-v<version>.tar.gz` only; GitHub records each asset's digest. The archive entries
are owned by root and follow cargo binstall's default name and layout: one directory named
`<name>-<target>-v<version>` holding the executable and `LICENSE` (`pdks-memory` adds `GARU-LICENSE`
and `EN-KO-LICENSE`). release-please also bumps the five workspace members' versions in
`Cargo.lock`. `release-assets` attaches the Rust archives to the same Release once
`rust-executables` succeeds.

`publish.yml`'s `publish-rust-crates` job runs after `rust-executables` succeeds and runs
`cargo publish --locked` for each of the four crates whose tagged version crates.io does not have
yet, through crates.io trusted publishing, as `publish-crate` does for `sdk-rust`. A crate's first
version is published by hand (see `new-package-checklist.md`). `cargo binstall` finds the Release
archives through the crates' `repository`, which the root `[workspace.package]` declares together
with `authors` and `license`.

`pnpm -r publish` publishes only `@polydeukes/sdk-ts`. `scripts/pack-npm-packages.mjs` builds four
npm packages outside the pnpm workspace from the twelve Release archives: `polydeukes` ships `pdks`,
`@polydeukes/adapter-claude-code` ships `pdks-claude-code`, `@polydeukes/adapter-codex` ships
`pdks-codex`, and `@polydeukes/memory` ships `pdks-memory`. Each package contains the three targets'
executables under `bin/<target>/`, the archive's license files, the crate's README, and a Node
launcher `bin/<name>.js` that selects the executable for `darwin arm64`, `linux x64` or
`linux arm64`; on any other platform it writes one stderr line. The launcher's own failures
(unsupported platform or an executable that cannot run) exit 1, because a host reads exit 2 from a
hook as a block. A child ended by a signal exits 128 plus the signal number. When
`<cwd>/node_modules/<npm name>/bin/<target>/<name>` exists and has the same real path as the
executable beside the launcher, the launcher runs that path and passes it as `argv[0]`. Otherwise,
for example in a global install, it runs the executable beside the launcher and passes the bare
command name as `argv[0]`, so an extension's `init` looks itself up on `PATH` and registers the
package manager's bin entry; the launcher's own real path can name a pnpm store version. When
`<cwd>/node_modules/polydeukes/bin/<target>/pdks` exists, the launcher puts that directory first on
the child's `PATH`. An extension's `init`, run from the project root, therefore registers the two
platform executables under the project's `node_modules/<package>` directories, so the registered
hook runs without Node and the registration keeps working after an npm or pnpm upgrade (pnpm keeps
`node_modules/<package>` as a link to its versioned store directory). `publish.yml`'s `npm-packages`
job runs after `rust-executables` and `release-assets` on `macos-latest`, `ubuntu-latest` and
`ubuntu-24.04-arm`, sets up pnpm with `pnpm/action-setup`, downloads the archives from the tag's
GitHub Release, packs the four packages and runs `scripts/verify-npm-packages.mjs`, which installs
them into a fresh npm consumer and a fresh pnpm consumer and runs them. The `publish-npm-binaries`
job runs after `npm-packages`, packs them from the same Release archives and runs
`npm publish --provenance --access public` for each version the registry does not have, through npm
trusted publishing registered for all four names.

`scripts/homebrew-formulae.mjs <version> <assets.json> <out-dir>` writes the four formulae of the
tap `huskyhoochu/homebrew-polydeukes` (`pdks`, `pdks-claude-code`, `pdks-codex`, `pdks-memory`) from
the tag's Release asset list (`gh api .../releases/tags/<tag> --jq .assets`). Each formula's `url`
is a Release archive and its `sha256` is the `digest` GitHub records for that asset; a missing asset
or digest exits 1. On macOS a formula requires arm64; on Linux it picks the x86_64 or aarch64 musl
archive. The three extension formulae depend on `huskyhoochu/polydeukes/pdks`. `pdks-memory` also
installs `GARU-LICENSE` and `EN-KO-LICENSE` into its keg. `publish.yml`'s `homebrew-formulae` job
runs after `rust-executables` and `release-assets` on `macos-latest` and `ubuntu-latest`, puts
`/home/linuxbrew/.linuxbrew/bin` on PATH only on `ubuntu-latest`, writes the formulae and runs
`scripts/verify-homebrew-formulae.mjs`, which installs them from a local tap, runs them, and removes
the tap and the formulae afterwards. Its `ubuntu-latest` leg uploads the formulae it verified as the
`homebrew-formulae` artifact. An extension installed by Homebrew, with its `init` run by bare name,
registers `$(brew --prefix)/bin/<name>` and `$(brew --prefix)/bin/pdks`, links that `brew upgrade`
keeps. The `publish-homebrew` job runs after `homebrew-formulae` in the `homebrew-tap` concurrency
group, downloads the `homebrew-formulae` artifact, clones the tap over SSH with the write deploy key
in the `HOMEBREW_PDKS_DEPLOY_KEY` secret (github.com's ed25519 host key is pinned in the step),
copies the four formulae into `Formula/`, and pushes one commit `pdks <version>` to `main`, or none
when the formulae are unchanged. It pushes nothing when the tap's `Formula/pdks.rb` names a newer
version than the run's.

`scripts/pack-pypi-wheels.py <archives-dir> <version> <out-dir>`, run as `python -I`, uses only the
Python standard library and builds twelve wheels from the twelve Release archives: `polydeukes`
ships `pdks`, `polydeukes-claude-code` ships `pdks-claude-code`, `polydeukes-codex` ships
`pdks-codex`, and `polydeukes-memory` ships `pdks-memory`, one wheel per name and target. The script
exits 1 when an archive or license file is missing, or the archives directory holds an archive
outside its crate and target tables. Each wheel holds the archive's executable unchanged under
`<dist>-<version>.data/scripts/`, which installers copy into the environment's `bin/`, and its
license files under `.dist-info/licenses/`; `pdks-memory` adds `GARU-LICENSE` and `EN-KO-LICENSE`
and carries the crate's `License-Expression` of `MIT AND CC-BY-SA-4.0`. Metadata comes from the
crate's `Cargo.toml` `description` and `license` (including the workspace license when inherited)
and its README. The README in each wheel's metadata has its relative links (`./` and `../../`)
rewritten to `https://github.com/huskyhoochu/polydeukes/blob/v<version>/...`, because PyPI resolves
relative links against pypi.org. The wheels carry no dependencies, so an extension wheel does not
install `polydeukes`. The macOS tag is `macosx_11_0_arm64`; each static musl Linux target has one
wheel tagged with `manylinux_2_17`, `manylinux2014` and `musllinux_1_1` for its architecture, so
glibc and musl systems install the same file. The executable's zip entry mode is `0o100755`: pip
keeps the executable bit only when the mode also carries the regular-file type. Entries carry a
fixed timestamp, so the same archives produce byte-identical wheels on every leg. `publish.yml`'s
`pypi-wheels` job runs after `rust-executables` and `release-assets` on `macos-latest`,
`ubuntu-latest` and `ubuntu-24.04-arm`, downloads the tag's Release archives, compares them with
this run's `rust-*` artifacts using `diff -r`, builds the wheels and runs
`scripts/verify-pypi-wheels.py`. The verifier installs the platform's four wheels into a fresh venv
with pip and checks that the judge alone installs only `pdks`, `pdks init` writes no host directory,
each adapter's `init` registers `<venv>/bin/<name>` and `<venv>/bin/pdks`, the registered command
blocks a protected write, and `pdks memory search` finds a document. The `ubuntu-latest` leg uploads
the twelve wheels it built and verified as the `pypi-wheels` artifact. The `publish-pypi-binaries`
job runs after `pypi-wheels` in the GitHub environment `pypi`, downloads the `pypi-wheels` artifact,
and uploads it with `pypa/gh-action-pypi-publish` and `skip-existing: true` through PyPI trusted
publishing registered for all four names. A re-run uploads only the files PyPI does not have.

## Shared dependency versions go through the pnpm catalog

Versions shared across packages are defined **once** in `pnpm-workspace.yaml` under `catalog:` and
each package references them as `"typescript": "catalog:"` in its own devDependencies. Do **not**
hoist a shared dev tool by declaring it only at the root. Only true repo-level tools (turbo, biome,
lefthook, commitlint) live in the root `package.json`. Verify a single resolved version with
`pnpm why typescript -r` (expect `Found 1 version`).

The catalog pins TypeScript 7 (the native Go compiler) to an exact version. TS 7 ships the standard
`typescript` package and `tsc` binary, so `tsc -p tsconfig.json` is unchanged. The `sdk-ts` emitting
build config sets `rootDir` explicitly and its tsconfig sets `types: ["node"]`. TS 7.0 ships
**no programmatic compiler API** — avoid depending on it.

## Module resolution is NodeNext and imports spell `.ts`

The `sdk-ts` `tsconfig.json` sets `module` and `moduleResolution` to `NodeNext` with
`rewriteRelativeImportExtensions: true`. A relative import is written with the source's own
extension (`from './discipline.ts'`) in `src/` and `__tests__/` alike; tsc rewrites it to `.js` in
the emitted JavaScript. An extensionless relative import is a Node error and a type error.
Declaration files keep the `.ts` spelling and TypeScript resolves it to the `.d.ts` beside it. A
test that asserts a source file's import text asserts `.ts`; one that names a dist file names `.js`.

## Build-graph blind spots

**Turbo's cache does not see the hook file.** A hook or gate artifact outside a package's declared
inputs stays cached across a change that should invalidate it, so an e2e run can validate the
previous build. When a change touches the assembly rather than a package's sources, verify against a
fresh build rather than a cached task.

## npm `keywords` exempt the banned control vocabulary

The **`keywords` array in `package.json`** is a discoverability index, not a describing surface:
industry terms like `harness` and `guard` belong there so npm search reaches us — do not "fix" them.
The `description` field is NOT exempt.
