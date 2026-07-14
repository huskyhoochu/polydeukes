# Polydeukes

A development *discipline* framework for building alongside an AI coding partner — deterministic
covenants, a verifiable ledger, local memory, and adversarial verification on one thin core.

**This repo is pre-alpha.** The first units are landing in `packages/core` (covenant
protocol, ROI telemetry, config loader), `packages/covenant` (the run_covenant execution
wrapper, the heredoc-aware multi-line Bash analysis core with its write-detection rules
(redirect/tee/`sed -i`), the path-routing dispatcher, the self-mod
meta-covenant with its escape-hatch seam, and the shell-mod meta-covenant that assembles
the detection rules into a Bash-axis judge with a read-only allowlist), and
`packages/adapter-claude-code` (PreToolUse payload → covenant input IR up-translation, and the
adapter-path ROI telemetry wiring with its injected dispatch seam);
`packages/polydeukes` remains a name-reserving stub.
The design docs are still the source of truth for everything not yet implemented. When a design
doc and shipped code disagree, neither side wins by default — triage the discrepancy against the
archived PRD (the merged contract): it may be a stale doc, or a code bug to fix.

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
Unit tasks must be small enough to fit one PRD and verifiable by a command or test.

**Self-dogfooding is ON (since 2026-07-14).** A PreToolUse hook (`.claude/hooks/`, registered in
`.claude/settings.json`) runs every Edit/Write/MultiEdit/NotebookEdit/Bash call through the
project's own covenants: the self-mod meta-covenant (tool axis) and the shell-mod meta-covenant
(Bash axis) both protect the three packages' `src`/`dist` plus the hook wiring itself. Every call
is measured in `.polydeukes/roi.log` (local, gitignored). Consequences to know:

- Editing covenant/core/adapter sources — or any command *mentioning* those paths without a
  read-only first token — is **blocked (exit 2)** by design. The sanctioned valve is the
  `POLYDEUKES_COVENANT_BYPASS` env var (recorded as `bypassed`, never silent).
- The hook fails **closed**: an unbuilt `dist` blocks edits too. Recovery is `pnpm build`
  (mentions no protected path, so it is never blocked).
- Arming the hatch via settings env takes effect immediately; **disarming requires a session
  restart** (the env persists in the running session).
