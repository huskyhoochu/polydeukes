---
paths:
  - "package.json"
  - "packages/*/package.json"
  - "pnpm-workspace.yaml"
  - "turbo.json"
  - "packages/*/turbo.json"
  - "vitest.config.ts"
  - "packages/*/tsconfig*.json"
---

# Workspace structure — non-obvious constraints

Things about this monorepo's layout that the files themselves don't explain. Package internals live
in their own rules (`memory-package.md`, `sdk-packages.md`); adding a package or touching release
registrations is `new-package-checklist.md`.

## Package roles

- **`packages/polydeukes`** is the **unscoped name reservation** on npm and the umbrella / `pdks`
  CLI. Subcommands: `covenant check` (the judgment runner over an input IR or a unified diff on
  stdin), `init` (the agent-neutral scaffold — config file and telemetry ignore line),
  `adapter <claude-code|codex|grok> init | hook` (native registration and host events),
  `docs [topic]` (the offline reader over the docs bundled into `dist/docs` at build time),
  `explain` (the assembled-registration renderer), and
  `memory ingest | search | show | obligations | supersession | lint | stats | usage`
  (`src/memory-command.ts`, the one umbrella module that loads `@polydeukes/memory`, by dynamic
  import, and only for this command). It owns the config discovery loader (`loadConfig`) — the one
  place allowed to read and parse the data config file — and **the judge (`src/covenant/`)**:
  dispatcher, discipline library, meta-covenants, TTL witness, and declaration engine, imported
  statically by both composition roots and `pdks explain`. It also owns the surfaces' pre-state
  readers (`pre-state-reader.ts`) and the baseline comparator (`baseline.ts`), so
  **the judge module opens no file**: what the judge needs from disk arrives injected. core keeps
  one file-I/O site, the telemetry log (`telemetry.ts`). `runCovenantCheck` is both surfaces'
  composition root; `assembleCheckRegistrations` takes the surface as a required field, which
  `bin.ts` sets from the input mode (`--diff` is `changeSet`, anything else is `session`), and
  compiles `disciplines` plus that surface's own list. Only umbrella-role logic (discovery,
  assembly, the CLI) belongs here; area logic goes in scoped `@polydeukes/*` packages. Its `dist` is
  on the protected list (a gitignored judge executable no commit can show); its `src` and
  `package.json` are not. The unscoped name is a deliberately held asset — never delete or rename
  it.
- **`packages/core`** (`@polydeukes/core`) is the **thin, domain- and agent-agnostic core**: the
  covenant protocol, the config schema, and the IR vocabulary.
- **`packages/adapter-claude-code`**, **`packages/adapter-grok`**, and **`packages/adapter-codex`**
  share three public verbs: `prepareHook`, `registerHook`, and `renderHookResponse`. Each owns its
  host payload, evidence, native registration, and response format. They peer on core and have no
  bin. The umbrella depends on all three and bundles them into its single executable;
  `adapter-command.ts` owns their common execution path and `adapter-process.ts` owns process
  communication and deadlines. Registration pins the executable and project root. Moving the
  executable requires init from its new location; from a pnpm install, init pins
  `node_modules/polydeukes/dist/bin.js` rather than the versioned store path. The pinned root is
  never replaced: a file in a worktree or anywhere outside the root is judged by its absolute path.
  Each adapter carries a file target under its spelled name and, when it differs, again under its
  real (`realpathSync.native`) name, so a protected entry that is itself a symlink and a link that
  leads to one both stay judged; a dangling link or a real path that fails to resolve (other than
  `ENOTDIR`) refuses the call. Only the PreToolUse registration turns a hook that cannot start into
  a refusal (Claude `onFailure: block`, Codex and Grok `|| exit 2`); the other events never block on
  failure. Existing project config remains owner-controlled; init reports the required protected
  paths. Native registration replaces owned legacy commands, removes an exact generated mjs, and
  preserves user-modified files and sibling handlers. Codex translates `apply_patch` into file
  changes and keeps session/subagent evidence from lifecycle events, leaving its unstable transcript
  unread. Prompt text enters witness evidence only with explicit human provenance. A changed
  `.codex/hooks.json` definition needs `/hooks` approval. Code Mode coverage must be measured on the
  installed host version: an Active label alone is not execution evidence.
- **`packages/pdks`** (crate `pdks`, `publish = false`) is the Rust re-implementation of
  `covenant check` over both surfaces (stdin IR and `--diff`), `init`, `explain` and `--version`. It
  passes the cases of `conformance/covenant/` listed in `tests/fixture-cases.txt`, plus Rust-only
  cases in `tests/divergent/` (behavior it deliberately changes, which replace the listed cases they
  contradict). Like `sdk-rust` it has no `package.json`, so pnpm, turbo and the publish e2e suites
  skip it; Forgejo CI runs its `cargo fmt`, `clippy` and `test`. Its constraints are in `rust.md`.
