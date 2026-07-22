# @polydeukes/core

**English** · [한국어](./README.ko.md)

> The thin, domain- and agent-agnostic core of Polydeukes — a development *discipline* framework for building alongside an AI coding partner.

**Pre-alpha.** Not yet published to npm. The API surface may move between milestones; for anything not landed here, the repository's design docs are the source of truth.

## What lives here

Every unit below is landed and tested — not blueprint:

- **Covenant protocol** — the contract every covenant (a deterministic, mutually binding promise) speaks: input arrives as stdin-JSON (`CovenantInput`, `parseInput`), verdicts leave as exit codes. A covenant body only ever emits `0` (upheld) or `1` (broken, non-blocking); translating `1` into the blocking `2` is the wrapper's job. Parsing is fail-closed — an unjudgeable payload resolves to `2`, never to a silent pass. The IR optionally carries `fileChanges` — agent-neutral pre/post content pairs adapters fill from their own sources (virtual apply, git blobs) so delta judgments never touch disk.
- **ROI telemetry** — a single append-only, line-oriented collector (`appendRecord`, `readRecords`) plus the `gain` aggregation (`runGain`). Every package writes through this one collector — via `appendRecordFailOpen`, the shared fail-open wrapper. Observation is fail-open: a logging failure never changes a verdict.
- **Config schema v2 (config as data)** — `defineConfig(unknown)` validates parsed yml/json data. Unknown keys are rejected loudly at every level (a typo must not silently disable a discipline), `testCmd` is a `{scope}` template string compiled into a callable, and the matching JSON Schema ships as `@polydeukes/core/schema.json` — held equivalent to the validator by a contract test. The schema now includes `disciplines:` — user-declared discipline entries (`forbid` / `immutable` / `forbidCommand`, exactly one predicate each) validated here as pure data and compiled by the covenant package.
- **Fail policy table** — one table (`resolveFailMode`) decides fail-open vs fail-closed per failure kind; "cannot judge" always means block.
- **Protected-path normalization** — `normalizeProtectedPaths` turns the declared `protectedPaths` list into the literal path strings the dispatcher matches on (trim, prefix/suffix strip, dedupe). Adapter settings live in the `adapters:` namespace map — one object per adapter, contents validated by that adapter, passed through the core verbatim.
- **Canonical transcript seam** — `CanonicalTranscript` is the query interface covenants use to ask about session history. The default is a noop; real transcripts stay behind adapters.

## Invariants

- **Zero runtime dependencies.** Validation is hand-rolled; the published JSON Schema is a sibling artifact the source never reads.
- **No agent, tool, or language literals.** Editor tool verbs and test-runner names are *values* supplied by configs and adapters, never part of this package's vocabulary — grep gates in the acceptance criteria keep it that way.
- **One-way dependencies.** Every other `@polydeukes/*` package depends only on `core`; core depends on none of them.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## License

MIT
