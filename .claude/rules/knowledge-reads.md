# Knowledge is written as markdown and read through the memory index

The documents under `_docs/` are the store; `.polydeukes/memory.db` is an index rebuilt from
them (`memory.adr.v011-store-design.md` D11).

- **Write** knowledge only as markdown files under `_docs/`. No command writes to the index
  directly; `pnpm exec pdks memory ingest` brings it level with the files.
- **Read** knowledge through `pnpm exec pdks memory` — `search <words>` to find sections,
  `show <section or document id>` to read one, `obligations <ticket id>` for carry-overs,
  `supersession <document id>` for what replaced what. Run `ingest` first in a session that
  has edited `_docs/` or pulled the wiki.
- **Open a file directly only to edit it.** The editing tools require reading a file before
  changing it, and that read is part of the write.

A shell `grep`, `rg`, or `find` over `_docs/knowledge` is advised by the root config's
`knowledge-reads-go-through-memory` discipline. The `precedent` disciplines that ask for a
knowledge read before an edit accept `pdks memory show` of the named documents as that read.
