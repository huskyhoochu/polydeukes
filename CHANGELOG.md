# Changelog

**English** · [한국어](./CHANGELOG.ko.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project is **pre-alpha**: no version has been published yet, so every change
below is grouped under `[Unreleased]`. The v0.1 MVP milestone is complete and will
become the first tagged release; the design docs remain the source of truth for
everything not yet implemented.

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
