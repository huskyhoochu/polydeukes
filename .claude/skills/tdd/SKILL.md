---
name: tdd
description: "Run the RED→AUDIT→GREEN→REVIEW→VALIDATE TDD cycle for any production code change. Delegates test writing to tdd-test-writer, then classifies those tests via tdd-test-auditor BEFORE any implementation is written (so low-value tests are pruned before they induce unnecessary code), then delegates implementation to tdd-implementer, then reviews and validates. RED, AUDIT and GREEN run in the sonnet or pi mode the owner names. Also use for auditing pre-existing test files — if the argument is `audit <path>` or the user says 'test audit', 'prune tests', '요식행위 테스트', '낮은 가치 테스트', 'test 가치 평가', enter the cycle at the AUDIT phase, classify, and apply its DELETEs. Invoke aggressively whenever any of these phrases appear or when the user is about to write/modify production code under packages/, even if the user does not explicitly name the skill."
user_invocable: true
argument: "<feature-description> | audit <path-or-glob>"
---

# TDD Cycle Skill

One flow, six phases, three delegated agents. The cycle is the sanctioned path for production code
under `packages/`.

The phase order is strict: **PRE-FLIGHT → RED → AUDIT → GREEN → REVIEW → VALIDATE**. Pre-flight
forces the relevant design knowledge (`_docs/knowledge/` adr + dev-log) and library docs to land in
the turn _before_ any test is written, so the rest of the cycle cannot be entered on stale
training-data assumptions. Auditing tests _before_ implementation prevents writing code that only
exists to satisfy low-value assertions. Every invocation walks the same phases in the same order;
the argument only selects where to enter.

## Runner — sonnet or pi, the owner's choice

RED, AUDIT and GREEN run in the mode the owner names for the ticket or for one phase ("sonnet 모드",
"pi 모드"). When none is named, ask once before RED; nothing else switches it — not cost, usage or
speed. A review fix runs in GREEN's mode unless the owner says otherwise. Both modes run the same
role bodies (`.claude/agents/tdd-*.md`) with the same task text.

- **sonnet** — the `Agent` tool with `subagent_type` the role and `model: "sonnet"`. The role files
  name no model; a spawn without one lands on the session default, `opus`.
- **pi** — one background `pi` process per phase on DeepSeek, launched as `/ticket` §3 WORK
  describes.

## Entry points

- `<feature-description>` → start at PRE-FLIGHT and walk the full cycle.
- `audit <path-or-glob>` → start at AUDIT over existing tests. Stops after the DELETEs land.
  PRE-FLIGHT / GREEN / REVIEW / VALIDATE are skipped because there is no new implementation to
  produce.
- Keywords that resolve to the audit entry: `test audit`, `prune tests`, `요식행위 테스트`,
  `낮은 가치 테스트`, `test 가치 평가`. These are not a separate mode — they are shortcuts into the
  same cycle at the AUDIT phase.

## Phases

**Every delegation prompt (RED, AUDIT, GREEN) ends with this line, verbatim.** In a coding loop the
model tends to issue the next independent tool calls one per turn; the line at the end of the
request is what keeps a single agent from spending a round trip per file:

```text
First privately list what you need next; then request every item that doesn't depend on another's result in this one response.
```

### 0. PRE-FLIGHT — main session (mandatory, blocks RED)

Before delegating to `tdd-test-writer`, the main session emits a `### TDD Pre-flight` block.
Skipping it is the most frequent root cause of repeating a mistake already recorded in
`_docs/knowledge/`.

```text
### TDD Pre-flight
- Task area: <one line — e.g. "core covenant protocol: stdin-JSON parse + exit-code map">
- area search (`./target/release/pdks-memory search '<keywords>'`):
  - <section id>: <one-line takeaway>   ← repeat per hit, or "no matches" if zero
- identifier search (`./target/release/pdks-memory search '<identifier>'` — symbol, file, config key, ticket ID):
  - <section id>: <one-line takeaway>   ← repeat per hit, or "no matches"
  - Skipped because: <reason>   ← only when the area search already answered the area
- PRD consulted (`_docs/prd/<ID>.md`):
  - <acceptance criteria / invariants this cycle must satisfy>
- Library docs (context7 — required when touching an external library API):
  - <library>@<version> §<topic>: <one-line snippet>
  - Skipped because: <reason>   ← only if no external library API is involved
```

**Both searches use memory, never direct file reads** (`.claude/rules/knowledge-reads.md`). Run
`cargo build --release -p pdks-memory` once per session before the searches. Each invocation reads
the current markdown. The area search takes topic words and ranks sections; the identifier search
takes the identifiers the cycle will touch (symbol, file, config key, ticket ID) — an identifier is
exact where a topic word matches every neighbouring section, and it reaches a prescription or a
carry-over whose keywords never appear in a filename. Open a hit with
`./target/release/pdks-memory show <section id>`.

