# Polydeukes

A development *discipline* framework for building alongside an AI coding partner — deterministic
covenants, a verifiable ledger, local memory, and adversarial verification on one thin core.

**This repo is pre-alpha.** Shipped so far, one line per package: `packages/core` — the covenant
protocol (stdin-JSON in, exit code out) with per-call file-change evidence, the data-config
schema + published JSON Schema, the fail-open/fail-closed policy table, and the
canonical-transcript seam; `packages/covenant` — the execution wrapper, the Bash analysis core,
the path-routing dispatcher with its `matches` content-predicate seam, the self-mod / shell-mod /
transcript-mod meta-covenants, the TTL-witness valve, the added-direction delta layer, and the
discipline library that compiles `disciplines:` config entries into registrations;
`packages/adapter-claude-code` — PreToolUse payload → covenant input IR, virtual post-state
evidence, the JSONL transcript provider, and the adapter's precedent-evidence vocabulary;
`packages/adapter-git` — staged diff → the same IR (the second adapter, zero core changes);
`packages/polydeukes` (umbrella) — the `pdks` bin (`covenant check` and `init claude-code`,
the session-surface installer), the `loadConfig`
discovery loader, and **both surfaces' composition roots** (`runCovenantCheck` for the commit
surface, `runClaudeCodeHook` for the session one), since assembly needs an adapter and the
covenant package at once and only the umbrella may depend sideways. Details live in the code and the archived PRDs (the merged contracts). The
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

**Path-scoped rules carry the rest.** `.claude/rules/` holds the constraints a file's own source
does not explain, each auto-loading for its `paths` — so they are not repeated here.
They are cut two ways. **By tree:** `domain-terms` (vocabulary, including the five verdicts and
the four discipline families), `workspace-structure` (layout, catalog, build-graph blind spots),
and `inference-boundaries` (what the code may infer, and why guessing is where an infinite
domain enters) cover `packages/**`; `judging-paths-and-shells`, `evidence-and-ir`,
`config-and-schema`, and `testing-fixtures` scope to the judge, the adapters, the config, and
the test trees. **By activity:** `claims-and-criteria` for docs and PRDs — how to write a
criterion that can be satisfied and a number that survives reuse; `delegation-and-review` for
what a subagent or a review round hands back; `current-state-only` wherever prose is written,
source comments included.

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
(protectedPaths / disciplines / adapters / witness) lives in `polydeukes.config.yaml`, which
documents each entry's why inline. Since DIST-01 the hook assembles nothing — it is a delegator
calling `runClaudeCodeHook`, the packaged entry point a consumer project installs, so what we are
judged by every day is the shipped artifact itself. Since DIST-02 it enters through the package's
session subpath rather than its barrel (barrel re-exports are eager, so the barrel would load the
commit surface and its git adapter on every session call), and `pdks init claude-code` generates
this same delegator for a consumer project. Protected: gate definitions (the
hook wiring, `.claude/settings.json`, `lefthook.yml`, `biome.json`, the generated `.git/hooks`),
the five packages' gitignored `dist`, the root config itself, the live session transcript, and
— since the delegator resolves the judge by NAME — **the `node_modules` directories that
resolution walks**, because a stub planted on that walk replaces the judge outright and every
call then passes with no telemetry row at all.
Package sources are NOT on the session list — they live in the commit surface's own additive
list (`adapters.git.protectedPaths`), so a session edit is free and the commit that stages it
is judged. The commit surface runs at `adapters.git.enforce: block`: a commit staging a
protected change stops unless a human answers the TTY prompt with the witness token (an
agent-spawned commit has no TTY and cannot). The session surface always blocks, and an
unjudgeable run (missing/invalid config, or a judge body that was never built) fails closed at
either level. Each surface proves a body exists as it composes that body's path, so the proof
covers exactly what the run would spawn — a body this surface never registers is not required
to be present. A body that *is* present but stale carries no such signal: it exits with
whatever its old logic returns, which no exit code distinguishes from a fresh judgment.

What blocks and why:

- **Tool axis** (Edit/Write/…): only the call's proven mutation target (its nested `fileChange`
  evidence) is compared — a protected path inside an edit's *content* is a mention and passes.
  An evidence-free call falls back to the conservative args-mention judgment.
