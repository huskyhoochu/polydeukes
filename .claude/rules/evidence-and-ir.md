---
paths:
  - "packages/pdks/src/core/**"
  - "packages/pdks/src/check.rs"
  - "packages/pdks/src/covenant/discipline.rs"
  - "packages/pdks-claude-code/**"
  - "packages/pdks-codex/**"
---

# Evidence and the IR

How adapters translate an external payload into `CovenantInput`, and what the core may assume about
what arrives. Vocabulary is in `domain-terms.md`.

## Enumerate success, never failure

A rule written as a list of failure shapes contradicts itself at the boundary — the shapes it forgot
become passes. Write the positive set instead: which tool results count as
_executed
and succeeded_,
which markers identify a _human_ utterance. This is why provenance uses a positive-identification
allowlist and never a blocklist of spoofable roles.

A message's `role` is not its provenance. `type=user` covers agent-authored turns too; the human
marker is a separate field the transcript supplies.

## Absence is a default, not an exception

When a field is missing in most real payloads, treat missing as the normal case and design the
judgment around it. Measure the ratio before deciding — an "exception path" that fires on more than
half the corpus is the main path wearing the wrong name.

## Measure the producer before designing attribution

Before comparing type designs for carrying evidence, count what the producers actually emit. A
three-way design debate over evidence attribution collapsed once the production cardinality turned
out to be 1:1 already. Apply the same check recursively to whatever the first measurement rejects.

## IR neutrality does not mean equal density

Two adapters filling the same IR field is not the same as filling it with the same richness. A test
that passes on one adapter's payload can be vacuous on the other's.
**Read a neutrality
claim narrowly**
— it says the core needs no adapter-specific branch, not that every adapter supplies every field.

## The payload contract comes from a live probe

External payload schemas are documented in more than one place and the places disagree. When the
contract matters, probe the real runtime and record what came back — official docs have been the
stale side more than once.

## Aggregated measurements hide the judged unit

A summed count across surfaces or entries conceals which unit was judged, and the missing unit
invents risks that do not exist. Report per-unit, then aggregate — never the reverse.

## The world axis is supplied, never read by the judge

The runner owns world supply. `packages/pdks/src/check.rs` rejects an input carrying a `world` key,
reads the files named by declarations, and builds a session snapshot.
`packages/pdks/src/covenant/discipline.rs` binds the supplied files, sidecar, transcript, and
observed changes into each declaration's world.

An absent file or channel is an absent key; `'[]'` as sidecar text is a present channel that
observed no spawn. On the session surface, a file binding for the judged change reads its own
`post`, absent on deletion. On the change-set surface, a modification reads the file from the tree
because its `post` contains only the added diff lines. Other file bindings read the supplied file
text. Transcript bindings read the session snapshot; the change-set surface has no session, so the
declaration's supply policy decides what that absence means.

## The actor comes from the host envelope only

`CovenantInput.actor` is `{ agentType?: string }`: the adapter reads the envelope's top-level
`agent_type` (present when the hook fires inside a subagent) and supplies `{}` for the main session.
`tool_input`, user text, the transcript body, and the sidecar are never read for it — those are
surfaces the agent writes, and an actor read from them is an actor the call chose for itself. A
surface that cannot prove an actor (the change-set surface) omits the key; a declaration's `supply`
policy says what the absence means.
