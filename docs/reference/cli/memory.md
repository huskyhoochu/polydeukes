# `pdks memory`

**English** · [한국어](./memory.ko.md)

Index the project's markdown documents into a local SQLite database, then search and show
their sections. The command is part of the `pdks` bin and loads the optional package
`@polydeukes/memory` only when it runs. `pdks covenant check` never loads it, so a verdict is
the same with or without the package.

<a id="syntax"></a>
## Syntax

```sh
pdks memory ingest [--rebuild]
pdks memory search <query…> [--json]
pdks memory show <id> [--json]
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
of the files to index:

```yaml
memory:
  include:
    - 'docs/**/*.md'
```

The index holds the `.md` files those globs reach under the current directory. Files named
`index.md` or `log.md` are skipped. Each document becomes one row, identified by its path
without the `.md` extension (`docs/guide`). Each H2 section becomes one row identified as
`<document id>#<anchor>` (`docs/guide#install`); the text before the first H2 is a row whose
anchor is empty. The other keys of the section, `typeMap`, `ticket`, and `weights`, are in the
[configuration reference](../configuration/index.md#memory).

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
anywhere among them. A section matches when it contains every word; when no section does, a
section that contains any word matches. The first line of the table form is the time of the
last ingest, followed by one line per result:

```text
# ingested at 2026-01-15T09:30:00.000Z
docs/guide#install  and  stable  unverified  Guide › Install
```

Each result line carries the section id, the match path (`and`, `or`, or `like`), the
document's status (followed by `, stale` when its `stale_after` date has passed), the trust
grade, and `<document title> › <section title>` (the document title alone for the text before
the first H2). The JSON form is
`{ "ingestedAt": …, "results": [ … ] }`. A query with no match exits `0` with the header alone,
or with an empty `results` list.

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
prints the stored document or section as one object. An id that is not in the index exits `2`
with a message on stderr and nothing on stdout. `show` reads the index alone and does not need
the config.

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
the file and running `pdks memory ingest` again restores the index.

`search` and `show` never create the file. When it does not exist, or no ingest has completed
in it, they exit `2`:

```text
pdks memory: no index at .polydeukes/memory.db — run `pdks memory ingest` first
```

<a id="exit-codes"></a>
## Exit codes

| Condition | Exit | Output |
|---|---|---|
| A successful command, including a search with no match | `0` | Answer on stdout |
| An argument list outside the syntax above | `2` | Usage on stderr, empty stdout |
| No config, or no `memory` section (`ingest`, `search`) | `2` | The key to declare on stderr |
| No index file, or no completed ingest (`search`, `show`) | `2` | The ingest hint on stderr |
| An id not in the index (`show`) | `2` | Message on stderr, empty stdout |
| `@polydeukes/memory` not installed | `2` | The install hint on stderr |
| Any other error | `2` | `pdks memory: <message>` on stderr, empty stdout |

<a id="see-also"></a>
## See also

- [`@polydeukes/memory`](../packages/memory.md)
- [Configuration reference](../configuration/index.md#memory)
- [`polydeukes`](../packages/polydeukes.md)
