# `pdks memory`

[English](./memory.md) · **한국어**

마크다운에서 매번 계산하는 프로젝트 기억 확장입니다.

<a id="syntax"></a>
## 문법

```sh
pdks memory search <query…> [--json] [--limit <n>]
pdks memory show <id> [--json]
pdks memory lint [--json]
pdks memory obligations <key> [--json]
pdks memory supersession <id> [--json]
pdks memory stats [--json]
pdks memory usage [--json]
```

프로젝트 루트에서 실행합니다. 모든 명령은 현재 설정과 마크다운 문서 모음을 읽습니다.
`pdks-memory`로도 같은 인자를 직접 실행할 수 있습니다.

<a id="install"></a>
## 설치

별도 실행 파일 `pdks-memory`를 설치하고 PATH에 넣습니다. 네 패키지 관리 경로는
[설치 안내](../../how-to/install.ko.md)에 있습니다. 확장을 찾지 못하면 설치한 뒤 다시 실행하세요.

<a id="configuration"></a>
## 문서 모음

`memory.include`는 마크다운 파일을 선택하고 `memory.exclude`는 일치하는 파일을 뺍니다. 경로 기준은
현재 디렉터리입니다. 문서 ID는 `.md`를 뺀 경로이며 H2 절 ID는 `#<anchor>`를 붙입니다. 서문의 앵커는
빈 값입니다. frontmatter의 제목·종류·상태·검증 정보를 읽고 일반 마크다운도 처리합니다.
[설정
참조](../configuration/index.ko.md#memory)를
참고하세요.

```yaml
memory:
  include: ["notes/**/*.md"]
  exclude: ["notes/archive/**"]
```

질의마다 파일에서 다시 계산하므로 색인 파일이나 준비 명령이 필요하지 않습니다.

<a id="search"></a>
## 검색

```sh
pdks memory search release notes --limit 5
pdks memory search release notes --json
```

각 절의 가장 잘 맞는 구절과 설정한 종류별 가중치로 순위를 정합니다. 내장 분석기가 한국어 낱말을
정규화하며 영어 질의는 한국어 gloss와 내장 사전으로 확장할 수 있습니다. 교체되거나 deprecated인
문서는 뒤로 배치합니다. 순위는 내용의 정확성을 보증하지 않습니다.

텍스트는 탭으로 나눈 절 ID, 일치 경로, 상태, 검증 등급, 제목의 다섯 열입니다. `and`는 모든 질의
낱말의 본문 일치, `or`는 일부 낱말 일치, `like`는 하나 이상의 낱말이 ID 접두로만 일치함을 뜻합니다.
JSON은 `{ "results": [...] }`이며 ingest 시각은 없습니다. 결과가 없으면 텍스트 행이 없거나 JSON
배열이 비고 exit 0입니다.

기본 한도는 20입니다. `--limit`은 앞자리 0 없이 1~9007199254740991의 정수를 받습니다. 값 누락이나
중복 지정은 사용법 오류입니다.

<a id="show"></a>
## 원문 조회

```sh
pdks memory show notes/storage
pdks memory show notes/storage#local-files --json
```

문서 또는 절 본문과 들어오고 나가는 링크를 돌려줍니다. 문서에는 같은 티켓의 관련 문서도 나옵니다.
모르는 ID는 exit 2이므로 검색 결과의 정확한 ID를 사용하세요.

<a id="lint"></a>
## 문서 검사

`pdks memory lint`는 해소되지 않은 링크, 연결되지 않은 같은 티켓 문서, 종류가 있는 모음의 종류 없는
문서, 찾을 수 없는 교체 대상, 교체 원문을 인용하지 않은 선언을 보고합니다. 위반이 있으면 exit
1입니다. JSON은 `{ "violations": [...] }`이며 각 항목은 `rule`, `id`, `detail`을 담습니다. 원문을
고친 뒤 다시 실행하세요.

<a id="obligations"></a>
## 이월 항목

`pdks memory obligations TASK-12`는 `memory.obligations` 추출 설정이 추출한 항목을 반환합니다.
텍스트는 절 ID와 첫 비어 있지 않은 줄, JSON은 `{ "obligations": [...] }`이며 각 항목에 key,
sectionId, docTitle, sectionTitle, 전체 text가 있습니다. 일치 항목이 없으면 exit 0, 추출 추출 설정이
없으면 exit 2입니다. 구문을 추출하므로 요구 사항인지는 원문을 읽어 판단하세요.

<a id="supersession"></a>
## 교체 관계

`pdks memory supersession notes/storage`는 교체 사슬을 양방향으로 따릅니다. 텍스트 행은 새 문서와 옛
문서 ID, JSON은 `{ "supersession": [...] }`의 newer·older 쌍입니다. 모르는 ID는 exit 2, 관계가 없는
기존 문서는 빈 결과입니다.

<a id="stats"></a>
## 문서 통계

`pdks memory stats`는 documents, sections, links, unresolved, isolated 다섯 값을 텍스트와 JSON으로
제공합니다. 다른 문서와 해소된 링크도 같은 티켓 문서도 없으면 고립 문서입니다. 현재 설정의 문서
모음을 셉니다.

<a id="usage"></a>
## 사용 통계

`pdks memory usage`는 로컬 질의 로그와 현재 문서 모음을 대조합니다. hot은 문서가 반환된 로그 행 수,
dead는 한 번도 반환되지 않은 문서, miss는 결과가 없거나 전부 or인 검색의 횟수입니다. miss는 확인할
후보이며 검색 실패의 증명이 아닙니다. JSON에는 from, to, entries, hot, dead, misses가 있습니다.
사용할 로그가 없으면 exit 2이며 JSON으로 파싱되지 않는 줄은 건너뜁니다.

<a id="log"></a>
## 질의 로그

성공한 search, show, obligations는 `.polydeukes/memory-log.jsonl`에 추가됩니다. 이 로컬 이력은
마크다운에서 재구축할 수 없습니다. `pdks init`은 `.polydeukes/`를 Git에서 무시하므로 사용 이력이
중요하면 별도로 보관하세요.

<a id="exit-codes"></a>
## 종료 코드

| 조건                                                            | 종료 코드 |
| --------------------------------------------------------------- | --------- |
| 빈 검색을 포함한 성공                                           | 0         |
| lint 위반 발견                                                  | 1         |
| 인자 오류, 설정 없음, 모르는 ID, 추출 설정·로그 없음, 읽기 실패 | 2         |

답은 stdout, 오류는 stderr입니다. 확장 실행 오류는 memory가 시작되기 전에 `pdks`가 보고하므로 빈
검색 결과와 구별하세요.

<a id="see-also"></a>
## 관련 문서

[기억 사용 안내](../../how-to/use-memory.ko.md) · [설정](../configuration/index.ko.md#memory) ·
[패키지
계약](../packages/memory.ko.md)
