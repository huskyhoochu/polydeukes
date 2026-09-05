---
paths:
  - ".claude/hooks/**"
  - ".claude/settings.json"
  - "polydeukes.config.yaml"
  - "lefthook.yml"
  - "packages/covenant/**"
  - "packages/adapter-claude-code/**"
  - "packages/adapter-git/**"
---

# How the two surfaces judge

What each axis actually compares when this repo judges itself. Vocabulary for the terms below
is in `domain-terms.md`; the recovery procedures for a locked session are in `CLAUDE.md`.

All protection-policy data lives in `polydeukes.config.yaml`, which documents each entry's why
inline — read it for the live protected paths and disciplines. Both surfaces fail **closed** on
an unjudgeable run (missing/invalid config, or a judge body that was never built); a
stale-but-present body carries no such signal.

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
  above are what blocks unasked. A declaration that binds the transcript needs a session, so
  the commit surface always lands it `skipped` — a permanent condition of that surface; one
  scoped on `command` observes nothing there. A declaration
  reading the `changes` world needs the whole change set, so the session surface lands it
  `skipped` the same way — one call is its whole observation (`docs-stay-bilingual`).

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
