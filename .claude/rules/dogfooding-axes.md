---
paths:
  - ".claude/hooks/**"
  - ".claude/settings.json"
  - ".grok/hooks/**"
  - "polydeukes.config.yaml"
  - "lefthook.yml"
  - "packages/polydeukes/src/covenant/**"
  - "packages/adapter-claude-code/**"
  - "packages/adapter-grok/**"
---

# How the two surfaces judge

What each axis actually compares when this repo judges itself. Vocabulary for the terms below
is in `domain-terms.md`; the recovery procedures for a locked session are in `AGENTS.md`.

All protection-policy data lives in `polydeukes.config.yaml`, which documents each entry's why
inline — read it for the live protected paths and disciplines. Both surfaces fail **closed** on
an unjudgeable run (missing/invalid config, or a judge body that was never built); a
stale-but-present body carries no such signal. One call is judged while the config does not
load: on the session surface, a single Edit or Write whose only target is the config file,
whose `pre` is the text the loader read, and whose result loads lands `advised` under the
`covenant-check` label and exits 0 whatever `--enforce` says, so a typo in the config can be
repaired from inside the session. A rewrite that still does not load, evidence that does not
start from the bytes on disk, a call that touches anything else, and every change-set run
stay closed.

## What blocks and why

- **Tool axis** (Edit/Write/…): only the call's proven mutation target is compared — a protected
  path inside an edit's *content* is a mention and passes. An evidence-free call falls back to
  the conservative args-mention judgment.
- **Bash axis**: a command *mentioning* a protected path without a read-only first token blocks
  (mentions compare raw AND dot-resolved segments as a union; globs and `$VAR` are never
  expanded). Computable shell writes (literal redirects, clean heredocs/herestrings) block like
  a `Write` before the allowlist is even consulted. A line the scanner cannot finish reading
  keeps an `unread` span and loses its allowlist absolution while the span is open. Everything
  the text leaves undecidable lands as a `skipped` telemetry row, and **that row is the
  contract**: predicting a shell target from text is undecidable, so the invariant this axis
  holds is that no call passes unrecorded. A new spelling landing in `skipped` is the declared
  limit showing itself; a pass with NO row (or `passed` without judgment) is the defect class.
  Never read a scan that stopped early as the safe direction.
- **The transcript** is judged by whole-path *equality*, never as an ancestor: forged writes
  block in every spelling, an allowlisted read head (`cat`, `tail`, `grep`, …) passes in every
  spelling, and a reader outside the allowlist (`jq`, `bat`) breaks — the allowlist vouches for
  the command, not the intent. Out-of-repo ancestors stay out of observation scope; the agent's
  own deny policy owns that ground.
- **Disciplines** in the config judge beyond path mention — every entry is one declaration.
  A break lands `advised` on both surfaces — exit 0, the `why` on
  stderr — unless the entry says `enforce: block` (POSTURE-01); the three meta-covenants
  above are what blocks unasked. The config places each declaration in the list of the surface
  that observes its channels — `disciplines` for one reading only the changed file and `file`
  sources, `sessionDisciplines` for one reading `command` · `transcript` · the `sidecar`
  channel · `actor`, `changeSetDisciplines` for one reading `changes` — and the loader refuses a
  misplaced entry rather than compiling it somewhere it cannot be judged. Each surface compiles
  the shared list plus its own, so neither surface carries the other's entries at all. A
  session-only declaration on a host that proves no session (Grok) still lands `skipped` by its
  own `supply` policy.

## What a host proves, and what follows from it

The axes above describe a surface whose payload carries a transcript path — this repository's
Claude hook, and any host that names one. The IR's `session` key is what says so, and three
things hang off it: the witness valve (it reads human utterances, so with no session there is
none to read), the transcript axis, and the completion of shell-write evidence into the file
world, which needs a pre-state channel.

The Grok adapter proves no session — that host's PreToolUse payload carries no transcript
path — so on that surface a shell write lands `skipped` with reason `no-observation` rather
than being judged against the file it targets. The tool axis and the path-mention judgment are
unaffected: they read the call's own arguments. A discipline scoped on `command` is unaffected
too, for the same reason.

That skip is the contract, not a gap: a surface that cannot answer says so in a row. The defect
class is the opposite shape — the same call landing `passed` against a subject nothing judged,
which is what this repository shipped for one commit before a review caught it.

## The sixth word nobody's judgment writes

The session surface compares the protected entries' on-disk state against a stored baseline at
each hook call, and an entry that moved with no judgment row explaining it lands one
`unattributed` row (COVENANT-14). It observes results rather than spellings, so an indirect
write — an interpreter, a test runner's child process — is recorded even though no declared
call carried it. It records and never blocks: the write already happened, and the comparison is
fail-open on both ends of the verdict. A rebuild that no judgment explains is a true positive,
not noise.

## The witness valve

A human types the config's token so it stands alone on the message's FIRST line, and the window
holds for `ttlMinutes`. The valve stands AFTER the verdict — only a judgment that actually
blocked can be witnessed open (recorded `witnessed`, never silent), a mid-sentence mention does
not arm it, and an agent can never open the valve for itself.
