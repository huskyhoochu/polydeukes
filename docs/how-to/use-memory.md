# Use project memory

**English** · [한국어](./use-memory.ko.md)

Memory finds decisions and evidence in your project's Markdown. Edit a document and the next query
reads the new text. You can start independently of judgment disciplines; first
[install the memory
extension](./install.md).

<a id="configure"></a>
## Configure a document collection

Run in a new example directory. In an existing project, merge the `memory` key into your
configuration instead. Make this edit in your own terminal because configuration is protected in
sessions.


```sh
mkdir pdks-memory-example
cd pdks-memory-example
mkdir notes
cat > polydeukes.config.yaml <<'YAML'
memory:
  include: ["notes/**/*.md"]
YAML
```

<a id="write"></a>
## Write a decision

The title and H2 sections become searchable locations. A stable section ID lets you reopen the same
evidence later.

```sh
cat > notes/storage.md <<'MARKDOWN'
---
title: Storage decision
type: adr
---
# Storage decision

## Local files {#local-files}

We store project decisions in Markdown so they can be reviewed with code.
MARKDOWN
```

<a id="retrieve"></a>
## Find and read the source

Look for `notes/storage#local-files` in search results, then open it with show. Search retrieves
evidence; it does not generate an answer.

```sh
pdks memory search Markdown
pdks memory show notes/storage#local-files
pdks memory stats
pdks memory lint
```

<a id="maintain"></a>
## Use memory during development

Before a task, open search hits and check the assumptions behind earlier decisions. After the task,
write changed decisions and executed checks in Markdown, linking related documents with relative
links. If lint exits 1, repair the document IDs and links it reports. If search finds nothing, check
that memory.include matches the file and that your query words occur in the text.

Document type, status, sources, and verification metadata help interpret a result. `unverified`
means human verification metadata is absent, not that the content is false. Follow replaced
decisions with supersession and retrieve unfinished work with your project's obligations
configuration. Configure both in the
[configuration reference](../reference/configuration/index.md#memory).

Search, show, and obligations append to `.polydeukes/memory-log.jsonl`. Run `pdks memory usage` to
inspect frequently returned documents and candidate search misses. Share documents through Git; the
local query history cannot be recovered from them, so preserve it separately when needed.

Read the [CLI reference](../reference/cli/memory.md) for JSON shapes and exit codes, or the
[SDK
references](../README.md#reference-packages)
for programmatic calls.
