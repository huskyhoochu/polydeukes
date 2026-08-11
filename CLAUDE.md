# Polydeukes

A development *discipline* framework for building alongside an AI coding partner — deterministic
covenants, a verifiable ledger, local memory, and adversarial verification on one thin core.

**This repo is alpha.** Five packages ship today: `core` (the covenant protocol — stdin-JSON
in, exit code out — with file-change evidence and the config schema), `covenant` (the judge:
Bash analysis, path-routing dispatcher, meta-covenants, TTL witness, discipline library),
`adapter-claude-code` and `adapter-git` (two payloads onto one input IR), and the `polydeukes`
umbrella (the `pdks` bin, `loadConfig`, and both surfaces' composition roots — only the umbrella
may depend sideways). Details live in the code and the archived PRDs (the merged contracts).
The design docs own everything not yet implemented; when a design doc and shipped code disagree,
neither side wins by default — triage against the archived PRD: it may be a stale doc, or a code
bug to fix.

## Vocabulary is binding

This project deliberately renames control-framing terms. **Never use `guard`, `harness`, or `kb`**
in code, packages, CLI, or docs — use `covenant`, `discipline framework`, and `memory`. The full
glossary is in `.claude/rules/domain-terms.md` (auto-loads for `packages/**`); read it before
naming anything. One deliberate exception: the npm `keywords` array keeps the industry terms —
it is a discoverability index; the `description` field is NOT exempt.

## Commands and conventions

- `pnpm check` — Biome lint + format with `--write` (the canonical "fix everything" command).
  lefthook runs Biome on staged files at `pre-commit`, so run it before committing.
- Runtime is pinned: **Node ≥24, pnpm@10.32.1**. Use pnpm, never npm/yarn.
- Commits follow Conventional Commits (commitlint-enforced).
- **Docs are bilingual:** English is the default; Korean mirrors live in `*.ko.md`. Keep them in
  sync when editing either. In Korean docs, use translation + English gloss for the vocabulary
  (`약속(covenant)`), never transliteration.

**Path-scoped rules carry the rest.** Each file in `.claude/rules/` states the constraints a
file's own source does not explain and auto-loads for its `paths` — they are not repeated here.

## How this project is developed

Development follows a roadmap → PRD → TDD loop, codified as skills: `/ticket <ID>` runs the full
unit-task loop and `/post-task` alone closes out substantial non-ticket chores before they
commit. Unit tasks must be small enough to fit one PRD and verifiable by a command or test.

**A gap left by a finished ticket is closed by a retrofit ticket, not a new roadmap ID**
(`COVENANT-01b` is the precedent): its own suffix, branch, and PR. Archived PRDs stay immutable;
the retrofit records the correction and the archived PRDs get a footnote pointing at it. This
keeps the roadmap a plan rather than a defect list.

## Self-dogfooding (ON since 2026-07-14)

A PreToolUse hook judges every Edit/Write/MultiEdit/NotebookEdit/Bash call, and lefthook's
pre-commit spawns `pdks covenant check` over the staged diff — two observations of the same
promises. All protection-policy data lives in `polydeukes.config.yaml`, which documents each
entry's why inline — read it for the live protected paths and disciplines. The hook is a thin
delegator calling `runClaudeCodeHook` through the package's session subpath (the barrel is
eager and would load the commit surface on every session call), so what we are judged by every
day is the shipped artifact itself; `pdks init claude-code` generates the same delegator for a
consumer project.

Session-protected: the gate definitions (hook wiring, `.claude/settings.json`, `lefthook.yml`,
`biome.json`, `.git/hooks`), the five packages' gitignored `dist`, the root config, and the live
session transcript. Package sources are on the commit surface's own list instead
(`adapters.git.protectedPaths`): a session edit is free,
and the commit that stages it stops unless a human answers the TTY prompt with the witness
token. Both surfaces fail **closed** on an unjudgeable run (missing/invalid config, or a judge
body that was never built); a stale-but-present body carries no such signal.

What blocks and why:

- **Tool axis** (Edit/Write/…): only the call's proven mutation target is compared — a protected
  path inside an edit's *content* is a mention and passes. An evidence-free call falls back to
  the conservative args-mention judgment.
- **Bash axis**: a command *mentioning* a protected path without a read-only first token blocks
  (mentions compare raw AND dot-resolved segments as a union; globs and `$VAR` are never
  expanded). Computable shell writes (literal redirects, clean heredocs/herestrings) block like
  a `Write` before the allowlist is even consulted. A line the scanner cannot finish reading
  keeps an `unread` span and loses its allowlist absolution while the span is open. Everything
  the text leaves undecidable lands as a `skipped` telemetry row, and **that row is the
  contract**: predicting a shell target from text is undecidable, so the invariant this axis
  holds is that no call passes unrecorded. A new spelling landing in `skipped` is the declared
  limit showing itself; a pass with NO row (or `passed` without judgment) is the defect class.
  Never read a scan that stopped early as the safe direction.
- **The transcript** is judged by whole-path *equality*, never as an ancestor: forged writes
  block in every spelling, an allowlisted read head (`cat`, `tail`, `grep`, …) passes in every
  spelling, and a reader outside the allowlist (`jq`, `bat`) breaks — the allowlist vouches for
  the command, not the intent. Out-of-repo ancestors stay out of observation scope; the agent's
  own deny policy owns that ground.
- **Disciplines** in the config judge beyond path mention (delta / command / context families).
  The context family needs a transcript, so the commit surface always lands it `skipped` — a
  permanent condition of that surface.
- Every judgment appends one row to `.polydeukes/roi.log` (local, gitignored):
  `passed` / `blocked` / `witnessed` / `advised` / `skipped`.

The sanctioned valve is the **TTL witness**: a human types the config's token so it stands alone
on the message's FIRST line, and the window holds for `ttlMinutes`. The valve stands AFTER the
verdict — only a judgment that actually blocked can be witnessed open (recorded `witnessed`,
never silent), a mid-sentence mention does not arm it, and an agent can never open the valve
for itself.

Recovery and rewiring:

- Fail-closed means an unbuilt `dist` blocks edits too; recovery is `pnpm build` (never itself
  blocked). When the hook gains a reference to a NEW dist symbol: build first, rewire second —
  the reverse order crashes assembly and blocks every call, including the recovery build.
- **A RENAME of anything the hook or config names has no safe build order** — dist, hook, and
  config must land together: package sources first (session-free), then swap the hook and root
  config in one witness window, then build. Beware test suites whose `beforeAll` rebuilds dist
  (the covenant five and both adapter e2e suites): run one after renaming sources and the
  session locks, every mutating call refused, until a human edits the two protected files in
  their own terminal.
- **Rewiring the hook cuts your own valve** — the delegator and the dist it loads are two links
  of one protected chain. Verify a rewired hook against real payloads *before* relying on it,
  and never remove the current valve until the replacement is proven; otherwise recovery is a
  human `git checkout`.
- **A dist SYMBOL rename has a window-free path — take it**: export the new name AND keep the
  old as an alias, build, swap the hook, drop the alias, build again. Any other order leaves an
  interval where the hook names something dist does not carry, and the witness valve cannot
  rescue it — an assembly crash lands before any verdict, so the valve is never consulted.

The measured history behind these rules — narrowing decisions, bypass profiles, per-ticket
evolution — lives in the local knowledge store; maintainers, see `CLAUDE.local.md` for pointers.
