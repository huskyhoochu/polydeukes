# `pdks-memory`

**English** · [한국어](./memory.ko.md)

<a id="consumer-contract"></a>
## Executable contract

Memory is a separate Rust executable that computes answers from current Markdown. `pdks memory` runs
`pdks-memory` on PATH. Commands are search, show, obligations, supersession, lint, stats, and usage.
Start with the [walkthrough](../../how-to/use-memory.md), then use the
[CLI
reference](../cli/memory.md).

<a id="ownership"></a>
## Data and responsibility

memory.include and exclude select documents. Bodies and links are read from files on every call;
query history lives in `.polydeukes/memory-log.jsonl`. The embedded Korean analyzer and
English–Korean dictionary work offline. The judge does not invoke memory.

<a id="limits"></a>
## Limits

Ranking does not establish truth: inspect the source and verification metadata. Query history cannot
be reconstructed from documents. [Configuration](../configuration/index.md#memory) changes take
effect on the next invocation.