Every field must be grounded in tool output from this turn (not memory); empty results are valid
("no matches"), a missing block is not. The search commands run _in this turn_ — paste the section
ids they return, do not synthesize. The user may exempt the block via the literal phrase
`skip preflight` or `no context7 needed` in their **most recent** message (an earlier exemption does
not carry forward). Self-granted exemptions are forbidden. AUDIT-only entry (`audit <path>`) skips
Pre-flight because no production code is produced.

### 1. RED — delegate to `tdd-test-writer`

- Input: PRD spec, types/schema, ubiquitous language (`.claude/rules/domain-terms.md`), existing
  test helpers.
- Output: a failing test file. If the target behavior is already implemented, tests may pass on
  first run — that is fine; AUDIT still evaluates their value.
- Pass the written file set straight to AUDIT — do not attempt GREEN until AUDIT has classified the
  tests.

### 2. AUDIT — delegate to `tdd-test-auditor`

- Input: test file paths produced by RED. For `audit <path>` entry, the supplied path or glob.
- Output: per-test (`it()` or Rust `#[test]`) Markdown table classifying each test as
  **P0 / P1 /
  DELETE**
  with a 1–2 sentence rationale per test, plus a **coverage-gaps** section. Only P0/P1 survive;
  everything else — including a happy-path already covered by a nearby P0/P1 — is DELETE.
- The gaps section answers a different question from the table: the table asks what bug each test
  catches, the gaps ask which input the suite never tried. A suite can be entirely P0 and still
  blind — that is how COVENANT-07b shipped three defects past a 24-test audit. Read both.
- **The recommendations are accepted without asking the user.** The main session removes every
  DELETE with a surgical `Edit` (`rm` when the whole file is DELETE), then reports the table
  verbatim with what it removed. The auditor stays read-only; the main session executes.
- This phase is the **value gate**. Tests that fail the bar do not reach GREEN, so the implementer
  never writes code to satisfy them.

**For `audit <path>` entry, the cycle ends here** after the DELETEs land.

### 3. GREEN — delegate to `tdd-implementer`

- Input: the audited, surviving test file(s) + current source tree.
- Output: minimum code to make the surviving tests pass. No speculative branches, no features the
  surviving tests do not demand. (Global AGENTS.md §2 Simplicity First.)

### 4. REVIEW — main session

- Dedupe and rename in both the implementation and the surviving tests.
- Verify test-implementation alignment: every surviving test should still describe behavior the
  implementation actually delivers. Auditor deletions can strand helper assertions; fix them here.
- Check the cross-cutting invariants the PRD names that no test enforces.
- Re-run the runner after every edit. Scope is cosmetic — naming, duplication, drift — behavior must
  not change.

### 5. VALIDATE — main session

The full gate, run once at the end of the cycle:

- Rust: `cargo test -p <crate>`, `cargo fmt --all --check`, and
  `cargo clippy -p <crate> --all-targets -- -D warnings`.
- `sdk-ts`: `cargo build -p pdks` before e2e tests, `pnpm -F @polydeukes/sdk-ts test`,
  `pnpm -F @polydeukes/sdk-ts typecheck` (`tsc --noEmit`), and `pnpm check`.

If any fails, stop. Do not silence failures with `--no-verify` or targeted skips; diagnose and loop
back to the phase that owns the failure (usually GREEN or REVIEW).

After VALIDATE passes, continue to the `/post-task` skill (TSDoc pass, docs-drift check, dev-log
self-question) before creating a PR — the cycle is not closed until its block is emitted.

## Test runner

Rust tests live in each crate's `tests/`. `sdk-ts` uses vitest in `__tests__/`; its e2e tests
require `cargo build -p pdks`.

| Phase    | TypeScript SDK                                                              | Rust                                                                                                       |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| RED      | `pnpm -F <pkg> exec vitest run <path>`: confirm failure or intentional pass | `cargo test -p <crate> --test <target> [filter]`: confirm failure or intentional pass                      |
| GREEN    | Run the new file; confirm it passes                                         | `cargo test -p <crate> --test <target> [filter]`: confirm it passes                                        |
| REVIEW   | Re-run the touched files after each edit                                    | `cargo test -p <crate> --test <target> [filter]` after each edit                                           |
| VALIDATE | Full suite, typecheck, and `pnpm check`                                     | `cargo test -p <crate>`, `cargo fmt --all --check`, `cargo clippy -p <crate> --all-targets -- -D warnings` |
