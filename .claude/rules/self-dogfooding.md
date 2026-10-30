# This repository judges itself

Self-dogfooding has been on since 2026-07-14. What each axis compares, and the witness valve, are in
`.claude/rules/dogfooding-axes.md`. Measured host coverage lives in the knowledge store
(`pnpm exec pdks memory search host measurements`), not here.

## What is wired

Native PreToolUse registrations translate the supported file and shell calls, while lefthook's
pre-commit pipes `git diff --cached` into the Rust executable's `covenant check --diff`
(`packages/pdks/target/release/pdks`). Each registration pins `.polydeukes/bin/pdks` and the project
root; this executable bundles all three adapters and the judge. Regenerate registrations with
`pdks adapter <claude-code|grok|codex> init`, using the installed executable, rather than editing
generated handlers. Grok uses its native tool names (`write`, `search_replace`,
`run_terminal_command`); under Grok's runtime, the Claude compatibility registration is silent and
the Grok registration owns the judgment.

Do not infer host-wide coverage from `/hooks` showing Active; remeasure the released host version
before claiming it. Codex session evidence comes only from the registered `UserPromptSubmit` and
`PostToolUse` lifecycle events, is removed at `SessionEnd`, and never comes from the unstable
transcript. Claude and Codex admit prompt text as human evidence only with explicit human origin;
Grok supplies no human-message evidence. Without proven human evidence, perform a protected
intentional change from the user's terminal.

## What blocks

Session-protected: the gate definitions (hook wiring, `.claude/settings.json`, `lefthook.yml`,
`biome.json`, `.git/hooks`), the packages' gitignored `dist`, and the root config. This includes the
Codex hook directory, `.codex/hooks.json`, `.polydeukes/bin/pdks`, and adapter dist. The change-set
surface has no list of its own and no prompt: it judges the piped diff and lands every verdict
`advised` at exit 0 unless the command carries `--enforce block` (this repo's lefthook line does not
— a staged gate-file change has already passed the session surface).

The protected list above is the only thing that blocks unasked, and only on the session surface;
nothing promotes a discipline's own `advise` to a block. How the three discipline lists are placed
and judged is in `dogfooding-axes.md`. Every judgment appends a row to `.polydeukes/roi.log` (local,
gitignored).

## Recovery and rewiring

These stay in a rule without `paths:` because no glob can predict when a session locks.

- The session hook runs the pinned executable independently of workspace `dist` and `node_modules`.
  Typecheck sources before building. Rebuilding the workspace updates the development CLI;
  `cargo build --release` of `packages/pdks` updates lefthook's judgment, and until it has run once
  a commit fails rather than passing unjudged. The pinned session executable is updated separately.
- Build a replacement executable at a temporary path and run
  `node scripts/verify-adapter-executable.mjs --executable <absolute-path>` before replacing the
  protected installed file. Keep the current executable available until its replacement is proven.
  Root configuration and hook definitions remain protected owner changes.
- If the installed executable or configuration cannot load, recover from the user's terminal. An
  assembly failure occurs before the witness valve can run. Preserve the witness token and TTL while
  repairing the executable, config, or wiring.
- A changed Codex hook definition needs user review through CLI `/hooks`. After init and trust
  approval, measure ordinary and protected calls and inspect telemetry; an Active label alone does
  not establish that the host invoked the hook.
