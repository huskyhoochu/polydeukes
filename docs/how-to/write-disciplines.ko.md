# 규율 작성하기

[English](../how-to/write-disciplines.md) · **한국어**

규율(discipline)은 확인하고 싶은 개발 관행을 선언한 항목입니다. 관측할 파일이나 세션의
증거를 고르고, 추출 과정과 관계를 적은 다음 위반과 정상 사례를 각각 실행합니다.
관측 결과를 보고 차단이 필요하다고 판단하기 전까지는 기본 강제 수준인 `advise`를 유지합니다.

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

<a id="which-list"></a>
## 어느 목록에 적는가

규율 목록은 셋이고, 항목이 어느 목록에 속하는지는 소스 축이 정합니다. 기전이 정하지도 않고
관계가 정하지도 않습니다. 같은 `companion` 기전이라도 `file` 소스 위에 서면 `disciplines`에
있고 `changes` 위에 서면 `changeSetDisciplines`에 있습니다. 선언의 소스를 읽으면 목록이
따라 나옵니다.

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

표면이 공급해야 할 것을 본체가 읽지 않아도 실제로는 표면에 묶이는 항목이 있습니다. 대화
기록을 읽는 밸브(`witness`)가 달린 항목은 밸브 자신의 `extract`가 대화 기록을 묶으므로 세션
항목이 됩니다.

<a id="posture"></a>
## 무인 실시간 표면의 기본 자세

무인 실시간 표면은 터미널 앞에 사람이 없는 어댑터 훅이나 SDK 호출자입니다. 사람이 지켜보는
자리에는 적용되지 않는 규칙 둘이 이곳에 적용됩니다.

**루프가 회차 안에서 스스로 고치지 못하는 항목을 `enforce: block`으로 올립니다.** 기준은
"되돌릴 수 없는가"가 아닙니다. 실시간 차단의 비용은 초 단위입니다. 모델이 stderr의 사유를
읽고 다시 시도하므로 위반이 그 회차 안에서 고쳐집니다. `advise`로 두면 같은 위반이 뒤의
검사, 곧 테스트 실행이나 CI나 리뷰어에게까지 가서 회차 하나를 쓰며 최대 45분이 듭니다.
"무인이니 전부 차단"이라는 뜻은 아닙니다. 차단은 회피를 낳고 회피는 텔레메트리 행을 남기지
않으므로, 루프가 손댈 수 없는 항목은 위반이라도 기록되는 `advise`에 두는 편이 낫습니다. 이
기준은 설정 저자의 것입니다.

**밸브가 없으므로 사유가 값으로 돌아옵니다.** 실시간 무인 표면에는 증인 밸브가 없습니다.
TTY도 사람의 턴도 없고, SDK는 증인 인자를 받지 않으며 세션을 지어내지도 않습니다. 그 자리를
대신하는 것이 사유를 데이터로 돌려주는 일입니다. `checkCovenant`는
`{ verdict: 'blocked', reason }`을 돌려주며 `reason`은 판정기 자신의 stderr이고,
`{ verdict: 'upheld', advisories }`는 종료 코드 0인 실행의 권고 줄을 싣습니다. 소비자는 그
텍스트를 사람이 나중에 읽는 자리, 곧 이슈나 로그에 적고 멈춥니다. 권고 텍스트를 모델에게
보일지도 소비자가 정합니다. 무인 루프에는 stderr 한 줄을 읽을 사람이 없으므로, 호출자가
전달해야 권고가 소비됩니다. 판정 결과의 모양은
[`@polydeukes/sdk-ts` 참조](../reference/packages/sdk-ts.ko.md)에 있습니다.

SDK 자신의 기본값은 실행 전체에 대한 `enforce: 'block'`이며, 이것은 표면의 강제 수준이지
항목의 것이 아닙니다. 보호 경로와 `enforce: block` 항목이 호출을 멈추고, 나머지 위반은
`advised`로 기록됩니다. 두 어댑터도 같은 방식으로 판정기를 스폰합니다.

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
