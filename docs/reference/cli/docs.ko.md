# `pdks docs`

[English](./docs.md) · **한국어**

설치된 패키지에 동봉된 문서를 읽습니다. 로컬 파일만 사용하며 프로젝트 설정을 읽거나,
판정기를 호출하거나, 네트워크 서비스에 질의하지 않습니다.

<a id="syntax"></a>
## 구문

```sh
pdks docs
pdks docs <topic> [--lang en|ko]
pdks docs search <query> [--lang en|ko] [--limit N] [--json]
pdks docs show <document-id> [--lang en|ko] [--section <section-id>] [--json]
```

`pdks docs --help`, `pdks docs search --help`, `pdks docs show --help`로 구문을 확인합니다.
기본 언어는 영어입니다. 기존 주제인 `install`, `config`, `discipline`, `covenant`,
`witness`도 유지합니다. 주제별 조회와 검색은 같은 문서 목록을 사용합니다.

<a id="search"></a>
## 검색

```sh
pdks docs search 'locale key pairing'
pdks docs search '번역 키 짝 맞춤' --lang ko --limit 3
pdks docs search --worktree --json
```

검색어는 인수 하나입니다. 여러 단어로 검색할 때는 따옴표로 묶습니다. `--worktree` 같은
식별자도 첫 번째 검색 인수로 사용할 수 있습니다. 그 뒤에 오는 알 수 없는 플래그는
오류입니다. 결과 개수는 1부터 50까지의 정수이며 기본값은 5입니다. 선택한 언어의 절을
대상으로 제목, 문서 메타데이터, Markdown 본문을 검색합니다. 공백으로 나눈 검색어가
모두 일치해야 합니다. 같은 입력에는 같은 결과를 내는 결정론적 텍스트 검색이며,
의미 해석이나 번역은 하지 않습니다.

각 결과에는 문서와 절 ID, 제목, 원문 일부, 상대 소스 경로, 점수, 완전한 `pdks docs show`
명령이 있습니다. 점수가 높은 결과부터 나열하고, 동점이면 문서 ID와 절 ID의 ASCII 순서를
따릅니다. 점수는 순위를 정하는 값이지 답변의 신뢰도가 아닙니다.

<a id="show"></a>
## 문서나 절 조회

```sh
pdks docs show first-judgment
pdks docs show write-disciplines --lang ko --section locale-key-pairing
```

`show`는 생성한 답변이 아니라 Markdown 원문을 반환합니다. 절은 명시한 앵커에서 시작해
다음 같은 수준 또는 상위 수준의 제목과 그 앵커 직전에 끝납니다. 하위 절은 포함합니다.
코드 블록 안의 제목은 경계가 아니라 본문입니다. 제목이 달라도 영어와 한국어의 ID는
같습니다.

<a id="json"></a>
## JSON 출력

검색은 다음 구조의 객체를 반환합니다.

```text
{ schemaVersion, packageVersion, language, query, count, results }
```

`schemaVersion`은 `1`이고 `packageVersion`은 설치된 패키지의 버전입니다. `count`는
개수 제한을 적용한 뒤 반환하는 결과 수입니다. 각 결과에는 `documentId`, `sectionId`,
`title`, `excerpt`, `source`, `command`, 숫자형 `score`가 있습니다. `source`는 문서
디렉터리 기준 상대 경로와 절 앵커이며, 빌드 머신의 절대 경로가 아닙니다.

조회는 다음 구조를 반환합니다.

```text
{ schemaVersion, packageVersion, language, documentId, sectionId, source, markdown }
```

전체 문서를 조회하면 `sectionId`는 `null`입니다. `markdown`은 바꾸지 않은 본문입니다.
JSON 출력은 완전한 객체 하나와 뒤따르는 줄바꿈으로 이루어집니다. 오류가 발생하면
불완전한 JSON 답변을 출력하지 않습니다.

<a id="failures"></a>
## 종료 코드와 동봉 범위

| 조건 | 종료 코드 | 출력 |
|---|---|---|
| 정상 조회 | `0` | stdout에 답변 |
| 검색 결과 없음 | `0` | 빈 목록 표시. JSON은 `count: 0`, `results: []` |
| 잘못된 인수 또는 알 수 없는 ID | `2` | stderr에 진단, stdout은 비어 있음 |
| 동봉 파일이 없거나 서로 맞지 않음 | `2` | stderr에 진단, stdout은 비어 있음 |

중복 플래그, 누락된 값, 불필요한 위치 인수, 지원하지 않는 언어, 빈 검색어, 경로 형태의
ID는 오류입니다. `show`는 등록한 ID를 읽으며 임의의 파일 경로를 읽지 않습니다.
무결성 해시로 Markdown 변경을 탐지하고 메타데이터가 동봉 내용과 맞는지 확인합니다.
동봉 문서가 불완전하거나 손상됐다면 패키지를 다시 설치하세요. 기여자는 전체 소스를
갖춘 체크아웃에서 다시 빌드할 수도 있습니다.

과거 게시물, 백서, 기여 안내, 이전 주소의 이동 안내는 동봉하거나 검색하지 않습니다.
설치된 문서는 온라인 최신 버전이 아니라 해당 패키지 버전을 설명합니다. 전체 원본 문서
목록은 [문서 홈](../../README.ko.md)에 있습니다.
