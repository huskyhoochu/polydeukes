---
name: tdd
description: "Run the RED→AUDIT→GREEN→REVIEW→VALIDATE TDD cycle for any production code change. Delegates test writing to tdd-test-writer, then classifies those tests via tdd-test-auditor BEFORE any implementation is written (so low-value tests are pruned before they induce unnecessary code), then delegates implementation to tdd-implementer, then reviews and validates. RED, AUDIT and GREEN run in the sonnet or pi mode the owner names. Also use for auditing pre-existing test files — if the argument is `audit <path>` or the user says 'test audit', 'prune tests', '요식행위 테스트', '낮은 가치 테스트', 'test 가치 평가', enter the cycle at the AUDIT phase, classify, and act on user-approved DELETEs. Invoke aggressively whenever any of these phrases appear or when the user is about to write/modify production code under packages/, even if the user does not explicitly name the skill."
user_invocable: true
argument: "<feature-description> | audit <path-or-glob>"
---

# TDD Cycle Skill

One flow, six phases, three delegated agents. The cycle is the sanctioned path for production code
under `packages/`.

The phase order is strict: **PRE-FLIGHT → RED → AUDIT → GREEN → REVIEW → VALIDATE**. Pre-flight
forces the relevant design knowledge (`_docs/knowledge/` adr + dev-log) and library docs to land in
the turn *before* any test is written, so the rest of the cycle cannot be entered on stale
training-data assumptions. Auditing tests *before* implementation prevents writing code that only
exists to satisfy low-value assertions. Every invocation walks the same phases in the same order;
the argument only selects where to enter.

## Runner — sonnet or pi, the owner's choice

