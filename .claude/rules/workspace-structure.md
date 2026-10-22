---
paths:
  - "package.json"
  - "packages/*/package.json"
  - "pnpm-workspace.yaml"
  - "turbo.json"
  - "packages/*/turbo.json"
  - "vitest.config.ts"
  - "packages/*/tsconfig*.json"
  - "release-please-config.json"
  - "_docs/prd/**"
---

# Workspace structure — non-obvious constraints

Things about this monorepo's layout that the files themselves don't explain. (Stack
facts — pnpm/turbo/Biome/Node 24 — are in `package.json`/`turbo.json`; not repeated here.)

## Package roles

- **`packages/polydeukes`** is the **unscoped name reservation** on npm and the umbrella /
  `pdks` CLI entry point — since ADAPTER-git the bin is real. Subcommands:
  `covenant check` (the judgment runner over an input IR or a unified diff on stdin),
  `init` (the agent-neutral project scaffold — config file and telemetry ignore line),
  `adapter <claude-code|codex|grok> init | hook` (native registration and host events),
  `docs [topic]`
  (the offline reader over the docs bundled into `dist/docs` at build time, since
  DOCS-02), `explain` (the assembled-registration renderer, since CLI-01), and
  `memory ingest | search | show | obligations | supersession | lint | stats | usage` (since
  MEMORY-15,
  `lint` · `stats` since MEMORY-05, `obligations` since MEMORY-14, `usage` since MEMORY-10,
  `supersession` since MEMORY-08:
  `src/memory-command.ts`, the one umbrella module that loads `@polydeukes/memory`, by dynamic
  import, and only for this command).
  Since CONFIG-03 it owns the config discovery loader
  (`loadConfig`) — the one place allowed to read and parse the data config file. Since
  SURFACE-02 it also owns **the judge (`src/covenant/`)** — the dispatcher, the discipline
  library, the meta-covenants, the TTL witness, and the declaration engine — which both
  composition roots and `pdks explain` import statically. Since
  ALGEBRA-03c it also owns the surfaces' pre-state readers (`pre-state-reader.ts`) and the
  baseline comparator (`baseline.ts`), so **the judge module opens no file**: what the judge needs
  from disk arrives injected. core keeps one file-I/O site of its own, the telemetry log
  (`telemetry.ts`), which every surface appends a row to. Since DIST-01 it also owns **both
  surfaces' composition root** — `runCovenantCheck`, the CLI over a staged diff or a host's
  IR carrying its tool roster and session evidence (SURFACE-03a). One assembly serves both:
  `assembleCheckRegistrations` takes the surface as a required field, which `bin.ts` sets from
  the input mode (`--diff` is `changeSet`, anything else is `session`), and compiles
  `disciplines` plus that surface's own list. Only
  umbrella-role logic (discovery, assembly, the CLI) belongs here; area logic still goes in
  scoped `@polydeukes/*` packages. The loader feeds the
  judges, so its `dist` is on the protected list (a gitignored judge executable no commit can
  show); its `src` and `package.json` are not — editing them in a session is the work itself,
  and the commit that stages them is what the change-set surface judges (advise by default since
  SURFACE-01). The unscoped name was verified free on npm and is a
  deliberately held asset — never delete or rename it.
- **`packages/core`** (`@polydeukes/core`) is the **thin, domain- and agent-agnostic core**.
  The covenant protocol (CORE-01) and `defineConfig()` loader (CONFIG-01) land here first.
- **`packages/adapter-claude-code`**, **`packages/adapter-grok`**, and
  **`packages/adapter-codex`** share three public verbs: `prepareHook`, `registerHook`, and
  `renderHookResponse`. Each owns its host payload, evidence, native registration, and
  response format. They peer on core and have no bin. The umbrella depends on all three and
  bundles them into its single executable; `adapter-command.ts` owns their common execution
  path and `adapter-process.ts` owns process communication and deadlines.
  Registration pins the executable and project root. Moving the executable requires init
  from its new location; from a pnpm install, init pins `node_modules/polydeukes/dist/bin.js`
  rather than the versioned store path. The pinned root is never replaced: a file in a
  worktree or anywhere outside the root is judged by its absolute path. Each adapter carries a
  file target under its spelled name and, when it differs, again under its real
  (`realpathSync.native`) name, so a protected entry that is itself a symlink and a link that
  leads to one both stay judged; a dangling link on the way refuses the call. Only the
  PreToolUse registration turns a hook that cannot start into a refusal (Claude
  `onFailure: block`, Codex and Grok `|| exit 2`); the other events never block on failure.
  Existing project config remains owner-controlled; init reports the
  required protected paths. Native registration replaces owned legacy commands, removes an
  exact generated mjs, and preserves user-modified files and sibling handlers.
  Codex translates `apply_patch` into file changes and keeps session/subagent evidence from
  lifecycle events, leaving its unstable transcript unread. Prompt text enters witness
  evidence only with explicit human provenance. A changed `.codex/hooks.json` definition
  needs `/hooks` approval. Code Mode coverage must be measured on the installed host version:
  an Active label alone is not execution evidence.
