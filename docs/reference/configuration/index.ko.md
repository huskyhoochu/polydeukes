# 설정 참조

[English](index.md) · **한국어**

`polydeukes.config.yaml`의 설정 키를 절별로 설명합니다. 설정 파일의 역할,
파일을 찾지 못했을 때의 동작, 편집기 연결 방법은
[폴리데우케스 설정하기](../../how-to/configure-project.ko.md)에 있고, 규율이 발동할 때 판정이 어떤
모습인지는 같은 문서의
[권고와 차단 중 선택하기](../../how-to/configure-project.ko.md#choose-advise-or-block) 절에 있습니다.

<a id="languages"></a>
## `languages`

필수 항목입니다. 언어 이름은 사용자 정의 키이며 `typescript`, `python` 등을 쓸 수 있습니다.
코어는 언어 이름을 하나도 내장하지 않고, 명령 문자열을 해석하지도 않습니다.

```yaml
languages:
  typescript:
    productionGlob: 'packages/*/src/**/*.ts'   # 무엇이 프로덕션 소스인가
    testCmd: 'pnpm --filter {scope} test'      # {scope}는 해석 시점에 치환된다
```

`testCmd`는 함수가 아니라 템플릿 문자열입니다. 문자열의 모든 `{scope}`를 치환하며,
그 밖의 중괄호(`${VAR}`, `{a,b}`, `awk '{print}'`)는 그대로 둡니다. `scope`를 사용하지 않는
명령(`pnpm test`)도 똑같이 유효합니다.

<a id="protectedpaths"></a>
## `protectedPaths`

선택 항목입니다. 약속(covenant)이 수정을 제한할 경로 패턴을 지정합니다. 편집 도구만이 아니라 셸
명령(`sed -i`, `tee`, 리다이렉트, heredoc, 상위 디렉터리 조작)도 같은 판정을 받습니다.
항목은 해석 시점에 정규화(공백 제거, 중복 제거)됩니다. 빈 문자열 항목은 경로 의미가
없으므로 로드 시점에 거부됩니다.

```yaml
protectedPaths:
  - 'packages/core/src'
  - '.claude/hooks'
```

**설정 파일은 자기 자신을 보호합니다.** 발견된 설정 파일은 `protectedPaths`에 자동으로
덧붙습니다. 자기 관문을 낮추려는 편집도 다른 모든 편집과 같은 판정기를 거칩니다.
규율을 선언하는 파일이 규율 밖에 있다면 사슬 전체가 장식이 되기 때문입니다.

<a id="adapters"></a>
## `adapters`

선택 항목입니다. 설정 파일 하나에 어댑터별 네임스페이스를 둡니다. 각 키는 어댑터 이름이며,
값은 해당 어댑터의 설정 객체입니다. 코어는 객체의 구조만 검증하고 내부 키와 값은 각 어댑터가
검증합니다. 네임스페이스 *안에* 알 수 없는 키가 있으면 해당 검증기가 이를 거부하고
오류 메시지에 전체 필드 경로를 표시합니다.

```yaml
adapters:
  git:
    enforce: advise
    protectedPaths:
      - 'packages/core/src'
```

<a id="adapters-git"></a>
### `adapters.git`, git 커밋 어댑터

| 키 | 값 | 기본값 | 의미 |
|---|---|---|---|
| `enforce` | `block` \| `advise` | `block` | 커밋 표면의 강제 수준 |
| `protectedPaths` | 문자열 배열 | `[]` | 커밋 표면만 판정하는 가산 관측 범위 |

- **`block`**은 차단 수준으로 판정하는 약속을 깨는 스테이징 변경이 있으면 커밋을
  차단합니다(exit 2). 보호 경로와 `enforce: block`으로 승격한 항목이 여기에 해당합니다.
  일반 항목은 이 설정 아래에서도 자체 기본값 `advise`를 유지합니다(아래 `enforce` 참조). 통과하는
  길은 증인(witness) 밸브뿐입니다. 사람이 TTY 프롬프트에 토큰 전체를 입력해야 하고,
  프롬프트는 무엇을 증언하는지 적습니다. 깨진 등록과 걸린 항목, 그리고 이 한 번의 답이
  커밋 전체를 덮는다는 사실입니다.
  네임스페이스가 없어도, `adapters` 맵이 없어도, `enforce` 키가 없어도 전부 `block`으로
  동작합니다. 키를 적지 않는 것이 곧 가장 엄격한 강제 수준의 선택입니다.
- **`advise`**는 커밋 표면에서 위반을 기록하되 작업을 차단하지 않게 합니다. 스테이징 변경에 내려진 판정은
  `advised` 텔레메트리 이벤트로 기록되고 커밋은 진행되며(exit 0), stderr에 권고 한 줄이
  남습니다. TTY 프롬프트는 표시하지 않습니다. 판정 기준은 유지하되 위반 시 차단하지 않는 것입니다. 판정 자체가
  불가능한 실행(설정 없음·무효, 판정 본체 해석 불가)은 어느 강제 수준에서든 exit 2로
  차단합니다.

**여기의 `protectedPaths`는 가산 범위입니다.** 커밋 표면은 최상위 `protectedPaths`와 이
목록의 합집합을 판정합니다. 공통 목록을 앞에 두고 이어 붙여 하나로 정규화하므로 철자와
중복 제거 규칙이 양쪽에 동일하게 적용됩니다. 세션 표면은 이 목록을 읽지 않습니다. 이
목록에는 세션에서 편집해도 되지만 커밋할 때는 보호해야 하는 경로를 적습니다. 판정기 소스를 여기에 둘 수 있습니다. 강제
수준과 마찬가지로 추가 범위도 관측자가 정합니다. 공통 목록에서 경로를 빼는 설정은 없습니다.
이 목록으로 보호 범위를 넓힐 수는 있지만 기존 범위를 줄일 수는 없습니다.

세션 표면(편집 시점 훅)에는 강제 수준 설정이 없습니다. 그곳에서 차단하는 것은 판정 사슬
자신의 보호입니다. 도구 축과 셸 축의 `protectedPaths` 변경과 언급, 세션 대화 기록, 판정할
수 없는 조립(설정 없음·무효, 빌드되지 않은 판정기, 파싱할 수 없는 페이로드, 답하지 못한
라우팅), 그리고 `enforce: block`으로 승격한 항목입니다. 그 밖의 모든 규율 항목은
위반 시 `advised`로 기록합니다.

**세션을 읽는 선언은 공급 정책이 `pass`일 때 커밋 표면에서 판정을 건너뜁니다.** 커밋에는 들여다볼 세션이
없으므로, `sources`가 대화 기록(transcript)을 묶는 선언 — `precedent` · `phase-order` ·
`turn-locality` · `stated-ground` 항목 — 은 그곳에서 판정할 수 없습니다. 커밋이 지닐 수 없는
증거를 요구하면 적용 범위에 해당하는 커밋이 모두 차단돼 정상 작업도 진행할 수 없습니다.
선언에 `supply: { session: 'pass' }`를 지정하면 이 부재를 허용합니다. 스테이징한 변경이 적용
범위에 해당하면 사유 `supply-pass`와 함께 `skipped`를 기록하고 이 선언으로 커밋을 차단하지 않습니다. 기록에는 항목의
`id`와 판정했을 변경이 함께 담기므로 판정하지 못한 항목을 기록에서 구별할 수 있습니다.
이 기록은 **변경이 항목의 적용 범위에 해당할 때만** 남습니다. `command`를 적용 범위의
소스로 쓰는 선언은 기록을 남기지 않습니다. 스테이징한 변경에는 명령줄이 없어 그 선언의
관측 대상이 되지 않기 때문입니다.

세션 표면이 읽을 대화 기록을 갖지 못했을 때의 처분과 같습니다. 다만 그 선언의 `supply`가
`pass`일 때입니다. 정책이 없으면 없는 소스는 판정 불가(exit 2)이지, 자동 건너뛰기가
아닙니다.

<a id="telemetry"></a>
## `telemetry`

선택입니다.

```yaml
telemetry:
  logPath: '.polydeukes/roi.log'   # 생략 시 기본값. gitignore에 두는 것을 권장
```

정상 판정, 차단, 증언, 권고, 미판정은 각각 한 줄의 기록을 남깁니다. 텔레메트리는 의도적으로
fail-open입니다. 기록 실패가 판정을 바꾸는 일은 없습니다. 다만 경로 값 자체는 로드
시점에 검증되어, 비어 있거나 공백뿐인 `logPath`는 거부됩니다.

<a id="witness"></a>
## `witness`

선택입니다.

```yaml
witness:
  token: 'covenant witness'   # 사람이 대화에 직접 입력하는 합의 문구
  ttlMinutes: 10              # 그 메시지 시점부터의 유효 시간(분)
```

유효 시간이 있는 인간의 증인 밸브를 설정하며, 약속을 조립할 때 사용합니다. 이 밸브는
면제가 아니라 sudo입니다. 결정론 관문이 판정 사슬에 관해 계산할 수 있는 단 하나의
성질은 "책임질 인간이 지금 여기 있는가"이고, 증인(witness)은 그 통과 조건을 사람이
직접 공급하는 자리입니다. covenant가 정당한 편집을 막을 때 사람이 합의된 토큰을 대화에
입력하면, 그 메시지의 타임스탬프부터 `ttlMinutes` 동안 차단된 판정을 증언으로 통과시킬
수 있고, 만료되면 자동으로 다시 차단됩니다. 이 섹션을 쓰면 두 키 모두 필수입니다.
토큰은 공백을 걷어낸 뒤 비어 있을 수 없고, 시간 창은 0보다 큰 유한한 수여야 합니다.

**밸브는 판정 뒤에 확인하며 판정을 대신하지 않습니다.** 판정 본체는 언제나 실행됩니다.
정상 판정을 받을 호출에는 밸브를 적용하지 않으므로 유효 시간 중에도 그 결과는 바뀌지 않습니다.
따라서 `witnessed` 행은 실제 차단을 사람이 책임지고 허용했다는 뜻입니다.
차단되지 않은 호출에 형식적인 증언 기록을 남기지는 않습니다.

**토큰은 메시지 첫 줄에 단독으로 놓여야 합니다.** 증언을 발동하는 것과 증언을 이야기하는
것은 다릅니다. 문장 안에서 토큰을 인용하거나 묻거나 설명하는 메시지는, 백틱으로 감싼
경우까지 포함해 밸브를 열지 않습니다. 첫 줄에 토큰만 있으면 발동하고, 이어지는 줄은
작업 내용으로 자유롭게 씁니다.

발동하는 메시지입니다. 첫 줄에 토큰만 두고 나머지 줄은 자유롭게 씁니다.

```text
covenant witness

이제 훅 파일을 고쳐줘
```

언급일 뿐인 메시지입니다. 밸브는 닫힌 채입니다.

```text
그런데 `covenant witness` 는 언제 만료되나요?
```

토큰 값 자체는 자유입니다. 어떤 문구든 쓸 수 있고, 접두사나 명령 형태를 검사하지 않습니다.
제약을 받는 것은 놓이는 자리뿐입니다.

토큰은 비밀이 아닙니다. 방어선은 비밀성이 아니라 출처 증명입니다. 세션 기록에서 사람이
직접 입력했다고 확인된 메시지로 토큰이 도착할 때만 증언이 성립하므로, 토큰을 아는
AI도 증언을 위조할 수 없습니다. 증언으로 통과한 판정은 조용히 사라지지 않고 `witnessed`로
기록됩니다.

<a id="disciplines"></a>
## `disciplines`

선택 항목입니다. 팀이 함께 지킬 규율을 항목마다 하나씩 데이터로 선언합니다.
판정 항목은 `declare` 블록(유일한 판정 형태로, 범위(`scope`)를 블록 안에 지니는 선언)과
`id`(텔레메트리 라벨)를 가지며, 선택적으로 `why`(에이전트가 읽는 차단 메시지에 함께 실리는
이유)와 `enforce` 강제 수준을 가집니다. 닫힌 키 집합은 `id` · `why` · `enforce` · `declare`이고
그 밖의 키는 거부됩니다.

**`draft`는 아직 판정 대상으로 전환하지 않은 항목입니다.** 술어를 갖지 않는 유일한 형태입니다. `{ id, why, draft: true }`
세 키뿐입니다. 초안(draft)은 아직 판정하지 않는 관행을 문장으로 기록합니다. 두 표면 어디에서도
판정과 텔레메트리 기록을 만들지 않고, `pdks explain`이 `unpromoted`로 표시합니다. 여기서는
`why`가 필수입니다(산문이 항목의 본문 전부입니다). 표식은 리터럴 `true`여야 합니다 —
초안은 선언하는 것이지 추론되는 것이 아니므로, 술어도 `draft: true`도 없는 항목은 여전히
검증 오류이고 `draft: false`는 죽은 데이터로 거부됩니다.

```yaml
disciplines:
  - id: 'benchmark-supports-performance-claim'
    why: 'a performance claim must be supported by a fresh benchmark run during judgment.'
    draft: true
```

영한 문서 쌍을 함께 변경하라는 요구는 초안으로 남길 필요가 없습니다. 이미 `companion`으로 판정할 수 있습니다(이
저장소의 `docs-stay-bilingual` 항목). `draft: true`는 지금 문법이 표현하지 못하는 약속에만
씁니다.

`why`는 판정하지 않습니다. 어떤 판정도 바꾸지 않습니다. 판정이 차단을 낸 뒤 위반 메시지에
덧붙으므로, 차단을 읽는 쪽이 이 파일을 열지 않고도 같은 줄에서 근거를 얻습니다. 여러 줄에
걸친 `why`는 공백으로 접힙니다. 메시지는 한 줄입니다.

**`enforce`는 항목 자신의 강제 수준입니다.** 판정 항목에 선택적으로 쓸 수 있으며 값은
`block` 또는 `advise`입니다. **적지 않으면 `advise`입니다.** `advise`에서는 위반이
`advised` 텔레메트리 이벤트로 기록되고 호출은 진행되며(exit 0), 위반 메시지는 그대로
stderr에 쓰입니다. `block`을 지정하면 항목의 강제 수준을 차단으로 승격합니다. 항목의 강제 수준은
표면의 강제 수준(커밋 표면의 `adapters.git.enforce`, 세션 표면은 강제 수준 설정이 없음)과
함께 적용하며 더 관대한 쪽을 따릅니다. 두 수준 중 하나라도 `advise`면 권고로 처리합니다.
항목의 `block` 설정으로 표면의 `advise` 설정을 무시할 수는 없습니다.
판정할 수 없는 본체(빌드되지 않음, 적재 불가)는 강제 수준과 무관하게 차단됩니다. 초안(draft)은 `enforce`를 갖지 않고, 그 밖의
값은 로드 시점에 거부됩니다. `pdks explain`은 항목이 선언한 강제 수준(`enforce: block` 또는
`enforce: advise`)를 두 표면 모두에 표시하고 적지 않은 항목은 표시하지 않습니다. 세션
머리줄이 기본값을 말합니다.

```yaml
  - id: 'hooks-stay-armed'
    why: 'a command that disarms or reroutes the git gate is a gate bypass in itself.'
    enforce: advise
    declare:
      mechanism: 'forbidden-command'
      scope: { source: 'command' }
      extract:
        hits:
          - { op: 'source', of: 'command' }
          - { op: 'lines' }
          - { op: 'matches', re: 'LEFTHOOK=(0|false|no|off)\b|core\.hooksPath' }
      relate:
        - { id: 'gates-armed', relation: { op: 'empty', of: 'hits' }, message: '{value}' }
```

**새로 추가한 내용은 `added-only`로 판정합니다.** 편집으로 *추가되는* 금지 낱말,
남겨 둔 `.only`, 대상이 없는 인용 등을 검사하는 선언입니다. `pre`와 `post`를 각각 줄로 나누고
일치한 문자열을 키로 지정합니다. `onlyIn`으로 `post`에만 있는 항목을 남긴 뒤, `empty`로
그 차이가 비어 있는지 판정합니다. 기존 일치 항목은 위반으로 세지 않으므로 선언을 도입해도
기존 코드 전체를 차단하지 않습니다. `supply: empty`를 지정하면 파일 생성(`pre` 없음)은
전체 내용을 추가한 것으로, 삭제(`post` 없음)는 아무것도 추가하지 않은 것으로 처리합니다.
`scope` 블록에서는 `in`/`except` 대신 경로에 적용할 정규식을 사용합니다.

```yaml
disciplines:
  - id: 'no-focused-tests-in-src'
    why: 'a focused test must not land in shared source.'
    declare:
      mechanism: 'added-only'
      scope: { source: 'target.path', include: ['^src/', '^test/'] }
      supply: { pre: 'empty', post: 'empty' }
      extract:
        before:
          - { op: 'source', of: 'pre' }
          - { op: 'lines' }
          - { op: 'keyByPattern', re: '(\.only\()' }
        after:
          - { op: 'source', of: 'post' }
          - { op: 'lines' }
          - { op: 'keyByPattern', re: '(\.only\()' }
        added:
          - { op: 'onlyIn', of: 'after', notIn: 'before' }
      relate:
        - id: 'nothing-added'
          relation: { op: 'empty', of: 'added' }
          message: 'adds {key}: {value}'
```

키가 일치한 문자열이므로, 파일 어딘가에 이미 있는 낱말을 담은 줄은 새 위반으로 세지 않습니다. 새 낱말 둘을
담은 한 줄은 첫 일치만 드러내고, 둘째는 **그 첫 일치를 고친 다음** 판정에서 나옵니다. 같은
입력을 다시 판정해도 둘째가 자동으로 나오지는 않습니다.

**생성 후 수정을 금지하는 경로도 선언할 수 있습니다.** 한 번 만들 수는 있어도 수정도 삭제도 안 되는 파일입니다.
`pre`가 있으면 수정이고 `post`가 없으면 삭제이며, 어느 쪽이든 위반입니다. 빈 내용으로 만드는 것(`post: ''`)은
생성으로 통과합니다.

```yaml
  - id: 'archived-records-stay-frozen'
    why: 'an archive that can be edited is not an archive.'
    declare:
      mechanism: 'self-absolution-ban'
      scope: { source: 'target.path', include: ['^records/archive/'] }
      supply: { pre: 'empty', post: 'empty' }
      extract:
        prior: [{ op: 'source', of: 'pre' }]
        here: [{ op: 'source', of: 'target.path' }]
        after: [{ op: 'source', of: 'post' }]
        deleted: [{ op: 'onlyIn', of: 'here', notIn: 'after' }]
        touched: [{ op: 'union', of: ['prior', 'deleted'] }]
      relate:
        - { id: 'frozen', relation: { op: 'empty', of: 'touched' }, message: '{value} is frozen' }
```

**명령줄은 소스입니다.** 세션 표면에서 셸 호출은 자기 명령줄을 고정 소스 `command`로
지니고, 파일을 바꾸지 않는 호출도 관측 하나입니다. 그 호출은 subject `-`인 자기 세계로
판정됩니다. `forbidden-command` 선언은 그 소스를 읽어 줄로 나누고, 패턴에 매치하는 줄만
남긴 뒤, 결과가 `empty`이기를 요구합니다. 범위를 `command`에 걸어 셸 호출만 받아들이게
합니다. Edit에는 명령줄이 없고, 세계에 없는 소스를 읽는 선언은 판정 불가이기 때문입니다.
여러 줄 명령은 줄 단위로 판정하므로 `^`는 줄의 시작을 뜻하고, 줄 경계를 걸치는 패턴은
일치하지 않습니다.

```yaml
  - id: 'hooks-stay-armed'
    why: 'a command that disarms or reroutes the git gate is a gate bypass in itself.'
    declare:
      mechanism: 'forbidden-command'
      scope: { source: 'command' }
      extract:
        hits:
          - { op: 'source', of: 'command' }
          - { op: 'lines' }
          - { op: 'matches', re: 'LEFTHOOK=(0|false|no|off)\b|core\.hooksPath' }
      relate:
        - { id: 'gates-armed', relation: { op: 'empty', of: 'hits' }, message: '{value}' }
```

**선행 요구는 세션 위의 선언입니다.** 대부분의 선언은 "이 변경 자체가 나쁜가"를 묻지만,
`precedent`는 요구된 절차가 세션에서 앞서 일어났는가를 묻습니다. 변경 자체는 정당하고 빠진
것은 그 앞에 있어야 할 절차이므로, 판정 대상은 세션 이력입니다.
`sources: { session: { transcript: true } }`가 사용자 턴과 도구 호출을 스냅샷 하나로
선언에 건네고, `toolUses`가 호출을 고르고, `filter`가 실행되어 **성공한** 것만 남기고,
`select`가 명령줄을 추출하고, `matches`가 요구된 명령을 찾습니다. 판정은 `nonEmpty`입니다.
약속(covenant)이 차단한 호출, 사람이 거부한 호출, 그냥 실패한 호출은 선행 증거가 아닙니다.
패턴은 명령줄의 어느 위치에서든 일치 여부를 찾으므로, 명령을 언급만 한 줄도 증거로 셉니다. 선언된
한계입니다. `supply: { session: 'pass' }`가 커밋 표면에서 매치하는 커밋을 전부 막는 대신
`skipped`를 기록하게 하는 값입니다.

```yaml
  - id: 'dependency-needs-npm-view'
    why: 'a dependency version must be measured before it is written.'
    declare:
      mechanism: 'precedent'
      scope: { source: 'target.path', include: ['^(packages/[^/]+/)?package\.json$'] }
      sources: { session: { transcript: true } }
      supply: { session: 'pass' }
      extract:
        npmView:
          - { op: 'source', of: 'session' }
          - { op: 'toolUses', names: ['Bash'] }
          - { op: 'filter', when: [{ field: 'succeeded', eq: true }] }
          - { op: 'select', path: 'args.command' }
          - { op: 'matches', re: '\bnpm view ' }
      relate:
        - { id: 'npm-view', relation: { op: 'nonEmpty', of: 'npmView' }, message: 'no successful npm view precedes this manifest edit' }
```

도구 호출도 같은 방식으로 증거가 됩니다. `names` 없는 `toolUses` 뒤에 `field name`과 도구
이름 위의 `matches`를 두거나, 한 종류의 에이전트 스폰이면 `toolUses`에 `subagentType`을
줍니다. 다른 이력 기전도 같은 스냅샷을 읽습니다. `phase-order`는 스폰 순번 둘을 `ordered`로
잇고, `turn-locality`는 시간 창 안의 사용자 턴만 남기며(`userTexts → ageMs → filter lte`),
`stated-ground`는 패턴에 맞는 사용자 턴을 요구합니다. 뒤의 둘은 보통 `command`에 범위를
걸어, 자기가 지키는 셸 호출만 판정되게 합니다.

**줄 앵커에 주의하십시오.** 선언의 `lines` 단계가 텍스트를 먼저 나누므로, 그 뒤의
`keyByPattern`이나 `matches` 안의 `^`는 줄의 시작입니다. 값의 중간에서 끊기는 패턴,
이를테면 버전의 첫 숫자에서 멈추는 패턴은 `4.0.5`와 `4.0.6`을 같은 키로 만들어서, 버전을
올려도 `added-only` 차집합에 항목이 추가되지 않아 변경을 탐지하지 못합니다. 변할 수 있는 값
전체가 패턴에 포함되도록 작성하세요. 두 실패 모두 컴파일되고 판정도 돌아가며 결과는 `passed`이니,
새 항목은 실제 파일과 현실적인 편집을 상대로 측정하십시오.

**증인과 선행 증거는 다릅니다.** 선행 증거를 찾는 패턴은 실제로 요구한 작업과 단순한 언급을 구별해야 합니다.
세션 증거는 AI 자신의 표면에 있으므로 위조를 막지 못합니다. 이 설계는 검사를 만족시키는
가장 손쉬운 방법이 명령을 실제로 실행하는 것이라는 점을 전제로 합니다. 그 실행이 규율이
유도하려는 행동입니다. 그래도 패턴만으로 증거의 위조 가능성이 사라지는 것은 아닙니다.
정상 사례와 위반 사례를 함께 시험하세요.

**`declare`는 선언 계열입니다.** 판정 하나를 데이터로 적습니다. 코어가
`algebra-declaration.schema.json`으로 공개하는 대수 문법 `judge = relate ∘ extract`입니다.
블록은 선언의 `scope` · `sources` · `supply` · `extract` · `relate`와 선택인 `witness`를 지니고, 항목의
`id`가 선언의 이름이므로 블록은 `discipline` 키를 갖지 않습니다. `in` · `except` · `when`은
거부됩니다. `scope` 블록이 곧 범위입니다.

```yaml
  - id: 'db-files-only-under-data'
    why: 'a *.db file may exist only under data/'
    declare:
      mechanism: 'naming'
      scope: { source: 'target.path', include: ['\.db$'] }
      extract:
        outside:
          - { op: 'source', of: 'target.path' }
          - { op: 'matches', re: '^(?!data/)' }
      relate:
        - id: 'placed'
          relation: { op: 'empty', of: 'outside' }
          message: '{value} is outside data/'
```

이 저장소의 실제 설정에서는 같은 기전에 `_docs/knowledge/` 경로를 사용하며,
항목 ID는 `sqlite-only-under-knowledge`입니다.

관측 하나가 **세계(world)** 하나로 판정되며 소스 이름은 일곱입니다. `target.path`(저장소
상대 경로), `pre`와 `post`(변경이 지닌 쪽의 파일 본문. 생성에는 `pre`가, 삭제에는 `post`가
없습니다), `state`(`{ pre, post }`, 수정에만 있습니다), `changes`(이 관측이 바꾸는 경로 전부.
세션 표면에서는 호출 하나, 커밋 표면에서는 staged 집합 전체), 그리고 `command`(셸 호출의
명령줄. 셸 호출에만 있고, 파일을 바꾸지 않는 셸 호출은 자기 세계 하나가 되므로 `command`에
범위를 건 선언은 그 호출을 보고 `target.path`에 범위를 건 선언은 보지 않습니다). `changes`를
읽는 선언은 변경 집합 전체를 관측하는 표면에서만 판정됩니다. 세션 표면은 그 선언을
`skipped`로 기록합니다 — 커밋 표면이 세션을 읽는 선언에 내리는 처분과 같으며, 호출 하나가 쌍의 나머지
반쪽을 실을 수 없기 때문입니다. 이 저장소의 라이브 설정은 그런 선언 하나를 싣습니다 —
`docs-stay-bilingual`, `.md`/`.ko.md` 쌍 위의 `implies`로, 한쪽만 staged된 커밋 표면에서
advised로 남습니다. 대상 밖 파일이 필요한 선언은
`sources` 블록에 이름을 붙이고(`sources: { en: { file: 'locales/en.json' } }`) `{ op:
'source', of: 'en' }`로 읽습니다. 경로는 저장소 상대(선두 `/` 없음, `..` 세그먼트 없음)이고
이름은 일곱 고정 이름과 겹칠 수 없습니다. 파일은 표면이 트리를 관측하는 방식대로
읽습니다 — 세션은 디스크, staged 커밋은 index, range는 `<to>` 커밋. 단 변경 자신이 만지는
파일은 변경의 `post`에서 읽으므로 두 표면이 같은 본문을 판정합니다. 둘째 종류
`sources: { spawns: { sidecar: true } }`는 경로가 아니라 세션의 스폰 기록 채널을 이름
붙입니다 — 호스트가 대화 기록(transcript) 옆에 남기는 서브에이전트 기록을 JSON 배열
하나로 공급받습니다. 채널이 어디 있는지는 표면이 아는 사실이라 값은 표지 `true`이고,
세션이 없는 커밋 표면에서는 채널이 언제나 없습니다. 셋째 종류
`sources: { session: { transcript: true } }`는 세션 자신의 대화 기록(transcript)을 이름
붙입니다 — 표면이 읽는 사용자 턴과 도구 호출을, 항목마다 관측
순번을 실은 스냅샷 하나로 선언에 건넵니다. 이력 단계(`toolUses` · `userTexts` · `first` ·
`ageMs`)가 그것을 읽고, `agentType`은 파싱된 사이드카를 읽습니다. 이 저장소의 라이브
설정은 그런 선언 하나를 싣습니다 — `tests-before-implementation`, 서브에이전트 스폰 둘의
순번 위의 `ordered`로, 세션이 없는 커밋 표면은 `skipped`로 기록합니다. 일곱째 고정 이름
`actor`는 관측의 주체(actor)입니다. 서브에이전트 안에서는 `{ agentType }`, 주 세션에서는
`{}`, 표면이 주체를 증명하지 못하면(커밋 표면) 없습니다. `{ op: 'source', of: 'actor' }` 뒤에
`agentType`을 `select`해 읽고, `producer-owned` · `actor-scope` 기전이 요구하는 `actor`
축을 유도합니다. 이 저장소의 라이브 설정은 각 하나씩 싣습니다(`tests-are-the-writers`,
`commits-come-from-the-main-session`). `supply`의 키는
고정 소스 일곱이나 선언 자신의 `sources` 이름이어야 하고, 그 밖의 키는 거부됩니다. 변경이
지니지 않은 소스는 없는 것이고, 그것이 무슨 뜻인지는 선언의 `supply` 블록이 적습니다. `error`(기본값)는 호출을 판정
불가로 만들어 강제 수준과 무관하게 `blocked`로 기록하고, `pass`는 판정하지 않고 지나가게
하며, `empty`는 없는 쪽을 빈 항목 열로 읽고 판정을 계속합니다. `empty`가 `added-only` 선언이
생성을 전부 추가로, 삭제를 아무것도 더하지 않은 것으로 보게 하는 값이고, 짝 소스 `state`에는
적용되지 않습니다. 그래서 전후를 비교하는 선언이 파일 생성을 지나가게 하려면
`supply: { state: pass }`가 필요합니다.

위반은 다른 계열과 같이 기록되되 하나가 더해집니다. 텔레메트리 행이 다섯째 필드에 관계가
성립하지 않은 요소들을 싣습니다(relate 항목마다 최대 여덟, 실제 개수를 곁에 적습니다).
`skipped` 행은 같은 자리에 사유 토큰을 대신 싣습니다. `no-observation`(항목이 읽는 것을
이 표면이 관측할 통로가 없음), `config-fault`(블록을 조립하지 못함), `supply-pass`(선언
자신의 `supply: pass`가 부재 소스를 지나가게 함) 셋입니다. 모든 선언은 `mechanism`도
적습니다. `naming` · `companion` · `pairing` 같은 카탈로그 이름 열여덟 중 하나이고,
검증기는 선언의 형상이 그 이름에 맞지 않으면 거부합니다. 소스가 유도하는 축(`actor`를 뺀
고정 이름은 `change`, `actor`는 `actor`, `file`·`sidecar` 소스는 `world`, `transcript` 소스는
`history`)과 관계가 그 이름이 허용하는 범위 안에 있어야 합니다.
컴파일러가 해석하지 못하는 블록(등재 표 밖의 단계 이름, 단계의 키 밖의 인자)은 stderr에
위치를 적고 아무것도 라우팅하지 않는 skip 등록이 됩니다. 선언의 범위 안으로 들어오는 셸
쓰기 가운데 판정기가 결과를 계산할 수 있는 것(리다이렉트 · heredoc · append)은 그것이
만드는 파일 변경으로 판정되고, 계산할 수 없는 것(`sed -i` · 불투명한 명령)은 `skipped`를
기록합니다. 선언 자신의 `witness` 블록은 사람의
증인과 함께 차단된 판정 결과를 여는 둘째 길이 됩니다.

규율을 추가할 때는 데이터를 편집하면 됩니다. 코드나 실행 연결부를 작성할 필요는 없습니다.
데이터로 표현할 수 없는 규율은 사용자 정의 판정 본체로 구현할 수 있습니다.
