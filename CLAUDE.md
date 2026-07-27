# Polydeukes

A development *discipline* framework for building alongside an AI coding partner — deterministic
covenants, a verifiable ledger, local memory, and adversarial verification on one thin core.

**This repo is pre-alpha.** Shipped so far, one line per package: `packages/core` — the covenant
protocol (stdin-JSON in, exit code out) with per-call file-change evidence, the data-config
schema + published JSON Schema, the fail-open/fail-closed policy table, and the
canonical-transcript seam; `packages/covenant` — the execution wrapper, the Bash analysis core,
the path-routing dispatcher with its `matches` content-predicate seam, the self-mod / shell-mod /
transcript-mod meta-covenants, the TTL-waiver hatch, the added-direction delta layer, and the
discipline library that compiles `disciplines:` config entries into registrations;
`packages/adapter-claude-code` — PreToolUse payload → covenant input IR, virtual post-state
evidence, the JSONL transcript provider, and the adapter's precedent-evidence vocabulary;
`packages/adapter-git` — staged diff → the same IR (the second adapter, zero core changes);
`packages/polydeukes` (umbrella) — the `pdks` bin (`covenant check`) and the `loadConfig`
discovery loader. Details live in the code and the archived PRDs (the merged contracts). The
design docs own everything not yet implemented; when a design doc and shipped code disagree,
neither side wins by default — triage against the archived PRD: it may be a stale doc, or a
code bug to fix.

## Vocabulary is binding

This project deliberately renames control-framing terms. **Never use `guard`, `harness`, or `kb`**
in code, packages, CLI, or docs — use `covenant`, `discipline framework`, and `memory`. The full
glossary (concept → package → verb → CLI) is in `.claude/rules/domain-terms.md`, which auto-loads
for `packages/**`. Read it before naming anything. One deliberate exception: the npm `keywords`
array in `package.json` keeps the industry terms (`harness`, `guard`) — it is a discoverability
index, not a describing surface; the `description` field is NOT exempt.

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

**A gap left by a finished ticket is closed by a retrofit ticket, not a new roadmap ID.** When an
already-merged and archived ticket turns out to have missed a responsibility, it gets a suffixed
ticket of its own (`COVENANT-01b` is the precedent), worked on a feature branch with its own PR.
Archived PRDs stay immutable; the retrofit records the correction and the archived PRDs get a
footnote pointing at it. This keeps the roadmap a plan rather than a defect list.

## Self-dogfooding (ON since 2026-07-14)

A PreToolUse hook (`.claude/hooks/`, registered in `.claude/settings.json`) judges every
Edit/Write/MultiEdit/NotebookEdit/Bash call, and lefthook's pre-commit spawns `pdks covenant
check` over the staged diff — two observations of the same promises. Protection-policy data
(protectedPaths / disciplines / adapters / waiver) lives in `polydeukes.config.yaml`, which
documents each entry's why inline; the hook only assembles it. Protected: gate definitions (the
hook wiring, `.claude/settings.json`, `lefthook.yml`, `biome.json`), the five packages'
gitignored `dist`, the root config itself, and the live session transcript. Package sources are
NOT on the session list — the commit surface re-observes them. The commit surface runs at
`adapters.git.enforce: advise` (recorded, never blocking); the session surface always blocks,
and an unjudgeable run (missing/invalid config, stale dist) fails closed at either level.

What blocks and why:

- **Tool axis** (Edit/Write/…): only the call's proven mutation target (its nested `fileChange`
  evidence) is compared — a protected path inside an edit's *content* is a mention and passes.
  An evidence-free call falls back to the conservative args-mention judgment.
- **Bash axis**: a command *mentioning* a protected path without a read-only first token blocks;
  a command's target is undecidable before execution. Mentions compare raw AND dot-resolved
  segments (a union). Globs and `$VAR` are never expanded — sharing one token with a protected
  path they block as opaque; as uncomputable mutation targets they leave a `skipped` telemetry
  row instead of passing silently. Computable shell writes (literal `echo` redirects, clean
  heredocs and herestrings) carry real evidence and block like a `Write`.
- **The transcript** has its own `transcript-mod` registration judging whole-path *equality*,
  never an ancestor: forged writes block in every spelling (`~`, `$HOME`, `${HOME}`, `~<user>`,
  absolute), reading it with an allowlisted head (`cat`, `tail`, `grep`, …) passes in every
  spelling, and the home directory is never a protected ancestor. A reader outside that
  allowlist (`jq`, `bat`) still breaks — the allowlist vouches for the command, not the intent.
  Destroying out-of-repo ancestors is out of observation scope by design — the agent's own deny
  policy owns that ground.
- **Disciplines** declared in the config judge beyond path mention (delta / command / context
  families) — read `polydeukes.config.yaml` for the live set and each entry's why.
- Every judgment appends one row to `.polydeukes/roi.log` (local, gitignored):
  `passed` / `blocked` / `bypassed` / `advised` / `skipped`.

The sanctioned valve is the **TTL waiver**: a human types the token from the config's `waiver:`
block so it stands alone on the message's FIRST line; the valve holds for `ttlMinutes`, then
blocking resumes on its own (recorded as `bypassed`, never silent). A mid-sentence mention does
not arm it, and only a real human utterance counts — an agent can never open the valve for
itself.

Recovery and rewiring:

- The hook fails **closed**: an unbuilt `dist` blocks edits too. Recovery is `pnpm build` (it
  mentions no protected path, so it is never blocked). When the hook gains a reference to a NEW
  dist symbol: build first, rewire second — the reverse order crashes assembly and blocks every
  call, including the recovery build.
- **Reassembling the hook cuts your own valve.** The composition root is itself protected, so a
  broken rewire can leave no way in — recovery becomes a human `git checkout`. Verify a rewired
  hook by spawning it against real payloads *before* relying on it, and never remove the current
  valve until the replacement is proven.

The measured history behind these rules — narrowing decisions, bypass profiles, per-ticket
evolution — lives in the local knowledge store; maintainers, see `CLAUDE.local.md` for pointers.
