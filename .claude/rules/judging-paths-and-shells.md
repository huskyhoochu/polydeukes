---
paths:
  - "packages/covenant/**"
---

# Judging paths and shell lines

Constraints the judge code carries that its own source does not explain. Vocabulary for the
terms below is in `domain-terms.md`.

## Disposing of a new bypass spelling

The shell axis's contract is in `CLAUDE.md`; what it means for a change here is one question.
**Did the spelling leave a telemetry row?** If yes it is a declared limit — write one line and
stop. Do not open a ticket and do not widen a pattern to chase it, because the next spelling
is always reachable. If no, that is the defect class and it blocks.

## Over-blocking is the designed direction

Ancestor matching reaches shallow top-level segments, so `.git/hooks` in the protected list
blocks `du -sh .git`. **This is not a bug to narrow.** The alternative — matching only exact
paths — loses attached-ancestor destruction, which is the reason the check exists. Let
friction accumulate as measurement; the witness valve is the release, not a narrower pattern.

## Narrowing a comparison drops candidates

When a fix narrows *how* two paths are compared, it silently narrows *which* pairs are ever
reached. The two are different axes and reviews confuse them. After any change to matching,
check the candidate set separately from the comparison direction.

## Ask which code path, not which input

A defect fixed for one input class usually lives on a sibling path that the ticket never
aimed at. `COVENANT-07d` and `COVENANT-18` hit the same escape-handling defect twice because
the first fix was scoped by input rather than by branch. **When adding a defense, enumerate
the code paths that reach the same conclusion**, not the inputs that triggered the report.

## Scan order is grammar

Two operator classes that share a character prefix make the scan order the grammar itself —
redirects must be scanned before control operators, or `cmd &> log` splits wrong. Any new
operator class needs its position in that order fixed and commented, not just its pattern.

## An allowlist vouches for the command, not for the intent

A read-only head (`cat`, `tail`, `grep`) absolves the line it fronts. That premise breaks in
two directions: a later stage of the same line can write, and a line the scanner could not
finish reading could be anything. **A layered absolution must never trust a lower layer's
non-detection** — an open `unread` span withdraws the head's vouching power for that line.

## Green tests do not substitute for adversarial execution

Every defect in this package's history passed its own suite. Before trusting a judging change,
spawn the real hook against real payloads. The suite proves the branch you wrote; the spawn
proves the branch that runs.
