---
paths:
  - "packages/pdks/src/core/config.rs"
  - "packages/pdks/src/core/declaration.rs"
  - "packages/pdks/src/core/validation.rs"
  - "packages/pdks/src/load_config.rs"
  - "schema/**"
  - "polydeukes.config.yaml"
---

# Config as data — schema and predicate traps

The config is data and the judgment is code. These are the ways that boundary has been crossed by
accident.

The root `schema/` contains `polydeukes.schema.json`, `algebra-declaration.schema.json`,
`covenant-input.schema.json`, and `memory-search-output.schema.json`. SDK types are generated from
the last two. The root config's `schema-enums-agree` discipline compares the first two.

## Never ask a semantic question with a syntactic pattern

Three review rounds went into a trigger regex answering "is this string a new dependency version".
It leaked both ways every time — missing ranges, tags and protocol forms, then catching `workspace:`
and `engines` once widened. The entry now carries no trigger at all.

Before adding a pattern, name the question it answers. If the answer depends on meaning rather than
shape, the pattern is the wrong tool: narrow the declaration's `scope` instead, or accept that the
trigger is "editing this file at all".

## A line anchor silently disarms a multi-line pattern

`^` without the `m` flag anchors to the whole string. A pattern that runs over a whole text as one
string therefore matches only the first line and the discipline silently stops firing — write
`(?:^|\n)` there. It is non-capturing, so a step that keys by capture group 1 does not key by the
anchor. A declaration's `lines` step splits first, so `^` inside `keyByPattern` or `matches` after
it is a line start, and a pattern spanning a line boundary does not match. `lines` also trims each
line, so a pattern that anchors on leading indent (`^  token:`) never matches — measured on the live
valve declaration, which read `unchanged` over an empty extraction until the indent left the
pattern. Any anchored pattern needs a fixture with the violation on a later line.

## A predicate belongs to the layer that knows the answer

Assembly-time conditions that ask questions assembly cannot answer produce fail-open, not over-block
protection. If the answer only exists at judgment time, do not compile the question into a
registration — move it to the point that has the data, or drop it.

## YAML parsing rejects unsupported tags

`packages/pdks/src/load_config.rs` parses with `reject_unsupported_tags: true` and
`strict_booleans: true`; merge keys are ordinary keys. Unsupported tags and duplicate keys fail
parsing. Configuration validation checks the parsed value before assembly.

## Added-direction filtering is what makes added-only declarations usable

An added-only declaration (`onlyIn` of `post` over `pre`, `supply: empty` on both sides) judges only
what the edit adds, which is what lets a discipline land on a repository that already violates it.
When a fixture is a file the branch _creates_, every line reads as added — so a contract test whose
literals are the contract needs a `scope.exclude`, or it trips its own discipline on any commit that
re-creates it.
