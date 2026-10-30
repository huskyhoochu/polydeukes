---
paths:
  - "packages/memory/**"
  - "packages/polydeukes/src/memory-command.ts"
---

# The memory package

`@polydeukes/memory` keeps a derived index at `.polydeukes/memory.db` that can always be rebuilt
from the documents; any schema change is absorbed by rebuilding. It has no core dependency, so it
has no `vitest.config.ts` alias; `engines.node` is `>=26`, where `node:sqlite` is stable. The
umbrella loads it only in `pdks memory`, dynamically; without it that command prints an install hint
and exits 2.

## Rows and the index

- `parseDocument` splits a markdown text into a preamble row and one row per H2, keyed
  `<document id>#<anchor>`.
- `openMemoryDb` / `replaceDocument` / `optimizeMemoryDb` keep those rows in a `node:sqlite`
  database with a contentless trigram FTS5 table over chunks. `replaceDocument` splits each section
  body into passages of at most 2,000 characters at blank lines, line breaks, or spaces, stores
  their offsets in SQLite characters, and writes one index row per passage; `searchMemory` ranks a
  section by its best passage.
- `replaceDocument` derives type and ticket columns from validated memory settings, and writes
  `obligation` rows from the `obligations` rules (a line rule keys each match on a marker line; a
  section rule keys a matching H2 section by the document's ticket) and `supersession` rows from the
  `supersedes` line rules (each match of `key` on a marker line names a target in one `direction`).

## Ingest

`ingestMemory` compares the files the `include` globs reach, minus those an `exclude` glob matches,
with the stored documents in one write transaction: it skips a document whose hash of text plus
type, ticket, obligation, and supersession settings is unchanged, replaces a changed one, and
deletes one whose file is gone or excluded. It then resolves every stored link row (`edge`, written
per section from `[[x]]` and `.md` links) against the whole index, so a skipped document's links
still follow their targets, and resolves every supersession row by document name as a wikilink
resolves and then by a unique ticket. It writes `meta.ingested_at` in the same transaction, which
`describeMemoryIndex` reads with the document, section, link, unresolved, and isolated counts.

## Reads

- `searchMemory` (async) normalizes the query first — Korean words lose particles and endings
  through the `garu-ko` analyzer, loaded only for a Hangul query, and English function words drop
  out — then finds section rows and applies configured type weights. A replaced document sorts with
  the deprecated ones and names its `supersededBy`.
- `showMemory` returns stored document or section content with its links and, for a document, the
  other documents with the same stored ticket, computed at read time.
- `lintMemory` reports unresolved links, unlinked same-ticket documents, untyped documents once any
  document has a type, unresolved supersession targets, and a `direction: supersedes` declaration
  that quotes nothing of what it replaces.
- `listObligations` returns every row under one key; `listSupersession` walks the chain both ways.
- `summarizeMemoryUsage` lays the entries of the query log `.polydeukes/memory-log.jsonl` against
  the indexed documents (hot, dead, and missed searches). The umbrella appends that log after each
  successful `search`, `show`, and `obligations`; it is local state the index rebuild never touches.
