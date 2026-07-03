# Polydeukes

A development *discipline* framework for building alongside an AI coding partner — deterministic
covenants, a verifiable ledger, local memory, and adversarial verification on one thin core.

**This repo is in the design stage (pre-alpha). No framework code exists yet** beyond a
name-reserving stub in `packages/polydeukes`. The current work is the architecture blueprint and
the reasoning behind it, not implementation. Treat the design docs as the source of truth, not the
(near-empty) `src/`.

## Vocabulary is binding

This project deliberately renames control-framing terms. **Never use `guard`, `harness`, or `kb`**
in code, packages, CLI, or docs — use `covenant`, `discipline framework`, and `memory`. The full
glossary (concept → package → verb → CLI) is in `.claude/rules/domain-terms.md`, which auto-loads
for `packages/**`. Read it before naming anything. The *why* behind each choice lives in the design
docs; the rule itself is non-negotiable.

## Commands

- `pnpm check` — Biome lint + format with `--write` (the canonical "fix everything" command)
- `pnpm format` — Biome format only
- `pnpm build` / `pnpm dev` — Turbo-orchestrated across packages
- Per-package build is `tsc -p tsconfig.build.json`; typecheck is `tsc --noEmit` (the package's
  `tsconfig.json` is the editor/typecheck project and also covers `__tests__/`)

Runtime is pinned: **Node ≥24, pnpm@10.32.1** (`.nvmrc` = 24). Use pnpm, never npm/yarn.

## Conventions

- **Commits: Conventional Commits**, enforced by commitlint on `commit-msg` (e.g. `docs:`, `feat:`,
  `chore:`). lefthook runs Biome on staged files at `pre-commit` — a commit that fails Biome is
  blocked, so run `pnpm check` first.
- **Formatting (Biome, non-default choices):** single quotes, 2-space indent, line width 100.
- **Docs are bilingual:** English is the default (`README.md`, `STORY.md`); Korean mirrors live in
  `*.ko.md`. Keep them in sync when editing either.
- In Korean docs, use translation + English gloss for the vocabulary (`약속(covenant)`), never
  transliteration.

## How this project is developed

Development follows a roadmap → PRD → TDD loop, codified as skills: `/ticket <ID>` runs the full
unit-task loop (PRD → branch → `/tdd` cycle → `/post-task` checks → PR + code review → squash merge
→ archive), and `/post-task` alone closes out substantial non-ticket chores before they commit.
Once the minimal core exists, Polydeukes is meant to develop *itself* (self-dogfooding): its own
covenants protect its source, its ledger measures the work. Unit tasks must be small enough to fit
one PRD and verifiable by a command or test.
