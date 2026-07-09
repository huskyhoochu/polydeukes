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

- **`packages/polydeukes`** is the **unscoped name reservation** on npm and the *future*
  umbrella / `pdks` CLI entry point. It is intentionally a near-empty stub — that is the
  finished state for now, **not** an unimplemented package. Do not move real logic here;
  real code goes in scoped `@polydeukes/*` packages. The unscoped name was verified free on
  npm and is a deliberately held asset — never delete or rename it.
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
tools (turbo, biome, lefthook, commitlint) live in the root `package.json`. Verify a single
resolved version with `pnpm why typescript -r` (expect `Found 1 version`).

The catalog pins **`typescript: 7.0.1-rc` (TypeScript 7.0 RC, the native Go compiler)**, chosen
deliberately over stable 5.x/6.x — pin an exact version in the catalog, not a dist-tag like `rc`,
so installs are reproducible. Bump the one catalog line on GA/patch and every package follows.
TS7 RC ships as the standard `typescript` package with the standard `tsc` binary (not
`@typescript/native-preview`/`tsgo`), so the `tsc -p tsconfig.json` build is unchanged.
**Caveat:** the TS programmatic compiler API is unstable until 7.1 — avoid depending on it in
`core` until then.

## npm `keywords` exempt the banned control vocabulary

`domain-terms.md` bans `harness`/`guard`/`kb` from code, docs, and user-facing surfaces. The
**`keywords` array in `package.json` is an exception**: it is a discoverability index (how users
*find* us on npm), not a surface where we *describe* the product. Industry-standard terms like
`harness` and `guard` belong there so npm search reaches us — keep them alongside the covenant
vocabulary, do not "fix" them to `discipline`/`covenant`. The `description` field is NOT exempt
(it is a describing surface) — covenant vocabulary only there.
