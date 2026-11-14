---
name: ticket
description: >-
  Run a ticket from PRD through implementation, review, merge, and archiving. Use when starting a
  roadmap or ISSUE ticket, including 'CORE-03 시작', 'CONFIG-01 작업해줘', or 'start the next task'.
user_invocable: true
argument: "<ticket-id> (e.g. CORE-03)"
---

# Ticket loop

This loop serves ticket work; chores and documentation edits commit to `main`, with `/post-task` for
substantial work. The phase order is PRE → BRANCH → WORK → POST-TASK → PR → MERGE → ARCHIVE.

## PRE

Confirm an open Forgejo issue on `b95labs/polydeukes` whose title starts with the ID and whose
body-named dependencies are all closed. Otherwise report the condition and stop. Read the issue body
(including 검증기준 and its why) and milestone description for the goal and Exit Criteria. If the
work exceeds one verifiable PRD, propose separate issues. For a new package or crate, read
`.claude/rules/new-package-checklist.md` and make each registration an acceptance criterion, because
that rule otherwise loads only for paths workers write.

Build once with `cargo build --release -p pdks-memory`, then run
`./target/release/pdks-memory search '<area keywords>'`,
`./target/release/pdks-memory obligations <ID>`, and `./target/release/pdks-memory search <ID>`.
Open hits with `./target/release/pdks-memory show <section id>`; include or explicitly exclude every
hit in the PRD scope. Read `_docs/knowledge/foundation.research.first-principles-prd.md` in full
before writing the PRD; a session discipline checks this read. Candidate requirements name who asked
for them; delete the rest.

Write `_docs/prd/<ID>.md` in the shape of archived `*.prd.*` files, with the frontmatter specified
by `_docs/knowledge/foundation.adr.knowledge-format.md`: `scope`, `type: prd`, `title` equal to the
H1, `tags`, `created_at` with UTC offset, and `status: draft`. Use relative markdown links, an
`in-progress` status line, and goal / scope / contract / acceptance criteria / invariants /
follow-ups sections. Record one release impact in the status block (`patch`, `minor`, `breaking`,
`none`) and a one-sentence reason based on the largest shipped effect. The owner approves the PRD
before code work.

## BRANCH

From up-to-date `main`, run `git checkout -b feat/<id>` with a lowercase ID and move the Plane item
to `In Progress`.

## WORK

Invoke `tdd` with the PRD and proceed after VALIDATE passes. Knowledge documents besides the PRD
carry `ticket: <ID>` in frontmatter; `pdks-memory` reads that key. Tick each acceptance criterion
when a run proves it and name that run on the same line; ticking later from recollection is a
self-report.

## POST-TASK

Invoke `post-task` and proceed when its `### Post-task` block is emitted.

## PR

Use the release-impact type in the branch commit and PR title:

| Release impact | Commit type                                                                      |
| -------------- | -------------------------------------------------------------------------------- |
| `patch`        | `fix`                                                                            |
| `minor`        | `feat`                                                                           |
| `breaking`     | Accurate type with `!`; `BREAKING CHANGE:` body when migration needs explanation |
| `none`         | `docs` / `test` / `ci` / `build` / `chore`                                       |

Push the branch and use `curl` for `POST /repos/b95labs/polydeukes/pulls`, with JSON keys `head`,
`base`, `title`, `body` and base `main`; API base URL and token access are in `AGENTS.local.md`. Run
`Skill({ skill: "code-review", args: "high <PR#> — <context>" })`, passing the PRD invariants and
these three constraints:

- A finding names a code path or enumerated list; sampling an infinite input space remains a
  hypothesis until a measured instance exists.
- A finding states what its fix costs the person who installed the product, because the disciplines
  are self-imposed.
- Finders and verifiers read only and run the built executable only against a fixture tree they
  create, outside this working tree.

Judge findings against the PRD text; accepted fixes become follow-up commits that pass VALIDATE and
are pushed.

## MERGE

Report the PR state and wait for the owner's merge decision. On approval, ensure the squash title
carries the release-impact type: release-please reads only the commit landing on `main`. Squash
merge, delete remote and local branches, and run `git checkout main && git pull --ff-only`.

## ARCHIVE

At merge time, close the Forgejo issue with a comment naming the PR and squash commit, and comment
on open issues the work changed. Close an `ISSUE-<n>` ticket's GitHub report separately with its
shipping version. Reconcile every acceptance-criteria box and doc-disposition item in both PRD and
issue body: tick with its proving run or edit, or leave unticked with a stated destination. Move
`_docs/prd/<ID>.md` to `_docs/knowledge/<scope>.prd.<name>.md`; set the status line to `done` with
merge date and PR number, delete `status: draft`, preserve other frontmatter, and add the entry
under its scope in `_docs/knowledge/index.md`. Archived PRDs are immutable. Run
`git -C _docs add -A && git -C _docs commit && git -C _docs push`, because `_docs/` is its own git
repository, a Forgejo wiki clone, and unpushed knowledge exists on one machine. Report issues the
merge unblocked, move those with all dependencies closed from `Backlog` to `Todo`, and confirm this
ticket reached `Done`.

## Trackers

Plane POLY modules are GENERAL (mainline), ISSUE (GitHub reports), DOCS (documentation), CANDIDATE
(`candidate`, `conditional` and `friction` issues and tickets waiting on a start condition), and
LEDGER / VERIFY / DEFINITION (optional milestones). Stages are `Backlog` while a dependency is open,
`Todo` once all close, `In Progress` from BRANCH, and `Done` when the issue closes;
optional-milestone modules stay in `Backlog` until the module starts. New issues use
`<ID> · <one verb sentence>` and are placed in their module by hand; module and stage REST paths are
in `AGENTS.local.md`.
