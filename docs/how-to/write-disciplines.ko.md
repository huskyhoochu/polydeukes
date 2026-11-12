# 규율 작성하기

[English](../how-to/write-disciplines.md) · **한국어**

규율(discipline)은 확인하고 싶은 개발 관행을 선언한 항목입니다. 관측할 파일이나 세션의 증거를
고르고, 추출 과정과 관계를 적은 다음 위반과 정상 사례를 각각 실행합니다. 관측 결과를 보고 차단이
필요하다고 판단하기 전까지는 기본 강제 수준인 `advise`를 유지합니다.

문법을 배우기 전에 [에이전트의 작업 삭제를 막는 레시피](../recipes/work-stays-recoverable.ko.md)를
복사해 보세요.

관계와 추출 연산의 전체 문법은 [선언 언어 참조](../reference/declaration-language/index.ko.md)에서
확인할 수 있습니다.

<a id="design-a-discipline"></a>
## 확인할 약속부터 정하기

규율을 쓰기 전에 정상 사례 하나와 위반 사례 하나를 적습니다. “좋은 코드를 작성한다” 대신 “편집으로
요청 래퍼 밖에 직접 요청을 추가해서는 안 된다”처럼 관측 가능한 비교로 좁힙니다.

| 질문                       | 선택                                                  |
| -------------------------- | ----------------------------------------------------- |
| 어떤 변화에서 검사할까?    | scope에 경로 또는 명령 범위를 지정                    |
| 무엇을 비교할까?           | 변경 전후 내용, 이름 붙인 파일, 명령, 주체, 대화 기록 |
| 비교할 단위는?             | 줄, JSON 키, 이름, 해시처럼 추출 가능한 값            |
| 어떤 관계가 성립해야 할까? | empty, equal, subset 등 선언 언어의 관계              |
| 증거가 없으면?             | supply의 error, pass, empty 중 실제 의미에 맞는 정책  |
| 언제 막을까?               | advise로 정상·위반을 확인한 뒤 block 선택             |

