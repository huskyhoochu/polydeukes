# `pdks memory`

**English** · [한국어](./memory.ko.md)

Index the project's markdown documents into a local SQLite database, then search and show their
sections and check the links between them. The command is part of the `pdks` bin and loads the
optional package `@polydeukes/memory` only when it runs. `pdks covenant check` never loads it,
so a verdict is the same with or without the package.

<a id="syntax"></a>
## Syntax

```sh
pdks memory ingest [--rebuild]
pdks memory search <query…> [--json] [--limit <n>]
pdks memory show <id> [--json]
pdks memory lint [--json]
pdks memory obligations <key> [--json]
pdks memory supersession <id> [--json]
pdks memory stats [--json]
pdks memory usage [--json]
```

Every path is relative to the directory the command runs in. The config is discovered there,
and the index is the file `.polydeukes/memory.db` beneath it. Any other argument list prints
the usage line and exits `2`.

<a id="install"></a>
## Install

```sh
pnpm add -D @polydeukes/memory
```

The package needs Node.js 24.15 or later. When it is not installed, every `pdks memory` command
prints one line and exits `2`:

```text
pdks memory: @polydeukes/memory is not installed — install it with `pnpm add -D @polydeukes/memory`
```

An error raised inside an installed copy, such as a missing file or an index that is not a
SQLite database, is printed as `pdks memory: <message>` instead.

<a id="configuration"></a>
## What gets indexed

`ingest` and `search` read the `memory` section of the config. `memory.include` lists the globs
of the files to index, and the optional `memory.exclude` lists the globs of the files to leave out:

```yaml
memory:
  include:
    - 'docs/**/*.md'
  exclude:
    - 'docs/releases/**'
```

The index holds the `.md` files the `include` globs reach under the current directory, minus the
files an `exclude` glob matches; a glob that matches a directory leaves out every file under
it. No file is skipped by its name alone. Each document becomes one
row, identified by its path without the `.md` extension (`docs/guide`). Each H2 section becomes
one row identified as `<document id>#<anchor>` (`docs/guide#install`); the text before the first
H2 is a row whose anchor is empty. The other keys of the section, `typeMap`, `ticket`, and
`weights`, are in the [configuration reference](../configuration/index.md#memory).

We recommend writing the documents in
[Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md),
markdown with a YAML frontmatter, and a bundle that follows it is indexed as it is. `ingest`
reads these OKF keys: `title` for the document title, `type` for the type that `typeMap` and
`weights` use, `status` so that `deprecated` sections sort last, `stale_after` to mark a result
stale, and `verified` for the trust grade. OKF reserves the file names `index.md` and `log.md`
for a bundle's catalog and log; to keep them out of the index, add `'**/index.md'` and
`'**/log.md'` to `exclude`. The format is not required: a file without frontmatter, or with
frontmatter that does not parse, is indexed, and the keys it lacks take their defaults.

When there is no config file, or the config has no `memory` section, `ingest` and `search`
print the key to declare with an example and exit `2`. No database is created.

<a id="ingest"></a>
## `pdks memory ingest`

```sh
pdks memory ingest
pdks memory ingest --rebuild
```

`ingest` compares the files the globs reach with the stored documents in one write transaction.
It adds new documents, replaces changed ones, deletes those whose file is gone, and records the
time of the run. It prints one line:

```text
indexed 12 documents into .polydeukes/memory.db
```

The count is the number of documents the index holds after the run. `indexed 0 documents`
means the globs reached no file. `--rebuild` replaces every document, including unchanged ones.
If the run fails, the index is left as it was.

<a id="search"></a>
## `pdks memory search`

```sh
pdks memory search release notes
pdks memory search release notes --json
```

The words after `search` are joined with single spaces into one query, and `--json` may appear
anywhere among them. The query is reduced to search terms first:

- A word containing Hangul goes through a Korean morphological analyzer bundled with the package
  (`garu-ko`; it reads no network), which removes its particles and endings. A Korean word with
  neither is kept whole, and question words such as `왜` and `어떻게` drop out:
  `세션이 잠기면 어떻게 복구하나요` becomes `세션` · `잠기` · `복구`.
- Any other word loses surrounding punctuation (a leading `.`, as in `.gitignore`, stays) and a
  trailing possessive (`'s`). Function words
  (`the`, `why`, `does`, …) and one-character words drop out. Case and word endings are kept, so
  `Why did the adapter's typecheck stay green` becomes `adapter` · `typecheck` · `stay` · `green`
  and an identifier such as `ISSUE-63b` stays as written.

A section matches when it contains any of the terms. When this changes none of the words, or
drops all of them, the words are searched as written, and sections that contain more of the words
come first: every section that contains all of them, then the sections that contain fewer, by how
many they contain. Otherwise the terms' scores alone set the order.

A section is ranked by its best passage. A section longer than 2,000 characters is scored in
passages of up to 2,000 characters, cut after a blank line, a line break, or other whitespace, so
no term is split between two passages; a run of more than 2,000 characters with no whitespace
stays one passage. A passage's score is the sum of the scores of the terms it
contains, and the section takes the score of its best passage. A long section is therefore ranked
by the part that matches rather than by its whole length. Results still name sections, and a
section appears once however many of its passages match.

The sections of a document whose status is `deprecated`, or that another document replaces by the
config's [`supersedes` rules](../configuration/index.md#memory), come after every other result,
ordered among themselves in the same way.

The first line of the table form is the time of the last ingest, followed by one line per
result:

```text
# ingested at 2026-01-15T09:30:00.000Z
docs/guide#install⇥and⇥stable⇥unverified⇥Guide › Install
```

Each result line carries five columns separated by a tab, shown as `⇥` above: the section id,
the match path (`and`, `or`, or `like`), the document's status (followed by `, stale` when its
`stale_after` date has passed, then by `, superseded by <id> <id>…` naming the documents that
replace it), the trust grade, and `<document title> › <section title>` (the
document title alone for the text before the first H2). The match path belongs to each result:
`or` when the section lacks one of the terms, `like` when it contains every term and at least
one matched as a word shorter than three characters or as a prefix of the section id, and `and`
otherwise. The JSON form is
`{ "ingestedAt": …, "results": [ … ] }`. A query with no match exits `0` with the header alone,
or with an empty `results` list.