- **`packages/sdk-ts`** (`@polydeukes/sdk-ts`) exposes four asynchronous process clients:
  `checkCovenant`, `checkChangeSet`, `memoryIngest`, and `memorySearch`. They share one resolver
  and binary process transport. An explicit executable resolves against the caller's cwd;
  otherwise the first executable pdks in an absolute PATH directory runs. `src/ir.ts` and
  `src/memory.ts` are committed types generated from core's two schemas; the pinned development
  generator's `scripts/generate-types.mjs --check` checks drift. The published package has
  no runtime dependencies or peers. Core remains a test-only development dependency.
  The SDK owns no judgment, telemetry, or index and has no bin.
- **`packages/sdk-rust`** is the cargo crate `polydeukes-sdk` (crates.io), not an npm package:
  `check_covenant`, `check_change_set`, `memory_ingest`, and `memory_search` share one resolver
  and byte transport with the same executable selection and result meaning as TS and Python.
  Its optional Duration covers communication through pipe completion; a timed-out direct
  child is killed and reaped. It has no
  `package.json`, so pnpm, turbo, and the publish e2e suites skip it, and tests that enumerate
  `packages/*` take only directories carrying a `package.json`. Its IR
  types are `src/ir.rs`, generated by typify from `packages/core/schema/covenant-input.schema.json`
  and committed, and its memory search output types are `src/memory.rs` from
  `memory-search-output.schema.json` the same way; `tests/ir_generated.rs` fails when either pair
  differs, and
  `POLYDEUKES_REGEN_IR=1 cargo test --test ir_generated` rewrites both. Forgejo CI runs
  `cargo test` after the build (the e2e test spawns the built `pdks`); `publish.yml`'s
  `publish-crate` job uploads it through crates.io trusted publishing.
- **`packages/sdk-python`** is the PyPI distribution `polydeukes-sdk`, imported as
  `polydeukes_sdk`: four synchronous verbs over a standalone `pdks` executable, with one
  resolver and process runner. It uses Python 3.12+, zero runtime dependencies, and generated
  TypedDict types from core's input and memory output schemas. It has no `package.json`;
  explicit uv steps own its checks, build, and installed-distribution tests.
- **`packages/documentation`** (`@polydeukes/documentation`) is **`private`** and publishes
  nothing: it builds the public site at <https://polydeukes.vercel.app> from `docs/`. It carries
  no judgment logic and no internal dependency, so `workspace:^` and the catalog do not apply,
  and the publish e2e suites skip it because they take only non-private manifests. Two
  consequences bind anything that touches it. It **reads `docs/` and never writes there**: the
  same files `pdks docs` bundles, generated into `src/content/docs/` at build time by
  `scripts/sync-docs.mjs`, which is gitignored. And because that generated tree is a copy of
  every development record, an oracle that greps `packages/*/src` for a forbidden string will
  match the record that discusses it — `surface-contract.test.ts` skips the directory for
  exactly that reason.
