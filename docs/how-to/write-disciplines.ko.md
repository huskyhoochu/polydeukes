# 규율 작성하기

[English](../how-to/write-disciplines.md) · **한국어**

규율(discipline)은 확인하고 싶은 개발 관행을 선언한 항목입니다. 관측할 파일이나 세션의
증거를 고르고, 추출 과정과 관계를 적은 다음 위반과 정상 사례를 각각 실행합니다.
관측 결과를 보고 차단이 필요하다고 판단하기 전까지는 기본 강제 수준인 `advise`를 유지합니다.

<a id="locale-key-pairing"></a>
## 번역 키 짝 맞춤

두 JSON 번역 파일의 키 집합을 비교합니다. 중첩된 키도 비교 대상입니다.
아래 전체 YAML을 **예제 프로젝트**의 `polydeukes.config.yaml`로 저장합니다. 기존 프로젝트의
설정을 덮어쓰지 마세요. 기존 설정에 추가할 때는 규율 항목만 복사합니다.
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
`advise`입니다. 소스 파일 둘 다 존재하고 올바른 JSON이어야 합니다. 커밋 표면은 선택한
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
pnpm exec pdks covenant check --worktree
```

`locale-key-parity`의 `advised` 진단에 영어에만 있는 `settings` 키가 나와야 합니다.
권고이므로 명령은 종료 코드 0으로 끝납니다. 한국어 파일에 빠진 키를 추가하고 같은 검사를 반복합니다.

```sh
printf '{"home":"홈","settings":"설정"}\n' > locales/ko.json
pnpm exec pdks covenant check --worktree
```

이제 키 비교 진단이 없어야 합니다. 번역 값은 서로 다르지만 키는 같습니다.
확인이 끝나면 두 예제 파일을 커밋한 기준 상태로 되돌립니다.

```sh
git restore -- locales/en.json locales/ko.json
```

`--worktree`는 git이 추적하지 않더라도 무시 대상이 아닌 파일을 추가된 파일로 포함합니다.
이 예제는 수정 사례를 검사하고 쉽게 원상 복구하기 위해 기준 상태를 커밋합니다.
소스 파일이 존재한다는 이유만으로 선언이 실행되지는 않습니다. 관측된 변경 중 하나
이상이 해당 선언의 적용 범위와 일치해야 합니다.

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
검사합니다. `pdks covenant check --worktree`는 현재 작업 트리의 변경을 판정하고,
`pdks explain`은 선언과 초안의 등록 상태를 보여 줍니다. 위 번역 예제처럼 한쪽 파일만
바꾼 경우와 양쪽 키를 맞춘 경우를 비교하세요.

판정 결과가 나타나지 않으면 먼저 관측 조건을 확인합니다. 무시 대상이 아닌 관측 파일인지,
선택한 비교에서 실제로 바뀌었는지, 적용 범위가 맞는지, 해당 표면이 증거를 공급할 수 있는지
차례로 살펴봅니다. `pdks explain`과 로그에서 `config-fault`, `no-observation`,
`supply-pass`도 확인합니다. 진단이 없다는 사실만으로 선언이 작동한다고 판단하지 마세요.

위 초안은 키 비교와 다른 요구입니다. 현재 엔진은 판정 도중 새 벤치마크를 실행하지 않습니다.
이미 공급된 증거를 비교하는 것과 판정 도중 새 벤치마크를 실행하는 것은 다른 요구입니다.
[선언과 관측 한계](../concepts/judgment.ko.md#declarations)를 참고하세요.
