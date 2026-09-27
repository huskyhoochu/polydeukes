# `@polydeukes/memory`

**English** · [한국어](memory.ko.md)

> **A searchable index of the project's markdown documents.** The package splits each document
> into sections, records the links between them, and keeps both in a local SQLite database
> that `pdks memory` reads.
>
> Beta and optional. Install it next to `polydeukes`, which names it as an optional peer
> dependency. It needs Node.js 24.15 or later.

<a id="ownership"></a>
## What this package owns

| Unit | What it does |
|---|---|
| `openMemoryDb` | Opens the database file, creating it and its tables when absent |
| `ingestMemory` | Brings the stored documents in line with the files the `include` globs reach, in one write transaction |
| `searchMemory` | Finds sections by literal query words and orders them |
| `showMemory` | Returns one stored document with its sections, or one stored section, with the links leaving and arriving at it; a document also lists the other documents with the same ticket |
| `lintMemory` | Reports unresolved links, documents that share a ticket and link to nothing, and documents without a `type` |
| `describeMemoryIndex` | Returns the time of the last completed ingest and the counts of documents, sections, links, unresolved links, and isolated documents |

The database is derived from the documents. It can be deleted and rebuilt from them at any
time, so a change to the stored shape is absorbed by a rebuild. The judge never imports this
package: `pdks covenant check` gives the same verdict whether it is installed or not.

<a id="install"></a>
## Install

```sh
pnpm add -D @polydeukes/memory
```

The `pdks memory` command in `polydeukes` loads the package when it runs. When the package is
not installed, that command prints an install hint and exits `2`; no other command is affected.

<a id="verbs"></a>
## The verbs

Each verb takes one spec object. The database connection is a `DatabaseSync` from
`node:sqlite`.

```ts
import {
  describeMemoryIndex,
  ingestMemory,
  lintMemory,
  openMemoryDb,
  searchMemory,
  showMemory,
} from '@polydeukes/memory';

const config = { include: ['docs/**/*.md'], weights: { guide: 2 } };
const db = openMemoryDb({ path: '.polydeukes/memory.db' });

ingestMemory({ db, root: process.cwd(), config });
const state = describeMemoryIndex({ db });
const results = searchMemory({ db, query: 'release notes', config });
const shown = showMemory({ db, id: 'docs/guide#install' });
const { violations } = lintMemory({ db });
db.close();
```

| Spec | Fields |
|---|---|
| `OpenMemoryDbSpec` | `path` — the database file |
| `IngestMemorySpec` | `db`, `root` (the directory the globs and ids are relative to), `config`, optional `rebuild` |
| `SearchMemorySpec` | `db`, `query`, optional `limit` (default 20), `now`, and `config` |
| `ShowMemorySpec` | `db`, `id` — a document or section id |
| `LintMemorySpec` | `db` |
| `DescribeMemoryIndexSpec` | `db` |

