---
paths:
  - "packages/pdks-memory/**"
---

# The memory package

`packages/pdks-memory` is the Rust `pdks-memory` executable. It reads the working directory's memory
configuration and computes every answer from the markdown matched by `memory.include`, minus
`memory.exclude`, on each run. Build it once with `cargo build --release -p pdks-memory`.

## Documents and sections

- `src/parse.rs` splits markdown into a preamble and H2 sections, keyed `<document id>#<anchor>`,
  and reads frontmatter and links.
- `src/corpus.rs` derives document types and tickets from the configured rules, extracts obligations
  and supersession declarations, and resolves links across the documents.
- `src/search.rs` ranks sections by their best passage. Passages split at blank lines, line breaks,
  then whitespace to at most 2,000 characters where whitespace allows.
- `src/normalize.rs` uses the embedded Korean morphological analyzer. `src/expand.rs` expands
  English query words with Korean translations from document glosses and the embedded word list.

## Reads

Run `./target/release/pdks-memory <verb>` in repository agent sessions. Each verb accepts `--json`;
`search` also accepts `--limit <n>`.

- `search <words>` returns ranked section rows with configured type weights and supersession
  information. In search output, `like` means a row matched only by an ID prefix for at least one
  query term; `and` means all query terms matched text, and `or` means only some terms matched.
- `show <section or document id>` returns content and links; a document also carries its same-ticket
  related documents.
- `obligations <ticket id>` returns the obligations extracted for that key.
- `supersession <document id>` follows the supersession chain in both directions.
- `lint` reports unresolved links, unlinked same-ticket documents, untyped documents once any
  document has a type, unresolved supersession targets, and a `direction: supersedes` declaration
  that quotes nothing of what it replaces.
- `stats` reports corpus counts.
- `usage` compares the local query log with the current documents.

`src/log.rs` appends successful `search`, `show`, and `obligations` queries to
`.polydeukes/memory-log.jsonl`. Process tests live in `tests/` and run with
`cargo test -p pdks-memory`.
