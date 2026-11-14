---
name: tdd
description: >-
  Run the TDD cycle for production code under packages/. Use audit entry for 'test audit', 'prune
  tests', '요식행위 테스트', '낮은 가치 테스트', or 'test 가치 평가'.
user_invocable: true
argument: "<feature-description> | audit <path-or-glob>"
---

# TDD cycle

Phase order: PRE-FLIGHT → RED → AUDIT → GREEN → REVIEW → VALIDATE. `audit <path-or-glob>` enters at
AUDIT and ends after DELETEs land.

## Runner

RED, AUDIT, and GREEN use the Agent tool with `subagent_type` set to `tdd-test-writer`,
`tdd-test-auditor`, and `tdd-implementer`, respectively, and `model: "sonnet"` for each call. The
role files name no model; an explicit call model selects the worker because a spawn without one
lands on the session default, `opus`.

## PRE-FLIGHT — main session

Before RED, search the task area and identifiers the cycle will touch (symbol, file, config key,
ticket ID) with `./target/release/pdks-memory search`, open hits with
`./target/release/pdks-memory show <section id>`, read the PRD, and consult current library
documentation when an external library API is involved. State what was found from this session's
tool output.

## RED

Give `tdd-test-writer` the PRD spec, types/schema, and existing test helpers. Tests that pass on
first run are acceptable when behavior already holds.

## AUDIT

Give `tdd-test-auditor` the test paths to classify each test P0 / P1 / DELETE and report coverage
gaps. The main session applies every DELETE without asking, then reports the table and what it
removed. This precedes GREEN so the implementer writes no code for a test that will not survive.

## GREEN

Give `tdd-implementer` the surviving tests and source tree; it writes the minimum code that passes
them.

## REVIEW — main session

Review naming and duplication in code and tests, test-implementation alignment after deletions, and
PRD invariants no test enforces. Preserve behavior; rerun touched tests after edits.

## VALIDATE — main session

- Rust: `cargo test -p <crate>`, `cargo fmt --all --check`,
  `cargo clippy -p <crate> --all-targets -- -D warnings`.
- sdk-ts: `cargo build -p pdks`, `pnpm -F @polydeukes/sdk-ts test`,
  `pnpm -F @polydeukes/sdk-ts typecheck`, `pnpm check`.

Diagnose failures and return them to the owning phase. After VALIDATE passes, invoke `/post-task`
for the closing checks. Focused runs during RED/GREEN/REVIEW:

- Rust: `cargo test -p <crate> --test <target> [filter]`.
- TypeScript: `pnpm -F <pkg> exec vitest run <path>`; sdk-ts e2e requires `cargo build -p pdks`.
