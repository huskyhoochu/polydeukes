# `@polydeukes/memory`

[English](./README.md) · **한국어**

이 패키지는 프로젝트의 마크다운 문서를 SQLite 색인으로 보관해 문서의 절을 검색하고 조회할 수
있게 하고, 문서 사이의 링크도 함께 보관합니다. 문서 하나가 행 하나가 되고, H2 절 하나가 `<문서 식별자>#<앵커>` 키를 가진 행 하나가
됩니다. 기록은 문서 쪽에 있습니다. 색인은 언제든 지우고 문서에서 다시 만들 수 있습니다.

`polydeukes`와 함께 쓰는 선택 설치 패키지이며, `pdks memory` 명령이 이 패키지를 불러옵니다.
우산 패키지 옆에 설치합니다.

```sh
pnpm add -D @polydeukes/memory
```

Node.js 24.15 이상이 필요합니다. 이 버전부터 `node:sqlite`가 안정 기능입니다.

<a id="overview"></a>
## 개요

공개 계약 심볼은 다음과 같습니다.

- `openMemoryDb` · `OpenMemoryDbSpec`
- `ingestMemory` · `IngestMemorySpec`
- `searchMemory` · `SearchMemorySpec` · `MemorySearchResult`
- `showMemory` · `ShowMemorySpec` · `MemoryDocument` · `MemorySection` · `MemoryShownSection` ·
  `MemoryLink`
- `lintMemory` · `LintMemorySpec` · `MemoryLintResult` · `MemoryViolation`
- `listObligations` · `ListObligationsSpec` · `MemoryObligation`
- `describeMemoryIndex` · `DescribeMemoryIndexSpec` · `MemoryIndexState`
- `summarizeMemoryUsage` · `SummarizeMemoryUsageSpec` · `MemoryLogEntry` · `MemoryUsage`
- `MemoryConfig`

<a id="examples"></a>
## 예제

```ts
import { describeMemoryIndex, ingestMemory, openMemoryDb, searchMemory } from '@polydeukes/memory';

const config = { include: ['docs/**/*.md'] };
const db = openMemoryDb({ path: '.polydeukes/memory.db' });

// 쓰기 트랜잭션 하나로 파일에 맞춰 문서를 추가·교체·삭제합니다.
ingestMemory({ db, root: process.cwd(), config });

const { documents, ingestedAt } = describeMemoryIndex({ db });
const results = await searchMemory({ db, query: 'release notes', config });
db.close();
```

같은 호출의 명령줄 형태는 `pdks memory ingest`, `pdks memory search`, `pdks memory show`,
`pdks memory lint`, `pdks memory stats`입니다.

<a id="see-also"></a>
## 같이 보기

- [`@polydeukes/memory` 패키지 참조](../../docs/reference/packages/memory.ko.md)
- [`pdks memory`](../../docs/reference/cli/memory.ko.md)
