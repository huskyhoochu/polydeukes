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
- **Carry-over sweep (separate from the keyword scan):** carried-over items live in the *body*
  (§8 follow-ups) of prior archived PRDs whose filenames share no keyword with the new ticket,
  so a filename scan structurally misses them
  (`foundation.dev-log.preflight-keyword-scan-misses-carryovers.md`). Grep the archive body and
  the memory's progress log for the ticket's ID and carry-over markers, e.g.
  `grep -ln '이월\|carry-over' _docs/knowledge/*.prd.*.md` plus a `grep '<ID>'` over the memory
  progress notes. Every hit must be dispositioned in the PRD's scope section — included or
  explicitly excluded; silence is a miss.
- **Ask recall one question here too.** This sweep is the clearest case of what a filename scan
  cannot reach, so put the question in prose — "what was carried over toward `<ID>`", "what did
  earlier tickets defer in this area". The command and its two weak axes are in the `/tdd`
  skill's PRE-FLIGHT section; the same rule applies — **every attempt gets a row in
  `_docs/knowledge/memory.dev-log.cognee-recall-gaps.md`**, a wrong answer included. Recall
  supplements the greps above and never replaces them: a hit it misses is still a miss.
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
- **Tick each acceptance criterion the moment a run proves it — not at the end.** As every
  phase lands (GREEN goes green, a spawn returns, VALIDATE passes), flip the criteria that run
  proved to `- [x]` in the PRD and write *which run showed it* on the same line. Batching the
  ticks until archive time means filling them in from memory, because by then the evidence is
  already gone — and a box ticked from memory is a self-report, not a verification record. This
  repository has had self-reports overturned by measurement at two milestone gates. A criterion
  no run has proved yet stays unticked; that is the checklist working, not a gap to paper over.

### 4. POST-TASK — delegate to the `/post-task` skill

- Invoke the `post-task` skill. It owns the TSDoc pass, the docs-drift check, and the dev-log
  self-question, and emits a mandatory `### Post-task` block.
- The loop does not proceed to PR until that block is emitted with every item grounded in
  this-session tool output.

### 5. PR — create, review, fix

- Commit with a Conventional Commit message (`feat(<pkg>): … (<ID>)`), push the branch, and
  open a PR against `main` with `tea pr create`.
- **Every commit that stages a protected path stops at a TTY witness prompt**, and an
  agent-spawned commit has no TTY and cannot answer — so a human runs it in their own
  terminal. Say how many prompts are coming before starting, never one at a time.
- **Splitting a branch by category is deferred, decided 2026-08-02.** It would cover ticket
  branches carrying more than one kind of change (a distribution-API decision, a new layer,
  a workflow fix that surfaced along the way), and would be done when each commit stands
  alone with tests passing at that point. It is deferred because MERGE squashes: the split
  would reach the review but never `main`, while multiplying the witness prompts above by the
  number of commits. **Opens when the merge strategy stops squashing** — until then the
  benefit is review granularity alone, which does not pay for the prompts.
- Review by launching the repo's vendored review workflow:
  `Workflow({ name: "pdks-code-review", args: "high <PR# or target> — <context>" })`.
  This is a fork of the built-in `/code-review` workflow living at
  `.claude/workflows/pdks-code-review.js` — vendored because the built-in skill is
  user-invocable only (`disable-model-invocation`), which stalled this phase on a manual
  step. This skill instructing the launch is the sanctioned Workflow opt-in; do not treat
  the launch as needing separate user approval. In the args, pass the PRD's invariants and
  severity framing as review context (the finder/verifier agents honor it). Findings land
  in-session; triage them the project's way: reviewer confidence is hypothesis strength,
  not a verdict — judge each finding against the PRD text.
- **Two constraints belong in the args, and a review without them leans one way.** A finding
  always arrives as "here is how it breaks", so accepting one is free and declining one costs
  an argument. Left alone that gradient adds a check every round.
  - **Finite domain.** A finding must name a code path or an enumerated list. One that
    samples an infinite input space — three invented malformed files out of all possible
    malformed files — is not a defect report, and closing it writes code for inputs nobody
    has seen. Ask for the measured instance; absent one, the finding is a hypothesis.
  - **What the fix costs.** Every check takes something from whoever installed this: a file
    they can no longer edit freely, a command that now refuses, a default that assumes they
    are the threat. A finding that names only the risk has reported half of itself. This
    product's disciplines are self-imposed, so a fix that removes the owner's choice is a
    regression even when the risk is real. (A human typing `/code-review`
  still runs Claude Code's own version; the two drift independently — the fork's header
  comment records the divergences.)