- **`packages/sdk-ts`**, **`packages/sdk-rust`** (crate `polydeukes-sdk`), and
  **`packages/sdk-python`** (PyPI `polydeukes-sdk`) are process clients over a standalone `pdks`;
  see `sdk-packages.md`.
- **`packages/memory`** (`@polydeukes/memory`) is published and is an **optional peer** of the
  umbrella (`peerDependenciesMeta` optional plus a `devDependencies` entry, which is the turbo build
  edge). The judgment chain never imports it; see `memory-package.md`.
- **`packages/documentation`** (`@polydeukes/documentation`) is **`private`** and publishes nothing:
  it builds the public site at <https://polydeukes.vercel.app> from `docs/`. It carries no judgment
  logic and no internal dependency, so `workspace:^` and the catalog do not apply, and the publish
  e2e suites skip it because they take only non-private manifests. It
  **reads
  `docs/` and never writes there**:
  the same files `pdks docs` bundles, generated into `src/content/docs/` at build time by
  `scripts/sync-docs.mjs`, which is gitignored. Because that generated tree is a copy of every
  development record, an oracle that greps `packages/*/src` for a forbidden string will match the
  record that discusses it — `surface-contract.test.ts` skips the directory for exactly that reason.

## Dependency direction

A scoped package (`memory`, `adapter-*`, `sdk-ts`) takes vocabulary only from `core` — `memory` uses
none and has no workspace dependency (its runtime dependencies are `yaml` and `garu-ko`) — and never
depends on a sibling; core depends on nothing. SDKs consume the process protocol with generated
types and have no runtime core/umbrella dependency. The umbrella depends on core and all three
adapters, and takes memory as an optional peer for `pdks memory` alone. Enforce this direction when
adding packages. What a package exports is governed by `package-contract.md`.

**The adapters take core as `peerDependencies`**, paired with a `devDependencies` entry so each
package still builds and tests alone. The umbrella takes core as an ordinary dependency, which
satisfies the peer in a consumer tree that installs the umbrella. The reason is runtime identity
rather than types: a value tuple like `SOURCE_KINDS` and the `parseInput` validation have to be ONE
copy for the validator and the engine to agree; two copies would disagree silently instead of
failing at install time.

## The single executable

The umbrella's single executable contains Node and its bundle (the umbrella plus the three
adapters), built by `packages/polydeukes/scripts/build-sea.mjs <output path>` and attached to each
GitHub Release by `publish.yml` (`pdks-linux-x64`, `pdks-darwin-arm64`). Build it after a full
`pnpm build`: the bundle takes whatever the adapters' `dist` holds.

## Shared dependency versions go through the pnpm catalog

Versions shared across packages are defined **once** in `pnpm-workspace.yaml` under `catalog:` and
each package references them as `"typescript": "catalog:"` in its own devDependencies. Do **not**
hoist a shared dev tool by declaring it only at the root. Only true repo-level tools (turbo, biome,
lefthook, commitlint) live in the root `package.json` — plus `polydeukes` itself as a dogfooding
devDependency, which links the `pdks` bin the lefthook pre-commit gate spawns. Verify a single
resolved version with `pnpm why typescript -r` (expect `Found 1 version`).

The catalog pins TypeScript 7 (the native Go compiler) to an exact version. TS 7 ships the standard
`typescript` package and `tsc` binary, so `tsc -p tsconfig.json` is unchanged. Every emitting build
config sets `rootDir` explicitly and every package tsconfig sets `types: ["node"]`. TS 7.0 ships
**no programmatic compiler API** — avoid depending on it in `core`.

## Module resolution is NodeNext and imports spell `.ts`

Every package `tsconfig.json` sets `module` and `moduleResolution` to `NodeNext` with
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

**The umbrella build reads two directories outside its own package** — `docs/` (bundled into
`dist/docs` by `copy-docs.mjs`) and `packages/core/schema/` (copied to `dist/schema` by
`copy-schema.mjs`, so a consumer's `$schema` line reaches a file inside the package it installed).
Both are declared in `packages/polydeukes/turbo.json` `inputs` with `$TURBO_ROOT$`. A copy step
added without its input declaration ships a stale asset on every cache hit, and CI never sees it —
CI runs with a cold cache. Any new copy step goes in that list at the same time.

## npm `keywords` exempt the banned control vocabulary

The **`keywords` array in `package.json`** is a discoverability index, not a describing surface:
industry terms like `harness` and `guard` belong there so npm search reaches us — do not "fix" them.
The `description` field is NOT exempt.
