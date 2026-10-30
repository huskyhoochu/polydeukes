# `@polydeukes/adapter-grok`

**English** · [한국어](adapter-grok.ko.md)

<a id="ownership"></a>
## Ownership

This module translates host events and tool names into the common covenant input IR. All three
adapters expose the same three functions.

| Function             | Input and result                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `prepareHook`        | `PrepareHookSpec` → `PrepareHookOutcome`: `check`, `recorded`, or `unavailable`                     |
| `registerHook`       | `RegisterHookSpec` → `RegisterHookOutcome`: created, updated, unchanged, preserved, and owned paths |
| `renderHookResponse` | `RenderHookResponseSpec` → `RenderHookResponseOutcome`: exit code, stdout, stderr                   |

The common `pdks` runtime reads stdin and sends IR to `covenant check --enforce block` through the
current executable. Stdin EOF and child communication each have a 10-second deadline. Registered
host deadlines are 60 seconds for PreToolUse, 30 for prompt/post events, and 5 for session end.

Untranslatable, truncated, or invalid UTF-8 input reaches `--input-failure`. The shared judge
reports the cause once and writes one `blocked covenant-check` row. Child launch failures, signals,
unexpected statuses, and deadlines also refuse the call; a failure before the judge starts can leave
no telemetry row.

The adapter translates Grok’s `write`, `search_replace`, and `run_terminal_command` tools and
camelCase event fields, accepting snake_case aliases. It supplies file pre/post states and shell
commands; it currently supplies no session history, human provenance, or actor. Receiving lifecycle
events does not establish a history channel. Perform changes requiring the witness valve from your
own terminal.

<a id="consumer-contract"></a>
## Connection and migration

```sh
pdks adapter grok init
```

Run from the project root. The single executable includes all three adapters and requires no
separate Node or npm installation. Registration pins absolute paths to the current executable and
project root. Rerun from the new location after moving either.

The installer updates its own registrations while preserving other handlers and owner settings. It
removes an old generated `.mjs` only when its contents match the original and preserves modified
files. Existing configuration is retained; compare the reported required protected paths with
`protectedPaths`.

Grok responds with stdout JSON containing `decision: allow|deny`; Claude and Codex use empty stdout
and exit 0 or 2. Observe-only lifecycle events exit 0 without a tool-decision JSON document.

<a id="limits"></a>
## Declared limits

The hook judges tool calls delivered by the host. It does not separately observe each file write
performed by a child process. Missing evidence follows the declaration’s supply policy; missing
history is not invented to produce `passed`. If the host has not trusted the hook or has disabled
it, this judgment path does not start.

When Claude and Grok are registered together, the Claude compatibility callback is skipped when
`GROK_WORKSPACE_ROOT` is present; Grok’s own registration owns that judgment. Grok still needs its
own `init`. Global host settings are unchanged.

[Installation reference](../cli/init.md#init-grok)
