# 규율 작성하기

[English](../how-to/write-disciplines.md) · **한국어**

규율(discipline)은 확인하고 싶은 개발 관행을 선언한 항목입니다. 관측할 파일이나 세션의
증거를 고르고, 추출 과정과 관계를 적은 다음 위반과 정상 사례를 각각 실행합니다.
관측 결과를 보고 차단이 필요하다고 판단하기 전까지는 기본 강제 수준인 `advise`를 유지합니다.

관계와 추출 연산의 전체 문법은 [선언 언어 참조](../reference/declaration-language/index.ko.md)에서 확인할 수 있습니다.

<a id="locale-key-pairing"></a>
## 번역 키 짝 맞춤

두 JSON 번역 파일의 키 집합을 비교합니다. 중첩된 키도 비교 대상입니다.
아래 전체 YAML을 **예제 프로젝트**의 `polydeukes.config.yaml`로 저장합니다. 기존 프로젝트의
설정을 덮어쓰지 마세요. 기존 설정에 추가할 때는 규율 항목만 복사합니다. 아래 YAML에는
`protectedPaths`와 `witness` 블록이 없으므로, 생성된 설정 위에 그대로 저장하면 증인 밸브가
사라집니다.
설치 절차는 [첫 판정 튜토리얼](../tutorials/first-judgment.ko.md)에 있습니다.

```yaml
languages:
  json:
    productionGlob: 'locales/**/*.json'
    testCmd: 'pnpm test'
telemetry:
  logPath: '.polydeukes/roi.log'
disciplines:
  - id: 'locale-key-parity'
    why: 'the ko and en locales must carry the same keys'
    declare:
      mechanism: 'pairing'
      sources:
        ko: { file: 'locales/ko.json' }
        en: { file: 'locales/en.json' }
      supply: { ko: 'error', en: 'error' }
      scope: { source: 'target.path', include: ['^locales/(ko|en)\.json$'] }
      extract:
        koKeys:
          - { op: 'source', of: 'ko' }
          - { op: 'json' }
          - { op: 'flattenKeys' }
        enKeys:
          - { op: 'source', of: 'en' }
          - { op: 'json' }
          - { op: 'flattenKeys' }
      relate:
        - id: 'parity'
          relation: { op: 'equal', of: ['koKeys', 'enKeys'] }
          messageBySide:
            left: '{key} is in ko only'
            right: '{key} is in en only'
```

`flattenKeys`는 번역 값이 아니라 키를 추출합니다. `equal`은 양방향으로 비교하고,
`messageBySide`는 어느 파일에 짝이 없는 키가 있는지 알려 줍니다. 기본 강제 수준은
`advise`입니다. 소스 파일 둘 다 존재하고 올바른 JSON이어야 합니다. 변경 집합 표면은 선택한
관측 범위에서 파일을 읽고, 세션 편집에서는 바뀌는 파일의 편집 후 내용을 사용합니다.

예제 프로젝트 루트에서 키가 같은 파일을 만들고 git 추적 대상으로 등록합니다.
아래 커밋에는 평소 사용하는 git 작성자 설정이 필요합니다. 이 커밋이 작업 트리 비교의
기준이 됩니다.

```sh
mkdir -p locales
printf '{"home":"Home"}\n' > locales/en.json
printf '{"home":"홈"}\n' > locales/ko.json
git add locales/en.json locales/ko.json
git commit -m 'docs: prepare locale example'
printf '{"home":"Home","settings":"Settings"}\n' > locales/en.json
git diff HEAD | pnpm exec pdks covenant check --diff
```

`locale-key-parity`의 `advised` 진단에 영어에만 있는 `settings` 키가 나와야 합니다.
권고이므로 명령은 종료 코드 0으로 끝납니다. 한국어 파일에 빠진 키를 추가하고 같은 검사를 반복합니다.

```sh
printf '{"home":"홈","settings":"설정"}\n' > locales/ko.json
git diff HEAD | pnpm exec pdks covenant check --diff
```

이제 키 비교 진단이 없어야 합니다. 번역 값은 서로 다르지만 키는 같습니다.
확인이 끝나면 두 예제 파일을 커밋한 기준 상태로 되돌립니다.

```sh
git restore -- locales/en.json locales/ko.json
```

`git diff HEAD`는 마지막 커밋과의 차이를 냅니다. 아직 git이 추적하지 않는 파일은
`git add -N`을 거쳐야 diff에 나타납니다. 이 예제는 수정 사례를 검사하고 쉽게 원상 복구하기
위해 기준 상태를 커밋합니다.
소스 파일이 존재한다는 이유만으로 선언이 실행되지는 않습니다. 관측된 변경 중 하나
이상이 해당 선언의 적용 범위와 일치해야 합니다.

