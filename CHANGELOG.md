# Changelog

**English** · [한국어](./CHANGELOG.ko.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project is **alpha**. Releases are tagged by release-please, and the first npm
publication lands with v0.3.0; the design docs remain the source of truth for
everything not yet implemented.

<!-- markdownlint-disable MD013 -- release-please writes the section lines below, at its own width. -->

## [0.5.0](https://github.com/huskyhoochu/polydeukes/compare/v0.4.0...v0.5.0) (2026-08-27)


### Features

* **adapter-git:** generalise covenant check over staged, worktree, and ref-range domains (DIAG-01) ([#67](https://github.com/huskyhoochu/polydeukes/issues/67)) ([99ecfee](https://github.com/huskyhoochu/polydeukes/commit/99ecfee7bcb67c3dd368e9d3f876549364083a41))
* **config:** judge published comments for citations nobody can follow ([62cc2f7](https://github.com/huskyhoochu/polydeukes/commit/62cc2f76fd80d5557a79ca02e4e8b4e45d984782))
* **core:** default posture advise — disciplines land advised, block is the promotion (POSTURE-01) ([#66](https://github.com/huskyhoochu/polydeukes/issues/66)) ([b3cc0d8](https://github.com/huskyhoochu/polydeukes/commit/b3cc0d8ed24bcd99cd6f8c4ee78f35ca06f0cf96))
* **core:** draft disciplines — unpromoted id+why entries (CONFIG-10) ([#64](https://github.com/huskyhoochu/polydeukes/issues/64)) ([a330d3b](https://github.com/huskyhoochu/polydeukes/commit/a330d3b28002309923310455f7ea92ed8bf7e547))
* **core:** per-entry enforce — session surface honours advise (CONFIG-11) ([#65](https://github.com/huskyhoochu/polydeukes/issues/65)) ([4098c4d](https://github.com/huskyhoochu/polydeukes/commit/4098c4dadca9a17f5261da8d42b204f8ba80172c))
* **covenant:** carry each discipline's why into its break message (COVENANT-19) ([#61](https://github.com/huskyhoochu/polydeukes/issues/61)) ([1bdfe98](https://github.com/huskyhoochu/polydeukes/commit/1bdfe98b2cfffa20245778ff9affb1faffb7936d))
* **covenant:** consolidated dispatch — in-process judge thunks (DISPATCH-01) ([#68](https://github.com/huskyhoochu/polydeukes/issues/68)) ([01466e2](https://github.com/huskyhoochu/polydeukes/commit/01466e2a0b0d8c8f7c8f03d26b13dafc55475392))
* **polydeukes:** discipline-draft skill — the sixth init artifact (DIAG-02) ([#69](https://github.com/huskyhoochu/polydeukes/issues/69)) ([e3a9d6e](https://github.com/huskyhoochu/polydeukes/commit/e3a9d6ed9e916d4bf41f5b0c5e0f899714134afd))
* **polydeukes:** render both surfaces' assembly with pdks explain (CLI-01) ([#63](https://github.com/huskyhoochu/polydeukes/issues/63)) ([76457e8](https://github.com/huskyhoochu/polydeukes/commit/76457e808128a94a528fdd8c38bf132f9c20b946))


### Bug Fixes

* **config:** answer the bare defect labels, and AC written with a space ([5050801](https://github.com/huskyhoochu/polydeukes/commit/505080108fdd2f503cc0ff5d7376c98066e7a029))

## [0.4.0](https://github.com/huskyhoochu/polydeukes/compare/v0.3.0...v0.4.0) (2026-08-18)


### Features

* **core:** tighten config validation and judgment regexes (CONFIG-09) ([#53](https://github.com/huskyhoochu/polydeukes/issues/53)) ([23b85c2](https://github.com/huskyhoochu/polydeukes/commit/23b85c20c6a58e306be829face6868d782b88731))
* **covenant:** record unattributed state changes on the session surface (COVENANT-14) ([#56](https://github.com/huskyhoochu/polydeukes/issues/56)) ([c63e22d](https://github.com/huskyhoochu/polydeukes/commit/c63e22d269c437d87bed73cf405529fd7c2e8b8a))
* **polydeukes:** bundle the config schema in the umbrella distribution (DIST-05) ([#58](https://github.com/huskyhoochu/polydeukes/issues/58)) ([279dcb2](https://github.com/huskyhoochu/polydeukes/commit/279dcb2df8c5bc4b5d2802bdf804c6d3bb6b6061))


### Bug Fixes

* **polydeukes:** drop node_modules from the default protection list ([546adf0](https://github.com/huskyhoochu/polydeukes/commit/546adf03694d11836b1c430c9f49ccbed17f166c))
* **polydeukes:** record the commit surface's fail-closed exits (ADAPTER-git-b) ([#57](https://github.com/huskyhoochu/polydeukes/issues/57)) ([819cf3d](https://github.com/huskyhoochu/polydeukes/commit/819cf3d2e054618d2c625df037d35ec9352fa9e1))

## [0.3.0](https://github.com/huskyhoochu/polydeukes/compare/v0.2.0...v0.3.0) (2026-08-10)


### Features

* **polydeukes:** add pdks init claude-code (DIST-02) ([#48](https://github.com/huskyhoochu/polydeukes/issues/48)) ([91f1fbf](https://github.com/huskyhoochu/polydeukes/commit/91f1fbf95f54dafcbb4f6a337b73929dd3c459fd))
* **polydeukes:** add the npm publishing pipeline (DIST-03) ([#49](https://github.com/huskyhoochu/polydeukes/issues/49)) ([5742e18](https://github.com/huskyhoochu/polydeukes/commit/5742e1824e5e87928a576482eead171ae8ca33b1))
* **polydeukes:** bundle the docs and answer them offline (DOCS-02) ([#52](https://github.com/huskyhoochu/polydeukes/issues/52)) ([e5b2229](https://github.com/huskyhoochu/polydeukes/commit/e5b2229db443c93cbdba44e30c8800e2e39eb979))
* **polydeukes:** move the session assembly into a packaged entry point (DIST-01) ([#46](https://github.com/huskyhoochu/polydeukes/issues/46)) ([9e85504](https://github.com/huskyhoochu/polydeukes/commit/9e85504a3d729ceebe5af19652b50e9e97c2b2ac))

## [0.2.0](https://github.com/huskyhoochu/polydeukes/compare/v0.1.0...v0.2.0) (2026-07-29)


### Features

* **adapter-claude-code:** jsonl transcript provider as the ttl waiver data source (ADAPTER-04) ([#25](https://github.com/huskyhoochu/polydeukes/issues/25)) ([a84c3b1](https://github.com/huskyhoochu/polydeukes/commit/a84c3b179fe60602448a42ebbc372666ae5a3bef))
* **adapter-git:** adapters.git.enforce level + advised telemetry event (CONFIG-06) ([#31](https://github.com/huskyhoochu/polydeukes/issues/31)) ([441ccce](https://github.com/huskyhoochu/polydeukes/commit/441ccceca3a62c2ec4071205d8eefc1df80390e2))
* **adapter-git:** git pre-commit adapter + pdks covenant check entry point (ADAPTER-git) ([#28](https://github.com/huskyhoochu/polydeukes/issues/28)) ([06b984b](https://github.com/huskyhoochu/polydeukes/commit/06b984b78780e568d020a296c4f8c66489ca4dcf))
* **assembly:** replace the session-global env valve with the TTL waiver ([7c5ee18](https://github.com/huskyhoochu/polydeukes/commit/7c5ee1868b738870e5d26178da13c85ce105e0a9))
* **config:** adopt native deny rules and implicit conventions as disciplines ([582f25c](https://github.com/huskyhoochu/polydeukes/commit/582f25cd2705527fb49cad288697046e0884e8d6))
* **config:** give the commit surface its own additive scope and restore block (CONFIG-08) ([#38](https://github.com/huskyhoochu/polydeukes/issues/38)) ([f4094b1](https://github.com/huskyhoochu/polydeukes/commit/f4094b1040e1fa73bc92b758f7fb6ff1daeae5e7))
* **core:** add CanonicalTranscript behavioral seam with noop default (CORE-04) ([#18](https://github.com/huskyhoochu/polydeukes/issues/18)) ([328efba](https://github.com/huskyhoochu/polydeukes/commit/328efbae7e0f00bd632d4fdd8d99a3eb62d0dbb6))
* **core:** config schema v2 — data config with {scope} templates + published JSON Schema (CONFIG-04) ([#20](https://github.com/huskyhoochu/polydeukes/issues/20)) ([e12cd22](https://github.com/huskyhoochu/polydeukes/commit/e12cd2288123d3099f2bc009c8db95a05b8eeae8))
* **core:** make FileChange a discriminated union with call-nested evidence (CORE-06) ([#33](https://github.com/huskyhoochu/polydeukes/issues/33)) ([c1747e6](https://github.com/huskyhoochu/polydeukes/commit/c1747e63642331d5e3b14d24dece012a75a5b9da))
* **core:** promote isPlainObject + fail-open telemetry helper to core exports (CORE-05) ([#29](https://github.com/huskyhoochu/polydeukes/issues/29)) ([b3c034c](https://github.com/huskyhoochu/polydeukes/commit/b3c034cc8d285ed0dd9721a9d703870a4a405698))
* **core:** redefine adapters as adapter namespace map (CONFIG-07) ([#30](https://github.com/huskyhoochu/polydeukes/issues/30)) ([c17dd5d](https://github.com/huskyhoochu/polydeukes/commit/c17dd5dee115d7b38e07c687d3e12886737f2a4f))
* **core:** waiver settings surface — token + ttlMinutes as config data (CONFIG-05) ([#26](https://github.com/huskyhoochu/polydeukes/issues/26)) ([0458196](https://github.com/huskyhoochu/polydeukes/commit/045819657dcbe5e125211403bcda7e42d506caef))
* **covenant:** add TTL waiver hatch predicate (COVENANT-06) ([#19](https://github.com/huskyhoochu/polydeukes/issues/19)) ([4bdf7c4](https://github.com/huskyhoochu/polydeukes/commit/4bdf7c46b7a4f26d2134bc266776f6301194c630))
* **covenant:** judge context evidence by execution, not by request (COVENANT-13b) ([#40](https://github.com/huskyhoochu/polydeukes/issues/40)) ([0098981](https://github.com/huskyhoochu/polydeukes/commit/00989814d609414d295a5d47c0dfbc3814bdd088))
* **covenant:** judge metachar-glued paths in the untokenizable fallback (COVENANT-07d) ([#43](https://github.com/huskyhoochu/polydeukes/issues/43)) ([3fd7804](https://github.com/huskyhoochu/polydeukes/commit/3fd78041b2f54c2259eba661e2b8e20c5cfce845))
* **covenant:** judge the proven mutation target, not an args mention (COVENANT-09) ([#32](https://github.com/huskyhoochu/polydeukes/issues/32)) ([70a1431](https://github.com/huskyhoochu/polydeukes/commit/70a1431fdd1b1d618588e0d63ee44d5ab3920873))
* **covenant:** judge the shell axis where computable, record skipped where not (COVENANT-10b) ([#36](https://github.com/huskyhoochu/polydeukes/issues/36)) ([2aa445b](https://github.com/huskyhoochu/polydeukes/commit/2aa445b7dfc358b0016fe6bab3e5b2af4f53cd88))
* **covenant:** judge the transcript by equality, not ancestry (COVENANT-07c) ([#37](https://github.com/huskyhoochu/polydeukes/issues/37)) ([ef7a672](https://github.com/huskyhoochu/polydeukes/commit/ef7a67247837d7e5d34e186c3297c0c27c9680bc))
* **covenant:** move the valve behind the verdict and rename it witness (COVENANT-17) ([#41](https://github.com/huskyhoochu/polydeukes/issues/41)) ([a624b3a](https://github.com/huskyhoochu/polydeukes/commit/a624b3a4a946fbaf4cbca702eba2779629f2cdfc))
* **covenant:** new-violation-only delta layer (COVENANT-05) ([#22](https://github.com/huskyhoochu/polydeukes/issues/22)) ([de62b8b](https://github.com/huskyhoochu/polydeukes/commit/de62b8badad40bba4e0c3242e2039a3a481be3f5))
* **covenant:** require session precedent before a matched edit (COVENANT-13) ([d77e3f6](https://github.com/huskyhoochu/polydeukes/commit/d77e3f69fc1a8e4b88d55c7a37251b9139ac075e))
* **covenant:** standard discipline library — data entries become enforcement (COVENANT-10) ([#23](https://github.com/huskyhoochu/polydeukes/issues/23)) ([a0258c4](https://github.com/huskyhoochu/polydeukes/commit/a0258c4611645d1fda8a4cf2fded6d9f5af099e9))
* **covenant:** the waiver token invokes only on a message's first line (COVENANT-15) ([#27](https://github.com/huskyhoochu/polydeukes/issues/27)) ([95b4874](https://github.com/huskyhoochu/polydeukes/commit/95b48743b8cb750c9924b699ef5fa08415188568))
* **polydeukes:** config discovery loader + dogfooding migration (CONFIG-03) ([#24](https://github.com/huskyhoochu/polydeukes/issues/24)) ([5a5b741](https://github.com/huskyhoochu/polydeukes/commit/5a5b741dade80e95c0daafa9189d1a7bced49263))


### Bug Fixes

* **config:** separate an unbuilt judge from a verdict at assembly (CONFIG-06b) ([#39](https://github.com/huskyhoochu/polydeukes/issues/39)) ([dbcc3ce](https://github.com/huskyhoochu/polydeukes/commit/dbcc3cefdfd5723194bcd52b5404151fb362c02a))
* **covenant:** a surface without an adapter evaluator is not a misconfiguration ([0566730](https://github.com/huskyhoochu/polydeukes/commit/056673031e3c476c4bcb209781a8d287df40919d))

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