`MemoryConfig` is the same shape as the config's
[`memory` section](../configuration/index.md#memory).

<a id="rows"></a>
## Documents and sections

`ingestMemory` indexes the `.md` files the globs reach under `root` and skips files named
`index.md` or `log.md`. A document's id is its `root`-relative path without `.md`. Its title is
the frontmatter `title`, else its first H1, else its id. Each H2 heading starts a section whose
id is `<document id>#<anchor>`: the heading's explicit `{#anchor}` when present, else its
lowercased text with punctuation removed and spaces as hyphens. The text before the first H2 is
a section with an empty anchor.

`ingestMemory` skips a document whose text and derived settings are unchanged, unless `rebuild`
is set. On any error the database is left as it was, including the time
`describeMemoryIndex` reports.

<a id="links"></a>
## Links

`ingestMemory` stores each link written in a section body as one row, once per section, form,
and target. Two forms are read, outside fenced code and inline code spans:

- a wikilink `[[target]]`, where the target is everything between the brackets;
- a markdown link `[text](target)` whose path before `#` is empty (the same document) or ends
  in `.md`. Images, links with a scheme (`https:`, `mailto:`), and other files are not links
  here. Frontmatter is not read for links.

After the documents are compared with the files, every stored link is resolved again against
the whole index, so a link resolves as soon as its target is indexed and becomes unresolved
when the target goes, whether or not the document holding it changed.

| Form | Resolves to |
|---|---|
| markdown `path.md#anchor` | the document at `path`, relative to the linking document's directory (the linking document itself when `path` is empty), and the section `<document>#<anchor>` when that section exists |
| wikilink `[[x]]` | the one document whose id ends in the path segment `x`; else the section `x` of the linking document; else the one section anywhere whose anchor is `x` |

A link to a file outside the `include` globs, to `index.md` or `log.md`, or to a path above
`root` is unresolved. An anchor that names no H2 section, such as an H3 heading, resolves to the
document alone.

`lintMemory` reports three kinds of violation, ordered by kind, id, and detail:

| `rule` | Reported for | `id` | `detail` |
|---|---|---|---|
| `unresolved` | a link that resolved to no document | the section it is written in | the link as written |
| `unlinked` | a document with a ticket that another document shares, and no link of its own | the document | the ticket |
| `untyped` | a document whose frontmatter has no non-empty string `type` | the document | empty |

The ticket comes from the `ticket` extraction rules of the config, so `unlinked` is never
reported without them. A document is **isolated** when no resolved link connects it to another
document, in either direction, and no other document has the same ticket.

<a id="results"></a>
## Result types

| Type | Fields |
|---|---|
| `MemorySearchResult` | `id`, `conceptId`, `docTitle`, `sectionTitle`, `status`, `trust`, `stale`, `matchPath` |
| `MemoryDocument` | `id`, `title`, `metadata`, `sections`, `links`, `related` — the ids of the other documents whose ticket is the same string, in id order |
| `MemorySection` | `id`, `ord`, `title`, `body` |
| `MemoryShownSection` | `id`, `conceptId`, `docTitle`, `sectionTitle`, `body`, `ord`, `links` |
| `MemoryLink` | `from` (the section the link is written in), `target` (`[[x]]`, or the markdown link's target), `to` (the section or document it resolved to, or `null`) |
| `MemoryLintResult` | `violations` |
| `MemoryViolation` | `rule`, `id`, `detail` |
| `MemoryIndexState` | `documents`, `ingestedAt` — ISO 8601 in UTC, or `null` before any ingest — `sections`, `links`, `unresolved`, `isolated` |

`links` is `{ out, in }`. For a document, `out` holds the links written in any of its sections
and `in` the links resolved to it; for a section, `out` holds the links written in it and `in`
the links resolved to that section. Both are sorted by `from`, then `target`.

In a search result, `status` is the frontmatter `status` (default `stable`), and `stale` is
true once the frontmatter `stale_after` time has passed. `trust` is `human-reviewed` when a
frontmatter `verified` entry has a `by` value starting with `human:`, `machine-verified` when an
entry has any other `by` value, and `unverified` otherwise. `matchPath` is `and` when every word
matched through the full-text index, `like` when a word matched by substring or id prefix, and
`or` when no section matched every word and the results match any word. Sections of
`deprecated` documents sort last; a configured weight moves a document type earlier.

<a id="limits"></a>
## Declared limits

- **Search is literal.** Words are matched as text, not by meaning or translation.
- **The index is only as recent as the last ingest.** `searchMemory` does not read the files;
  `describeMemoryIndex` reports when they were last compared.
- **Links are read in two forms.** `[[x|label]]` and `[[x#anchor]]` are read as the target
  `x|label` and `x#anchor`, and a markdown path starting with `/` is not resolved.
- **Keeping the database is the user's responsibility.** The package makes no backup of it,
  and a rebuild from the documents restores it.

<a id="see-also"></a>
## See also

- [`pdks memory`](../cli/memory.md)
- [Configuration reference](../configuration/index.md#memory)
- [`polydeukes`](polydeukes.md)
