# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a developer working with an AI coding agent such as Claude Code or Codex. They
have seen the agent repeat a specific mistake: bypassing a Git hook, hard-resetting the working
tree, or editing a test file to make it pass. They arrive wanting that one thing to stop.

Secondary audiences have lower priority:

- A maintainer making a development practice checkable for contributors and CI.
- Someone comparing Polydeukes with Biome, ast-grep, Semgrep, commitlint, hook scripts, or agent
  permission settings.
- An existing user resolving an unexpected block or upgrading an installation.

## Product Purpose

Polydeukes is a development discipline framework. The documentation helps a developer turn a
specific recurring mistake into a checkable discipline and understand the resulting judgment.

Success for the site is a visitor copying one discipline, pasting it into their configuration, and
seeing its first judgment.

## Positioning

Polydeukes judges an agent's command or edit before it runs. Its distinguishing capability is
combining that judgment with observed session history and the identity of the acting subagent.
Session evidence includes documents read, tools called, and, on Claude Code, the human's turns.

Judgment depends on the evidence supplied by the host. The documentation must distinguish what each
host can observe from what a discipline can compare.

## Operating Context

The documentation site is https://polydeukes.vercel.app. Developers use it alongside their editor,
agent session, terminal, project configuration, and CI.

Polydeukes ships the native Rust executable `pdks`, the judge. Optional executables are
`pdks-claude-code`, `pdks-codex`, and `pdks-memory`. TypeScript, Rust, and Python SDKs invoke the
judge from programs.

Homebrew is the recommended installation route, as confirmed by the owner on 2026-11-10. Other
routes are crates.io, npm/pnpm, and PyPI. Prebuilt executables support macOS arm64, Linux x64, and
Linux arm64. There is no prebuilt Windows release.

The documentation body comes from Markdown under `docs/` and `docs/catalog.json`, through
`packages/documentation/scripts/sync-docs.mjs`. The same Markdown is compiled into the executable
for `pdks docs`. Installed documentation describes that executable's build; the site may describe a
newer release. The landing page is a separate, manually authored Astro page.

## Capabilities and Constraints

The session surface judges one agent call before it runs through a host hook. The change-set surface
uses `pdks covenant check --diff` to judge a unified diff at commit time, in CI, or on demand.
Session calls and diffs supply different evidence.

A declared discipline is one configuration entry, expressible in YAML, using a closed grammar.
Extraction works with text, lines, JSON, and regular expressions. It has no syntax-tree extraction.

A broken discipline is recorded as `advised` by default and work proceeds. `enforce: block` is
opt-in per entry. Diff checks also need `--enforce block` to stop on a blocking entry. Built-in
covenants protecting configuration, protected paths, and transcripts can block session calls
independently of an entry's enforcement setting.

In a supported human session, a configured witness token can open a block. Codex carries no human
utterances. Disciplines that read human instructions record `skipped` there, and a blocked Codex
call cannot be witnessed open.

Telemetry uses `passed`, `blocked`, `witnessed`, `advised`, `skipped`, and `unattributed`.
`unattributed` is a baseline comparison finding, not a verdict emitted by the judge. `skipped` does
not establish that a discipline passed.

Adapters judge calls delivered by the host, not every write made by child processes. Calls can
proceed if the adapter or judge cannot start. Actual telemetry establishes whether a call reached
judgment; a hook's active status alone does not.

The documentation body remains plain Markdown usable through `pdks docs` in a terminal. Site tabs,
buttons, and badges are presentation layered over document sections and must never be the only
carrier of content. Reorganising the site means reorganising the Markdown documents under `docs/`
themselves and keeping the catalog consistent.

## Brand Commitments

Every verdict, number, and command output shown must be a real value the repository can reproduce.
Examples, testimonials, customer logos, and benchmarks must not be invented. Measurements retain
their source, date, scope, and conditions.

English and Korean are equal. Every screen must have the same structure and content in both
languages, and Korean typography receives the same care as English typography.

The current visual identity is not a binding commitment. The owner has left it undecided.

## Evidence on Hand

As checked on 2026-11-10, the repository's root configuration contains 27 discipline entries, each
with a stated reason. The project uses its own disciplines in daily development.

The local `.polydeukes/roi.log` contains real verdict rows. `conformance/` contains fixtures
exercised against the real judge by the repository's fixture runners and tests.

`packages/documentation/src/data/telemetry.json` supplies the landing page with a telemetry snapshot
dated 2026-09-15. Its figures describe that snapshot, not current totals.

`packages/documentation/src/data/evidence.json` supplies cited third-party research measurements
about AI agents, with sources and conditions. These are not third-party benchmarks of Polydeukes.
The repository provides no testimonials, customer logos, or third-party Polydeukes benchmarks.

## Product Principles

- Start with the user's specific recurring mistake and support reaching one observed judgment.
- Make every claim traceable to reproducible evidence and state the limits of that evidence.
- Separate judgment from enforcement so developers can observe advice before choosing to block.
- Keep missing observations distinct from successful checks, including differences between hosts.
- Maintain one documentation source across the website and terminal, with equal English and Korean
  content.

## Accessibility & Inclusion

Copy controls must work from the keyboard. English and Korean are first-class languages with
equivalent content and functionality.

The owner has not set a product-specific accessibility standard. A formal standard is undecided.
