---
name: ticket
description: "Run the full unit-task operating loop for a roadmap ticket (e.g. CORE-03): PRD creation → feature branch → TDD cycle → post-task checks → PR + code review → squash merge → PRD archiving. This is the codified workflow the project already follows by hand — invoke it whenever the user names a roadmap ticket ID to start (e.g. 'CORE-03 시작', 'CONFIG-01 작업해줘') or asks to 'start the next task'. It delegates the code work to the /tdd skill and the pre-PR checks to the /post-task skill; this skill owns the sequence and the gates between them."
user_invocable: true
argument: "<ticket-id> (e.g. CORE-03)"
---

# Ticket Loop Skill

One loop, seven phases. This is the sanctioned path for roadmap ticket work — the manual
precursor of the ledger lifecycle CLI (roadmap LEDGER-06: new/start/work/verify/finish). After
the self-dogfooding branch point, phases of this skill migrate one by one into ledger gates;
until then, this document *is* the workflow.

Scope guard: this loop is for **ticket work only** (a roadmap ID like CORE-03). Chores and doc
edits do not enter it — they commit directly to `main` (no unrequested branches, ever) and, when
substantial, run `/post-task` standalone before committing.

The phase order is strict: **PRE → BRANCH → WORK → POST-TASK → PR → MERGE → ARCHIVE**.

## Phases

### 1. PRE — roadmap check + PRD (blocks everything)

- Confirm the ticket exists in `_docs/roadmap.md`, is unchecked, and **all its dependencies are
  checked ✅**. A ticket with unmet dependencies does not start — say so and stop.
- Re-read the ticket's row (검증기준 = acceptance criteria) and its `why` bullet.
- Scan `_docs/knowledge/` for entries relevant to the ticket's area before writing the PRD —
  the PRD must build on recorded decisions, not re-derive them.
- Write `_docs/prd/<ID>.md` following the shape of the archived PRDs in `_docs/knowledge/`
  (`*.prd.*` files): same 4-key frontmatter (`scope`/`type`/`tags`/`created_at`), status line
  `in-progress`, sections for goal / contract / acceptance criteria / invariants / follow-ups.
- **Present the PRD to the user for approval before any code work.** The user may amend scope
  here; the approved PRD is the cycle's contract.

### 2. BRANCH

- `git checkout -b feat/<id>` (lowercase, e.g. `feat/core-03`), branched from up-to-date `main`.
- This is the only sanctioned branch creation. Never create branches the loop (or the user)
  did not ask for.

### 3. WORK — delegate to the `/tdd` skill

- Invoke the `tdd` skill with the PRD as the feature description. It owns
  PRE-FLIGHT → RED → AUDIT → GREEN → REVIEW → VALIDATE; do not re-implement its phases here.
- The loop does not proceed until VALIDATE passes (tests + typecheck + `pnpm check`).

### 4. POST-TASK — delegate to the `/post-task` skill

- Invoke the `post-task` skill. It owns the TSDoc pass, the docs-drift check, and the dev-log
  self-question, and emits a mandatory `### Post-task` block.
- The loop does not proceed to PR until that block is emitted with every item grounded in
  this-session tool output.

### 5. PR — create, review, fix

- Commit with a Conventional Commit message (`feat(<pkg>): … (<ID>)`), push the branch, and
  open a PR against `main` with `gh pr create`.
- Run the `/code-review` skill on the PR. Triage its findings the project's way: reviewer
  confidence is hypothesis strength, not a verdict — judge each finding against the PRD text.
- Apply accepted fixes as follow-up commits on the same branch (each passing VALIDATE), push.

### 6. MERGE — user's call

- **Merging is always the user's decision.** Report the PR state and wait; never merge
  unprompted.
- On approval: squash merge, delete the remote and local branch, then
  `git checkout main && git pull --ff-only`.

### 7. ARCHIVE — at merge time, not before

Archiving happens **when the PR merges**, never merely when acceptance criteria pass:

- Check the ticket ✅ in `_docs/roadmap.md` (and update any downstream rows the work informed).
- Move `_docs/prd/<ID>.md` → `_docs/knowledge/<scope>.prd.<name>.md`: flip the status line to
  `done` (with merge date + PR number), keep the 4-key frontmatter. Archived PRDs are immutable.
- Report which roadmap tickets the merge unlocked.

## Notes

- `_docs/` is local-only (gitignored) by design; this skill is checked in, so contributors
  without `_docs/` can still follow the loop's shape with their own roadmap/PRD store.
- Vocabulary is binding throughout: `covenant` / `discipline framework` / `memory` — never
  `guard` / `harness` / `kb` (see `.claude/rules/domain-terms.md`).
- Unit tasks must stay small enough for one PRD, verifiable by a command or test. If PRE
  reveals the ticket is bigger than that, propose splitting it in the roadmap first.
