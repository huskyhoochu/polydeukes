# @polydeukes/core

> The thin, domain- and agent-agnostic core of Polydeukes.

**Pre-alpha.** The first units have landed: the covenant protocol (stdin-JSON / exit-code semantics), the ROI telemetry collector (`gain`), and the `defineConfig()` validator for data configs (schema v2 — `testCmd` is a `{scope}` template string, and the matching JSON Schema ships as `@polydeukes/core/schema.json`).

The core knows nothing about any specific AI agent, language, or sync backend. Every other package (`covenant`, `ledger`, `memory`, `verify`) depends only on `core` — never on each other.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## License

MIT
