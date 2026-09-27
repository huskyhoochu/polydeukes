# `pdks memory`

[English](./memory.md) · **한국어**

프로젝트의 마크다운 문서를 로컬 SQLite 데이터베이스에 색인하고, 그 절을 검색하고 조회합니다.
이 명령은 `pdks` 실행 파일에 들어 있으며, 선택 설치 패키지 `@polydeukes/memory`를 이 명령이
실행될 때만 불러옵니다. `pdks covenant check`는 이 패키지를 불러오지 않으므로, 패키지가 있든
없든 판정 결과는 같습니다.

<a id="syntax"></a>
## 구문

```sh
pdks memory ingest [--rebuild]
pdks memory search <query…> [--json]
pdks memory show <id> [--json]
```

모든 경로는 명령을 실행한 디렉터리 기준입니다. 설정 파일도 그 디렉터리에서 찾고, 색인은 그
아래의 `.polydeukes/memory.db` 파일입니다. 이 밖의 인자 조합은 사용법 줄을 출력하고 `2`로
종료합니다.

<a id="install"></a>
## 설치

```sh
pnpm add -D @polydeukes/memory
```

이 패키지는 Node.js 24.15 이상이 필요합니다. 설치되어 있지 않으면 모든 `pdks memory` 명령이 한
줄을 출력하고 `2`로 종료합니다.

```text
pdks memory: @polydeukes/memory is not installed — install it with `pnpm add -D @polydeukes/memory`
```

설치된 패키지 안에서 난 오류, 예컨대 빠진 파일이나 SQLite가 아닌 색인 파일은 대신
`pdks memory: <오류 문구>`로 출력합니다.

<a id="configuration"></a>
## 색인 대상

`ingest`와 `search`는 설정의 `memory` 절을 읽습니다. `memory.include`는 색인할 파일의 glob
목록입니다.

```yaml
memory:
  include:
    - 'docs/**/*.md'
```

