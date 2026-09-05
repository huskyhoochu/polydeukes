# `pdks docs`

**English** · [한국어](./docs.ko.md)

Read the documentation bundled with the installed package. This command reads local files only;
it does not load the project's configuration, invoke the judge, or query a network service.

<a id="syntax"></a>
## Syntax

```sh
pdks docs
pdks docs <topic> [--lang en|ko]
pdks docs search <query> [--lang en|ko] [--limit N] [--json]
pdks docs show <document-id> [--lang en|ko] [--section <section-id>] [--json]
```

Use `pdks docs --help`, `pdks docs search --help`, or `pdks docs show --help` for syntax.
The default language is English. The five legacy topics remain `install`, `config`, `discipline`,
`covenant`, and `witness`; each is mapped by the same catalog that drives search and retrieval.

<a id="search"></a>
## Search

```sh
pdks docs search 'locale key pairing'
pdks docs search '번역 키 짝 맞춤' --lang ko --limit 3
pdks docs search --worktree --json
```

The query is one argument. Quote multiword queries. A literal identifier such as `--worktree`
is accepted as the first search argument; subsequent unknown flags are errors. Limits are
integers from 1 to 50, defaulting to 5. Search selects sections in the requested language and
uses their titles, document metadata, and Markdown text. Every whitespace-separated query term
must match; this is a deterministic text search, not semantic interpretation or translation.

Each result includes the document and section IDs, a title, a raw-text excerpt, its relative
source path, a score, and a complete `pdks docs show` command. Higher scores come first; ties
use ASCII document ID and section ID order. Scores are ranking values, not confidence measures.

<a id="show"></a>
## Show a document or section

```sh
pdks docs show first-judgment
pdks docs show write-disciplines --lang ko --section locale-key-pairing
```

`show` returns the original Markdown, not a generated answer. A section starts at its explicit
anchor and ends before the next same-level or higher-level heading and its anchor. Child
sections are included. Headings inside fenced code are content, not boundaries. IDs are stable
across English and Korean even when their titles differ.

<a id="json"></a>
## JSON output

Search returns this object shape:

```text
{ schemaVersion, packageVersion, language, query, count, results }
```

`schemaVersion` is `1`; `packageVersion` is the installed package's version. `count` is the number
of returned results after applying the limit. Each result has `documentId`, `sectionId`, `title`,
`excerpt`, `source`, `command`, and numeric `score`. `source` is relative to the docs directory
and includes the section anchor; it is not an absolute path on the build machine.

Show returns:

```text
{ schemaVersion, packageVersion, language, documentId, sectionId, source, markdown }
```

`sectionId` is `null` for a full document. `markdown` contains its unchanged body. JSON output is
one complete object followed by a newline; errors never produce a partial JSON answer.

<a id="failures"></a>
## Exit codes and bundle boundaries

| Condition | Exit | Output |
|---|---|---|
| A successful query | `0` | Answer on stdout |
| No search match | `0` | Explicit empty list; JSON has `count: 0`, `results: []` |
| Invalid arguments or an unknown ID | `2` | Diagnostic on stderr, empty stdout |
| Missing or inconsistent bundle files | `2` | Diagnostic on stderr, empty stdout |

Duplicate flags, missing values, positional extras, unsupported languages, empty queries, and
path-shaped IDs are errors. `show` reads registered IDs, not arbitrary filesystem paths.
Integrity hashes detect changed Markdown, and metadata is checked against the bundle contents.
Reinstall the package if its bundle is incomplete or damaged. Rebuilding from the complete source
checkout is another option for contributors.

Historical posts, the whitepaper, contribution instructions, and compatibility notices are not
bundled or searched. The installed docs describe that package version, not an online latest
version. See [the documentation home](../../README.md) for the full source collection.
