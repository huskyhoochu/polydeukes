# `pdks-claude-code`

**English** · [한국어](./adapter-claude-code.ko.md)

<a id="ownership"></a>
## Responsibility

A Rust executable translates host events into input IR and sends them to a separate
`pdks covenant check --enforce block` process. Its consumer contract is the init and hook commands.

<a id="translation"></a>
## Observed evidence

File tools supply disk pre-state and computed post-state; shell calls supply the command. Only
Claude transcript messages marked `origin.kind: human` count as human evidence. SDK-authored user
messages do not establish human provenance.

<a id="consumer-contract"></a>
## Connect

```sh
pdks-claude-code init
```

Install the judge and adapter first, then run from the project root. Register again after paths
change. [Installation](../../how-to/install.md) · [Registration contract](../cli/init.md) ·
[Migration](../../how-to/migrate-to-rust.md)

<a id="limits"></a>
## Limits and recovery

Judges calls delivered by the host, not every write made by child processes. Calls can proceed when
the adapter or judge cannot start, so verify executable paths and actual logs. Make protected edits
in your terminal when a session has no human evidence.