색인에는 현재 디렉터리 아래에서 이 glob이 가리키는 `.md` 파일이 들어갑니다. 이름이 `index.md`나
`log.md`인 파일은 건너뜁니다. 문서 하나가 행 하나가 되며, 식별자는 `.md` 확장자를 뺀 경로입니다
(`docs/guide`). H2 절 하나도 행 하나가 되며, 식별자는 `<문서 식별자>#<앵커>`입니다
(`docs/guide#install`). 첫 H2 앞의 본문은 앵커가 빈 행이 됩니다. 이 절의 나머지 키인 `typeMap`,
`ticket`, `weights`는 [설정 참조](../configuration/index.ko.md#memory)에 있습니다.

문서는
[Open Knowledge Format(OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md),
곧 YAML frontmatter가 달린 마크다운으로 작성하기를 권장합니다. 이 명세를 따르는 묶음(bundle)은
그대로 색인됩니다. `ingest`가 읽는 OKF 키는 다음과 같습니다. `title`은 문서 제목, `type`은
`typeMap`과 `weights`가 쓰는 유형입니다. `status`가 `deprecated`인 문서의 절은 결과의 맨 뒤에
놓이고, `stale_after`가 지난 문서의 결과에는 오래됨 표시가 붙으며, `verified`는 신뢰 등급을
정합니다. 위에서 건너뛴다고 한 `index.md`와 `log.md`는 OKF가 예약한 파일 이름입니다. 이 형식은
필수가 아닙니다. frontmatter가 없거나 해석되지 않는 파일도 색인되며, 없는 키는 기본값을 씁니다.

설정 파일이 없거나 설정에 `memory` 절이 없으면 `ingest`와 `search`는 선언할 키와 예시를 출력하고
`2`로 종료합니다. 데이터베이스는 만들지 않습니다.

<a id="ingest"></a>
## `pdks memory ingest`

```sh
pdks memory ingest
pdks memory ingest --rebuild
```

`ingest`는 쓰기 트랜잭션 하나 안에서 glob이 가리키는 파일과 저장된 문서를 대조합니다. 새 문서를
추가하고, 바뀐 문서를 교체하고, 파일이 사라진 문서를 지우고, 실행 시각을 기록합니다. 출력은 한
줄입니다.

```text
indexed 12 documents into .polydeukes/memory.db
```

수는 실행 뒤 색인에 있는 문서 수입니다. `indexed 0 documents`는 glob이 파일을 하나도 가리키지
않았다는 뜻입니다. `--rebuild`는 바뀌지 않은 문서까지 모두 교체합니다. 실행이 실패하면 색인은
실행 전 상태 그대로 남습니다.

<a id="search"></a>
## `pdks memory search`

```sh
pdks memory search release notes
pdks memory search release notes --json
```

`search` 뒤의 낱말은 공백 하나로 이어 한 검색어가 되며, `--json`은 그 사이 어디에 있어도 됩니다.
모든 낱말을 담은 절이 결과가 되고, 그런 절이 없으면 낱말 하나라도 담은 절이 결과가 됩니다. 표
형태의 첫 줄은 마지막 ingest 시각이고, 이어서 결과마다 한 줄이 나옵니다.

```text
# ingested at 2026-01-15T09:30:00.000Z
docs/guide#install  and  stable  unverified  Guide › Install
```

결과 한 줄에는 절 식별자, 매치 경로(`and`, `or`, `like`), 문서의 상태(`stale_after` 날짜가 지났으면
뒤에 `, stale`), 신뢰 등급, `<문서 제목> › <절 제목>`(첫 H2 앞 본문이면 문서 제목만)이 들어갑니다.
JSON 형태는
`{ "ingestedAt": …, "results": [ … ] }`입니다. 일치하는 절이 없는 검색도 `0`으로 종료하며, 머리
줄만 출력하거나 빈 `results` 목록을 냅니다.

`search`는 파일이 아니라 색인을 읽습니다. 머리 줄의 시각 뒤에 바뀐 문서는 다음 `ingest` 전까지
반영되지 않습니다.

<a id="show"></a>
## `pdks memory show`

```sh
pdks memory show docs/guide
pdks memory show docs/guide#install --json
```

문서 식별자를 주면 `# <제목>`을 출력하고, 이어 절마다 `## <절 제목>`과 본문을 출력합니다. 절
식별자를 주면 `# <문서 제목> › <절 제목>`과 그 절의 본문을 출력합니다. `--json`은 저장된 문서나
절을 객체 하나로 출력합니다. 색인에 없는 식별자는 stderr에 문구를 내고 stdout에는 아무것도 내지
않은 채 `2`로 종료합니다. `show`는 색인만 읽으므로 설정 파일이 필요하지 않습니다.

<a id="database"></a>
## 색인 파일

색인은 `.polydeukes/memory.db`입니다. 문서에서 파생된 파일이며, 언제든 문서에서 다시 만들 수
있습니다.

```sh
pdks memory ingest --rebuild
```

색인 파일을 보존하고, 백업하고, 버전 관리하는 일은 사용자의 책임입니다. 폴리데우케스는 이 파일의
사본을 만들지 않습니다. `pdks init`이 `.gitignore`에 넣는 `.polydeukes/` 줄이 이 파일도 덮으므로,
그 줄을 바꾸지 않는 한 커밋에 들어가지 않습니다. 기록은 문서 쪽에 있습니다. 파일을 지우고
`pdks memory ingest`를 다시 실행하면 색인이 복원됩니다.

`search`와 `show`는 이 파일을 만들지 않습니다. 파일이 없거나 그 안에서 끝난 ingest가 없으면 `2`로
종료합니다.

```text
pdks memory: no index at .polydeukes/memory.db — run `pdks memory ingest` first
```

<a id="exit-codes"></a>
## 종료 코드

| 조건 | 종료 코드 | 출력 |
|---|---|---|
| 성공한 명령. 일치가 없는 검색 포함 | `0` | stdout에 응답 |
| 위 구문 밖의 인자 조합 | `2` | stderr에 사용법, stdout은 비어 있음 |
| 설정 파일이 없거나 `memory` 절이 없음(`ingest`, `search`) | `2` | stderr에 선언할 키 |
| 색인 파일이 없거나 끝난 ingest가 없음(`search`, `show`) | `2` | stderr에 ingest 안내 |
| 색인에 없는 식별자(`show`) | `2` | stderr에 문구, stdout은 비어 있음 |
| `@polydeukes/memory`가 설치되지 않음 | `2` | stderr에 설치 안내 |
| 그 밖의 오류 | `2` | stderr에 `pdks memory: <오류 문구>`, stdout은 비어 있음 |

<a id="see-also"></a>
## 같이 보기

- [`@polydeukes/memory`](../packages/memory.ko.md)
- [설정 참조](../configuration/index.ko.md#memory)
- [`polydeukes`](../packages/polydeukes.ko.md)
