# @polydeukes/core

> The thin, domain- and agent-agnostic core of Polydeukes.

**Pre-alpha — design stage.** This is a scaffold. The covenant protocol (stdin-JSON / exit-code semantics) and the `defineConfig()` loader are the first units to land here; nothing is implemented yet.

The core knows nothing about any specific AI agent, language, or sync backend. Every other package (`covenant`, `ledger`, `memory`, `verify`) depends only on `core` — never on each other.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## License

MIT
