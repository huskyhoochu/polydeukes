# `@polydeukes/memory`

**English** · [한국어](./README.ko.md)

This package keeps a SQLite index of a project's markdown documents so their sections can be
searched and shown, and keeps the links between them. Each document becomes one row, and each
H2 section one row keyed `<document id>#<anchor>`. The documents stay the record: the index can
be deleted and rebuilt from them at any time.

It is an optional companion to `polydeukes`, whose `pdks memory` command loads it. Install it
next to the umbrella:

```sh
pnpm add -D @polydeukes/memory
```

It needs Node.js 24.15 or later, where `node:sqlite` is stable.

<a id="overview"></a>
## Overview

Public contract symbols include:

- `openMemoryDb` · `OpenMemoryDbSpec`
- `ingestMemory` · `IngestMemorySpec`
- `searchMemory` · `SearchMemorySpec` · `MemorySearchResult`
- `showMemory` · `ShowMemorySpec` · `MemoryDocument` · `MemorySection` · `MemoryShownSection` ·
  `MemoryLink`
- `lintMemory` · `LintMemorySpec` · `MemoryLintResult` · `MemoryViolation`
- `describeMemoryIndex` · `DescribeMemoryIndexSpec` · `MemoryIndexState`
- `MemoryConfig`

<a id="examples"></a>
## Examples

```ts
import { describeMemoryIndex, ingestMemory, openMemoryDb, searchMemory } from '@polydeukes/memory';

const config = { include: ['docs/**/*.md'] };
const db = openMemoryDb({ path: '.polydeukes/memory.db' });

// One write transaction: adds, replaces, and deletes documents to match the files.
ingestMemory({ db, root: process.cwd(), config });

const { documents, ingestedAt } = describeMemoryIndex({ db });
const results = searchMemory({ db, query: 'release notes', config });
db.close();
```

The command line form of the same calls is `pdks memory ingest`, `pdks memory search`,
`pdks memory show`, `pdks memory lint`, and `pdks memory stats`.

<a id="see-also"></a>
## See also

- [`@polydeukes/memory` package reference](../../docs/reference/packages/memory.md)
- [`pdks memory`](../../docs/reference/cli/memory.md)
