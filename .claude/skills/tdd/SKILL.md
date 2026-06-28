---
name: tdd
description: "Run the RED→AUDIT→GREEN→REVIEW→VALIDATE TDD cycle for any production code change. Delegates test writing to tdd-test-writer, then classifies those tests via tdd-test-auditor BEFORE any implementation is written (so low-value tests are pruned before they induce unnecessary code), then delegates implementation to tdd-implementer, then reviews and validates. Single flow, no modes. Also use for auditing pre-existing test files — if the argument is `audit <path>` or the user says 'test audit', 'prune tests', '요식행위 테스트', '낮은 가치 테스트', 'test 가치 평가', enter the cycle at the AUDIT phase, classify, and act on user-approved DELETEs. Invoke aggressively whenever any of these phrases appear or when the user is about to write/modify production code under packages/, even if the user does not explicitly name the skill."
user_invocable: true
argument: "<feature-description> | audit <path-or-glob>"
---

# TDD Cycle Skill

One flow, six phases, three delegated agents. The cycle is the sanctioned path for production code
under `packages/`. It is how Polydeukes is built — and, after the self-dogfooding branch point, how
Polydeukes builds itself.

The phase order is strict: **PRE-FLIGHT → RED → AUDIT → GREEN → REVIEW → VALIDATE**. Pre-flight
forces the relevant design knowledge (`_docs/knowledge/` adr + dev-log) and library docs to land in
the turn *before* any test is written, so the rest of the cycle cannot be entered on stale
training-data assumptions. Auditing tests *before* implementation prevents writing code that only
exists to satisfy low-value assertions. Every invocation walks the same phases in the same order;
the argument only selects where to enter.

## Entry points

- `<feature-description>` → start at PRE-FLIGHT and walk the full cycle.
- `audit <path-or-glob>` → start at AUDIT over existing tests. Stops after user-approved DELETEs
  land. PRE-FLIGHT / GREEN / REVIEW / VALIDATE are skipped because there is no new implementation
  to produce.
- Keywords that resolve to the audit entry: `test audit`, `prune tests`, `요식행위 테스트`,
  `낮은 가치 테스트`, `test 가치 평가`. These are not a separate mode — they are shortcuts into the
  same cycle at the AUDIT phase.

## Phases

### 0. PRE-FLIGHT — main session (mandatory, blocks RED)

Before delegating to `tdd-test-writer`, the main session emits a `### TDD Pre-flight` block. There
is no hook enforcing it yet (a covenant will, post-dogfooding) — for now it is a discipline the main
session upholds by hand. Skipping it is the most frequent root cause of repeating a mistake already
recorded in `_docs/knowledge/`.

```
### TDD Pre-flight
- Task area: <one line — e.g. "core covenant protocol: stdin-JSON parse + exit-code map">
- knowledge scan (`ls _docs/knowledge/ | grep -iE '<keywords>'`):
  - <filename>: <one-line takeaway>   ← repeat per match, or "no matches" if zero
- PRD consulted (`_docs/prd/<ID>.md`):
  - <acceptance criteria / invariants this cycle must satisfy>
- Library docs (context7 — required when touching an external library API):
  - <library>@<version> §<topic>: <one-line snippet>
  - Skipped because: <reason>   ← only if no external library API is involved
```

Every field must be grounded in tool output from this turn (not memory); empty results are valid
("no matches"), a missing block is not. The knowledge scan command runs *in this turn* — paste
matching filenames, do not synthesize. The user may waive via the literal phrase `skip preflight`
or `no context7 needed` in their **most recent** message (an earlier waiver does not carry forward).
Self-waiving is forbidden. AUDIT-only entry (`audit <path>`) skips Pre-flight because no production
code is produced.

### 1. RED — delegate to `tdd-test-writer`

- Input: PRD spec, types/schema, ubiquitous language (`.claude/rules/domain-terms.md`), existing
  test helpers.
- Output: a failing test file. If the target behavior is already implemented, tests may pass on
  first run — that is fine; AUDIT still evaluates their value.
- Verify: run the test runner (below) on the new file and confirm failure (or intentional passing).
- Pass the written file set straight to AUDIT — do not attempt GREEN until AUDIT has classified the
  tests.

### 2. AUDIT — delegate to `tdd-test-auditor`

- Input: test file paths produced by RED. For `audit <path>` entry, the supplied path or glob.
- Output: per-`it()` Markdown table classifying each test as **P0 / P1 / DELETE** with a 1–2
  sentence rationale per test. Only P0/P1 survive; everything else — including a happy-path already
  covered by a nearby P0/P1 — is DELETE.
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
  surviving tests do not demand. (CLAUDE.md §2 Simplicity First.)
- Verify: the runner goes green on the new file.

### 4. REVIEW — main session

- Dedupe and rename in both the implementation and the surviving tests.
- Verify test-implementation alignment: every surviving `it()` should still describe behavior the
  implementation actually delivers. Auditor deletions can strand helper assertions; fix them here.
- Check the cross-cutting invariants the PRD names — for core work that includes the **agent/tool/
  language literal grep gate** (`@polydeukes/core` source must have zero `Edit`/`Write`/`claude`/
  `vitest`/`pytest`/`go test` literals) and **one-way dependency** (every package depends only on
  `core`).
- Re-run the runner after every edit. Scope is cosmetic — naming, duplication, drift — behavior
  must not change.

### 5. VALIDATE — main session

The full gate, run once at the end of the cycle:

- `pnpm -F <pkg> test` (or `pnpm build` / `turbo run test` across packages)
- `pnpm -F <pkg> typecheck` (`tsc --noEmit`)
- `pnpm check` (Biome lint + format — also runs on staged files at pre-commit via lefthook)

If any fails, stop. Do not silence failures with `--no-verify` or targeted skips; diagnose and loop
back to the phase that owns the failure (usually GREEN or REVIEW).

> After the self-dogfooding branch point (roadmap: COVENANT-04 + ADAPTER-01 wired), VALIDATE also
> means the change must pass the project's own covenants and be measured in the ledger. A covenant
> that blocks, or a missing measurement, is itself a regression signal.

## Test runner

Single runner, single language: **vitest** on Node ≥24, ESM, TypeScript 7 RC.

| Phase | Command |
|---|---|
| RED | new file only — `pnpm -F <pkg> exec vitest run <path>` (single-file failure confirmation) |
| AUDIT | none (classification only) |
| GREEN | new file only — single-file passing confirmation |
| REVIEW | none (or narrowly scoped if a cosmetic change touches tested code) |
| VALIDATE | full suite once — `pnpm -F <pkg> test` + typecheck + `pnpm check` |

Test files live in each package's `__tests__/` directory (outside `src/`), so the core's
literal-grep gate (which scans `src/` only) never trips on a `vitest` import.

Per-phase full-suite runs waste time; VALIDATE is the single intra-cycle full-suite gate.

## Why AUDIT comes before GREEN

The naive order (RED → GREEN → AUDIT) lets implementation accumulate against tests the auditor
would later classify DELETE. Every such test induces a code branch that exists only to satisfy a
low-value assertion, and removing the test later often leaves the branch behind. Running AUDIT
immediately after RED keeps the GREEN surface honest — code is only written for tests that already
pass the value bar.