증거가 없다는 이유로 empty를 쓰면 “관측하지 못함”을 “아무것도 없음”으로 바꿉니다. 빈 내용이 문제의
실제 의미일 때만 사용하세요. pass는 약속이 지켜졌다는 기록이 아니라 건너뛴 관측을 남깁니다. 기본값인
`error`는 소스가 없어 판정할 수 없는 관측을 `advise`에서도 차단합니다
([공급 정책](../reference/declaration-language/index.ko.md#supply-policies) 참고).
[설정 참조](../reference/configuration/index.ko.md#discipline-lists)에서 증거에 맞는 규율 목록을
선택하고 `pdks explain`으로 조립을 확인합니다.

<a id="verification-loop"></a>
## 규율을 검증하는 순서

1. 임시 Git 프로젝트에서 완전한 설정과 필요한 파일을 준비합니다.
2. `pdks explain`이 설정을 읽고 해당 규율을 조립하는지 확인합니다.
3. 정상 입력과 위반 입력을 각각 실행하고 규율 ID·사유·텔레메트리를 확인합니다.
4. 관측 범위 밖 입력도 넣어 의도한 파일만 검사하는지 봅니다.
5. 실제 연결할 [표면](../concepts/judgment.ko.md#terms)에서 같은 검사를 합니다. 세션 편집은 파일
   전체의 변경 전후 내용을 `pre`와 `post`로 공급합니다. diff 입력의 수정은 변경 구간의 `-`와 `+`
   줄만 공급합니다([diff 변환](../reference/cli/covenant-check.ko.md#diff-translation) 참고).
6. 일상 작업에서 조언을 관찰한 뒤 필요한 항목의 강제 수준을 올립니다.

[아래 요청 래퍼 예제](#added-line-check)는 위반, 수정한 변경, 관측 범위 밖 변경을 실행합니다.

<a id="added-line-check"></a>
## 요청은 요청 래퍼를 거치게 하기

이 선언은 관측 범위 안의 파일에서 `fetch(`를 포함한 줄이 변경 전보다 늘면 보고합니다.
`src/http/client.ts`를 제외한 `src/` 아래 TypeScript 파일을 검사합니다. 해당 래퍼를 거치는 요청에는
래퍼의 타임아웃이 적용됩니다.

[`pdks` 실행 파일](./install.ko.md)을 설치한 뒤, 예제용 빈 Git 프로젝트를 만듭니다:

```sh
mkdir pdks-request-example
cd pdks-request-example
git init
```

아래 전체 YAML을 이 예제 프로젝트의 `polydeukes.config.yaml`로 저장합니다. 기존 프로젝트의 설정을
덮어쓰지 마세요. 이 YAML에는 `protectedPaths`와 `witness` 블록이 없으므로, 생성된 설정을 이 내용으로
교체하면 증인 밸브가 사라집니다.

기존 프로젝트에서는 규율 항목만 기존 `disciplines:` 키 아래에 넣고 `telemetry:` 블록은 복사하지
않습니다. 프로젝트의 래퍼 파일에 맞게 `include`와 `exclude` 경로를 조정하고, `before`와 `after`의 두
`re` 값을 해당 프로젝트의 직접 호출 문법에 맞는 동일한 패턴으로 바꿉니다. `id`와 `why`도 프로젝트의
용어로 다시 씁니다. 설정은 에이전트 세션에서 보호되므로,
[첫 판정 튜토리얼](../tutorials/first-judgment.ko.md)의 설명대로 사용자가 터미널에서 직접
편집합니다.

```yaml
telemetry:
  logPath: ".polydeukes/roi.log"
disciplines:
  - id: "requests-go-through-the-client"
    why: "a request made outside src/http/client.ts skips the timeout that file applies"
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^src/.+\.ts$']
        exclude: ['^src/http/client\.ts$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '(\bfetch\()' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '(\bfetch\()' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-direct-request"
          relation: { op: "empty", of: "added" }
          message: "adds a direct request: {value}"
```

`mechanism: "added-only"`는 이 선언이 수행하는 검사의 종류를 지정합니다. 로더는 해당 종류에서
허용하는 소스와 관계만 받아들입니다
([메커니즘](../reference/declaration-language/index.ko.md#mechanisms) 참고). 이 항목은 `enforce`를
생략하므로 위반이 권고로 기록됩니다.

`include`는 `src/` 아래 TypeScript 경로를 선택하고, `exclude`는 래퍼 자체를 관측 범위에서
제외합니다. `pre`와 `post`는 변경 전후 내용을 공급하고, `lines`는 각각을 줄로 나눕니다.
`keyByPattern`은 패턴에 맞는 줄을 남기고, 첫 번째 일치의 캡처 그룹 1을 키(`fetch(`)로 사용하며, 그
줄을 값으로 유지합니다. 한 줄에서는 첫 번째 일치만 남깁니다.

`onlyIn`은 `after` 항목의 키를 `before`와 비교해 항목을 선택합니다. `count: true`이면 같은 키의 항목
중 초과한 수만큼 남깁니다. `before`에 일치하는 줄이 하나, `after`에 둘이면 `added`에 하나가
남습니다. `empty` 관계는 `added`에 항목이 없어야 한다고 요구합니다. 없는 `pre`나 `post`는 `supply`에
따라 빈 내용이 되므로, 파일을 만들면 일치하는 항목이 추가될 수 있고 파일을 삭제하면 추가되지
않습니다. 메시지의 `{value}`는 값으로 유지한 일치하는 줄입니다. 이 연산들은
[선언 언어 레퍼런스](../reference/declaration-language/index.ko.md)를 참고하세요.

이 실습은 diff 입력을 사용합니다. 아래 `pdks explain` 출력의 두 블록에서 볼 수 있듯이 같은 항목이
에이전트 세션의 편집 호출에도 적용됩니다. 변경 전후에 일치하는 줄의 수를 비교하므로, 파일을 수정한
diff에서는 변경 구간의 줄로 비교해도 전체 파일로 비교할 때와 결과가 같습니다
([diff 변환](../reference/cli/covenant-check.ko.md#diff-translation) 참고).

`pdks explain`을 실행해 항목이 로드되는지 확인합니다:

```text
pdks explain — polydeukes.config.yaml

input: call IR (one call, stdin) · disciplines 1 · sessionDisciplines 0 · disciplines: advise unless enforce: block · meta: block
  registrations 4 · declare 1 · skip 1 · meta 2 · draft 0
  meta     self-mod                       paths 1 (includes the config file itself)
  meta     transcript-mod                 content predicate · conditional: session.evidencePath
  declare  requests-go-through-the-client added-only · change · empty no-direct-request · scope target.path · include 1 · exclude 1 · sources 0 · valve — · why ✓ · unattended: judge
  skip     shell-unjudgeable              a shell command whose write target this layer cannot determine

input: --diff (change set, stdin) · disciplines 1 · disciplines: advise unless enforce: block
  registrations 3 · declare 1 · skip 1 · meta 1 · draft 0
  meta     self-mod                       paths 1 (includes the config file itself)
  declare  requests-go-through-the-client added-only · change · empty no-direct-request · scope target.path · include 1 · exclude 1 · sources 0 · valve — · why ✓
  skip     shell-unjudgeable              a shell command whose write target this layer cannot determine
```

첫 번째 블록은 에이전트 세션의 호출 입력에 대해 조립이 만드는 표이고, 두 번째는 diff 입력에 대해
조립이 만드는 표입니다. 이 항목은 양쪽 모두에서 `declare`로 나타납니다. 각 필드는
[`pdks explain` 참조](../reference/cli/explain.ko.md)를 참고하세요.

예제 프로젝트 루트에서 추적할 파일을 준비합니다. 아래 커밋에는 평소 사용하는 로컬 git 작성자 설정이
필요하며, 이 커밋이 비교의 기준이 됩니다:

```sh
mkdir -p src/http
printf 'export const request = (url: string) => fetch(url, { signal: AbortSignal.timeout(5000) });\n' > src/http/client.ts
printf "import { request } from './http/client';\n\nexport const loadOrders = () => request('/orders');\n" > src/orders.ts
git add src
git commit -m 'docs: prepare request example'
```

직접 요청을 추가하고 diff를 검사합니다:

```sh
printf "\nexport const loadUsers = () => fetch('/users');\n" >> src/orders.ts
git diff HEAD | pdks covenant check --diff
```

명령은 종료 코드 0으로 끝나고 표준 오류에 다음 줄을 출력합니다:

```text
discipline 'requests-go-through-the-client' broken on src/orders.ts: adds a direct request: export const loadUsers = () => fetch('/users'); — why: a request made outside src/http/client.ts skips the timeout that file applies
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

래퍼를 사용하도록 변경을 수정하고 다시 검사합니다:

```sh
git restore -- src/orders.ts
printf "\nexport const loadUsers = () => request('/users');\n" >> src/orders.ts
git diff HEAD | pdks covenant check --diff
```

명령은 아무것도 출력하지 않고 종료 코드 0으로 끝납니다. 이제 래퍼 자체에 관측 범위 밖 변경을 만들어
봅니다:

```sh
git restore -- src/orders.ts
printf "export const ping = () => fetch('/ping');\n" >> src/http/client.ts
git diff HEAD | pdks covenant check --diff
```

명령은 아무것도 출력하지 않고 종료 코드 0으로 끝납니다. 이 경로에서는 이 규율을 판정하지 않습니다.
확인이 끝나면 래퍼를 되돌립니다:

```sh
git restore -- src/http/client.ts
```

세 번의 검사는 `.polydeukes/roi.log`에 다음 행을 남깁니다. 여기서는 타임스탬프 필드를 생략했으며,
필드 사이는 탭으로 구분합니다:

```text
advised	requests-go-through-the-client	src/orders.ts	[{"id":"no-direct-request","witnesses":[{"key":"fetch(","value":"export const loadUsers = () => fetch('/users');"}],"total":1}]
passed	requests-go-through-the-client	src/orders.ts
passed	covenant-check	src/http/client.ts
```

수정한 변경에는 이 규율의 `passed` 행이 있습니다. 관측 범위 밖 변경에는 일반 `covenant-check` 행만
있으며, 이 규율의 판정을 받고 지나갔다는 증거가 되지 않습니다.

<a id="locale-key-pairing"></a>
## 번역 키 짝 맞춤

이 예제는 두 JSON 번역 파일의 키를 비교해 파일 간 내용의 일관성을 유지합니다. 중첩된 키도
비교합니다.

아래 YAML은 완전한 설정 파일입니다. 새 디렉터리에서 `git init`으로 만든 빈 예제 프로젝트에
`polydeukes.config.yaml`로 저장합니다. 예제 프로젝트를 만드는 명령은
[요청 래퍼 예제](#added-line-check)에 있습니다.

기존 프로젝트의 설정을 덮어쓰지 마세요. 기존 프로젝트에서는 규율 항목만 기존 `disciplines:` 아래에
넣습니다. 이 YAML에는 `protectedPaths`와 `witness` 블록이 없으므로, 생성된 설정 위에 그대로 저장하면
증인 밸브가 사라집니다.

앞 절의 예제 프로젝트를 이어서 쓴다면 앞 절의 항목 아래에 이 항목을 추가해도 됩니다.

```yaml
telemetry:
  logPath: ".polydeukes/roi.log"
disciplines:
  - id: "locale-key-parity"
    why: "the ko and en locales must carry the same keys"
    declare:
      mechanism: "pairing"
      sources:
        ko: { file: "locales/ko.json" }
        en: { file: "locales/en.json" }
      supply: { ko: "error", en: "error" }
      scope: { source: "target.path", include: ['^locales/(ko|en)\.json$'] }
      extract:
        koKeys:
          - { op: "source", of: "ko" }
          - { op: "json" }
          - { op: "flattenKeys" }
        enKeys:
          - { op: "source", of: "en" }
          - { op: "json" }
          - { op: "flattenKeys" }
      relate:
        - id: "parity"
          relation: { op: "equal", of: ["koKeys", "enKeys"] }
          messageBySide:
            left: "{key} is in ko only"
            right: "{key} is in en only"
```

`flattenKeys`는 번역 값이 아니라 키를 추출합니다. `equal`은 양방향으로 비교하고, `messageBySide`는
어느 파일에 짝이 없는 키가 있는지 알려 줍니다. 기본 강제 수준은 `advise`입니다. 소스 파일 둘 다
존재하고 올바른 JSON이어야 합니다. 변경 집합 표면은 선택한 관측 범위에서 파일을 읽고, 세션
편집에서는 바뀌는 파일의 편집 후 내용을 사용합니다.

예제 프로젝트 루트에서 키가 같은 파일을 만들고 git 추적 대상으로 등록합니다. 아래 커밋에는 평소
사용하는 git 작성자 설정이 필요합니다. 이 커밋이 작업 트리 비교의 기준이 됩니다.

```sh
mkdir -p locales
printf '{"home":"Home"}\n' > locales/en.json
printf '{"home":"홈"}\n' > locales/ko.json
git add locales/en.json locales/ko.json
git commit -m 'docs: prepare locale example'
printf '{"home":"Home","settings":"Settings"}\n' > locales/en.json
git diff HEAD | pdks covenant check --diff
```

`locale-key-parity`의 `advised` 진단에 영어에만 있는 `settings` 키가 나와야 합니다. 권고이므로
명령은 종료 코드 0으로 끝납니다. 한국어 파일에 빠진 키를 추가하고 같은 검사를 반복합니다.

```sh
printf '{"home":"홈","settings":"설정"}\n' > locales/ko.json
git diff HEAD | pdks covenant check --diff
```

이제 키 비교 진단이 없어야 합니다. 번역 값은 서로 다르지만 키는 같습니다. 확인이 끝나면 두 예제
파일을 커밋한 기준 상태로 되돌립니다.

```sh
git restore -- locales/en.json locales/ko.json
```

`git diff HEAD`는 마지막 커밋과의 차이를 냅니다. 아직 git이 추적하지 않는 파일은 `git add -N`을
거쳐야 diff에 나타납니다. 이 예제는 수정 사례를 검사하고 쉽게 원상 복구하기 위해 기준 상태를
커밋합니다. 소스 파일이 존재한다는 이유만으로 선언이 실행되지는 않습니다. 관측된 변경 중 하나 이상이
해당 선언의 적용 범위와 일치해야 합니다.

<a id="locale-key-pairing-many"></a>
### 번역 파일이 셋 이상일 때

이 예제는 세 개 이상 파일 사이에서 내용의 일관성을 유지합니다.

`equal`은 추출 결과 두 개를 비교합니다. 파일이 셋 이상이면 모든 파일의 키를 모은 합집합을 만들고,
파일마다 `subset` 하나로 그 합집합을 모두 가지고 있는지 확인합니다. `onlyIn`은 합집합에 아직 없는
키만 더하므로, 여러 파일에 있는 키도 그 키가 빠진 파일마다 증인 1건으로 나옵니다. 이 방법은
`flattenKeys`가 각 항목의 키와 값에 같은 점 경로를 싣는다는 점에 기댑니다. `onlyIn`은 키를 비교하고
`subset`은 값을 비교하기 때문입니다. 줄 번호를 키로 삼는 `lines`처럼 키와 값이 다른 추출에는 이
방법을 쓸 수 없습니다.

`ko`·`en`·`fr` 세 파일이라면 위 예제의 `locale-key-parity` 항목을 다음으로 바꿉니다.
`supply: 'error'`는 없는 파일을 거부하므로, 위 절차를 실행하기 전에 같은 키를 가진
`locales/fr.json`도 만듭니다(`printf '{"home":"Accueil"}\n' > locales/fr.json`).

```yaml
- id: "locale-key-parity"
  why: "every locale file must carry the same keys"
  declare:
    mechanism: "pairing"
    sources:
      ko: { file: "locales/ko.json" }
      en: { file: "locales/en.json" }
      fr: { file: "locales/fr.json" }
    supply: { ko: "error", en: "error", fr: "error" }
    scope: { source: "target.path", include: ['^locales/(ko|en|fr)\.json$'] }
    extract:
      ko: [{ op: "source", of: "ko" }, { op: "json" }, { op: "flattenKeys" }]
      en: [{ op: "source", of: "en" }, { op: "json" }, { op: "flattenKeys" }]
      fr: [{ op: "source", of: "fr" }, { op: "json" }, { op: "flattenKeys" }]
      enNew: [{ op: "onlyIn", of: "en", notIn: "ko" }]
      koEn: [{ op: "union", of: ["ko", "enNew"] }]
      frNew: [{ op: "onlyIn", of: "fr", notIn: "koEn" }]
      all: [{ op: "union", of: ["koEn", "frNew"] }]
    relate:
      - {
          id: "ko-full",
          relation: { op: "subset", of: "all", in: "ko" },
          message: "{value} is missing from ko",
        }
      - {
          id: "en-full",
          relation: { op: "subset", of: "all", in: "en" },
          message: "{value} is missing from en",
        }
      - {
          id: "fr-full",
          relation: { op: "subset", of: "all", in: "fr" },
          message: "{value} is missing from fr",
        }
```

기준이 되는 파일은 없습니다. `ko`에만 있는 키는 `en-full`과 `fr-full`을 위반하고, `en`과 `fr`에만
있는 키는 `ko-full` 하나만 위반합니다. 파일이 하나 늘 때마다 추출 세 개(그 파일의 키, `onlyIn`, 다음
`union`)와 관계 항목 하나가 늘고, 모든 관계 항목의 `of`는 그 마지막 `union`으로 옮깁니다.

<a id="which-list"></a>
## 어느 목록에 적는가

두 목록은 두 목적을 나타냅니다. `disciplines`는 결과를 검증합니다. 변경 집합 표면은 작업이 저장소에
기록되기 전에 그 선언들을 판정합니다. 세션 표면도 변경된 파일 자신의 `pre`/`post`/`state`,
`target.path`, `file` 소스를 읽는 항목을 위반이 발생하는 호출에서 판정합니다. `file` 소스를 읽는
`companion` 선언과 `changes`를 읽는 선언은 모두 `disciplines`에 속합니다. 호출 하나에는 변경 집합이
없으므로 세션 표면은 `changes`를 읽는 항목을 건너뜁니다. `sessionDisciplines`는 과정과 사람의 증거를
담으며 세션 표면만 판정합니다. 선언이 무엇을 읽는지가 목록을 정합니다.

| 선언이 읽는 것              | 목록                 | 예                                                                                                                                |
| --------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 변경된 파일과 `file` 소스만 | `disciplines`        | 파일 형상 유형들. 신규분 한정, 비가역 표식, 자기사면 금지, 통제 어휘, 이름 규약, `file` 소스 위의 동반 의무, 지문 동기, 순서 불변 |
| 대화 기록(transcript)       | `sessionDisciplines` | 이력 4종. 선행 요구, 단계 순서, 턴 근접, 사전 언명                                                                                |
| 주체(actor)                 | `sessionDisciplines` | 생산자 전속, 주체 한정                                                                                                            |
| 명령줄                      | `sessionDisciplines` | 명령줄 금지                                                                                                                       |
| 스폰 기록 통로(`sidecar`)   | `sessionDisciplines` | `{ sidecar: true }`를 묶는 모든 선언                                                                                              |
| `changes`                   | `disciplines`        | 변경 집합 위의 짝 맞춤. 함께 움직여야 하는 경로 둘 사이의 `implies`                                                               |

항목은 그 소스가 가리키는 목록에 적습니다. 자리를 잘못 잡은 항목은 로드 시점 오류이고, 메시지가
항목과 그 항목이 읽는 통로와 가야 할 목록을 함께 대므로, 본문을 그대로 옮기면 됩니다. 규칙 자체와
오류 모양은 [설정 참조](../reference/configuration/index.ko.md#placement-rule)에 있습니다.

목록을 고를 때는 `witness` 블록의 소스도 포함합니다. 그 블록의 `extract`가 대화 기록을 읽으면 항목
전체를 `sessionDisciplines`에 적습니다.

<a id="posture"></a>
## 무인 실시간 표면의 기본 자세

사람이 지켜보지 않는 어댑터 훅이나 SDK 호출자는 차단과 권고를 받았을 때 어떻게 처리할지 정해야
합니다.

**권고만으로는 루프가 위반을 수정하지 않을 때 `enforce: block`을 사용합니다.** 호출자는 모델에게
사유와 재시도 방법을 전달해야 합니다. 루프가 진단에 따라 조치할 수 없는 항목은 `advise`로 두고,
기록된 위반을 사람이 검토할 수 있게 합니다. 해당 루프의 실제 관측 결과를 바탕으로 강제 수준을
선택하세요.

**진단을 호출자에게 돌려줍니다.** `checkCovenant`는 판정기의 stderr를 담은
`{ verdict: 'blocked', reason }` 또는 종료 코드 0인 실행의 권고를 담은
`{ verdict: 'upheld', advisories }`를 반환합니다. SDK는 별도의 증인 인자를 받지 않습니다. 호출자는
진단을 모델에게 전달할지, 이슈나 로그에 기록할지, 재시도하거나 중단할지 정합니다. 권고도 호출자가
전달해야 모델이 읽을 수 있습니다. 반환 타입은
[SDK 참조](../reference/packages/sdk-ts.ko.md#verdicts)에 있습니다.

SDK는 실행 전체에 기본값 `enforce: 'block'`을 적용합니다. 이 수준에서는 보호 경로와 `enforce: block`
항목이 호출을 멈출 수 있고, 나머지 규율 위반은 `advised`로 기록됩니다. 세 에이전트 어댑터도 같은
설정을 사용합니다.

<a id="when-to-draft"></a>
## 선언 대신 초안으로 남길 때

필요한 약속이지만 현재 문법으로 표현할 수 없다면 `draft`로 등록합니다.

```yaml
disciplines:
  - id: "benchmark-supports-performance-claim"
    why: "a performance claim must be supported by a fresh benchmark run during judgment."
    draft: true
```

`draft: true`인 항목은 판정 결과나 텔레메트리 행을 남기지 않습니다. 설정에는 등록돼 있으므로
`pdks explain`에서 확인할 수 있습니다.

<a id="proof-runs"></a>
## 한 번은 실제로 판정해 보기

설정을 저장한 뒤에는 실제로 해당 설정을 관측할 수 있는 판정 경로를 실행합니다.

- 요청 래퍼 예제에서는 직접 요청을 추가하면 권고를 기록하고, 래퍼를 사용하면 판정을 받고 지나갑니다.
- `git diff HEAD | pdks covenant check --diff`는 현재 작업 트리에 대해 번역 키 짝 맞춤 예제의 항목을
  검사합니다.
- `pdks explain`은 등록 상태와 해당 항목이 선언인지 초안인지를 보여 줍니다.
- 짝 맞춤 예제는 `locales/en.json`이나 `locales/ko.json` 중 한쪽만 편집해 간단히 확인할 수 있습니다.

판정 결과가 나타나지 않으면 먼저 관측 조건을 확인합니다. 무시 대상이 아닌 관측 파일인지, 선택한
비교에서 실제로 바뀌었는지, 적용 범위가 맞는지, 해당 표면이 증거를 공급할 수 있는지 차례로
살펴봅니다. `pdks explain`과 로그에서 `no-observation`, `supply-pass`도 확인합니다. 진단이 없다는
사실만으로 선언이 작동한다고 판단하지 마세요.

위 초안은 판정 도중 새 벤치마크를 실행할 것을 요구합니다. 요청 예제와 번역 예제는 검사에 공급된
증거를 비교합니다. 현재 엔진은 판정 도중 새 벤치마크를 실행하지 않습니다. 공급된 증거는 비교할 수
있지만, 그것은 같은 약속이 아닙니다. [선언과 관측 한계](../concepts/judgment.ko.md#declarations)를
참고하세요.