`search` returns at most 20 results. `--limit <n>` sets another ceiling, and like `--json` it may
appear anywhere among the query words; `n` is a positive integer written in digits with no
leading zero, no larger than 9007199254740991. A value
that is not, a missing value, or `--limit` given twice is a usage error with exit `2`, so a
mistyped limit never reads as a search with no results.

`search` reads the index, not the files. A document changed since the time in the header is not
reflected until the next `ingest`.

<a id="show"></a>
## `pdks memory show`

```sh
pdks memory show docs/guide
pdks memory show docs/guide#install --json
```

A document id prints `# <title>` and then each section as `## <section title>` with its body. A
section id prints `# <document title> › <section title>` and that section's body. `--json`
prints the stored document or section as one object, including its `links`. An id that is not
in the index exits `2` with a message on stderr and nothing on stdout. `show`, `lint`, and
`stats` read the index alone and do not need the config.

When links leave or arrive at the document or section, the table form ends with a `## links`
block: one `out` line per link written in it, and one `in` line per link resolved to it.

```text
## links
out  docs/guide#install  setup.md  → unresolved
out  docs/guide#install  [[faq]]  → docs/faq
in  docs/index-page#  → docs/guide
```

A document id also lists the other documents whose ticket is the same string. The ticket is
the one the last ingest stored from the config's `ticket` extraction rules, so a changed rule
takes effect after the next `ingest`. When there is one, the table form ends with a
`## related` block after the links, one document id per line; `--json` carries the list as
`related`. A section id shows no related documents.

```text
## related
docs/design-notes
docs/release-plan
```

<a id="lint"></a>
## `pdks memory lint`

```sh
pdks memory lint
pdks memory lint --json
```

`lint` reports the link violations the index holds. The first line of the table form is the
time of the last ingest, followed by one line per violation as `<rule>  <id>  <detail>`:

```text
# ingested at 2026-01-15T09:30:00.000Z
unresolved  docs/guide#install  setup.md
unlinked  docs/notes/release  REL-12
untyped  docs/scratch
unresolved-supersession  docs/adr/0007  supersedes 0003
unquoted  docs/adr/0009  docs/adr/0004
```

