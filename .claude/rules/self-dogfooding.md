# This repository judges itself

Self-dogfooding has been on since 2026-07-14. What each axis compares, and the witness valve, are in
`.claude/rules/dogfooding-axes.md`. Measured host coverage lives in the knowledge store
(`pnpm exec pdks memory search host measurements`), not here.

## What is wired

The session judge and adapters are the three Rust executables in `.polydeukes/bin/`: `pdks`,
`pdks-claude-code`, and `pdks-codex`. `.claude/settings.json` registers `pdks-claude-code` and
`.codex/hooks.json` registers `pdks-codex` from that directory. Each registration pins the project
root and the absolute path of `.polydeukes/bin/pdks`. Regenerate registrations from the repository
root, rather than editing them:

```sh
PATH="$PWD/.polydeukes/bin:$PATH" .polydeukes/bin/pdks-claude-code init
PATH="$PWD/.polydeukes/bin:$PATH" .polydeukes/bin/pdks-codex init
```

Registrations carry neither `onFailure` nor `|| exit 2`. If the adapter cannot start, the host lets
the call proceed with no message. If the adapter starts but cannot start the judge, it lets the call
proceed and tells the user to install `pdks`. lefthook's pre-commit still pipes `git diff --cached`
into `target/release/pdks covenant check --diff`.

Do not infer host-wide coverage from `/hooks` showing Active; remeasure the released host version
before claiming it. The Claude hook carries the transcript's human turns and tool calls. Codex
records tool calls at `PostToolUse` into a session evidence file and removes it at `SessionEnd`. It
carries no human utterances, and Codex prompt text is not human evidence. A blocked Codex call
cannot be witnessed open; perform a protected change from the user's terminal.

## What blocks

Session-protected: the gate definitions (hook wiring, `.claude/settings.json`, `lefthook.yml`,
`biome.json`, `.cargo/config.toml`, `.git/hooks`), the packages' gitignored `dist`, and the root
config. This includes the Codex hook directory, `.codex/hooks.json`, the `.polydeukes/bin`
directory, and adapter dist. The change-set surface has no list of its own and no prompt: it judges
the piped diff and lands every verdict `advised` at exit 0 unless the command carries
`--enforce block` (this repo's lefthook line does not — a staged gate-file change has already passed
the session surface).

The protected list above is the only thing that blocks unasked, and only on the session surface;
nothing promotes a discipline's own `advise` to a block. How the three discipline lists are placed
and judged is in `dogfooding-axes.md`. Every judgment appends a row to `.polydeukes/roi.log` (local,
gitignored).

## Recovery and rewiring

These stay in a rule without `paths:` because no glob can predict when a session locks.

- The session hooks run the pinned Rust executables independently of workspace `dist` and
  `node_modules`. Typecheck sources with `pnpm -r --if-present typecheck` before building. Build all
  three from the owner's terminal (no hook) with
  `cargo build --release -p pdks -p pdks-claude-code -p pdks-codex`; this also updates lefthook's
  judge at `target/release/pdks`. Until `cargo build --release -p pdks` has run once, a commit fails
  rather than passing unjudged: lefthook runs `target/release/pdks`. Copy the three executables into
  a temporary directory. In a Rust-judged agent session, prefix that build with
  `CARGO_TARGET_DIR="$PWD/.polydeukes/tmp/target"` and copy from `.polydeukes/tmp/target/release/`:
  shell commands naming protected `target/release/pdks` are blocked, even for copying, because the
  Rust judge has no read-only proof. This `CARGO_TARGET_DIR` build leaves lefthook's judge
  unchanged; after an in-session rebuild, run `cargo build --release -p pdks` from the owner's
  terminal to refresh `target/release/pdks`.
- Prove the temporary executables before replacing the protected installed files:
  `node scripts/verify-adapter-fixtures.mjs --command '["<tmp>/pdks-claude-code","hook","--project-root","@@ROOT@@","--pdks","<tmp>/pdks"]'`
  and
  `node scripts/verify-adapter-fixtures.mjs --command '["<tmp>/pdks-codex","hook","--project-root","@@ROOT@@","--pdks","<tmp>/pdks"]' --cases-dir conformance/adapter/codex`.
  Replace `<tmp>` with the absolute temporary-directory path. Keep the previous executables until
  the replacement is proven, then replace all three files in `.polydeukes/bin/` from the owner's
  terminal. Root configuration and hook definitions remain protected owner changes.
- If the installed executable or configuration cannot load, recover from the user's terminal. An
  assembly failure occurs before the witness valve can run. Preserve the witness token and TTL while
  repairing the executable, config, or wiring.
- A changed Codex hook definition needs user review through CLI `/hooks`. After init and trust
  approval, measure ordinary and protected calls and inspect telemetry; an Active label alone does
  not establish that the host invoked the hook.
