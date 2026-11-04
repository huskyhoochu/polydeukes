# `pdks-codex`

**English** · [한국어](./adapter-codex.ko.md)

<a id="ownership"></a>
## Responsibility

A Rust executable translates host events into input IR and sends them to a separate
`pdks covenant check --enforce block` process. Its consumer contract is the init and hook commands.

<a id="apply-patch"></a>
## Observed evidence

Splits apply_patch into one IR element per file and translates shell calls. PostToolUse records
per-session tool history in `.polydeukes/codex-sessions/`; SessionEnd removes it. Prompts are not
human evidence and cannot open the witness valve.

<a id="consumer"></a>
## Connect

```sh
pdks-codex init
```

Install the judge and adapter first, then run from the project root. Register again after paths
change. [Installation](../../how-to/install.md) · [Registration contract](../cli/init.md) ·
[Migration](../../how-to/migrate-to-rust.md)

<a id="code-mode-coverage"></a>
## Verify host delivery

Approve trust through Codex `/hooks` and check telemetry for actual file and shell calls. An Active
label is not evidence that the host delivered a call.

<a id="limits"></a>
## Limits and recovery

Judges calls delivered by the host, not every write made by child processes. Calls can proceed when
the adapter or judge cannot start, so verify executable paths and actual logs. Make protected edits
in your terminal when a session has no human evidence.
