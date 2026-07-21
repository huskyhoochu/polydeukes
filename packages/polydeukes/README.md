# polydeukes

> A development discipline framework for building alongside an AI coding partner.

**Pre-alpha.** This package reserves the unscoped `polydeukes` name on npm and is the umbrella / future `pdks` CLI entry point. Its first real export is `loadConfig(rootDir)` — the config discovery loader that finds the root data config (`polydeukes.config.yaml`/`.yml`/`.json`, exactly one), parses it safely, and delegates validation to `@polydeukes/core`'s `defineConfig()`. The covenant, ledger, memory, and verify modules live in their own `@polydeukes/*` packages.

Polydeukes externalizes the discipline a developer applies to themselves — test-first, verify-before-commit, record decisions, don't repeat mistakes — into deterministic machinery shared with an AI partner, rather than prompt-level requests. The framing is partnership, not control.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## Planned packages

| Package | Role |
|---------|------|
| `@polydeukes/core` | Covenant protocol, config loader, transcript interface |
| `@polydeukes/covenant` | Deterministic PreToolUse hooks + self-mod meta-covenant |
| `@polydeukes/ledger` | Work tracking; completion authority moves from "I'm done" to "the actions passed" |
| `@polydeukes/memory` | Local SQLite + FTS5 memory store |
| `@polydeukes/verify` | Multi-agent adversarial verification |

## License

MIT
