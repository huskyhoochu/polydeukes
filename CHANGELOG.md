# Changelog

**English** · [한국어](./CHANGELOG.ko.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project is **pre-alpha**: no version has been published yet, so every change
below is grouped under `[Unreleased]`. The v0.1 MVP milestone is complete and will
become the first tagged release; the design docs remain the source of truth for
everything not yet implemented.

## [0.2.0](https://github.com/huskyhoochu/polydeukes/compare/v0.1.0...v0.2.0) (2026-07-22)


### Features

* **adapter-claude-code:** jsonl transcript provider as the ttl waiver data source (ADAPTER-04) ([#25](https://github.com/huskyhoochu/polydeukes/issues/25)) ([a84c3b1](https://github.com/huskyhoochu/polydeukes/commit/a84c3b179fe60602448a42ebbc372666ae5a3bef))
* **adapter-git:** adapters.git.enforce level + advised telemetry event (CONFIG-06) ([#31](https://github.com/huskyhoochu/polydeukes/issues/31)) ([441ccce](https://github.com/huskyhoochu/polydeukes/commit/441ccceca3a62c2ec4071205d8eefc1df80390e2))
* **adapter-git:** git pre-commit adapter + pdks covenant check entry point (ADAPTER-git) ([#28](https://github.com/huskyhoochu/polydeukes/issues/28)) ([06b984b](https://github.com/huskyhoochu/polydeukes/commit/06b984b78780e568d020a296c4f8c66489ca4dcf))
* **assembly:** replace the session-global env valve with the TTL waiver ([7c5ee18](https://github.com/huskyhoochu/polydeukes/commit/7c5ee1868b738870e5d26178da13c85ce105e0a9))
* **config:** adopt native deny rules and implicit conventions as disciplines ([582f25c](https://github.com/huskyhoochu/polydeukes/commit/582f25cd2705527fb49cad288697046e0884e8d6))
* **core:** add CanonicalTranscript behavioral seam with noop default (CORE-04) ([#18](https://github.com/huskyhoochu/polydeukes/issues/18)) ([328efba](https://github.com/huskyhoochu/polydeukes/commit/328efbae7e0f00bd632d4fdd8d99a3eb62d0dbb6))
* **core:** config schema v2 — data config with {scope} templates + published JSON Schema (CONFIG-04) ([#20](https://github.com/huskyhoochu/polydeukes/issues/20)) ([e12cd22](https://github.com/huskyhoochu/polydeukes/commit/e12cd2288123d3099f2bc009c8db95a05b8eeae8))
* **core:** promote isPlainObject + fail-open telemetry helper to core exports (CORE-05) ([#29](https://github.com/huskyhoochu/polydeukes/issues/29)) ([b3c034c](https://github.com/huskyhoochu/polydeukes/commit/b3c034cc8d285ed0dd9721a9d703870a4a405698))
* **core:** redefine adapters as adapter namespace map (CONFIG-07) ([#30](https://github.com/huskyhoochu/polydeukes/issues/30)) ([c17dd5d](https://github.com/huskyhoochu/polydeukes/commit/c17dd5dee115d7b38e07c687d3e12886737f2a4f))
* **core:** waiver settings surface — token + ttlMinutes as config data (CONFIG-05) ([#26](https://github.com/huskyhoochu/polydeukes/issues/26)) ([0458196](https://github.com/huskyhoochu/polydeukes/commit/045819657dcbe5e125211403bcda7e42d506caef))
* **covenant:** add TTL waiver hatch predicate (COVENANT-06) ([#19](https://github.com/huskyhoochu/polydeukes/issues/19)) ([4bdf7c4](https://github.com/huskyhoochu/polydeukes/commit/4bdf7c46b7a4f26d2134bc266776f6301194c630))
* **covenant:** new-violation-only delta layer (COVENANT-05) ([#22](https://github.com/huskyhoochu/polydeukes/issues/22)) ([de62b8b](https://github.com/huskyhoochu/polydeukes/commit/de62b8badad40bba4e0c3242e2039a3a481be3f5))
* **covenant:** standard discipline library — data entries become enforcement (COVENANT-10) ([#23](https://github.com/huskyhoochu/polydeukes/issues/23)) ([a0258c4](https://github.com/huskyhoochu/polydeukes/commit/a0258c4611645d1fda8a4cf2fded6d9f5af099e9))
* **covenant:** the waiver token invokes only on a message's first line (COVENANT-15) ([#27](https://github.com/huskyhoochu/polydeukes/issues/27)) ([95b4874](https://github.com/huskyhoochu/polydeukes/commit/95b48743b8cb750c9924b699ef5fa08415188568))
* **polydeukes:** config discovery loader + dogfooding migration (CONFIG-03) ([#24](https://github.com/huskyhoochu/polydeukes/issues/24)) ([5a5b741](https://github.com/huskyhoochu/polydeukes/commit/5a5b741dade80e95c0daafa9189d1a7bced49263))

## [Unreleased]

### v0.1 MVP — covenant core + measurement (complete)

The project's own covenant substrate is deterministically protected from self-modification
on both the tool axis (Edit/Write/MultiEdit) and the Bash axis (`sed -i` / heredoc / tee /
redirect, parent-directory operations, and quote/escape-split paths), and every covenant
call is recorded in ROI telemetry. Self-dogfooding is on: the project builds itself through
its own covenants.

### Added

- **`@polydeukes/core`** — the thin, domain- and agent-agnostic core:
  - Covenant protocol contract: stdin-JSON ↔ `CovenantVerdict` with exit-code semantics
    (0 uphold / 1 break / 2 blocking); malformed input fails closed.
  - ROI telemetry: an append-only, single-collector logger shared by every package, plus
    a `gain` aggregation CLI. Concurrent appends never interleave.
  - `polydeukes.config.ts` schema with a `defineConfig()` loader (language as a first-class
    axis); no test-runner literals in core.
  - Fail-open / fail-closed policy table keyed by failure kind.
  - Protected-path normalization with automatic adapter-directory inclusion.
- **`@polydeukes/covenant`** — the covenant execution and judging layer:
  - `run_covenant` wrapper translating a break into the blocking exit code, with per-call
    ROI logging.
  - Heredoc-aware multi-line Bash command analysis with write-detection rules
    (redirect / tee / `printf` redirect / `sed -i` in-place / heredoc).
  - Path-routing dispatcher registering protected paths across a three-layer model.
  - Self-mod meta-covenant (tool axis) with an escape-hatch seam.
  - Shell-mod meta-covenant (Bash axis) assembling the detection rules into a judge with a
    read-only allowlist.
  - Path-segment matching primitive (ancestor / descendant / equal on normalized segments)
    shared by the dispatcher and both judges.
- **`@polydeukes/adapter-claude-code`** — the first agent adapter:
  - Claude Code PreToolUse payload → agent-neutral covenant-input IR up-translation.
  - Adapter-path ROI telemetry wiring with an injected dispatch seam.
  - Virtual-post-state parser computing Edit/Write/MultiEdit apply-results without touching
    disk (feeds the v0.2 new-violation-only trigger).
- **Self-dogfooding assembly** — a PreToolUse hook running every Edit/Write/MultiEdit/Bash
  call through the project's own covenants; every call is measured, and the escape hatch is
  recorded as `bypassed` rather than passing silently.
- **`@polydeukes/polydeukes`** — the unscoped name-reservation stub.

### Fixed

- Path matching judged on raw substrings let parent-directory operations
  (`rm -rf packages/core`) and quote/escape/line-continuation-split paths bypass the
  dispatcher and both judges; replaced with segment-aware matching that also handles the
  absolute `file_path` values Claude Code actually sends, without over-blocking unrelated
  paths whose names merely share a prefix.
- The self-dogfooding hook's fail-closed catch-all blocked without recording a telemetry
  row once the core module was available; it now records one `blocked` row per blocked call.
- `virtualPostState` expanded `$`-replacement patterns (`$&`, `$$`, `$'`) in `new_string`,
  diverging from the real Edit tool's literal substitution; substitutions are now literal.