| Rule | Reported for | Detail |
|---|---|---|
| `unresolved` | a link that resolves to no indexed document | the link as written |
| `unlinked` | a document that shares its ticket with another document and has no link of its own | the ticket |
| `untyped` | a document whose frontmatter has no `type`, once any document has one | empty |
| `unresolved-supersession` | a `supersedes` target that names no document, or more than one by ticket | the direction and the target as written |
| `unquoted` | a document that declares, by a `direction: supersedes` rule, that it replaces another, and quotes no sentence of it | the replaced document |

`unlinked` needs the `ticket` rules of the config; without them it is never reported. The two
supersession rules need the `supersedes` rules. For `unquoted`, a quotation is the text of a
line starting with `>` below the first H2, or the text inside `「…」` or `“…”`; the document
passes when one quotation appears in the replaced document's text. Both sides are compared without markdown
formatting: `>` markers, link and image syntax (their visible text stays), wikilink brackets
(the alias, or else the name, stays), the characters `*`, `_`, `` ` ``, and `~`, and repeated
whitespace are removed first. The JSON
form is `{ "ingestedAt": …, "violations": [ … ] }`. `lint` exits `1` when it reports any
violation and `0` when it reports none, so a script can use it as a check. Like `search`, it
reads the index rather than the files: run `pdks memory ingest` first to lint the current text.
How links are read and resolved is in the
[package reference](../packages/memory.md#links).

<a id="obligations"></a>
## `pdks memory obligations`

```sh
pdks memory obligations REL-12
pdks memory obligations REL-12 --json
```

`obligations` lists every obligation stored under one key, with no limit. The obligations come
from the `memory.obligations` rules of the config, which `ingest` applies to each document: a
line rule turns a marker line, such as an unchecked checkbox, into one obligation per key it
names, and a section rule turns a section, such as `Unresolved questions`, into one obligation
keyed by the document's ticket. The rules are in the
[configuration reference](../configuration/index.md#memory). The first line of the table form is
the time of the last ingest, followed by one line per obligation:

```text
# ingested at 2026-01-15T09:30:00.000Z
docs/release-plan#follow-ups⇥- [ ] REL-12 move the changelog step
```

Each line carries the section id and, after a tab, the first non-empty line of the obligation's
text. The lines are ordered by section id, then by position in the section. The JSON form is
`{ "ingestedAt": …, "obligations": [ … ] }`, where each obligation carries `key`, `sectionId`,
`docTitle`, `sectionTitle`, and the full `text`. A key with no obligation exits `0` with the
header alone, or with an empty list.

A rule matches the form of a line, not its meaning: a line that cites a ticket as a precedent is
listed as well, and deciding what each line asks of the key is left to the reader. When the
config declares no `memory.obligations` rule, `obligations` exits `2` with one line naming the
key to declare, because an empty answer would read as "no obligation". Like `search`, it reads
the index rather than the files, and a changed rule takes effect after the next `ingest`.

<a id="supersession"></a>
## `pdks memory supersession`

```sh
pdks memory supersession docs/adr/0004
pdks memory supersession docs/adr/0004 --json
```

`supersession` lists the replacement chain through one document, with no limit: the documents
that replace it, the documents that replace those, and so on, and in the other direction the
documents it replaces and what those replace. It follows each direction on its own, so a
document that another member of the chain also replaces is not listed. The pairs come from the
`memory.supersedes` rules of the config
([configuration reference](../configuration/index.md#memory)). The first line of the table form
is the time of the last ingest, followed by one line per pair:

```text
# ingested at 2026-01-15T09:30:00.000Z
docs/adr/0004⇥docs/adr/0002
docs/adr/0009⇥docs/adr/0004
```

Each line carries the newer document id and, after a tab, the one it replaces, ordered by the
newer id and then the older. The JSON form is `{ "ingestedAt": …, "supersession": [ … ] }`,
where each pair carries `newer` and `older`. A document with no pair exits `0` with the header
alone, or with an empty list; an id that is not a document in the index exits `2` like `show`.
Like `show`, it reads the index alone and does not need the config.

<a id="stats"></a>
## `pdks memory stats`

```sh
pdks memory stats
pdks memory stats --json
```

`stats` prints five lines:

```text
documents  12
sections  48
links  30
unresolved  2
isolated  3/12
```

`links` counts every stored link and `unresolved` those that resolve to no document. A
document is isolated when no resolved link connects it to another document in either
direction and no other document has the same ticket. The JSON form is
`{ "ingestedAt", "documents", "sections", "links", "unresolved", "isolated" }`.

<a id="usage"></a>
## `pdks memory usage`

```sh
pdks memory usage
pdks memory usage --json
```

Every successful `search`, `show`, and `obligations` appends one JSON line to
`.polydeukes/memory-log.jsonl`: the time, the command, its query (the search words, the shown
id, or the obligations key), and the ids it returned in output order, each search result with
its match path. `usage` lays that log against the documents in the index:

```text
# log 2026-09-28T01:00:24.000Z .. 2026-09-30T10:12:00.000Z · 42 entries
hot⇥7⇥docs/roadmap
dead⇥docs/adr/0003-cache
miss⇥2⇥cache eviction policy
```

Columns are separated by a tab, shown as `⇥` above. The header gives the time of the first and
last line and the number of lines that parsed. A `hot` line
is an indexed document and the number of log lines that returned it; a line that returned several
of its sections counts once. A `dead` line is an indexed document no log line returned. A `miss`
line is a search query that returned nothing or only `or`-matched rows, with how many times it
was run. Ids of documents no longer in the index are left out of `hot` and `dead`. The JSON form
is `{ "ingestedAt", "from", "to", "entries", "hot", "dead", "misses" }`.

`usage` reads no config. A line that does not parse as JSON is skipped. When the log does not
exist or no line of it parses, `usage` exits `2`:

```text
pdks memory: no memory log at .polydeukes/memory-log.jsonl — run pdks memory search, show, or obligations first
```

<a id="database"></a>
## The index file

The index is `.polydeukes/memory.db`. It is derived from the documents, and it can always be
rebuilt from them:

```sh
pdks memory ingest --rebuild
```

Keeping, backing up, and versioning the index file is the user's responsibility. Polydeukes
makes no copy of it. The `.polydeukes/` line that `pdks init` adds to `.gitignore` covers it,
so it stays out of commits unless you change that line. The documents are the record: deleting
the file and running `pdks memory ingest` again restores the index. An index written by an
earlier version of `@polydeukes/memory` is brought up to date by the next `pdks memory ingest`;
run it after upgrading, before searching.

`search`, `show`, `lint`, `obligations`, `stats`, and `usage` never create the file. When it does not
exist, or no ingest has completed in it, they exit `2`:

```text
pdks memory: no index at .polydeukes/memory.db — run `pdks memory ingest` first
```

<a id="log"></a>
## The query log

The query log is `.polydeukes/memory-log.jsonl`. Unlike the index, it cannot be rebuilt from the
documents: `ingest --rebuild` and deleting the index leave it in place, and ids stay the same
across a rebuild, so `usage` counts continue. Keeping or removing it is the user's
responsibility, and the same `.polydeukes/` line in `.gitignore` covers it.

<a id="exit-codes"></a>
## Exit codes

| Condition | Exit | Output |
|---|---|---|
| A successful command, including a search with no match and a `lint` with no violation | `0` | Answer on stdout |
| `lint` reports a violation | `1` | The report on stdout |
| An argument list outside the syntax above | `2` | Usage on stderr, empty stdout |
| No config, or no `memory` section (`ingest`, `search`, `obligations`) | `2` | The key to declare on stderr |
| No `memory.obligations` rule (`obligations`) | `2` | The key to declare on stderr |
| No index file, or no completed ingest (`search`, `show`, `lint`, `obligations`, `supersession`, `stats`, `usage`) | `2` | The ingest hint on stderr |
| No query log, or no line of it parses (`usage`) | `2` | The log hint on stderr, empty stdout |
| An id not in the index (`show`, `supersession`) | `2` | Message on stderr, empty stdout |
| `@polydeukes/memory` not installed | `2` | The install hint on stderr |
| Any other error | `2` | `pdks memory: <message>` on stderr, empty stdout |

<a id="see-also"></a>
## See also

- [`@polydeukes/memory`](../packages/memory.md)
- [Configuration reference](../configuration/index.md#memory)
- [`polydeukes`](../packages/polydeukes.md)
