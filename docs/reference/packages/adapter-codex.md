# `@polydeukes/adapter-codex`

**English** · [한국어](adapter-codex.ko.md)

> **The Codex install unit** — `PreToolUse` payloads become the covenant input IR, with one
> element per file the patch touches, and the package installs the session surface into a
> project.
>
> Beta. Install it next to `polydeukes`, which it names as a `peerDependency`.

<a id="ownership"></a>
## What this package owns

The boundary where Codex's vocabulary is translated away. Agent and tool literals live *here*
by design, so that they never reach the core.

| Unit | What it does |
|---|---|
| `pdks-codex` bin | One subcommand, `pdks-codex init`, which registers the session surface in a project |
| `runHook` | Translates one `PreToolUse` payload into the input IR and spawns the judge |
| Payload validation | Demands every key the host's generated schema marks required, in the one spelling that host sends |
| Patch parsing | Turns the raw patch text of an `apply_patch` call into one file change per file it touches |
| Path rebasing | Resolves a patch path against the call's working directory and carries it relative to the project root |

`runHook({ repoRoot })` is what the generated hook delegator imports. It builds the IR — the
`tools` roster included, with no `session` or `actor` key — then spawns
`pdks covenant check --enforce block` in `repoRoot` and returns the child's exit code. The
judging happens in that child process; this package carries no judgment logic.

**This package writes no telemetry rows.** A failure before the spawn is sent to `pdks` on
stdin, so the row that call earns is written by the one writer.

<a id="apply-patch"></a>
## Why this adapter parses text where its siblings read arguments

Codex normalises every file edit that reaches the hook into a single tool name, `apply_patch`,
and puts the patch itself in `tool_input.command` — the same field a shell call uses for its
command line. There is no path argument to read. `Edit` and `Write` exist as matcher aliases
you may write in `.codex/hooks.json`, but the payload always names the tool `apply_patch`, so
a roster or a branch keyed on the aliases matches nothing that ever arrives.

One patch can create, update, delete and rename files in one call. The adapter carries each as
its own element of one IR, on one spawn: every file is judged, and any one of them blocking
blocks the whole call. A rename contributes two elements, because it changes the path it
leaves as well as the one it takes.

<a id="consumer"></a>
## Where the consumer touches it

Two lines install the Codex session surface, run from the project root:

```sh
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-codex
npx pdks-codex init
```

`pdks-codex init` resolves `polydeukes` from the project, spawns `pdks init` for the
agent-neutral scaffold, then writes the delegator and merges its entry into
`.codex/hooks.json` non-destructively — other events, other matchers and keys it does not know
are left alone. A re-run reports each existing artifact as skipped and overwrites nothing. The
full artifact list is in [`pdks init`](../cli/init.md#init-codex).

**Writing the registration is not the end of the install.** Codex records trust against the
hash of a hook's definition, so the generated hook is listed for review and skipped until you
approve it with `/hooks`. This is why `init` writes a byte-identical command string on every
run: a changed one needs approving again, and until someone does, nothing is judged.

Installing this adapter beside `@polydeukes/adapter-claude-code` or
`@polydeukes/adapter-grok` in one project can run the judge twice per call.

- **The generated hook** imports `runHook` from this package. Upgrading the package upgrades
  what runs; the hook file itself never changes.

No configuration namespace of its own. The scaffold `pdks init` writes protects `.codex/hooks`
by default, so the registration this installer creates is covered by the config it creates.

<a id="limits"></a>
## Declared limits

The first four are the host's own, and no adapter can narrow them. The first is measured
rather than documented; the next three are stated in the host's hook documentation.

- **A Code Mode `exec` dispatch is not observed.** In codex-cli 0.154 the host does not emit
  `PreToolUse` for a Code Mode `exec` call, nor for the `tools.apply_patch` and
  `tools.exec_command` calls nested in its JavaScript
  ([openai/codex#23411](https://github.com/openai/codex/issues/23411),
  [#38850](https://github.com/openai/codex/issues/38850)). A hook that `/hooks` lists as
  Active still sees nothing on that surface, and a protected path edited there leaves no
  telemetry row. `pdks-codex init` prints this as a `note:` line.
- **The roster, not the matcher, decides what is judged.** The adapter translates
  `apply_patch` and `Bash`; every other name — a Code Mode name, an MCP tool, `write_stdin` —
  is refused with exit 2 and a `blocked` runner row before the judge runs. Widening the
  matcher in `.codex/hooks.json` to such a name blocks every call under it rather than
  judging it, and the edit changes the trust hash, so the hook is skipped until `/hooks`
  approves it again.
- **`write_stdin` is not judged again.** It delivers input to a unified-exec session that
  already passed `PreToolUse`. A shell left open for input is judged once, at the call that
  opened it.
- **Hosted tools do not take this path.** Web search and its kind do not run through the local
  function-tool hooks, so they reach no covenant.
- **The host calls its tool hooks a guardrail rather than a complete enforcement boundary.**
  Some specialized tool paths can opt out of the default hook path.
- **There is no transcript channel.** The IR omits `session` and `actor`. The payload names a
  transcript path, but the host documents that format as unstable, so no judgment reads it —
  which leaves the session witness valve without the human-message evidence it needs. For an
  intentional blocked edit, use your own terminal.
- **A patch resolving outside the project is refused rather than judged.** Such a path has no
  project-relative form, and an element carrying one would land in no scope — judged over
  nothing, and passed.
- **An unresolvable `polydeukes` leaves no row.** When the umbrella cannot be resolved from the
  project there is no process to spawn and no log path to write to, so the hook exits `2` with
  one line on stderr and the telemetry log gains nothing. Every other pre-spawn failure does
  reach `pdks` and does leave a row.
