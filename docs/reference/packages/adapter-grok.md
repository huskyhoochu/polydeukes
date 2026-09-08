# `@polydeukes/adapter-grok`

**English** · [한국어](adapter-grok.ko.md)

> **The Grok install unit** — PreToolUse payloads become the covenant input IR, with the
> file-change evidence the judge reads, and the package installs the session surface into a
> project.
>
> Alpha. Install it next to `polydeukes`, which it names as a `peerDependency`.

<a id="ownership"></a>
## What this package owns

The boundary where Grok's vocabulary is translated away. Agent and tool literals live *here*
by design, so that they never reach the core.

| Unit | What it does |
|---|---|
| `pdks-grok` bin | One subcommand, `pdks-grok init`, which registers the session surface in a project |
| `runHook` | Translates one PreToolUse payload into the input IR and spawns the judge |
| Payload up-translation | A raw PreToolUse payload becomes a `CovenantInput` |
| Virtual post-state | Computes what a file *would* contain after a write or substitution applies, without touching disk |
| File-change evidence | Pairs the disk pre-state with the virtual post-state into union evidence |

`runHook({ repoRoot })` is what the generated hook delegator imports. It builds the IR — the
`tools` roster included, with no `session` or `actor` key — then spawns
`pdks covenant check --enforce block` in `repoRoot` and returns the child's exit code. The
judging happens in that child process; this package carries no judgment logic.

**This package writes no telemetry rows.** A failure before the spawn is sent to `pdks` on
stdin as a plain line, and `pdks` records the fail-closed row, so one call still leaves one
row. It never imports the judge: `polydeukes` and `@polydeukes/core` are both
`peerDependencies`, so the vocabulary and the judge are shared rather than installed a second
time here.

The roster this adapter puts on the IR is Grok-native: `write` and `search_replace` mutate a
file; `run_terminal_command` carries a shell line.

<a id="consumer-contract"></a>
## Where the consumer touches it

Two lines install the Grok session surface, run from the project root:

```sh
npm install --save-dev polydeukes @polydeukes/adapter-grok
npx pdks-grok init
```

`pdks-grok init` resolves `polydeukes` from the project, spawns `pdks init` for the
agent-neutral scaffold, then writes the two Grok artifacts non-destructively. A re-run
reports each existing artifact as skipped and overwrites nothing. The full artifact list is in
[`pdks init`](../cli/init.md#init-grok).

Installing both this adapter and `@polydeukes/adapter-claude-code` in one project can run the
judge twice per call.

- **The generated hook** imports `runHook` from this package. Upgrading the package upgrades
  what runs; the hook file itself never changes.

No configuration namespace of its own.

<a id="limits"></a>
## Declared limits

- **A child process's writes are outside observation.** This surface judges *declared tool
  calls*. A command that spawns a process which then writes files is judged on the command,
  not on what the child did.
- **Evidence exists only where a post-state can be computed.** `write` and `search_replace`
  contribute one. A substitution that matches nothing, or that matches more than once without
  `replace_all`, yields no evidence — the host tool refuses those calls.
- **An evidence-free call falls back to the conservative judgment** — the call's arguments
  are compared for a mention rather than a proven target.
- **There is no transcript channel.** The IR omits `session` and `actor`. Grok's ACP history
  does not supply the human-message evidence the session witness valve needs. For an
  intentional blocked edit, use your own terminal.
- **An unresolvable `polydeukes` leaves no row.** When the umbrella cannot be resolved from the
  project there is no process to spawn and no log path to write to, so the hook exits `2` with
  one line on stderr and the telemetry log gains nothing. Every other pre-spawn failure does
  reach `pdks` and does leave a row.