- **Bash axis**: a command *mentioning* a protected path without a read-only first token blocks;
  a command's target is undecidable before execution. Mentions compare raw AND dot-resolved
  segments (a union). Globs and `$VAR` are never expanded — sharing one token with a protected
  path they block as opaque; as uncomputable mutation targets they leave a `skipped` telemetry
  row instead of passing silently. Computable shell writes (literal `echo` redirects, clean
  heredocs and herestrings) carry real evidence and block like a `Write` — that is a refusal
  class of its own, reached before the allowlist, so an allowlisted head (`echo`, `printf`) does
  not save a redirect into a protected path. **A line the scanner cannot finish reading is not
  discarded** (COVENANT-18): it yields the commands it did read plus one `unread` span per
  failure. The read half reaches precise judgment, the span alone falls to the mention scan, and
  the line loses its allowlist absolution for as long as a span is open — what was never read
  could be anything, so no head vouches for it. So `rm packages/core/dist;echo 'x` blocks as
  `rm mentions protected path …`, `cat packages/core/dist;echo 'x` blocks too, and the fully-read
  `cat packages/core/dist/index.js` still passes. The span scan strips quotes and backslashes
  (the shell would too) and reads the span together with its metacharacter-split fragments as a
  union (COVENANT-07d), so closing the glued spellings could not withdraw a spaced one. **It
  closes only what is decidable from the text, and the rest is a declared limit rather than
  pending work** — a glob keeps its target hidden here (`rm packages/core/dist* 'x` passes,
  leaving two rows), and a quoted word carries its metacharacters through successful
  tokenization, so `bash -c "rm -rf packages/core/dist;echo x"` reaches no mention (one row,
  `nested shell execution`). All of them leave a `skipped shell-unjudgeable` row. **That row is
  the contract, not the block**: predicting a shell command's target from its text is
  undecidable, so the invariant this axis actually holds is that no call passes unrecorded — a
  new spelling that lands in `skipped` is this limit showing itself, not a defect to open a
  ticket for. A spelling that passes with NO row, or with `passed` for a call that was never
  judged, is the defect class (that was blocker B7). Never read a scan that stopped early as the
  safe direction.
- **The transcript** has its own `transcript-mod` registration judging whole-path *equality*,
  never an ancestor: forged writes block in every spelling (`~`, `$HOME`, `${HOME}`, `~<user>`,
  absolute), reading it with an allowlisted head (`cat`, `tail`, `grep`, …) passes in every
  spelling, and the home directory is never a protected ancestor. That read absolution belongs
  to a line read all the way through: a line still carrying an unread span keeps its head but
  not its vouching power, so `cat <transcript>;echo 'x` blocks like a write does while
  `tail -f <transcript>` passes. A reader outside that
  allowlist (`jq`, `bat`) still breaks — the allowlist vouches for the command, not the intent.
  Destroying out-of-repo ancestors is out of observation scope by design — the agent's own deny
  policy owns that ground.
- **Disciplines** declared in the config judge beyond path mention (delta / command / context
  families) — read `polydeukes.config.yaml` for the live set and each entry's why. The context
  family judges session history, so the commit surface — which injects no transcript — always
  lands it as `skipped`. That family has no second layer behind it, and the absence is a
  permanent condition of the surface rather than a gap to close.
- Every judgment appends one row to `.polydeukes/roi.log` (local, gitignored):
  `passed` / `blocked` / `witnessed` / `advised` / `skipped` (rows older than COVENANT-17 say
  `bypassed`; the reader folds them into `witnessed`, one-way).

The sanctioned valve is the **TTL witness**: a human types the token from the config's
`witness:` block so it stands alone on the message's FIRST line; the window holds for
`ttlMinutes`, then blocking resumes on its own. Since COVENANT-17 the valve stands AFTER the
verdict — the judge body always runs, and only a judgment that actually blocked can be
witnessed open (recorded as `witnessed`, would-block only, never silent). A clean call never
consults the valve, so a `witnessed` row always names a real block a human answered for. A
mid-sentence mention does not arm it, and only a real human utterance counts — an agent can
never open the valve for itself.

Recovery and rewiring:

- The hook fails **closed**: an unbuilt `dist` blocks edits too. Recovery is `pnpm build` (it
  mentions no protected path, so it is never blocked). When the hook gains a reference to a NEW
  dist symbol: build first, rewire second — the reverse order crashes assembly and blocks every
  call, including the recovery build.
- **When a change RENAMES what the hook or config names** (a dist symbol, a config key), no
  build order is safe alone — dist, hook, and config must land together. Sequence it: package
  sources first (session-free), then swap the hook and the root config in one window under the
  witness valve, then build. Beware test suites whose `beforeAll` rebuilds dist (`turbo run
  build` — the covenant five and both adapter e2e suites): run one after renaming sources and
  the session locks on the spot, every mutating call refused. Recovery is a human editing the
  two protected files in their own terminal — measured live, 2026-07-28 (COVENANT-17).
- **Rewiring the hook cuts your own valve.** The delegator is itself protected, so a broken
  rewire can leave no way in — recovery becomes a human `git checkout`. Verify a rewired hook by
  spawning it against real payloads *before* relying on it, and never remove the current valve
  until the replacement is proven. (Since DIST-01 the assembly it calls lives in
  `packages/polydeukes/src` and is session-free. What the session surface still holds here is
  the delegator, the dist it loads, and the `node_modules` path it resolves that dist through —
  three links of one chain, not one file.)
- **A dist SYMBOL rename has a window-free path — take it.** Export the new name AND keep the old
  one as an alias, build, swap the hook, then drop the alias and build again. Neither
  "build first" nor "hook first" is safe on its own, because each leaves an interval where the
  hook names something dist does not carry, and **the witness valve cannot rescue that interval**:
  an assembly crash lands before any verdict, so the valve is never consulted. The bridge removes
  the interval instead of surviving it — measured live, 2026-08-02 (DIST-01).

The measured history behind these rules — narrowing decisions, bypass profiles, per-ticket
evolution — lives in the local knowledge store; maintainers, see `CLAUDE.local.md` for pointers.
