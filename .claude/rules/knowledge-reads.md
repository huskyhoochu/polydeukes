# Knowledge is written as markdown and read through memory

The documents under `_docs/` are the store. `pdks-memory` recomputes every answer from the markdown
on each run. Build it once per session with `cargo build --release -p pdks-memory`.

- **Write** knowledge only as markdown files under `_docs/`.
- **Read** knowledge through `./target/release/pdks-memory` — `search <words>` to find sections,
  `show <section or document id>` to read one, `obligations <ticket id>` for carry-overs,
  `supersession <document id>` for what replaced what.
- **Open a file directly only to edit it.** The editing tools require reading a file before changing
  it, and that read is part of the write.

A shell `grep`, `rg`, or `find` over `_docs/knowledge` is advised by the root config's
`knowledge-reads-go-through-memory` discipline. The `precedent` disciplines that ask for a knowledge
read before an edit accept `pdks-memory show` of the named documents as that read.

`covenant-needs-knowledge-read` scopes `packages/pdks/(src|tests)`, `core-needs-knowledge-read`
scopes `packages/pdks/src/core`, and `adapter-needs-knowledge-read` scopes
`packages/pdks-claude-code` and `packages/pdks-codex`.
