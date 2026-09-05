---
paths:
  - "packages/core/src/config.ts"
  - "packages/core/src/algebra.ts"
  - "packages/core/src/validation.ts"
  - "packages/core/schema/**"
  - "polydeukes.config.yaml"
---

# Config as data — schema and predicate traps

The config is data and the judgment is code. These are the ways that boundary has been
crossed by accident.

## Never ask a semantic question with a syntactic pattern

Three review rounds went into a trigger regex answering "is this string a new dependency
version". It leaked both ways every time — missing ranges, tags and protocol forms, then
catching `workspace:` and `engines` once widened. The entry now carries no trigger at all.

Before adding a pattern, name the question it answers. If the answer depends on meaning rather
than shape, the pattern is the wrong tool: narrow the declaration's `scope` instead, or accept
that the trigger is "editing this file at all".

## A line anchor silently disarms a multi-line pattern

`^` without the `m` flag anchors to the whole string. A pattern that runs over a whole text
as one string therefore matches only the first line and the discipline silently stops
firing — write `(^|\n)` there. A declaration's `lines` step splits first, so `^` inside
`keyByPattern` or `matches` after it is a line start, and a pattern spanning a line boundary
does not match. `lines` also trims each line, so a pattern that anchors on leading indent
(`^  token:`) never matches — measured on the live valve declaration, which read `unchanged`
over an empty extraction until the indent left the pattern. Any anchored pattern needs a
fixture with the violation on a later line.

## A predicate belongs to the layer that knows the answer

Assembly-time conditions that ask questions assembly cannot answer produce fail-open, not
over-block protection. If the answer only exists at judgment time, do not compile the question
into a registration — move it to the point that has the data, or drop it.

## Empty and malformed config fail in different directions

An unresolved YAML tag surfaces as a *warning*, not a parse error — safe parsing does not mean
fail-closed parsing. Validation must reject explicitly; do not assume the parser did it.

Zero valid entries must never become universal-uphold. Both judge bodies fail closed on an
empty list for exactly this reason, and the pair-grid argv parser treats a `--`-prefixed value
as a shifted grid rather than a value.

## Added-direction filtering is what makes added-only declarations usable

An added-only declaration (`onlyIn` of `post` over `pre`, `supply: empty` on both sides)
judges only what the edit adds, which is what lets a discipline land on a repository that
already violates it. When a fixture is a file the branch *creates*, every line reads as
added — so a contract test whose literals are the contract needs a `scope.exclude`, or it
trips its own discipline on any commit that re-creates it.