<a id="locale-key-pairing-many"></a>
### 번역 파일이 셋 이상일 때

`equal`은 추출 결과 두 개를 비교합니다. 파일이 셋 이상이면 모든 파일의 키를 모은 합집합을
만들고, 파일마다 `subset` 하나로 그 합집합을 모두 가지고 있는지 확인합니다. `onlyIn`은
합집합에 아직 없는 키만 더하므로, 여러 파일에 있는 키도 그 키가 빠진 파일마다 증인 1건으로
나옵니다. 이 방법은 `flattenKeys`가 각 항목의 키와 값에 같은 점 경로를 싣는다는 점에 기댑니다.
`onlyIn`은 키를 비교하고 `subset`은 값을 비교하기 때문입니다. 줄 번호를 키로 삼는 `lines`처럼
키와 값이 다른 추출에는 이 방법을 쓸 수 없습니다.

`ko`·`en`·`fr` 세 파일이라면 위 예제의 `locale-key-parity` 항목을 다음으로 바꿉니다. `supply:
'error'`는 없는 파일을 거부하므로, 위 절차를 실행하기 전에 같은 키를 가진 `locales/fr.json`도
만듭니다(`printf '{"home":"Accueil"}\n' > locales/fr.json`).

```yaml
  - id: 'locale-key-parity'
    why: 'every locale file must carry the same keys'
    declare:
      mechanism: 'pairing'
      sources:
        ko: { file: 'locales/ko.json' }
        en: { file: 'locales/en.json' }
        fr: { file: 'locales/fr.json' }
      supply: { ko: 'error', en: 'error', fr: 'error' }
      scope: { source: 'target.path', include: ['^locales/(ko|en|fr)\.json$'] }
      extract:
        ko: [{ op: 'source', of: 'ko' }, { op: 'json' }, { op: 'flattenKeys' }]
        en: [{ op: 'source', of: 'en' }, { op: 'json' }, { op: 'flattenKeys' }]
        fr: [{ op: 'source', of: 'fr' }, { op: 'json' }, { op: 'flattenKeys' }]
        enNew: [{ op: 'onlyIn', of: 'en', notIn: 'ko' }]
        koEn: [{ op: 'union', of: ['ko', 'enNew'] }]
        frNew: [{ op: 'onlyIn', of: 'fr', notIn: 'koEn' }]
        all: [{ op: 'union', of: ['koEn', 'frNew'] }]
      relate:
        - { id: 'ko-full', relation: { op: 'subset', of: 'all', in: 'ko' }, message: '{value} is missing from ko' }
        - { id: 'en-full', relation: { op: 'subset', of: 'all', in: 'en' }, message: '{value} is missing from en' }
        - { id: 'fr-full', relation: { op: 'subset', of: 'all', in: 'fr' }, message: '{value} is missing from fr' }
```

기준이 되는 파일은 없습니다. `ko`에만 있는 키는 `en-full`과 `fr-full`을 위반하고, `en`과
`fr`에만 있는 키는 `ko-full` 하나만 위반합니다. 파일이 하나 늘 때마다 추출 세 개(그 파일의 키,
`onlyIn`, 다음 `union`)와 관계 항목 하나가 늘고, 모든 관계 항목의 `of`는 그 마지막 `union`으로
옮깁니다.

<a id="which-list"></a>
## 어느 목록에 적는가

선언이 읽는 소스에 따라 규율 목록을 선택합니다. 예를 들어 `companion` 선언이 `file`
소스만 읽으면 `disciplines`에, `changes`를 읽으면 `changeSetDisciplines`에 적습니다.

| 선언이 읽는 것 | 목록 | 예 |
|---|---|---|
| 변경된 파일과 `file` 소스만 | `disciplines` | 파일 형상 유형들. 신규분 한정, 비가역 표식, 자기사면 금지, 통제 어휘, 이름 규약, `file` 소스 위의 동반 의무, 지문 동기, 순서 불변 |
| 대화 기록(transcript) | `sessionDisciplines` | 이력 4종. 선행 요구, 단계 순서, 턴 근접, 사전 언명 |
| 주체(actor) | `sessionDisciplines` | 생산자 전속, 주체 한정 |
| 명령줄 | `sessionDisciplines` | 명령줄 금지 |
| 스폰 기록 통로(`sidecar`) | `sessionDisciplines` | `{ sidecar: true }`를 묶는 모든 선언 |
| `changes` | `changeSetDisciplines` | 변경 집합 위의 짝 맞춤. 함께 움직여야 하는 경로 둘 사이의 `implies` |

