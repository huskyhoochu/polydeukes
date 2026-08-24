# Troubleshooting Polydeukes

**English** · [한국어](./troubleshooting.ko.md)

> Alpha. Nine states cover what ships today — five ways a fail-closed system refuses to
> proceed, and four things worth knowing when a judgment surprises you. Each entry is
> symptom → cause → recovery.

This is the guide layer for recovery: the fail-closed states, reading verdicts, and the
witness valve.

The one principle behind half of this page: **a gate that cannot judge blocks rather than
guesses.** A missing config, an ambiguous config, an invalid config, an installer that
cannot prove resolution, and a judge that cannot be loaded all fail closed, because a dead
gate that waves things through is the cheapest bypass of all. The recovery is never to
disable the gate — it is to give it back what it needs to judge. And run that recovery
**from your own terminal**: inside a session the repair commands are judged by the very
gate they repair, and while no config is loaded there is no witness valve to open.

## Every call is blocked and there is no config

**Symptom.** On the session surface, every editing tool call and shell command exits 2;
on the commit surface, every `pdks covenant check` run does. The error says no Polydeukes
config was found and names the three candidate filenames.

**Cause.** The surface is wired but config discovery found nothing at the project root.
Discovery looks for exactly these, in this order: `polydeukes.config.yaml`,
`polydeukes.config.yml`, `polydeukes.config.json`. A missing config never silently loads
defaults — silent defaults would mean silently unprotected.

**Recovery.** Restore the file from git. On the session path,
`pnpm exec pdks init claude-code` recreates the missing artifacts; on the commit path the
config is hand-written — the [install guide](./installation.md)'s commit-surface section
has a starting point.

## More than one config file

**Symptom.** Every call exits 2 with an error naming two (or three) config files at once.

**Cause.** Two spellings coexist — say a `polydeukes.config.yaml` created next to a
project's existing `.yml`. Ambiguity never picks a winner.

**Recovery.** Keep exactly one file and delete the others. If both have content, merge by
hand first — the loader will not choose for you.

## The config is invalid

**Symptom.** Every call exits 2 with an error naming the offending file — and, for schema
violations, the exact key.

**Cause.** One of: a YAML parse error; a custom YAML tag (rejected even though the parser
cannot execute it — config data stays uncomputable by contract); an unknown key (a typo
like `protectedPath:` is rejected with the full field path — with one open ground: an
adapter namespace's *name* is not validated, so `adapters.gti:` for `adapters.git:` loads
clean and its entries are simply never read; that one spelling you check yourself); or an
empty `languages` block, the schema's one required entry.

**Recovery.** Fix the named key in the named file. The error is specific on purpose — no
rewrite-and-hope needed.

## `pdks init claude-code` refuses to run

**Symptom.** The installer prints an install command and exits 2 without creating anything.

**Cause.** Preflight: before writing any file, the installer proves the `polydeukes`
package resolves from the target project root. A hook generated without that would block
every call through its own fail-closed catch — an uneditable tree. The usual trigger is
running via a one-off `npx` without installing, or running in the wrong directory (it
installs where it is invoked).

**Recovery.** `pnpm add -D polydeukes` in the project you meant, then re-run from that
root. Zero files were written, so there is no partial state to clean up.

## The judge cannot be loaded

**Symptom.** Every call exits 2 with `covenant hook failed closed: Cannot find package
'polydeukes'` — or an error naming a judge-body file that does not exist.

**Cause.** The hook is wired but the package it delegates to is gone or incomplete: the
dependency was removed, the tree is a fresh clone that was never installed, or (in a
source clone of this repository) the judge's build output is missing. The installer's
preflight prevents *wiring* a project into this state, but nothing prevents a wired
project from entering it later.

**Recovery.** From your own terminal, reinstall the dependency (`pnpm install`, or
`pnpm add -D polydeukes` if it was removed). In a source clone, run the build. The hook
file itself needs no repair — it is a delegator, and it recovers the moment the package
resolves again.

## Reading a verdict

**Symptom.** Something was blocked (or passed) and you want to know what the record says.

**Cause.** Not a failure — this is the measurement working. Every judgment appends exactly
one record to the telemetry log (`.polydeukes/roi.log` by default, `telemetry.logPath` to
move it).

**Recovery.** Read the last lines and the six-word vocabulary:

| Word | Means |
|---|---|
| `passed` | Judged, upheld the covenant. |
| `blocked` | Judged, broke it. The call did not run. |
| `witnessed` | A blocked verdict a human opened in person. Never silent. |
| `advised` | Commit surface at `advise` level: a break recorded without stopping the commit. |
| `skipped` | A registration matched but could not judge — **the recorded absence of a judgment, not a pass.** |
| `unattributed` | A protected entry changed on disk and no judgment explains it — **an observation, not a verdict.** Nothing was blocked; the write already happened. |

An `unattributed` row names the entry, not the file inside it. Rebuilding a protected `dist`
without a judged call producing one is expected — it says a write reached that entry outside
the session's view, which is exactly what the row is for.

## Opening a blocked call — the witness

**Symptom.** A call you and your agent agree should proceed was blocked, and you want it
through without editing the policy.

**Cause.** The valve exists for exactly this, and it sits *after* the verdict — only a
judgment that actually blocked can be witnessed open.

**Recovery.** Type the token from your config's `witness:` block so it stands **alone on
the first line** of a conversation message. The window holds for `ttlMinutes`, then
blocking resumes on its own. Three things that do not work, by design: quoting or
mentioning the token mid-sentence (invocation is first-line-standalone only); witnessing a
call that was never blocked (the valve is consulted only after a block); and the agent
typing the token for itself (only human-authored messages count — the defence is
provenance, not secrecy). Every allowance lands as one `witnessed` row.

## A blocked commit

**Symptom.** `git commit` stops at a prompt asking a human to witness a staged protected
change — or, from an agent, the commit simply fails with exit 2.

**Cause.** The commit surface at the default `block` level judges the staged diff, and its
valve is a TTY prompt. An agent-spawned commit has no TTY, so for it the valve is not even
assembled — a terminal-holding human is the pass condition, not a workaround.

**Recovery.** Run the commit from your own terminal and answer the prompt with the full
token — one answer covers that whole commit. If you want the commit surface to measure
without stopping, set `adapters.git.enforce: advise`: verdicts are then recorded as
`advised` and the commit proceeds with one advisory line on stderr. At either level a run
that *cannot judge* (missing or invalid config, an unresolvable judge) still exits 2 —
`advise` relaxes the verdict, never the gate's integrity.

## `skipped` rows on the commit surface

**Symptom.** A `requirePrecedent` discipline that judges normally in sessions always lands
as `skipped` on commits.

**Cause.** Context-family disciplines judge *session history* — was the required step
actually executed before this change. A commit has no session to read, so the entry
assembles as a skip registration: routing intact, no judge body. When its scope matches a
staged change it records `skipped` with the entry's id and proceeds.

**Recovery.** None needed — this is a declared condition of the surface, not a defect. The
row is the point: a gate that did nothing says so in the data. `pdks explain` shows the
same fact before any commit: every context entry appears under the commit surface as a
`skip` line carrying the reason. A context-family entry is
really a session-surface tool — on a project that wires only the commit surface, such an
entry only ever buys telemetry, so declare it where an AI partner's session exists to be
judged. The row appears only when the entry's scope actually matched, so an unrelated
commit records nothing.
