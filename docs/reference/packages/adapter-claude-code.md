# `@polydeukes/adapter-claude-code`

**English** · [한국어](adapter-claude-code.ko.md)

> **The Claude Code install unit** — PreToolUse payloads become the covenant input IR,
> with the file-change evidence and the transcript channel the judge reads, and the
> package installs the session surface into a project.
>
> Alpha. Install it next to `polydeukes`, which it names as a `peerDependency`.

<a id="ownership"></a>
## What this package owns

The boundary where Claude Code's vocabulary is translated away. Agent and tool literals
live *here* by design, so that they never reach the core — which is what makes the core's
agent-neutrality a claim a test can check rather than a slogan.

| Unit | What it does |
|---|---|
| `pdks-claude-code` bin | One subcommand, `pdks-claude-code init`, which registers the session surface in a project |
| `runHook` | Translates one PreToolUse payload into the input IR and spawns the judge |
| Payload up-translation | A raw PreToolUse payload becomes a `CovenantInput` |
| Virtual post-state | Computes what a file *would* contain after an edit applies, without touching disk |
| File-change evidence | Pairs the disk pre-state with the virtual post-state into union evidence |
| Transcript provider | Turns a session JSONL file into a `CanonicalTranscript` |

`runHook({ repoRoot })` is what the generated hook delegator imports. It builds the IR — the
`tools` and `session` evidence included — then spawns `pdks covenant check --enforce block` in
`repoRoot` and returns the child's exit code. The judging happens in that child process; this
package carries no judgment logic.

**This package writes no telemetry rows.** A failure before the spawn is sent to `pdks` on
stdin as a plain line, and `pdks` records the fail-closed row, so one call still leaves one
row. It never imports the judge: `polydeukes` and `@polydeukes/core` are both
`peerDependencies`, so the vocabulary and the judge are shared rather than installed a second
time here.

<a id="translation"></a>
## Payload translation and the three axes

**Three axes reach the judge**, and they differ in what evidence they can carry.

| Axis | Carries | Consequence |
|---|---|---|
| Tool | A proven `fileChange` — the mutation target computed before the tool runs | Only the proven target is judged. A protected path inside an edit's *content* is a mention and passes |
| Shell | A command line whose target is often not computable before execution | Computable writes are judged like an edit; the rest is recorded rather than guessed |
| Transcript | The session's own record | Judged by whole-path equality, never as a protected ancestor |

Translation is fail-closed at every step. A `Task` call carrying a subagent type maps to a
spawn; a payload that cannot be classified is a translation *failure* that logs one
`blocked` record and exits `2`, rather than degrading into a guess. The envelope's top-level
`agent_type` becomes the IR's `actor` — `{ agentType }` inside a subagent, `{}` otherwise;
`tool_input` is never read for it, since that is the agent's own text.

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

**Precedent is a declaration, not an adapter evaluator.** This adapter supplies the
transcript snapshot. The declaration engine extracts succeeded `toolUses` and matches them;
there is no separate precedent evaluator in this package. The grammar is in
[Configuration — disciplines](../configuration/index.md#disciplines).

<a id="consumer-contract"></a>
## Where the consumer touches it

Two lines install the Claude Code session surface, run from the project root:

```sh
npm install --save-dev polydeukes @polydeukes/adapter-claude-code
npx pdks-claude-code init
```

`pdks-claude-code init` resolves `polydeukes` from the project, spawns `pdks init` for the
agent-neutral scaffold, then writes the four Claude Code artifacts non-destructively. A re-run
reports each existing artifact as skipped and overwrites nothing. The full artifact list is in
[`pdks init`](../cli/init.md#init-claude-code).

- **The generated hook** imports `runHook` from this package. Upgrading the package upgrades
  what runs; the hook file itself never changes.

No configuration namespace of its own.

<a id="limits"></a>
## Declared limits

- **A child process's writes are outside observation.** This surface judges *declared tool
  calls*. A command that spawns a process which then writes files — a test runner, a build
  — is judged on the command, not on what the child did. The commit surface is the second
  observation that covers the same ground for tracked files.
- **Evidence exists only where a post-state can be computed.** All four mutating tools
  contribute one, notebooks included — a `NotebookEdit` yields cell-level `modify` evidence.
  What yields nothing is a payload this adapter cannot resolve: an unreadable or unparseable
  notebook, a cell it cannot name, an edit mode it does not know.
- **An evidence-free call falls back to the conservative judgment** — the call's arguments
  are compared for a mention rather than a proven target.
- **Out-of-repository ancestors stay out of scope.** A path above the project root is not
  observed here; the agent's own deny policy owns that ground.
- **An unresolvable `polydeukes` leaves no row.** When the umbrella cannot be resolved from the
  project there is no process to spawn and no log path to write to, so the hook exits `2` with
  one line on stderr and the telemetry log gains nothing. Every other pre-spawn failure does
  reach `pdks` and does leave a row.
- **A Grok tree that reuses this delegator sends Grok tool names here.** `pdks init grok` points
  the Grok registration at an existing Claude delegator rather than creating a second one, so
  Grok payloads arrive at this adapter. Their tool names are not Claude's, so the meta-covenants
  do not route them until a Grok adapter ships.
