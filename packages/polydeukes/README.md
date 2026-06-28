# polydeukes

> A development discipline framework for building alongside an AI coding partner.

**Pre-alpha — design stage.** This package reserves the unscoped `polydeukes` name on npm and is the future umbrella / `pdks` CLI entry point; it currently exposes only version metadata. The covenant, ledger, memory, and verify modules live in their own `@polydeukes/*` packages and are in design.

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
