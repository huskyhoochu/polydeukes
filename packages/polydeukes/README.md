# polydeukes

**English** · [한국어](./README.ko.md)

> The unscoped umbrella: the `pdks` CLI entry point and the config discovery loader — the one place where the framework's pieces are assembled for the surfaces a repository actually runs.

**Pre-alpha.** Not yet published to npm. This package reserves the unscoped `polydeukes` name and sits above the scoped `@polydeukes/*` modules as the only one allowed to assemble them — every other dependency stays one-way, through the core alone.

## What lives here

- **`loadConfig(rootDir)`** — config discovery. Exactly one root data config (a `polydeukes.config` file in yaml, yml, or json form) directly under the given root, parsed with a safe schema (config data is never executable) and validated by the core's `defineConfig()`. Every failure branch throws — silent defaults are forbidden — and the discovered file attaches itself to its own protection surface.
- **`pdks covenant check`** — the first real subcommand of the `pdks` bin (`polydeukes` is an alias). A pre-commit judgment runner: staged changes are collected by `@polydeukes/adapter-git`, translated into the covenant input IR, and dispatched through the very judge bodies the session hook spawns — one judge, every surface. An empty staging area is an explicit pass; a missing or invalid config fails closed.
- **The commit-surface waiver valve** — at the `block` level (the default), when a staged change matches a protected surface, the runner prompts once on `/dev/tty` for the full waiver token (a substring is refused). No TTY — CI, an agent-spawned `git commit` — means no prompt and no bypass: the valve is reachable only by a human at a terminal, and nothing is ever persisted. Every bypass is measured as `bypassed`, never silent.
- **The enforcement level** — the git adapter's namespace setting `adapters.git.enforce: block | advise` selects what a commit-surface verdict does. Under `advise` the valve is structurally absent: a verdict is recorded as an `advised` event, one advisory line lands on stderr, and the commit proceeds — a backstop that measures instead of blocking. Only the verdict is relaxed: a run that cannot judge (missing or invalid config, an unresolvable judge body) fails closed at exit 2 at either level.

## The wider map

| Module | Role |
|---|---|
| `@polydeukes/core` | Covenant protocol, config schema, ROI telemetry, transcript seam |
| `@polydeukes/covenant` | Dispatcher, judge bodies, Bash analysis, discipline library |
| `@polydeukes/adapter-claude-code` | Session surface — PreToolUse payloads → covenant input IR |
| `@polydeukes/adapter-git` | Commit surface — staged diffs → covenant input IR |
| `@polydeukes/ledger` · `@polydeukes/memory` · `@polydeukes/verify` | Blueprint stage |

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## License

MIT
