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

## Correct fixes compose into dead code

Two independently correct changes can leave a branch that nothing reaches. After a review
round lands several fixes, re-read the combined path rather than each diff — the defect is in
the composition, and no individual review would have caught it.
