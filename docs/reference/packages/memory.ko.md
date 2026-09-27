# `@polydeukes/memory`

[English](memory.md) · **한국어**

> **프로젝트 마크다운 문서의 검색용 색인.** 이 패키지는 문서마다 절로 나누고 문서 사이의 링크를
> 기록해 로컬 SQLite 데이터베이스에 보관하며, `pdks memory`가 그 데이터베이스를 읽습니다.
>
> 베타이며 선택 설치입니다. 이 패키지를 선택 peer 의존으로 선언하는 `polydeukes` 옆에 설치합니다.
> Node.js 24.15 이상이 필요합니다.

<a id="ownership"></a>
## 담당하는 기능

| 단위 | 하는 일 |
|---|---|
| `openMemoryDb` | 데이터베이스 파일을 엽니다. 없으면 파일과 테이블을 만듭니다 |
| `ingestMemory` | 쓰기 트랜잭션 하나 안에서 저장된 문서를 `include` glob이 가리키는 파일에 맞춥니다 |
| `searchMemory` | 검색어 낱말을 글자 그대로 찾아 절을 고르고 순서를 정합니다 |
| `showMemory` | 저장된 문서 하나와 그 절들, 또는 저장된 절 하나를 거기서 나가고 들어오는 링크와 함께 돌려줍니다 |
| `lintMemory` | 해소되지 않은 링크, 티켓을 공유하면서 링크가 없는 문서, `type`이 없는 문서를 보고합니다 |
| `describeMemoryIndex` | 마지막으로 끝난 ingest 시각과 문서 · 절 · 링크 · 미해소 링크 · 고립 문서의 수를 돌려줍니다 |

데이터베이스는 문서에서 파생된 것입니다. 언제든 지우고 문서에서 다시 만들 수 있으므로, 저장
형태가 바뀌어도 다시 만들면 됩니다. 판정기는 이 패키지를 import하지 않습니다. 이 패키지가 설치되어
있든 없든 `pdks covenant check`의 판정 결과는 같습니다.

<a id="install"></a>
## 설치

```sh
pnpm add -D @polydeukes/memory
```

`polydeukes`의 `pdks memory` 명령이 실행될 때 이 패키지를 불러옵니다. 패키지가 설치되어 있지
않으면 그 명령은 설치 안내를 출력하고 `2`로 종료합니다. 다른 명령은 영향을 받지 않습니다.

<a id="verbs"></a>
## 동사

동사마다 spec 객체 하나를 받습니다. 데이터베이스 연결은 `node:sqlite`의 `DatabaseSync`입니다.

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

| Spec | 필드 |
|---|---|
| `OpenMemoryDbSpec` | `path` — 데이터베이스 파일 |
| `IngestMemorySpec` | `db`, `root`(glob과 식별자의 기준 디렉터리), `config`, 선택 항목 `rebuild` |
| `SearchMemorySpec` | `db`, `query`, 선택 항목 `limit`(기본값 20), `now`, `config` |
| `ShowMemorySpec` | `db`, `id` — 문서나 절의 식별자 |
| `LintMemorySpec` | `db` |
| `DescribeMemoryIndexSpec` | `db` |