- Auxiliary, for L-sized tickets where a durable review record on the PR is wanted: also run
  the `code-review:code-review` plugin (5-perspective review posted as a GitHub comment).
  Know its shape: findings scoring below its confidence cut are silently dropped, so it
  supplements the in-session pass, never replaces it.
- `/code-review ultra` (cloud multi-agent review, separately billed) is **user-triggered
  only** — suggest it at milestone gates (e.g. closing v0.1), never launch it on the user's
  behalf.
- Apply accepted fixes as follow-up commits on the same branch (each passing VALIDATE), push.

### 6. MERGE — user's call

- **Merging is always the user's decision.** Report the PR state and wait; never merge
  unprompted.
- On approval: squash merge, delete the remote and local branch, then
  `git checkout main && git pull --ff-only`.

### 7. ARCHIVE — at merge time, not before

Archiving happens **when the PR merges**, never merely when acceptance criteria pass:

- Check the ticket ✅ in `_docs/roadmap.md` (and update any downstream rows the work informed).
- **Reconcile the acceptance criteria — every box, in both places they live** (the PRD and,
  when the ticket came from a sub-roadmap, that document's criteria list). By now the boxes
  should already be ticked, each carrying the run that proved it (phase 3) — this step audits
  that record rather than creating it. Any box still empty is answered here, not filled in:
  either name the run that proved it and tick it, or leave it unticked with a line saying so
  and a destination, exactly like a review finding. Ticking a roadmap row while its own
  criteria stay `- [ ]` is what makes an archived ticket read as "completed without
  verification", and it also destroys the only record of how it was verified.
- **Do the same for the doc-disposition list.** It is not an acceptance criterion, so the
  bullet above does not reach it — but the rule is identical: for each item, record which run
  or edit discharged it, or write its destination. A merged ticket that silently left its own
  `- [ ]` items is how a carry-over goes missing, and closing that leak is the standing
  prescription in `_docs/knowledge/foundation.dev-log.carryover-grep-misses-disposition-sections.md`.
- Move `_docs/prd/<ID>.md` → `_docs/knowledge/<scope>.prd.<name>.md`: flip the status line to
  `done` (with merge date + PR number), keep the 4-key frontmatter. Archived PRDs are immutable.
- **Commit and push the `_docs/` clone, then re-index.** Everything this loop wrote there —
  the PRD, any dev-log from POST-TASK, the archived PRD, the roadmap tick — is only a local
  edit until that push. Unpushed knowledge exists on one machine, which is exactly what the
  telemetry loss demonstrated costs a project its record. The push is also what makes the
  recall index stale, so the two belong in one step:

  ```sh
  git -C _docs add -A && git -C _docs commit && git -C _docs push
  ssh root@gem12 'incus exec apps -- /opt/cognee/sync.sh' &
  ```

  `sync.sh` pulls the clone and re-indexes only what changed — background it, since a
  ticket's 3~4 documents take a couple of minutes and nothing downstream waits on it. A
  daily timer covers pushes made outside this loop; recall prints how far behind the index
  is, so a skipped sync surfaces at the next question rather than silently aging.
- Report which roadmap tickets the merge unlocked.

## Notes

- `_docs/` sits at a gitignored path but is **its own git repository** — a clone of the
  project's Forgejo wiki, which is where the roadmap, PRDs, and knowledge entries actually
  live. Edits there are ordinary git work: commit and push in that directory (see ARCHIVE).
  This skill is checked into the main repo, so contributors without that clone can still
  follow the loop's shape with their own roadmap/PRD store.
- Vocabulary is binding throughout: `covenant` / `discipline framework` / `memory` — never
  `guard` / `harness` / `kb` (see `.claude/rules/domain-terms.md`).
- Unit tasks must stay small enough for one PRD, verifiable by a command or test. If PRE
  reveals the ticket is bigger than that, propose splitting it in the roadmap first.
