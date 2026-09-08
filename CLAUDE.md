# Polydeukes

A development *discipline* framework for building alongside an AI coding partner — deterministic
covenants, a verifiable ledger, local memory, and adversarial verification on one thin core.

**This repo is alpha.** Four packages ship today: `core` (the covenant protocol — stdin-JSON
in, exit code out — with file-change evidence, the config schema, and the algebra declaration
schema), `adapter-claude-code` and `adapter-grok` (each one agent's session payload onto the
input IR and its own `init` bin; the commit surface is a unified diff on stdin that the
umbrella translates itself), and the `polydeukes` umbrella (the `pdks` bin, `loadConfig`, both
surfaces' composition roots, the disk they need — and the judge itself as its `src/covenant/`
module: Bash analysis, path-routing dispatcher, meta-covenants, TTL witness, discipline
library, and the declaration engine — extract steps, seven relations, witness lists). An
adapter is one agent's install unit: `pdks-claude-code init` / `pdks-grok init` registers the
hook, and `runHook` builds the IR and spawns `pdks covenant check`. Each takes `core` as a
`peerDependency` so one copy of the vocabulary is shared rather than duplicated, and
`polydeukes` as a `peerDependency` for the bin it spawns. Nothing depends the other way:
the umbrella names no adapter, so a consumer installs the umbrella and whichever adapters
its agents need. The judge module opens no file at all, and core's only file I/O is the
telemetry log it appends every judgment to.
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
pre-commit pipes `git diff --cached` into `pdks covenant check --diff` — two observations of
the same promises. Each hook is a thin delegator importing its adapter's `runHook`, which
builds the IR and spawns `pdks covenant check` — the judgment lives in the installed packages,
so the delegator never needs regenerating. The two files here are byte-identical to what
`pdks-claude-code init` and `pdks-grok init` write into a consumer's tree, which is what makes
the verdicts we meet every day a measurement of the shipped install units rather than a private
arrangement; `delegators-are-generated.test.ts` runs both installers and diffs the result
against these files. The Grok registration matches on that host's own names (`write` ·
`search_replace` · `run_terminal_command`) and spawns its own delegator, so no name rewrite
stands between a Grok call and its judgment.

Session-protected: the gate definitions (hook wiring, `.claude/settings.json`, `lefthook.yml`,
`biome.json`, `.git/hooks`), the packages' gitignored `dist`, and the root config. The
commit surface has no list of its own and no prompt: it judges the piped diff and lands every
verdict `advised` at exit 0 unless the command carries `--enforce block` (this repo's lefthook
line does not — a staged gate-file change has already passed the session surface). The
`disciplines:` entries land `advised` on both surfaces (exit 0, the `why`
on stderr) unless an entry says `enforce: block`. The session-protected list is a separate
list, not an override applied to those entries: nothing promotes a discipline's own `advise`
to a block, and since POSTURE-01 the protected list above is the only thing that blocks
unasked — on the session surface. Every judgment appends one row to `.polydeukes/roi.log`
(local, gitignored).

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
  already typechecks, so gate any dist-touching command on `tsc --noEmit` first. A third shape
  leaves a COMPLETE dist behind: a source edit that makes one member of the judge object
  (`src/covenant/module.ts`) undefined, then a rebuild — the hook fails with
  `covenant.<verb> is not a function` on every call. A review agent probing the seam did
  exactly this (2026-09-07). Recovery is `git checkout -- <file> && pnpm build` in a human
  terminal; the built module is asserted by `surface-fold-contract.test.ts` when dist exists.
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
