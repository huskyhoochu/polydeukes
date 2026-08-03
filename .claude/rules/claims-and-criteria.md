---
paths:
  - "_docs/**"
  - "docs/**"
  - "*.md"
---

# Claims, criteria, and measured numbers

How to write an acceptance criterion, a finding, or a number so that it can actually be
satisfied and later trusted. Every rule here came from a criterion or a figure that survived
review and turned out to be unsatisfiable or wrong.

## A criterion must have a finite domain

Two forms are allowed:

- **A universal over code paths** — "every path that returns a verdict writes a telemetry
  row." The domain is the code, so it stays finite as inputs grow.
- **An enumerated finite list** — "these N spellings are blocked." Anything outside the list
  is a **declared limit**, not a shortfall.

**A universal over the input space is forbidden** — "cannot be bypassed", "no evasion exists".
There is no fixed target in an infinite domain, so no implementation ever satisfies it and one
new spelling always refutes it. One such sentence rolled the v0.2 gate back three times.

The same rule governs a ticket: enumerate the set the PRD closes, and let counterexamples
outside it fail to block the ticket. "Does not regress" is bounded by the tests that exist.

## A number without its domain is void

"Zero regressions" means nothing until it says *measured over what*. Write the corpus and its
size next to the figure. A ratio needs its denominator restated at every reuse — `bypassed`
28% was tracked as a friction metric across three journal rounds before anyone asked what the
denominator counted, and it was not what everyone assumed.

**`passed` is an upper bound and `blocked` a lower one.** An agent that predicts a block
reshapes the call before making it, and the reshaped call passes legitimately with no record
that anything was avoided. Cite the dogfooding ratios with that bias stated; the reproduction
is in `foundation.dev-log.preemptive-shaping-leaves-no-row.md`.

## Describe what is, not what was left out

No "deliberately not included", no "this alternative was rejected", no marker written to stop a
future session re-opening a decision. The intent is to prevent re-litigation and the effect is
the opposite: it makes an absence into a documented entity that keeps arguing for itself. A
decision that was made leaves its result and nothing else. Commit messages and PR bodies are
outside this — describing what changed is not marking an absence.

## A claim ages with the thing it measured

An archived PRD's evidence is true for the terrain it was measured on. When the terrain
changes — a surface narrowed, a package added — a size-based argument has to be re-measured
before it is reused, even though the archived document itself stays immutable.

## Deferring requires a domain and a range

To defer an item, write what it covers (a finite enumeration) and what counts as done. Add
the opening condition when there is one — "when one real instance is filed" is finite;
"later" is not. **An item whose domain cannot be enumerated cannot be deferred** — it will be
recycled forever as a reason to reopen a decision. Discard it and record why.

## Verify what a subagent reports, not that it reported

Delegated audits have returned summaries whose counts disagreed with their own tables, and
tables with rows for files that did not exist. Recount from the table, and spot-check that the
cited location exists, before acting on any delegated finding.

## Correct fixes compose into dead code

Two independently correct changes can leave a branch that nothing reaches. After a review
round lands several fixes, re-read the combined path rather than each diff — the defect is in
the composition, and no individual review would have caught it.