- **`packages/memory`** (`@polydeukes/memory`) is published and is an **optional peer** of the
  umbrella (`peerDependenciesMeta` optional plus a `devDependencies` entry, which is the turbo
  build edge); its barrel carries `openMemoryDb`, `ingestMemory`, `searchMemory`, `showMemory`,
  `lintMemory`, `listObligations`, `listSupersession`, `describeMemoryIndex`, and
  `summarizeMemoryUsage`. Inside it,
  `parseDocument` splits a markdown text into
  a preamble row and one row per H2, keyed `<document id>#<anchor>`; `openMemoryDb` /
  `replaceDocument` / `optimizeMemoryDb` keep those rows in a `node:sqlite` database with a
  contentless trigram FTS5 table over chunks: `replaceDocument` splits each section body into
  passages of at most 2,000 characters at blank lines, line breaks, or spaces, stores their
  offsets in SQLite characters, and writes one index row per passage, and `searchMemory` ranks a
  section by its best passage. `replaceDocument` derives type and
  ticket columns from validated memory settings; `ingestMemory` compares the files the `include`
  globs reach, minus those an `exclude` glob matches, with the stored documents in one write
  transaction — it skips a document whose hash of text plus type, ticket, obligation, and
  supersession settings is
  unchanged, replaces a changed one, and deletes one whose file is gone or excluded, then
  resolves every stored link row (`edge`, written per section from `[[x]]` and `.md` links)
  against the whole index, so a skipped document's links still follow
  their targets; `searchMemory` (async) normalizes the query first — Korean words lose particles and
  endings through the `garu-ko` analyzer, loaded only for a Hangul query, and English function words
  drop out — then finds section rows and applies configured type weights, while
  `showMemory` returns stored document or section content with its links (and, for a
  document, the other documents with the same stored ticket, computed at read time), and
  `lintMemory` reports unresolved links, unlinked same-ticket documents, and untyped
  documents once any document has a type. `replaceDocument` also writes `obligation` rows from
  the `obligations` rules (a line rule keys each match on a marker line; a section rule keys a
  matching H2 section by the document's ticket), and `listObligations` returns every row under one
  key. It writes `supersession` rows from the `supersedes` line rules (each match of `key` on a
  marker line names a target in one `direction`); `ingestMemory` resolves every row after the
  reconciliation, by document name as a wikilink name resolves and then by a unique ticket, so
  `searchMemory` sorts a replaced document with the deprecated ones and names its `supersededBy`,
  `listSupersession` walks the chain both ways, and `lintMemory` reports unresolved targets and a
  `direction: supersedes` declaration that quotes nothing of what it replaces. `ingestMemory` also
  writes `meta.ingested_at` in its transaction, which `describeMemoryIndex` reads with the
  document, section, link, unresolved, and isolated counts. `summarizeMemoryUsage` lays the
  entries of the query log `.polydeukes/memory-log.jsonl` against the indexed documents (hot,
  dead, and missed searches); the umbrella appends that log after each successful `search`,
  `show`, and `obligations`, and it is local state the index rebuild never touches. It has no
  core dependency, so it has
  no `vitest.config.ts` alias; `engines.node` is `>=24.15`, where `node:sqlite` stops printing an
  experimental warning. The database is a derived index — any schema change is absorbed by
  rebuilding it from the documents. The judgment chain never imports it.
- **Dependency direction:** a scoped package (`ledger`, `memory`, `verify`, `adapter-*`,
  `sdk-ts`) takes vocabulary only from `core` — `memory` uses none and has no workspace
  dependency (its runtime dependencies are `yaml` and `garu-ko`) — and never depends on a
  sibling; core depends on nothing. SDKs consume the process protocol with generated types
  and have no runtime core/umbrella dependency. The umbrella depends on core and all three
  adapters, and takes memory as an optional peer for `pdks memory` alone. A consumer can use
  the bundled executable for all three hosts. Enforce this direction when adding packages.
- **The kind of the core dependency is `peerDependencies`** (ALGEBRA-03c) for the adapters,
  paired with a `devDependencies` entry so each package still builds and tests alone.
  The umbrella takes core as an ordinary dependency, and that is what satisfies the peer in a
  consumer tree that installs the umbrella. The reason is runtime identity
  rather than types: a
  value tuple like `SOURCE_KINDS` and the `parseInput` validation have to be ONE copy for the
  validator and the engine to agree, and two copies would disagree silently instead of failing
  at install time.
- **What a package exports is governed by `package-contract.md`** (entry-point kinds, barrels as
  re-export-only consumer contracts, the executor/vocabulary skeletons) — it auto-loads for
  barrels, manifests, and READMEs.

## New-package scaffold checklist

Three registrations are enumerated, not inferred, so a new package silently misses them. All
three have been forgotten at least once (ADAPTER-01, CONFIG-03, ADAPTER-git), each time surfacing
later as a confusing failure rather than an obvious one:

1. **`vitest.config.ts` alias** — map `@polydeukes/core` to its *source*. The exports map points
   at `dist`, so without the alias `pnpm -F <pkg> test` breaks on a clean clone.
2. **`release-please-config.json` `extra-files`** — the list is explicit, so a new package's
   version file is not bumped until it is registered. **If a release PR is already open,
   editing the config is not enough**: release-please compares release notes, not the file
   list it would write, so it logs `PR #N remained the same` and leaves the stale branch in
   place while the workflow still reports success. Close the PR (`tea pr close <N>`), delete
   its head branch (`git push origin --delete <branch>`), and rerun the workflow so it
   recomputes from the current config. **The rerun may not recover.** Measured 2026-09-16:
   after the close-and-delete, the action's branch-creation call answered 500 on every retry
   across two reruns 35 minutes apart, while the same call with an owner token answered 201
   at once — so it is the actions token against that branch name, not a settling delay, and
   the closed PR's `refs/pull/N/head` cannot be removed over the API (405). When that
   happens, write the release commit by hand: every manifest and
   `.release-please-manifest.json` to the new version, the CHANGELOG section the bot had
   already composed on the closed PR, committed as `chore(main): release X.Y.Z`. That is
   what the bot would have written, so the next release-please run reads the version as
   released. An empty `chore:` commit is the only rerun — the workflow has no
   `workflow_dispatch`.
3. **`workspace:^` for internal dependencies** — never a version range.
4. **npm trusted publishing is registered per package, and only after the package
   exists.** A new name has no access page to register on, so the workflow's OIDC token
   answers `ENEEDAUTH` for it and stops the whole `pnpm -r publish` walk there. The first
   version goes up by hand from the tagged tree — `pnpm publish --access public
   --no-git-checks --otp=<authenticator code>`, over the same pnpm path the workflow uses
   (`npm publish` rejects the bin for a missing exec bit that pnpm does not check; the
   browser-auth EOTP path prints a masked URL and never opens it, so `--otp` is the one that
   completes). Then register `huskyhoochu` / `polydeukes` / `publish.yml` on the new access
   page and rerun the workflow for whatever the stop left unpublished. **Which packages the
   workflow actually publishes is read off the registry, not the settings**:
   `dist.attestations` on the latest version is present only when the workflow uploaded it.
   On 2026-09-16 that read showed three of five existing packages registered — `adapter-grok`
   and `sdk-ts` had gone up by hand on every release since the bootstrap, and the
   bootstrap-day `ENEEDAUTH` had stopped on `adapter-grok` for exactly this reason.

The publish e2e suites (`packages/polydeukes/__tests__/publish-pack.e2e.test.ts`,
`clean-install.e2e.test.ts`) need no registration: they derive their package set from the
non-private `packages/*` manifests — the same domain `pnpm -r publish` acts on — so a new
package is covered the moment it exists.

A cargo crate under `packages/` takes its own three registrations instead: a `toml` entry in
`release-please-config.json` `extra-files` (`$.package.version` of its `Cargo.toml`), a
`cargo test` step in `.forgejo/workflows/ci.yml` after the build, and a crates.io trusted
publisher (repository `huskyhoochu/polydeukes`, workflow `publish.yml`) on the crate's settings
page. The last one, like npm's, can only be registered once the crate exists, so the first
version is published by hand from the tagged tree with a `publish-new` token.

A Python package under `packages/` takes a `toml` extra-file registration for
`$.project.version` in its `pyproject.toml` and the SDK version in `uv.lock`, explicit uv
checks in Forgejo CI, and a PyPI
OIDC publish job after the standalone executable builds. Commit its uv lockfile and include
`py.typed` in the wheel. Runtime dependencies remain declared in `project.dependencies`;
code generation and checking tools belong to the development dependency group. Its first
release requires the owner to configure a PyPI pending publisher for `huskyhoochu/polydeukes`,
workflow `publish.yml`, environment `pypi`, and confirm the matching GitHub environment.
The pinned TOML updater exposes parsed scalar nodes as `{value, start, end}`, so the lockfile
JSONPath filters by `@.name.value` before selecting `.version`. Recheck that path against the
actual updater when upgrading the action.
The npm alias, workspace dependency, and npm first-publication steps above apply to npm packages.

## Shared dependency versions go through the pnpm catalog

Versions shared across packages are defined **once** in `pnpm-workspace.yaml` under `catalog:`
and each package references them as `"typescript": "catalog:"` in its own devDependencies. This
is the pnpm + Turborepo recommended pattern: central version (no drift) **and** each package
explicitly declares what it uses ("install where used"). Do **not** hoist a shared dev tool by
declaring it only at the root — add it to the catalog and reference it. Only true repo-level
tools (turbo, biome, lefthook, commitlint) live in the root `package.json` — plus
`polydeukes` itself as a dogfooding devDependency, which links the `pdks` bin that the
lefthook pre-commit covenant gate spawns (ADAPTER-git). Verify a single
resolved version with `pnpm why typescript -r` (expect `Found 1 version`).

The catalog pins **`typescript: 7.0.2` (TypeScript 7.0 GA, the native Go compiler)** — pin an
exact version in the catalog, not a dist-tag, so installs are reproducible. Bump the one catalog
line on patch releases and every package follows. TS7 ships as the standard `typescript` package
with the standard `tsc` binary (not `@typescript/native-preview`/`tsgo`), so the
`tsc -p tsconfig.json` build is unchanged. The RC→GA default changes (`rootDir` → `./`, `types`
→ `[]`) don't bite here: every emitting build config sets `rootDir` explicitly and every package
tsconfig sets `types: ["node"]`.
**Caveat:** TS 7.0 ships **no programmatic compiler API** (planned for 7.1) — avoid depending on
it in `core` until then.

## Module resolution is NodeNext and imports spell `.ts`

Every package `tsconfig.json` sets `module` and `moduleResolution` to `NodeNext` with
`rewriteRelativeImportExtensions: true`. A relative import is written with the source's own
extension (`from './discipline.ts'`) in `src/` and `__tests__/` alike; tsc rewrites it to `.js`
in the emitted JavaScript, so dist carries the file names Node resolves. An extensionless
relative import is a Node error and now a type error — `Bundler` resolution used to admit it.
Declaration files keep the `.ts` spelling and TypeScript resolves it to the `.d.ts` beside
it, so a consumer typechecks against the published tarball unchanged. A test that asserts a
source file's import text asserts `.ts`; one that names a dist file names `.js`. CommonJS
dependencies read differently under NodeNext: a subpath outside an `exports` map needs its
file extension (`ajv/dist/2020.js`), and a plugin exported as `module.exports = fn` with
`exports.default = fn` is called as `ns.default.default(...)` from a namespace import.

## Build-graph blind spots

**Turbo's cache does not see the hook file.** A hook or gate artifact outside a package's
declared inputs stays cached across a change that should invalidate it, so an e2e run can
validate the previous build. When a change touches the assembly rather than a package's
sources, verify against a fresh build rather than a cached task.

**The umbrella build reads two directories outside its own package** — `docs/` (bundled into
`dist/docs` by `copy-docs.mjs`, DOCS-02) and `packages/core/schema/` (copied to `dist/schema`
by `copy-schema.mjs`, DIST-05, so a consumer's `$schema` line reaches a file inside the
package it installed). Both are declared in `packages/polydeukes/turbo.json` `inputs` with
`$TURBO_ROOT$`. A copy step added without its input declaration ships a stale asset on every
cache hit, and CI never sees it — CI runs with a cold cache. Any new copy step goes in that
list at the same time.

**An import-only exports map blocks `createRequire`.** A package consumed through
`createRequire` (as the git adapter's spawn path does) needs a `require` condition in its
exports map; an `import`-only map fails at runtime while typechecking clean.

## npm `keywords` exempt the banned control vocabulary

`domain-terms.md` bans `harness`/`guard`/`kb` from code, docs, and user-facing surfaces. The
**`keywords` array in `package.json` is an exception**: it is a discoverability index (how users
*find* us on npm), not a surface where we *describe* the product. Industry-standard terms like
`harness` and `guard` belong there so npm search reaches us — keep them alongside the covenant
vocabulary, do not "fix" them to `discipline`/`covenant`. The `description` field is NOT exempt
(it is a describing surface) — covenant vocabulary only there.
