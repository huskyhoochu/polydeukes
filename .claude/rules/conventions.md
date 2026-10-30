# Repository conventions

These hold for every change in this repository, whatever path it touches.

## Vocabulary is binding

This project deliberately renames control-framing terms. **Never use `guard`, `harness`, or `kb`**
in code, packages, CLI, or docs — use `covenant`, `discipline framework`, and `memory`. The full
glossary is in `.claude/rules/domain-terms.md`; read it before naming anything. One deliberate
exception: the npm `keywords` array keeps the industry terms — it is a discoverability index; the
`description` field is NOT exempt.

## Languages

- **Public docs are bilingual:** English is the default; Korean mirrors live in `*.ko.md`. Keep them
  in sync when editing either — the change-set surface judges the pair (`docs-stay-bilingual`,
  advised when one side is staged without the other). In Korean docs, use translation + English
  gloss for the vocabulary (`약속(covenant)`), never transliteration.
- `AGENTS.md` and `AGENTS.local.md` have no Korean mirrors.
- Internal documents under `_docs/`, including PRDs, are written in Korean only.

## Commands

- `pnpm check` is the canonical "fix everything" command (Biome lint + format with `--write`).
- Root `pnpm test` completes workspace builds using Turbo's cache, then runs every package's test
  suite in parallel on each invocation.
- For a focused e2e run, first run `pnpm build`, then `pnpm -F <package> exec vitest run <file>`;
  focused tests consume the existing build artifacts.
- Typecheck before either build command. The root has no `typecheck` script:
  `pnpm -r --if-present typecheck`.
- lefthook's pre-commit judges with the Rust release build. After a fresh clone or a change under
  `packages/pdks`, run `cargo build --release --manifest-path packages/pdks/Cargo.toml`.
- A single executable built for a release or a measurement comes after a full `pnpm build`.
  `pnpm -F polydeukes build` alone leaves the adapters' `dist` stale, and the executable bundles
  whatever `dist` holds.

## Tools that stay out

Do not use or introduce Transcodes in this repository. Do not invoke Transcodes plugins, skills,
MCP tools, CLI commands, Persona workflows, hooks, generated files, or dependencies here. Manage
agent instructions directly in `AGENTS.md` and the repository-owned rule files.
