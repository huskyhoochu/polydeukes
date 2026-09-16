---
paths:
  - "packages/**"
  - "_docs/**"
---

# Delegated work and what comes back

What a subagent or a review round returns is a claim about the tree, not the tree.

## Verify what a subagent reports, not that it reported

Delegated audits have returned summaries whose counts disagreed with their own tables, and
tables with rows for files that did not exist. Recount from the table, and spot-check that the
cited location exists, before acting on any delegated finding.

## Verify the working tree after any parallel agent run

Concurrent agents writing the same tree have produced corrupted intermediate states that no
single agent's output revealed. `git status` plus a diff against `HEAD` is the check — the
session hook only judges declared tool calls, so a child process's writes are outside its
observation.

## A run log is a claim about that run, not about the setup

A workflow's comments say what it was designed to do; its old run logs say what happened
once. Neither says what is configured now. Before reporting a publish or release path as
broken, ask in this order: the latest run's outcome, then the newest run *after* the last
human-visible fix, and only then the setup. On 2026-09-16 an `ENEEDAUTH` from the
bootstrap day was read as "trusted publishing is not set up" a day after it had been set up
for every package, and the owner had to say so three times. The registry itself is the
oracle: `npm view <pkg> version` says what is published, and a `403`/`ENEEDAUTH` on the
*latest* tag — not an earlier one — is what says auth is missing.

The same rule reaches the owner's words. When the owner states a fact about setup they
performed outside the repository — a registry page, a secret, an approval — that statement
outranks every log the repository holds, because the repository cannot observe that setup.
Take it as given and move to the next unknown.

## Correct fixes compose into dead code

Two independently correct changes can leave a branch that nothing reaches. After a review
round lands several fixes, re-read the combined path rather than each diff — the defect is in
the composition, and no individual review would have caught it.
