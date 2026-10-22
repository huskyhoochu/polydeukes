# How this project is developed

Development follows a roadmap → PRD → TDD loop, codified as skills: `/ticket <ID>` runs the full
unit-task loop and `/post-task` alone closes out substantial non-ticket chores before they commit.
Unit tasks must be small enough to fit one PRD and verifiable by a command or test. The skills live
in `.claude/skills/<name>/SKILL.md`; an agent without skill support reads that file and follows it.

The code and the archived PRDs (the merged contracts) hold current behaviour. Design docs own
everything not yet implemented; when a design doc and shipped code disagree, neither side wins by
default — triage against the archived PRD: it may be a stale doc, or a code bug to fix.

## Gaps and reports

**A gap left by a finished ticket is closed by a retrofit ticket, not a new roadmap ID**
(`COVENANT-01b` is the precedent): its own suffix, branch, and PR. Archived PRDs stay immutable;
the retrofit records the correction and the archived PRDs get a footnote pointing at it. This
keeps the roadmap a plan rather than a defect list.

Work that starts from an outside issue report takes its ID from the GitHub number instead
(`ISSUE-59`, split as `ISSUE-62a`), whether or not it closes a finished ticket's gap — the report
number is the stronger identifier, and the archived-PRD footnote still applies.

An outside report is first reproduced in a scratch repository with the released `pdks` bin, and
its verdict (accurate · partial · not reproduced · misreproduced) is posted as a comment. It is
then dispositioned one way: a doc chore (committed to `main`, report closed at once), an
`ISSUE-<n>` ticket — without waiting when leaving it costs a locked session, a discipline silently
off while rows read `passed`, or a declaration that can only answer one way — or a `friction`
issue carrying its re-evaluation trigger. Commits and PR bodies cite the report as
`huskyhoochu/polydeukes#<n>`; a bare `#<n>` resolves to a Forgejo number. A report is closed by
hand, with the version that shipped it.

## Tickets live in Forgejo issues

Every planned ticket, candidate, open-on-condition item, and observed friction is one issue on
`b95labs/polydeukes`, titled with its ID, labelled by kind, and placed on one of three kanban
projects (roadmap, issue reports, docs). A milestone's goal and Exit Criteria are its Forgejo
milestone description, and the milestone is named for its goal, not a version number. No wiki
page duplicates them.

## Milestone gate

A milestone closes through a fixed gate, once its Exit Criteria hold: ① a full audit runs every
criterion's command; ② a dogfooding journal round is added with numbers; ③ the release-please PR
merges; ④ `_docs/roadmap.history.md` gains the gate entry and inherits the milestone's Exit
Criteria verbatim.