RED, AUDIT and GREEN run in the mode the owner names for the ticket or for one phase ("sonnet
모드", "pi 모드"). When none is named, ask once before RED; nothing else switches it — not cost,
usage or speed. A review fix runs in GREEN's mode unless the owner says otherwise. Both modes run
the same role bodies (`.claude/agents/tdd-*.md`) with the same task text.

- **sonnet** — the `Agent` tool with `subagent_type` the role and `model: "sonnet"`. The role
  files name no model; a spawn without one lands on the session default, `opus`.
- **pi** — one background `pi` process per phase on DeepSeek, launched as `/ticket` §3 WORK
  describes.

## Entry points

- `<feature-description>` → start at PRE-FLIGHT and walk the full cycle.
- `audit <path-or-glob>` → start at AUDIT over existing tests. Stops after user-approved DELETEs
  land. PRE-FLIGHT / GREEN / REVIEW / VALIDATE are skipped because there is no new implementation
  to produce.
- Keywords that resolve to the audit entry: `test audit`, `prune tests`, `요식행위 테스트`,
  `낮은 가치 테스트`, `test 가치 평가`. These are not a separate mode — they are shortcuts into the
  same cycle at the AUDIT phase.

## Phases

**Every delegation prompt (RED, AUDIT, GREEN) ends with this line, verbatim.** In a coding loop
the model tends to issue the next independent tool calls one per turn; the line at the end of the
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
- area search (`pnpm exec pdks memory search '<keywords>'`):
  - <section id>: <one-line takeaway>   ← repeat per hit, or "no matches" if zero
- identifier search (`pnpm exec pdks memory search '<identifier>'` — symbol, file, config key, ticket ID):
  - <section id>: <one-line takeaway>   ← repeat per hit, or "no matches"
  - Skipped because: <reason>   ← only when the area search already answered the area
- PRD consulted (`_docs/prd/<ID>.md`):
  - <acceptance criteria / invariants this cycle must satisfy>
- Library docs (context7 — required when touching an external library API):
  - <library>@<version> §<topic>: <one-line snippet>
  - Skipped because: <reason>   ← only if no external library API is involved
```

**Both searches read the memory index, never the files** (`.claude/rules/knowledge-reads.md`).
Run `pnpm exec pdks memory ingest` first so the index holds the current documents. The area
search takes topic words and ranks sections; the identifier search takes the identifiers the
cycle will touch (symbol, file, config key, ticket ID) — an identifier is exact where a topic
word matches every neighbouring section, and it reaches a prescription or a carry-over whose
keywords never appear in a filename. Open a hit with `pnpm exec pdks memory show <section id>`.

Every field must be grounded in tool output from this turn (not memory); empty results are valid
("no matches"), a missing block is not. The search commands run *in this turn* — paste the
section ids they return, do not synthesize. The user may exempt the block via the literal phrase
`skip preflight` or `no context7 needed` in their **most recent** message (an earlier exemption
does not carry forward). Self-granted exemptions are forbidden. AUDIT-only entry
(`audit <path>`) skips Pre-flight because no production code is produced.

### 1. RED — delegate to `tdd-test-writer`

- Input: PRD spec, types/schema, ubiquitous language (`.claude/rules/domain-terms.md`), existing
  test helpers.
- Output: a failing test file. If the target behavior is already implemented, tests may pass on
  first run — that is fine; AUDIT still evaluates their value.
- Pass the written file set straight to AUDIT — do not attempt GREEN until AUDIT has classified the
  tests.

### 2. AUDIT — delegate to `tdd-test-auditor`

- Input: test file paths produced by RED. For `audit <path>` entry, the supplied path or glob.
- Output: per-`it()` Markdown table classifying each test as **P0 / P1 / DELETE** with a 1–2
  sentence rationale per test, plus a **coverage-gaps** section. Only P0/P1 survive; everything
  else — including a happy-path already covered by a nearby P0/P1 — is DELETE.
- The gaps section answers a different question from the table: the table asks what bug each test
  catches, the gaps ask which input the suite never tried. A suite can be entirely P0 and still
  blind — that is how COVENANT-07b shipped three defects past a 24-test audit. Read both.
- Present the table verbatim. For every DELETE, ask the user whether to prune, rewrite, or keep.
  Default action on approved DELETE is surgical `Edit`; if a whole file is DELETE, `rm` it.
- The auditor only has `Read, Glob, Grep`. It cannot delete. That is intentional — the DELETE
  decision belongs to the user; the auditor's job is classification, not enforcement.
- This phase is the **value gate**. Tests that fail the bar do not reach GREEN, so the implementer
  never writes code to satisfy them.

**For `audit <path>` entry, the cycle ends here** after approved DELETEs land.

### 3. GREEN — delegate to `tdd-implementer`

- Input: the audited, surviving test file(s) + current source tree.
- Output: minimum code to make the surviving tests pass. No speculative branches, no features the
  surviving tests do not demand. (Global AGENTS.md §2 Simplicity First.)

### 4. REVIEW — main session

- Dedupe and rename in both the implementation and the surviving tests.
- Verify test-implementation alignment: every surviving `it()` should still describe behavior the
  implementation actually delivers. Auditor deletions can strand helper assertions; fix them here.
- Check the cross-cutting invariants the PRD names that no test enforces (the core literal gate
  is `agent-literal-gate.test.ts`, run in VALIDATE).
- Re-run the runner after every edit. Scope is cosmetic — naming, duplication, drift — behavior
  must not change.

### 5. VALIDATE — main session

The full gate, run once at the end of the cycle:

- `pnpm -F <pkg> test` (or `pnpm build` / `turbo run test` across packages)
- `pnpm -F <pkg> typecheck` (`tsc --noEmit`)
- `pnpm check` (Biome lint + format — also runs on staged files at pre-commit via lefthook)

If any fails, stop. Do not silence failures with `--no-verify` or targeted skips; diagnose and loop
back to the phase that owns the failure (usually GREEN or REVIEW).

After VALIDATE passes, continue to the `/post-task` skill (TSDoc pass, docs-drift check, dev-log
self-question) before creating a PR — the cycle is not closed until its block is emitted.

## Test runner

**vitest**. Test files live in each package's `__tests__/` directory (outside `src/`), so the
core's literal gate, which scans `src/`, never trips on a `vitest` import.

| Phase | Command |
|---|---|
| RED | the new file only — `pnpm -F <pkg> exec vitest run <path>`: confirm it fails (or passes on purpose) |
| GREEN | the new file only — confirm it passes |
| REVIEW | re-run the touched files after each edit |
| VALIDATE | the full suite once — `pnpm -F <pkg> test` + typecheck + `pnpm check` |
