# Polydeukes

A development *discipline* framework for building alongside an AI coding partner — deterministic
covenants, a verifiable ledger, local memory, and adversarial verification on one thin core.

**This repo is alpha.** Five packages ship today: `core` (the covenant protocol — stdin-JSON
in, exit code out — with file-change evidence, the config schema, and the algebra declaration
schema), `covenant` (the judge: Bash analysis, path-routing dispatcher, meta-covenants, TTL
witness, discipline library, and the declaration engine — extract steps, seven relations,
witness lists),
`adapter-claude-code` and `adapter-git` (two payloads onto one input IR), and the `polydeukes`
umbrella (the `pdks` bin, `loadConfig`, both surfaces' composition roots, and the disk they
need — only the umbrella may depend sideways). The judge and the two adapters take `core` as a
`peerDependency` so one copy of the vocabulary is shared rather than duplicated; the umbrella's
ordinary dependency is what satisfies it. `covenant` opens no file at all, and core's only file
I/O is the telemetry log it appends every judgment to.
Details live in the code and the archived PRDs (the merged contracts).
The design docs own everything not yet implemented; when a design doc and shipped code disagree,
neither side wins by default — triage against the archived PRD: it may be a stale doc, or a code
bug to fix.

## Vocabulary is binding

This project deliberately renames control-framing terms. **Never use `guard`, `harness`, or `kb`**
in code, packages, CLI, or docs — use `covenant`, `discipline framework`, and `memory`. The full
glossary is in `.claude/rules/domain-terms.md` (auto-loads for `packages/**`); read it before
naming anything. One deliberate exception: the npm `keywords` array keeps the industry terms —
it is a discoverability index; the `description` field is NOT exempt.

## Conventions

- **Docs are bilingual:** English is the default; Korean mirrors live in `*.ko.md`. Keep them in
  sync when editing either — the commit surface judges the pair (`docs-stay-bilingual`, advised
  when one side is staged without the other). In Korean docs, use translation + English gloss
  for the vocabulary (`약속(covenant)`), never transliteration.
- `pnpm check` is the canonical "fix everything" command (Biome lint + format with `--write`).

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
promises. The hook is a thin delegator calling `runClaudeCodeHook` through the package's session
subpath (the barrel is eager and would load the commit surface on every session call), so what we
are judged by every day is the shipped artifact itself; `pdks init claude-code` generates the same
delegator for a consumer project, and `pdks init grok` reuses that file when it already exists.

Session-protected: the gate definitions (hook wiring, `.claude/settings.json`, `lefthook.yml`,
`biome.json`, `.git/hooks`), the five packages' gitignored `dist`, and the root config. Package
sources are on the commit surface's own list instead (`adapters.git.protectedPaths`): a session
edit is free, and the commit that stages it stops unless a human answers the TTY prompt with the
witness token. The `disciplines:` entries land `advised` on both surfaces (exit 0, the `why`
on stderr) unless an entry says `enforce: block`. The session-protected list is a separate
list, not an override applied to those entries: nothing promotes a discipline's own `advise`
to a block, and since POSTURE-01 the protected list above is the only thing that blocks
unasked. Every judgment appends one row to `.polydeukes/roi.log` (local, gitignored).

**What each axis compares, and the witness valve, are in
`.claude/rules/dogfooding-axes.md`** — it auto-loads for the hook, the config, and the judge
packages. The recovery procedures below stay here because no `paths` glob can predict when a
session locks.

### Recovery and rewiring

- Fail-closed means an unbuilt `dist` blocks edits too; recovery is `pnpm build` (never itself
  blocked). When the hook gains a reference to a NEW dist symbol: build first, rewire second —
  the reverse order crashes assembly and blocks every call, including the recovery build.
- **A RENAME of anything the hook or config names has no safe build order** — dist, hook, and
  config must land together: package sources first (session-free), then swap the hook and root
  config in one witness window, then build. Beware test suites whose `beforeAll` rebuilds dist
  (the set moves with the tests — enumerate it with
  `rg -l 'turbo run build|pnpm build' packages/*/__tests__` before relying on it): run one
  while the source tree is mid-change — a rename, or any cross-package contract change — and
  the session locks, every mutating call refused, until a human runs the recovery in their own
  terminal. A PARTIAL rebuild is the same lockout with a cheaper recovery: one package's dist
  rebuilt against sources the sibling dist has not seen crashes assembly on every call, and
  `pnpm build` (run by a human — the locked session cannot) clears it only if the whole tree
  already typechecks, so gate any dist-touching command on `tsc --noEmit` first.
- **Rewiring the hook cuts your own valve** — the delegator and the dist it loads are two links
  of one protected chain. Verify a rewired hook against real payloads *before* relying on it,
  and never remove the current valve until the replacement is proven; otherwise recovery is a
  human `git checkout`.
- **A dist SYMBOL rename has a window-free path — take it**: export the new name AND keep the
  old as an alias, build, swap the hook, drop the alias, build again. Any other order leaves an
  interval where the hook names something dist does not carry, and the witness valve cannot
  rescue it — an assembly crash lands before any verdict, so the valve is never consulted.

The measured history behind these rules — narrowing decisions, bypass profiles, per-ticket
evolution — lives in the local knowledge store.
