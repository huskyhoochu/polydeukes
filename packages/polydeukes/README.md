# polydeukes

> A harness framework for developing alongside an AI coding partner.

**Pre-alpha — design stage.** This package currently reserves the name on npm and exposes only version metadata. The core, guard, ledger, kb, and verify modules are in design.

Polydeukes externalizes the discipline a developer applies to themselves — test-first, verify-before-commit, record decisions, don't repeat mistakes — into deterministic machinery shared with an AI partner, rather than prompt-level requests. The framing is partnership, not control.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## Planned packages

| Package | Role |
|---------|------|
| `@polydeukes/core` | Guard protocol, config loader, transcript interface |
| `@polydeukes/guard` | Deterministic PreToolUse hooks + self-mod meta-guard |
| `@polydeukes/ledger` | Work tracking; completion authority moves from "I'm done" to "the actions passed" |
| `@polydeukes/kb` | Local SQLite + FTS5 knowledge store |
| `@polydeukes/verify` | Multi-agent adversarial verification |

## License

MIT
