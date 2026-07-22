---
paths:
  - "packages/**"
  - "package.json"
  - "pnpm-workspace.yaml"
---

# Workspace structure — non-obvious constraints

Things about this monorepo's layout that the files themselves don't explain. (Stack
facts — pnpm/turbo/Biome/Node 24 — are in `package.json`/`turbo.json`/`CLAUDE.md`; not repeated here.)

## Package roles

- **`packages/polydeukes`** is the **unscoped name reservation** on npm and the umbrella /
  `pdks` CLI entry point — since ADAPTER-git the bin is real, with `covenant check` (the
  pre-commit judgment runner) as its only subcommand. Since CONFIG-03 it owns the config discovery loader
  (`loadConfig`) — the one place allowed to read and parse the data config file (core stays
  file-I/O-free). Only umbrella-role logic (discovery, assembly-facing loading, the CLI)
  belongs here; area logic still goes in scoped `@polydeukes/*` packages. Its `src`/`dist` are
  on the protection surface (the loader feeds the judges). The unscoped name was verified free
  on npm and is a deliberately held asset — never delete or rename it.
- **`packages/core`** (`@polydeukes/core`) is the **thin, domain- and agent-agnostic core**.
  The covenant protocol (CORE-01) and `defineConfig()` loader (CONFIG-01) land here first.
- **Dependency direction is one-way:** every other package (`covenant`, `ledger`, `memory`,
  `verify`, `adapter-*`) depends only on `core` — never on each other. The umbrella `polydeukes` may
  re-export them, but core must never depend on any sibling. Enforce this when adding packages.

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

## npm `keywords` exempt the banned control vocabulary

`domain-terms.md` bans `harness`/`guard`/`kb` from code, docs, and user-facing surfaces. The
**`keywords` array in `package.json` is an exception**: it is a discoverability index (how users
*find* us on npm), not a surface where we *describe* the product. Industry-standard terms like
`harness` and `guard` belong there so npm search reaches us — keep them alongside the covenant
vocabulary, do not "fix" them to `discipline`/`covenant`. The `description` field is NOT exempt
(it is a describing surface) — covenant vocabulary only there.
