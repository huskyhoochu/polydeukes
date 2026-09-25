# 선언 언어 참조

[English](./index.md) · **한국어**

규율(discipline)의 `declare` 블록을 작성할 때 사용하는 참조 문서입니다. 지원하는 소스,
추출 단계, 조합 연산자, 관계, 기전(mechanism)을 모두 표로 정리했습니다. 설치와 실전 예제는
[규율 작성하기](../../how-to/write-disciplines.ko.md)를, 프로젝트 설정과 강제 수준은
[설정 참조](../configuration/index.ko.md)를 보세요.

<a id="declaration-shape"></a>
## 선언 구조

판정 항목에는 `id`와 `declare`가 필요하며, `why`와 `enforce`는 선택입니다.
항목은 [소스를 관측할 수 있는 목록](../configuration/index.ko.md#three-lists)에 작성합니다.

| `declare` 안의 필드 | 필수 여부 | 의미 |
|---|---|---|
| `mechanism` | 필수 | 아래 기전 표의 이름입니다. 사용할 수 있는 증거 축과 관계를 제한합니다. |
| `scope` | 선택 | 소스 하나에 정규식을 적용해 판정할 관측을 선택합니다. |
| `sources` | 선택 | 파일이나 세션 증거에 이름을 붙입니다. |
| `supply` | 선택 | 소스가 없을 때의 처리를 정합니다. 지정하지 않은 소스는 `error`를 사용합니다. |
| `extract` | 필수 | 추출 이름마다 비어 있지 않은 단계 목록을 지정합니다. |
| `relate` | 필수 | 비교 조건과 진단 메시지의 목록입니다. 비어 있을 수 없습니다. |
| `witness` | 선택 | 위반을 허용할 수 있는 추가 비교 조건입니다. |

바깥의 `id`가 규율 이름이므로 `declare` 안에 `discipline`을 다시 쓰지 않습니다.
이름과 키는 대소문자를 구분하며, 지원하지 않는 선언 키는 거부됩니다.

다음 항목은 `data/` 밖의 `.db` 경로를 알립니다.

```yaml
disciplines:
  - id: 'database-location'
    why: '데이터베이스 파일은 data/ 아래에 둡니다.'
    enforce: advise
    declare:
      mechanism: 'naming'
      scope: { source: 'target.path', include: ['\.db$'] }
      extract:
        outside:
          - { op: 'source', of: 'target.path' }
          - { op: 'matches', re: '^(?!data/)' }
      relate:
        - id: 'location'
          relation: { op: 'empty', of: 'outside' }
          message: '{value}는 data/ 아래에 있어야 합니다'
```

<a id="scope"></a>
## 적용 범위

| 키 | 의미 |
|---|---|
| `source` | 필수입니다. `target.path`, `pre`, `post`, `command` 또는 이름 붙인 `file` 소스 중 하나입니다. |
| `include` | 정규식 문자열 목록입니다. 하나 이상 일치해야 합니다. 생략하거나 빈 목록이면 모든 문자열을 허용합니다. |
| `exclude` | 정규식 문자열 목록입니다. 하나라도 일치하면 제외합니다. 생략하거나 빈 목록이면 제외하지 않습니다. |
| `excludeIgnoreCase` | 선택인 불리언이며 기본값은 `false`입니다. `exclude`에만 적용됩니다. |

`scope`가 없으면 모든 관측이 대상입니다. `scope`를 지정했는데 그 소스가 없으면 대상에서
제외됩니다. 패턴은 경로 glob이 아닌 정규식이며, `include`는 항상 대소문자를 구분합니다.

<a id="fixed-sources"></a>
## 고정 소스

각 관측은 확인할 수 있는 소스를 공급합니다. 파일 변경은 각각 판정하므로 `target.path`,
`pre`, `post`는 현재 판정하는 변경을 가리킵니다.

| 소스 | 값 | 공급되는 경우 |
|---|---|---|
| `target.path` | 저장소 기준 상대 경로 문자열 | 파일 대상이 있는 관측입니다. |
| `pre` | 변경 전 파일 텍스트 | 수정, 그리고 이전 텍스트를 읽을 수 있는 삭제입니다. 생성에는 없습니다. |
| `post` | 제안된 변경 후 파일 텍스트 | 생성과 수정입니다. 삭제에는 없습니다. |
| `state` | 변경 전후의 쌍 `{ pre, post }` | 수정입니다. 파이프라인을 양쪽에 각각 적용합니다. |
| `changes` | 관측한 변경 집합의 경로 배열 | `changeSetDisciplines`에서 읽습니다. `items`로 개별 경로를 추출합니다. |
| `command` | 셸 명령 텍스트 | 파일 대상이 없는 호출을 포함한 세션 셸 호출입니다. 실행되지 않는 stdin 리터럴 데이터는 제외합니다. |
| `actor` | 선택 필드 `agentType`을 가진 객체 | 주체를 확인할 수 있는 세션 호스트가 공급합니다. 주 세션은 `{}`이며, 호스트가 주체를 공급하지 않으면 소스 자체가 없습니다. |

소스가 없는 상태는 빈 문자열이나 빈 배열이 있는 상태와 다릅니다. 부재 처리는 `supply`로
정합니다. `state`는 호출 사이의 작업 진행 상태를 저장하지 않습니다. 쌍인 추출 결과를 받는
관계는 `unchanged`뿐입니다. 셸 stdin 처리는
[명령 소스 예제](../configuration/index.ko.md#disciplines)에서 설명합니다.

<a id="source-kinds"></a>
## 추가 소스 종류

`sources`에서 새 이름마다 바인딩 하나를 지정합니다. 고정 소스 이름을 덮어쓸 수 없습니다.

| 종류 | 바인딩 예제 | 공급되는 값 |
|---|---|---|
| `file` | `en: { file: 'locales/en.json' }` | 파일 텍스트입니다. 경로는 저장소 기준 상대 경로이며, 앞의 `/`와 `..` 경로 조각은 허용하지 않습니다. |
| `sidecar` | `spawns: { sidecar: true }` | 호스트의 에이전트 생성 기록을 담은 JSON 텍스트입니다. `agentType`이나 `items` 전에 `json`으로 파싱합니다. |
| `transcript` | `session: { transcript: true }` | `observedAtMs`, `toolCalls`, `userMessages`를 담은 세션 스냅샷입니다. |

바인딩은 `{ op: 'source', of: 'en' }`으로 읽습니다. 현재 변경하는 파일은 제안된 `post`를
사용하고, 나머지 파일은 해당 표면이 관측한 프로젝트 상태에서 읽습니다. `sidecar`와
`transcript`는 `sessionDisciplines`에 작성하며, 호스트가 그 통로를 공급해야 합니다.
두 종류의 표식 값은 리터럴 `true`입니다.

<a id="supply-policies"></a>
## 공급 정책

| 정책 | 소스가 없을 때의 동작 |
|---|---|
| `error` | 기본값입니다. 판정할 수 없는 관측으로 처리해 차단합니다. 강제 수준이 `advise`여도 같습니다. |
| `pass` | 사유 `supply-pass`와 함께 `skipped`를 기록하고 이 선언을 판정하지 않습니다. |
| `empty` | 빈 항목 목록으로 판정을 계속합니다. 단일 소스에만 쓸 수 있고 `state`에는 쓸 수 없습니다. |

`supply`의 키는 고정 소스나 선언에서 바인딩한 소스 이름이어야 합니다. 변경 전후 비교에서
생성과 삭제를 건너뛰려면 `supply: { state: 'pass' }`를 씁니다. 새로 추가한 내용만 검사하려면
`supply: { pre: 'empty', post: 'empty' }`를 씁니다. 잘못된 JSON은 `pass`나 `empty`를
지정해도 공급 오류입니다. 두 정책은 소스가 없는 경우에 적용됩니다.

<a id="items-and-pipelines"></a>
## 항목과 파이프라인

추출 결과는 순서가 있는 `{ key, value }` 항목 목록입니다. 키는 조합 연산과 키 비교에서
항목을 식별하며, 값은 값 비교 관계가 대조하는 데이터입니다. 키를 바꿔도 값은 바뀌지 않습니다.

파이프라인은 `source`나 조합 연산자로 시작합니다. 조합 연산자는 다른 추출 이름을 참조하며
첫 단계에만 올 수 있습니다. 참조한 추출은 존재해야 하고 순환 참조는 허용하지 않습니다.
`state`에서 나온 쌍은 조합 연산자의 입력이 될 수 없습니다. 이후 단계는 결과를 차례로 변환합니다.

<a id="extract-steps"></a>
## 추출 단계

지원하는 단항 단계 17개입니다. 인자 예제에 표시한 키를 사용하며, 지원하지 않는 인자는
컴파일 오류가 됩니다. 별도 설명이 없으면 항목 순서를 유지합니다.

| 단계 | 인자 | 결과 |
|---|---|---|
| `source` | `of: 'post'` 필수 | 해당 소스를 키 `'0'`인 항목 하나로 읽어 시작합니다. `state`는 쌍으로 추출합니다. |
| `json` | 없음 | 문자열 값을 JSON으로 파싱하고 키는 유지합니다. 잘못된 JSON은 공급 오류입니다. |
| `select` | `path: 'args.command'` 필수 | 객체의 점 경로를 따라 읽습니다. 없는 경로는 제외합니다. 결과가 배열이면 위치를 키로 원소를 나누고, 단일 값이면 키를 유지합니다. |
| `items` | 없음 | 각 배열을 한 단계 펼쳐 0부터 시작하는 위치를 키로 부여합니다. 배열이 아닌 값은 제외합니다. |
| `keyBy` | `field: 'id'` 필수 | 객체 필드의 문자열 표현을 키로 지정하고 원래 값은 유지합니다. 객체가 아니거나 필드가 없거나 null 또는 객체 값이면 제외합니다. |
| `keyByPattern` | `re: '^(.+)\.ts$'` 필수, `i: true` 선택·기본값 `false` | 첫 정규식 일치의 캡처 그룹 1을 키로 지정합니다. 일치하지 않거나 캡처가 없으면 제외하고, 원래 값은 유지합니다. |
| `field` | `name: 'version'` 필수 | 키를 유지하고 값을 객체의 해당 속성으로 바꿉니다. 속성이 없으면 `undefined`이며, 객체가 아니면 제외합니다. |
| `filter` | `when: [{ field: 'succeeded', eq: true }]` 필수 | 모든 조건을 만족하는 항목을 유지합니다. `when: []`는 모든 항목을 유지합니다. 아래 조건 표를 보세요. |
| `flattenKeys` | 없음 | `home.title`처럼 중첩된 말단 경로를 키와 값으로 나열합니다. 번역 문구는 결과에 포함하지 않습니다. |
| `sort` | 없음 | 값을 기준으로 안정적인 오름차순 정렬을 합니다. 모두 숫자면 수치로, 그 밖에는 문자열로 비교합니다. |
| `lines` | 없음 | 값을 문자열로 바꿔 줄바꿈으로 나누고, 각 줄의 앞뒤 공백과 빈 줄을 제거합니다. 키는 원래 줄 번호이며 1부터 시작합니다. |
| `matches` | `re: '^test:'` 필수, `i: true` 선택·기본값 `false` | 문자열로 바꾼 값이 정규식에 일치하는 항목을 유지합니다. 키와 값은 바뀌지 않습니다. |
| `toolUses` | `names: ['Bash']`, `subagentType: 'reviewer'` 모두 선택 | 세션 스냅샷에서 호출을 추출하고 관측 순번을 키로 씁니다. 지정한 필터는 모두 일치해야 합니다. 성공 여부는 자동으로 검사하지 않습니다. |
| `userTexts` | `re: '^approved$'` 필수, `i: true` 선택·기본값 `false` | 일치하는 사용자 메시지를 관측 순번 키로 추출합니다. 값에 스냅샷의 `observedAtMs`도 추가합니다. |
| `agentType` | `is: 'reviewer'` 필수 | 파싱한 생성 기록 중 종류가 일치하는 항목을 위치 키로 추출합니다. 기록 배열이나 객체 하나를 받습니다. |
| `first` | 없음 | 첫 항목과 그 키를 유지합니다. 빈 입력은 빈 상태로 남으며 정렬하지 않습니다. |
| `ageMs` | 없음 | 객체 값에 `ageMs = observedAtMs - timestampMs`를 추가합니다. 시간이 없거나 숫자가 아니거나 미래 관측이면 제외합니다. |

`items`와 배열을 반환하는 `select`는 배열마다 별도로 번호를 매깁니다. 여러 배열을 펼치면
키가 겹칠 수 있으므로 객체 식별자로 비교해야 할 때는 `keyBy`를 사용하세요.
`flattenKeys`는 일반 객체의 속성을 따라 내려갑니다. 배열은 해당 속성 경로의 말단 값으로
취급하며 배열 인덱스를 나열하지 않습니다. 빈 객체는 중첩된 경우에도 경로를 만들지 않습니다.

정규식 단계는 JavaScript 정규식을 사용합니다. 지원하는 플래그 인자는 `i`이며 `g`나 `m`
인자는 없습니다. 파일 전체 텍스트에서 `^`는 전체의 시작을 가리킵니다. 각 줄에 적용하려면
먼저 `lines`를 쓰세요. `keyByPattern`에는 캡처 그룹이 필요하며 첫 일치만 사용합니다.

<a id="filter-predicates"></a>
## 필터 조건

조건 하나에는 `field`와 연산자 하나가 필요합니다. `field`는 점 경로가 아닌 객체의 직접
속성 이름입니다. 객체가 아닌 값은 조건을 만족하지 못합니다. `when`의 모든 조건이 참이어야 합니다.

| 연산자 | 예제 | 조건 |
|---|---|---|
| `eq` | `{ field: 'succeeded', eq: true }` | 상수와 구조적으로 같습니다. |
| `ne` | `{ field: 'status', ne: 'draft' }` | 상수와 구조적으로 다릅니다. |
| `size` | `{ field: 'errors', size: 0 }` | 필드가 배열이고 원소 수가 지정한 수와 같습니다. |
| `notIn` | `{ field: 'status', notIn: ['draft', 'failed'] }` | 배열에 나열한 모든 상수와 필드 값이 다릅니다. |
| `lte` | `{ field: 'ageMs', lte: 600000 }` | 필드가 숫자이며 지정한 수 이하입니다. |
| `gte` | `{ field: 'count', gte: 1 }` | 필드가 숫자이며 지정한 수 이상입니다. |

`size`, `lte`, `gte`의 인자는 숫자이고 `notIn`의 인자는 배열입니다. 없는 속성은
`undefined`이므로 `ne`나 `notIn`을 만족할 수 있습니다. 두 연산자가 속성의 존재까지 확인하지는
않습니다.

<a id="combinators"></a>
## 조합 연산자

피연산자는 서로 다른 추출 이름 둘입니다. `onlyIn`과 `intersect`는 **키**로 비교하고,
`union`은 두 목록을 이어 붙입니다. 세 연산 모두 항목의 값을 유지하며 정렬하거나 중복을
제거하지 않습니다.

| 조합 연산자 | 구문 | 결과 |
|---|---|---|
| `union` | `{ op: 'union', of: ['a', 'b'] }` | `a`의 모든 항목 뒤에 `b`의 모든 항목을 붙입니다. 중복 키도 유지합니다. |
| `onlyIn` | `{ op: 'onlyIn', of: 'a', notIn: 'b' }` | `a` 중 키가 `b`에 없는 항목입니다. |
| `intersect` | `{ op: 'intersect', of: ['a', 'b'] }` | `a` 중 키가 `b`에도 있는 항목입니다. 값은 `a`의 것을 사용합니다. |

<a id="relations"></a>
## 관계

관계 7개는 모두 조건을 위반한 항목을 반환합니다. 반환 항목이 없으면 조건을 만족한 것입니다.
아래의 `a`, `b`는 파일 이름이 아닌 추출 이름입니다.

| 관계 | 구문 | 조건 |
|---|---|---|
| `empty` | `{ op: 'empty', of: 'a' }` | `a`에 항목이 없어야 합니다. 실패하면 모든 항목을 보고합니다. |
| `nonEmpty` | `{ op: 'nonEmpty', of: 'a' }` | `a`에 항목이 하나 이상 있어야 합니다. 실패하면 추출 이름과 값 `null`을 보고합니다. |
| `equal` | `{ op: 'equal', of: ['a', 'b'] }` | 값의 집합이 양방향으로 같아야 합니다. 왼쪽에만 있는 항목, 오른쪽에만 있는 항목 순으로 보고합니다. |
| `subset` | `{ op: 'subset', of: 'a', in: 'b' }` | `a`의 모든 값이 `b`에 있어야 합니다. 일치하지 않는 `a`의 항목을 보고합니다. |
| `implies` | `{ op: 'implies', of: 'a', requires: 'b' }` | `a`의 모든 키가 `b`에 있어야 합니다. 필요한 키가 없는 `a`의 항목을 보고합니다. |
| `ordered` | `{ op: 'ordered', of: 'a', strict: false }` | 값이 오름차순이어야 합니다. `strict` 기본값은 `false`이며, `true`이면 이웃한 동일 값도 거부합니다. 위반한 쌍의 뒤 항목을 보고합니다. |
| `unchanged` | `{ op: 'unchanged', of: 'a' }` | `state`에서 추출한 쌍의 공통 키에서 변경 전후 값이 같아야 합니다. 추가되거나 삭제된 키는 위반으로 세지 않습니다. |

`equal`과 `subset`은 값을 구조적으로 비교하며 항목의 키, 목록 순서, 중복 횟수는 무시합니다.
값 *안에* 있는 배열은 순서를 비교합니다. `implies`는 키로 비교하며 값을 무시합니다.
예를 들어 `{ key: 'en', value: 'home' }`과 `{ key: 'ko', value: 'home' }`은 `equal`을
만족하지만, 키가 다르므로 앞 항목이 뒤 항목을 `implies`로 요구하면 위반입니다.

`ordered`는 모든 값이 숫자면 수치로, 그 밖에는 문자열 표현으로 비교합니다. 정렬을 수행하지
않으며 빈 입력과 항목 하나인 입력은 통과합니다. 바로 앞에서 정렬하면 원래 입력의 순서가
올바랐는지는 확인할 수 없습니다.

쌍을 받는 관계는 `unchanged`뿐이고, 나머지는 단일 추출 결과를 받습니다. `equal`, `subset`,
`implies`에 지정하는 두 추출 이름은 서로 달라야 합니다.

<a id="messages-and-witness"></a>
## 메시지와 선언의 증인

각 `relate` 항목에는 고유한 `id`, `relation`, 그리고 아래 메시지 형태 중 하나가 필요합니다.

| 필드 | 용도 |
|---|---|
| `message` | 모든 관계에서 쓸 수 있는 진단 템플릿 하나입니다. |
| `messageBySide` | `{ left: '…', right: '…' }`이며 `equal`에만 허용됩니다. |

템플릿의 `{key}`와 `{value}`는 첫 위반 항목의 값으로 치환합니다. `{before}`는
`unchanged`의 변경 전 값이며, 없으면 빈 문자열입니다. 위반이 여러 개면 나머지 개수를
덧붙입니다. 객체는 JavaScript 문자열 표현으로 출력하므로 표시하려는 필드를 먼저 추출하세요.

선언의 선택 블록 `witness`에는 선택인 `extract`와 필수인 `relate`가 있습니다. 본체의
추출을 참조할 수 있지만 본체는 증인의 추출을 참조할 수 없고, 증인의 추출 이름으로 본체의
이름을 덮어쓸 수도 없습니다. 본체가 위반하고 증인의 모든 비교가 성립하면 증언으로 허용됩니다.
증인의 공급 오류는 위반을 허용하지 않습니다.
최상위의 [인간 증인(witness) 설정](../configuration/index.ko.md#witness)은 별도로 지정합니다.

<a id="mechanisms"></a>
## 기전

선언마다 기전 하나를 지정합니다. 컴파일러는 `source` 단계에서 축을 도출합니다.
`actor`를 뺀 고정 소스는 `change`, `actor`는 `actor`, 파일과 sidecar 바인딩은 `world`,
대화 기록 바인딩은 `history`입니다. 적용 범위만으로 축이 추가되지는 않습니다. 본체의 관계와
도출한 축이 선택한 기전의 허용 범위에 들어가야 합니다. 증인의 추출 소스도 축에 포함합니다.
기전이 비교 조건을 만들어 주지는 않으므로 추출과 관계는 직접 작성해야 합니다.

| 기전 | 허용하는 축 | 허용하는 본체 관계 | 용도 또는 필수 구조 |
|---|---|---|---|
| `pairing` | `world` | `equal`, `subset` | 공급한 파일에서 대응하는 데이터를 비교합니다. |
| `companion` | `change`, `world` | `implies` | 다른 추출에 대응하는 키가 있어야 합니다. |
| `monotonic-order` | `change`, `world` | `ordered` | 나열된 값의 순서를 확인합니다. |
| `fingerprint-sync` | `world` | `equal` | 추출한 지문 값을 비교합니다. |
| `producer-owned` | `actor` | `empty`, `nonEmpty` | 관측된 작업 주체를 확인합니다. |
| `self-absolution-ban` | `change` | `unchanged`, `empty` | 파일 자체 내용의 변경을 검사합니다. |
| `actor-scope` | `actor` | `empty`, `nonEmpty` | 관측된 주체에 따라 작업을 제한합니다. |
| `precedent` | `history`, `world` | `nonEmpty` | 선행 증거를 요구합니다. |
| `phase-order` | `history` | `ordered` | 추출한 관측 순번을 비교합니다. |
| `turn-locality` | `history` | `nonEmpty` | 지정한 시간 범위 안의 증거를 요구합니다. |
| `stated-ground` | `history` | `nonEmpty` | 패턴에 일치하는 사용자 발언을 요구합니다. |
| `controlled-vocabulary` | `change`, `world` | `subset` | 추출한 값을 허용 집합과 비교합니다. |
| `naming` | `change` | `empty`, `nonEmpty` | `scope.source`는 `target.path`여야 합니다. |
| `added-only` | `change` | `empty` | 주로 `post`와 `pre`의 차이를 비교합니다. |
| `one-way-marker` | `change` | `subset` | 선택한 값이 계속 존재하는지 확인합니다. |
| `delegated-scope` | — | — | 예약 이름이며 로드 시점에 거부됩니다. |
| `scoped-valve` | `change`, `actor`, `world`, `history` | 관계 7개 모두 | 선언의 `witness` 블록이 필수입니다. |
| `forbidden-command` | `change` | `empty` | `scope.source`는 `command`여야 합니다. |

이름 18개에는 예약 이름 하나가 포함되므로 사용할 수 있는 것은 17개입니다. 기전 제약과
[규율 목록 배치](../configuration/index.ko.md#placement-rule)는 별도로 검사합니다.

<a id="validation"></a>
## 선언 검증하기

`pnpm exec pdks explain`을 실행해 의도한 표면에 항목이 `declare`로 등록됐는지 확인하세요.
등록되지 않은 단계, 잘못된 단계 인수, 쌍·단일 불일치처럼 컴파일할 수 없는 선언은 지원하지
않는 키나 잘못된 소스·목록 조합과 마찬가지로 설정 로드 단계에서 위치와 사유를 알리며 실패합니다.

이후 해당 표면에서 위반 입력과 정상 입력을 각각 실행하세요.
[번역 파일 예제](../../how-to/write-disciplines.ko.md#locale-key-pairing)를 참고할 수 있습니다.
`advised`와 `skipped`도 종료 코드 0일 수 있으므로 종료 코드만으로 판단하지 마세요.