`MemoryConfig`는 설정의 [`memory` 절](../configuration/index.ko.md#memory)과 같은 형태입니다.

<a id="rows"></a>
## 문서와 절

`ingestMemory`는 `root` 아래에서 glob이 가리키는 `.md` 파일을 색인하고, 이름이 `index.md`나
`log.md`인 파일은 건너뜁니다. 문서의 식별자는 `root` 기준 경로에서 `.md`를 뺀 것입니다. 제목은
frontmatter의 `title`, 없으면 첫 H1, 그것도 없으면 식별자입니다. H2 제목마다 절이 시작되며, 절의
식별자는 `<문서 식별자>#<앵커>`입니다. 앵커는 제목에 명시한 `{#anchor}`가 있으면 그것이고, 없으면
제목을 소문자로 바꾸고 문장 부호를 지운 뒤 공백을 하이픈으로 바꾼 것입니다. 첫 H2 앞의 본문은
앵커가 빈 절이 됩니다.

`ingestMemory`는 `rebuild`를 켜지 않는 한 본문과 파생 설정이 바뀌지 않은 문서를 건너뜁니다. 오류가
나면 데이터베이스는 `describeMemoryIndex`가 알려 주는 시각까지 포함해 실행 전 상태 그대로 남습니다.

<a id="links"></a>
## 링크

`ingestMemory`는 절 본문에 적힌 링크를 절 · 표기 · 대상마다 행 하나로 저장합니다. 펜스 코드와
인라인 코드 밖에 있는 두 표기를 읽습니다.

- 위키링크 `[[target]]`. 대괄호 안 전체가 대상입니다.
- markdown 링크 `[text](target)` 중 `#` 앞의 경로가 비어 있거나(같은 문서) `.md`로 끝나는 것.
  이미지, 스킴이 있는 링크(`https:` · `mailto:`), 다른 파일은 여기서 링크가 아닙니다. frontmatter는
  링크를 찾을 때 읽지 않습니다.

문서와 파일을 대조한 뒤에는 저장된 링크 전부를 색인 전체에 대해 다시 해소합니다. 그래서 링크를 담은
문서가 바뀌지 않아도, 대상이 색인되는 즉시 그 링크가 해소되고 대상이 사라지면 미해소가 됩니다.

| 표기 | 해소되는 곳 |
|---|---|
| markdown `path.md#anchor` | 링크를 담은 문서의 디렉터리를 기준으로 한 `path`의 문서(`path`가 비면 링크를 담은 문서 자신), 그리고 그 절이 있으면 `<문서>#<anchor>` 절 |
| 위키링크 `[[x]]` | 식별자의 마지막 경로 조각이 `x`인 문서가 하나이면 그 문서, 아니면 링크를 담은 문서의 `x` 절, 그것도 아니면 앵커가 `x`인 절이 전체에서 하나일 때 그 절 |

`include` glob 밖의 파일, `index.md`나 `log.md`, `root` 위를 가리키는 경로로 가는 링크는 미해소입니다.
H3 제목처럼 H2 절이 아닌 앵커는 문서까지만 해소됩니다.

`lintMemory`는 위반 세 종류를 종류 · 식별자 · 세부 순서로 보고합니다.

| `rule` | 보고 대상 | `id` | `detail` |
|---|---|---|---|
| `unresolved` | 어떤 문서로도 해소되지 않은 링크 | 링크가 적힌 절 | 적힌 그대로의 링크 |
| `unlinked` | 다른 문서와 티켓을 공유하면서 자기 링크가 하나도 없는 문서 | 그 문서 | 티켓 |
| `untyped` | frontmatter에 비어 있지 않은 문자열 `type`이 없는 문서 | 그 문서 | 빈 문자열 |

티켓은 설정의 `ticket` 추출 규칙에서 오므로, 규칙이 없으면 `unlinked`는 보고되지 않습니다. 해소된
링크가 어느 방향으로도 다른 문서와 잇지 않는 문서를 **고립** 문서라고 합니다.

<a id="results"></a>
## 결과 타입

| 타입 | 필드 |
|---|---|
| `MemorySearchResult` | `id`, `conceptId`, `docTitle`, `sectionTitle`, `status`, `trust`, `stale`, `matchPath` |
| `MemoryDocument` | `id`, `title`, `metadata`, `sections`, `links` |
| `MemorySection` | `id`, `ord`, `title`, `body` |
| `MemoryShownSection` | `id`, `conceptId`, `docTitle`, `sectionTitle`, `body`, `ord`, `links` |
| `MemoryLink` | `from`(링크가 적힌 절), `target`(`[[x]]` 또는 markdown 링크의 대상), `to`(해소된 절이나 문서, 없으면 `null`) |
| `MemoryLintResult` | `violations` |
| `MemoryViolation` | `rule`, `id`, `detail` |
| `MemoryIndexState` | `documents`, `ingestedAt`(UTC 기준 ISO 8601 시각. ingest 전에는 `null`), `sections`, `links`, `unresolved`, `isolated` |

`links`는 `{ out, in }`입니다. 문서의 `out`은 그 문서의 절에 적힌 링크이고 `in`은 그 문서로 해소된
링크입니다. 절의 `out`은 그 절에 적힌 링크이고 `in`은 그 절로 해소된 링크입니다. 둘 다 `from`, 그다음
`target` 순서로 정렬합니다.

검색 결과의 `status`는 frontmatter의 `status`이고(기본값 `stable`), `stale`은 frontmatter의
`stale_after` 시각이 지나면 참입니다. `trust`는 frontmatter `verified` 항목의 `by` 값이 `human:`으로
시작하면 `human-reviewed`, 다른 `by` 값이 있으면 `machine-verified`, 그 밖에는 `unverified`입니다.
`matchPath`는 모든 낱말이 전문 색인으로 일치했으면 `and`, 어떤 낱말이 부분 문자열이나 식별자 앞부분으로
일치했으면 `like`, 모든 낱말을 담은 절이 없어 낱말 하나라도 담은 절을 돌려주면 `or`입니다.
`deprecated` 문서의 절은 맨 뒤로 가고, 설정한 가중치는 해당 문서 종류를 앞으로 옮깁니다.

<a id="limits"></a>
## 선언된 한계

- **검색은 글자 그대로입니다.** 낱말은 텍스트로 비교하며, 의미 해석이나 번역은 하지 않습니다.
- **색인은 마지막 ingest 시점까지만 최신입니다.** `searchMemory`는 파일을 읽지 않습니다.
  `describeMemoryIndex`가 파일과 마지막으로 대조한 시각을 알려 줍니다.
- **링크는 두 표기만 읽습니다.** `[[x|label]]`과 `[[x#anchor]]`는 대상 `x|label`과 `x#anchor`로
  읽고, `/`로 시작하는 markdown 경로는 해소하지 않습니다.
- **데이터베이스 보존은 사용자의 책임입니다.** 이 패키지는 백업을 만들지 않으며, 문서에서 다시
  만들면 복원됩니다.

<a id="see-also"></a>
## 같이 보기

- [`pdks memory`](../cli/memory.ko.md)
- [설정 참조](../configuration/index.ko.md#memory)
- [`polydeukes`](polydeukes.ko.md)
