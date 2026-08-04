# `@polydeukes/adapter-claude-code`

**English** · [한국어](./adapter-claude-code.ko.md)

> **The session surface's translator** — PreToolUse payloads become the covenant input IR,
> with the file-change evidence and the transcript channel the judge reads.
>
> Alpha. A transitive dependency of the umbrella: you do not install it and you do not
> import it. The session surface reaches it through
> [`polydeukes/claude-code`](./polydeukes.md#subpaths).

## What this package owns

The boundary where Claude Code's vocabulary is translated away. Agent and tool literals
live *here* by design, so that they never reach the core — which is what makes the core's
agent-neutrality a claim a test can check rather than a slogan.

| Unit | What it does |
|---|---|
| Payload up-translation | A raw PreToolUse payload becomes a `CovenantInput` |
| Virtual post-state | Computes what a file *would* contain after an edit applies, without touching disk |
| File-change evidence | Pairs the disk pre-state with the virtual post-state into union evidence |
| Transcript provider | Turns a session JSONL file into a `CanonicalTranscript` |
| Precedent evaluator | This adapter's own evidence vocabulary for the context family |
| Telemetry wiring | Drives the full funnel so exactly one row lands per call |

This package never imports the covenant package. The dispatch seam is *injected* by the
umbrella, which keeps dependencies one-way, through the core alone.

## Payload translation and the three axes

**Three axes reach the judge**, and they differ in what evidence they can carry.

| Axis | Carries | Consequence |
|---|---|---|
| Tool | A proven `fileChange` — the mutation target computed before the tool runs | Only the proven target is judged. A protected path inside an edit's *content* is a mention and passes |
| Shell | A command line whose target is often not computable before execution | Computable writes are judged like an edit; the rest is recorded rather than guessed |
| Transcript | The session's own record | Judged by whole-path equality, never as a protected ancestor |

Translation is fail-closed at every step. A `Task` call carrying a subagent type maps to a
spawn; a payload that cannot be classified is a translation *failure* that logs one
`blocked` record and exits `2`, rather than degrading into a guess.

**Evidence is computed, never read back.** The virtual post-state applies `Edit`, `Write`,
and `MultiEdit` in memory — sequential multi-edit application included — so a content-aware
discipline judges the *proposed* result rather than the file as it currently is. An
unresolvable post-state yields no evidence at all, because the real tool would reject the
same edit, and evidence is never fabricated for a non-mutating call.

**The transcript admits only positively-identified human messages.** That is what makes the
witness valve human-only: an AI cannot synthesize its own witness. A read failure answers
`undefined` rather than an empty transcript — an empty session has said nothing yet and is
judged, an unreadable one is no evidence channel at all and is skipped. Either way the
valve turns off, never open.

**The precedent evaluator judges two keys.** `subagent` is exact spawn-kind equality, since
a kind is a value rather than a pattern; `tool` matches observed tool names as a regular
expression. Any key outside this vocabulary returns `undefined` — the handshake that tells
the compiler the evidence is unjudgeable, so the entry skips instead of judging on a guess.

## Where the consumer touches it

- **The generated hook**, which loads this adapter through the umbrella's `claude-code`
  subpath. Upgrading the package upgrades what runs; the hook file itself never changes.
- **`requirePrecedent` entries** using the `subagent` or `tool` evidence keys.

No import, and no configuration namespace of its own.

## Declared limits

- **A child process's writes are outside observation.** This surface judges *declared tool
  calls*. A command that spawns a process which then writes files — a test runner, a build
  — is judged on the command, not on what the child did. The commit surface is the second
  observation that covers the same ground for tracked files.
- **A tool that produces no post-state carries no evidence.** `NotebookEdit` is the shipped
  instance: it takes part in judgment through its arguments, not through `fileChange`.
- **An evidence-free call falls back to the conservative judgment** — the call's arguments
  are compared for a mention rather than a proven target.
- **Out-of-repository ancestors stay out of scope.** A path above the project root is not
  observed here; the agent's own deny policy owns that ground.