항목은 그 소스가 가리키는 목록에 적습니다. 자리를 잘못 잡은 항목은 로드 시점 오류이고,
메시지가 항목과 그 항목이 읽는 통로와 가야 할 목록을 함께 대므로, 본문을 그대로 옮기면
됩니다. 규칙 자체와 오류 모양은
[설정 참조](../reference/configuration/index.ko.md#placement-rule)에 있습니다.

목록을 고를 때는 `witness` 블록의 소스도 포함합니다. 그 블록의 `extract`가 대화 기록을
읽으면 항목 전체를 `sessionDisciplines`에 적습니다.

<a id="posture"></a>
## 무인 실시간 표면의 기본 자세

사람이 지켜보지 않는 어댑터 훅이나 SDK 호출자는 차단과 권고를 받았을 때 어떻게 처리할지
정해야 합니다.

**권고만으로는 루프가 위반을 수정하지 않을 때 `enforce: block`을 사용합니다.** 호출자는
모델에게 사유와 재시도 방법을 전달해야 합니다. 루프가 진단에 따라 조치할 수 없는 항목은
`advise`로 두고, 기록된 위반을 사람이 검토할 수 있게 합니다. 해당 루프의 실제 관측 결과를
바탕으로 강제 수준을 선택하세요.

**진단을 호출자에게 돌려줍니다.** `checkCovenant`는 판정기의 stderr를 담은
`{ verdict: 'blocked', reason }` 또는 종료 코드 0인 실행의 권고를 담은
`{ verdict: 'upheld', advisories }`를 반환합니다. SDK는 별도의 증인 인자를 받지 않습니다.
호출자는 진단을 모델에게 전달할지, 이슈나 로그에 기록할지, 재시도하거나 중단할지 정합니다.
권고도 호출자가 전달해야 모델이 읽을 수 있습니다.
반환 타입은 [SDK 참조](../reference/packages/sdk-ts.ko.md#verdicts)에 있습니다.

SDK는 실행 전체에 기본값 `enforce: 'block'`을 적용합니다. 이 수준에서는 보호 경로와
`enforce: block` 항목이 호출을 멈출 수 있고, 나머지 규율 위반은 `advised`로 기록됩니다.
세 에이전트 어댑터도 같은 설정을 사용합니다.

<a id="when-to-draft"></a>
## 선언 대신 초안으로 남길 때

필요한 약속이지만 현재 문법으로 표현할 수 없다면 `draft`로 등록합니다.

```yaml
languages:
  json:
    productionGlob: 'locales/**/*.json'
    testCmd: 'pnpm test'
disciplines:
  - id: 'benchmark-supports-performance-claim'
    why: 'a performance claim must be supported by a fresh benchmark run during judgment.'
    draft: true
```

`draft: true`인 항목은 판정 결과나 텔레메트리 행을 남기지 않습니다. 설정에는 등록돼
있으므로 `pdks explain`에서 확인할 수 있습니다.

<a id="proof-runs"></a>
## 한 번은 실제로 판정해 보기

설정을 저장한 뒤에는 필요한 증거를 공급할 수 있는 판정 경로로 위반과 정상 사례를 모두
검사합니다. `git diff HEAD | pdks covenant check --diff`는 현재 작업 트리의 변경을 판정하고,
`pdks explain`은 선언과 초안의 등록 상태를 보여 줍니다. 위 번역 예제처럼 한쪽 파일만
바꾼 경우와 양쪽 키를 맞춘 경우를 비교하세요.

판정 결과가 나타나지 않으면 먼저 관측 조건을 확인합니다. 무시 대상이 아닌 관측 파일인지,
선택한 비교에서 실제로 바뀌었는지, 적용 범위가 맞는지, 해당 표면이 증거를 공급할 수 있는지
차례로 살펴봅니다. `pdks explain`과 로그에서 `config-fault`, `no-observation`,
`supply-pass`도 확인합니다. 진단이 없다는 사실만으로 선언이 작동한다고 판단하지 마세요.

위 초안은 키 비교와 다른 요구입니다. 현재 엔진은 판정 도중 새 벤치마크를 실행하지 않습니다.
이미 공급된 증거를 비교하는 것과 판정 도중 새 벤치마크를 실행하는 것은 다른 요구입니다.
[선언과 관측 한계](../concepts/judgment.ko.md#declarations)를 참고하세요.
