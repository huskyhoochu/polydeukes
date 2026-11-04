# `pdks memory`

**English** · [한국어](./memory.ko.md)

The project memory extension computes answers from Markdown on every invocation.

<a id="syntax"></a>
## Syntax

```sh
pdks memory search <query…> [--json] [--limit <n>]
pdks memory show <id> [--json]
pdks memory lint [--json]
pdks memory obligations <key> [--json]
pdks memory supersession <id> [--json]
pdks memory stats [--json]
pdks memory usage [--json]
```

Run from the project root. Every command reads the current configuration and Markdown corpus.
`pdks-memory` accepts the same arguments directly.

<a id="install"></a>
## Install

Install the separate `pdks-memory` executable and put it on PATH. See
[installation](../../how-to/install.md) for all four package managers. If dispatch cannot find the
extension, install it before retrying.

<a id="configuration"></a>
## Document collection

`memory.include` selects Markdown files; `memory.exclude` removes matches. Paths are relative to the
command's current directory. A document ID is its path without `.md`; an H2 section ID adds
`#<anchor>`. The preamble has an empty anchor. Frontmatter supplies titles, types, status, and trust
metadata; ordinary Markdown also works. See [configuration](../configuration/index.md#memory).

```yaml
memory:
  include: ["notes/**/*.md"]
  exclude: ["notes/archive/**"]
```

Each query rebuilds its view from these files. No index file or preparation command is required.

<a id="search"></a>
## Search

```sh
pdks memory search release notes --limit 5
pdks memory search release notes --json
```

Search returns sections, ranked by their best passage with configured type weights. Korean words are
normalized with the embedded analyzer; English query terms can expand through Korean glosses and the
embedded dictionary. Superseded and deprecated documents are demoted. A score is a ranking signal,
not a statement that a document is correct.

Text output has five tab-separated columns: section ID, match path, status, trust, and title. `and`
means all query terms matched text; `or` means only some did; `like` means at least one term matched
only an ID prefix. JSON is `{ "results": [...] }`. There is no ingest timestamp. No match produces
no text rows or an empty JSON results list, with exit 0.

The default limit is 20. `--limit` accepts decimal integers from 1 to 9007199254740991 without a
leading zero. Missing or duplicate limits are usage errors.

<a id="show"></a>
## Show

```sh
pdks memory show notes/storage
pdks memory show notes/storage#local-files --json
```

Show returns the document or section body and its incoming/outgoing links. A document also includes
related documents sharing its ticket. Unknown IDs exit 2; use the exact ID returned by search.

<a id="lint"></a>
## Lint

`pdks memory lint` reports unresolved links, unlinked same-ticket documents, untyped documents when
the collection has types, unresolved supersession targets, and replacement declarations that quote
no replaced content. It exits 1 when violations exist. JSON is `{ "violations": [...] }`. Each item
identifies the `rule`, document/section ID, and detail. Repair the source Markdown and rerun.

<a id="obligations"></a>
## Obligations

`pdks memory obligations TASK-12` returns items extracted by `memory.obligations` entries. Text rows
contain a section ID and the first nonempty line; JSON is `{ "obligations": [...] }` with key,
sectionId, docTitle, sectionTitle, and full text. No matching items returns exit 0; no configured
extraction configuration is an error, exit 2. Extraction matches syntax, so read each item before
deciding what it requires.

<a id="supersession"></a>
## Supersession

`pdks memory supersession notes/storage` follows the replacement chain in both directions. Text rows
carry newer and older document IDs. JSON is `{ "supersession": [...] }`, with `newer` and `older`
pairs. Unknown document IDs exit 2; a known document with no pairs returns an empty result.

<a id="stats"></a>
## Stats

`pdks memory stats` reports documents, sections, links, unresolved links, and isolated documents.
JSON contains those five fields: `documents`, `sections`, `links`, `unresolved`, `isolated`. A
document is isolated when it has neither a resolved connection to another document nor a same-ticket
peer. Counts describe the current configured corpus.

<a id="usage"></a>
## Usage

`pdks memory usage` compares the local query log with the current corpus. `hot` rows count log
entries that returned a document; `dead` lists documents never returned; `miss` counts searches with
no results or only `or` matches. These are candidates for inspection, not proof that search failed.
JSON has `from`, `to`, `entries`, `hot`, `dead`, and `misses`. A missing or unreadable usable log
exits 2. Invalid JSON log lines are skipped.

<a id="log"></a>
## Query log

Successful search, show, and obligations calls append to `.polydeukes/memory-log.jsonl`. This
history is local and cannot be reconstructed from Markdown. `pdks init` ignores `.polydeukes/` in
Git; arrange a backup if the usage history matters to you.

<a id="exit-codes"></a>
## Exit codes

| Condition                                                                                                   | Exit |
| ----------------------------------------------------------------------------------------------------------- | ---- |
| Successful query, including an empty search                                                                 | 0    |
| Lint found violations                                                                                       | 1    |
| Invalid arguments, missing configuration, unknown ID, missing extraction configuration/log, or read failure | 2    |

Answers go to stdout; errors go to stderr. Extension-dispatch failures are reported by `pdks` before
the memory process starts. Read that diagnostic separately from an empty search result.

<a id="see-also"></a>
## See also

[Memory walkthrough](../../how-to/use-memory.md) · [Configuration](../configuration/index.md#memory)
· [Package contract](../packages/memory.md)
