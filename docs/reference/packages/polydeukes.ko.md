# `polydeukes`

[English](./polydeukes.md) · **한국어**

일반 사용자는 통합 패키지인 `polydeukes` 하나만 설치하면 됩니다. `pdks` 실행 파일, 판정기,
두 표면의 조립 루트, 세션 표면 실행기 서브패스, 동봉된 스키마 자산을 모두 이 패키지가
맡습니다.

<a id="polydeukes-entry-points"></a>
## 진입점

| 지정자 | 무엇인가 |
|---|---|
| `pdks` / `polydeukes` | 실행 파일입니다. `bin`에 이름 둘로 등록된 같은 CLI입니다 |
| `polydeukes/claude-code` | `runClaudeCodeHook`과 입력·결과 타입 |
| `polydeukes/schema.json` | 동봉된 설정 JSON Schema |

`.` 진입점은 없습니다. `import 'polydeukes'`는 `ERR_PACKAGE_PATH_NOT_EXPORTED`로 실패합니다.
사용자가 닿는 것은 실행 파일과 세션 서브패스, 그리고 스키마 파일입니다.

<a id="polydeukes-bin"></a>
## CLI 명령

| 명령 | 목적 |
|---|---|
| `pdks covenant check` | 표준 입력의 입력 IR(기본) 또는 통합 diff(`--diff`)를 판정 |
| `pdks init claude-code` | Claude Code 세션 표면 설치 |
| `pdks init grok` | Grok 세션 표면 설치 |
| `pdks explain` | 조립된 등록표를 판정 없이 표시 |
| `pdks docs [topic]` | 동봉된 주제를 읽음 |
| `pdks docs search <query>` | 동봉된 문서를 검색 |
| `pdks docs show <document-id>` | 동봉된 문서 또는 절을 표시 |

`pdks docs`는 오프라인입니다. 네트워크가 아니라 설치된 패키지를 읽습니다. 플래그, JSON,
종료 코드는 [`pdks docs`](../cli/docs.ko.md)에 있습니다.

<a id="polydeukes-export-map"></a>
## 공개 심볼

<a id="session-export"></a>
### `./claude-code`

| 심볼 | 종류 | 메모 |
|---|---|---|
| `runClaudeCodeHook` | 함수 | 세션 표면을 실행하고 `{ exitCode: 0 \| 2 }`를 반환합니다. |
| `ClaudeCodeHookSpec` | 타입 | 세션 실행기 입력입니다. |
| `ClaudeCodeHookOutcome` | 타입 | 세션 실행기 결과입니다. |

```ts
import { runClaudeCodeHook } from 'polydeukes/claude-code';

const hook = await runClaudeCodeHook({ repoRoot: process.cwd(), rawPayload: '{}' });
```

`ClaudeCodeHookSpec`은 `repoRoot`(설정을 찾을 저장소), `rawPayload`(훅 페이로드 텍스트이며,
없으면 훅이 표준 입력인 파일 디스크립터 0을 읽습니다), `telemetryPath`(판정 기록을 추가할
위치)를 받습니다.

<a id="schema-export"></a>
### `./schema.json`

| 자산 | 메모 |
|---|---|
| `polydeukes.schema.json` | 통합 패키지에 동봉한 설정 스키마 사본입니다. |

<a id="covenant-module"></a>
## 판정기(`covenant` 모듈)

판정기는 통합 패키지의 `src/covenant/` 모듈입니다. 선언된 약속(covenant)을 평가해 판정
결과를 내는 기능을 모두 여기서 구현하며, 두 조립 루트와 `pdks explain`이 이 모듈을 바로
가져옵니다. 따로 설치할 것도, 불러올 것도, 충족할 peer 의존도 없습니다. 사용자는 설정의
`disciplines:` 블록과 `.polydeukes/roi.log`의 기록을 통해 동작을 확인합니다.

<a id="ownership"></a>
### 모듈이 담당하는 기능

| 단위 | 하는 일 |
|---|---|
| `runCovenant` 래퍼 | 판정 본체를 실행하고, 비차단 `1`을 차단하는 `2`로 번역하고, 모든 호출을 기록합니다. 측정되지 않고 실행되는 약속은 없습니다 |
| 경로 라우팅 디스패처 | 보호 경로에 약속을 등록하고 일치하는 항목을 **모두** 실행합니다. 하나가 실패했다고 뒤의 판정을 생략하지 않습니다 |
| 메타 약속 | 판정 사슬 자신을 지키는 등록 셋 |
| TTL 증인 | 유효 시간이 있는 인간의 증인 밸브입니다. 차단 판정 뒤에만 확인합니다 |
| 델타 층 | 파일의 전후 쌍에 대한 신규 위반 전용 판정 |
| 규율(discipline) 라이브러리 | 설정의 `disciplines:` 항목을 별도 사용자 코드 없이 판정합니다 |

<a id="disciplines-and-meta-covenants"></a>
### 규율 계열과 메타 약속

**`disciplines:` 항목은 선언 하나입니다.** 관측한 증거를 입력으로 받아 `judge = relate ∘ extract`를 계산합니다. 선언의 소스가 무엇을 묶는지가
판정에 필요한 증거를 정하고, 그것이 곧 어느 표면에서
판정될 수 있는지를 정합니다.

| 소스 | 판정 대상 | 필요한 증거 |
|---|---|---|
| 고정 이름 `target.path` · `pre` · `post` · `state` · `changes` | 변경 자체 | 파일 변경 |
| 고정 이름 `command` | 셸 호출의 명령줄 | 셸 호출입니다. Edit에는 없습니다 |
| `{ transcript: true }` | 세션 이력입니다. 이 호출 **앞에** 자격을 갖춘 호출이 실제로 실행됐는가 | 세션 |
| `{ file: … }` · `{ sidecar: true }` | 다른 파일, 또는 스폰 기록 채널 | 표면의 리더 |

이 항목들을 쓰는 가이드는 [설정 레퍼런스의 `disciplines` 절](../configuration/index.ko.md#disciplines)에
있습니다. 선언 문법은 코어의 `algebra-declaration.schema.json`입니다.

**메타 약속 셋**이 판정 사슬을 지킵니다. 다른 약속과 똑같은 약속이고, 아래 어휘가 그대로
적용됩니다.

| 등록 | 축 | 판정 대상 |
|---|---|---|
| self-mod | 도구 | 편집 도구를 통한 보호 경로 변형입니다. 호출의 증명된 변형 대상만 대조하므로, 편집 **내용** 안의 보호 경로는 언급이고 통과합니다 |
| shell-mod | 셸 | 같은 것을 명령줄로 합니다. 보호 경로를 언급하는 명령은 첫 낱말이 읽기 전용임을 증명할 때만 통과합니다 |
| transcript-mod | 대화 기록 | 라이브 세션 대화 기록에 대한 쓰기입니다. 전체 경로 **등가**로 판정하고 보호 조상으로는 결코 보지 않습니다 |

**낱말 여섯**이 텔레메트리 계약입니다. 판정 결과 다섯과 관측 하나입니다. `.polydeukes/roi.log`의
한 행은 이 중 정확히 하나를 담고, CLI와 문서와 테스트가 같은 사건에 같은 낱말을 씁니다.
행을 읽는 법은 [문제 해결](../../troubleshooting.ko.md#reading-verdict)에 있습니다.

| 판정 결과 | 뜻 |
|---|---|
| `passed` | 호출이 판정됐고 약속을 지켰습니다 |
| `blocked` | 호출이 판정됐고 약속을 깼습니다 |
| `witnessed` | **차단된** 작업을 인간의 증언으로 허용했습니다. 위반이 없었다는 뜻이 아니며 허용 사실을 기록합니다 |
| `advised` | 호출을 멈추지 않고 위반을 기록했습니다. 항목이 `enforce: block`을 적지 않는 한 두 표면 모두에서 규율 항목의 기본 처분입니다 |
| `skipped` | 적용 범위가 일치했지만 판정할 수 없었습니다. **정상 판정이 아니라** 판정하지 못했다는 기록입니다 |
| `unattributed` | 보호 항목의 디스크 상태가 변했는데 그것을 설명하는 판정 기록이 없습니다. **판정이 아닙니다.** 이 행 때문에 차단되거나 통과하는 호출은 없으며, 세션 표면이 저장된 기준선과 상태를 대조한 뒤에 기록합니다 |

`unattributed`는 나머지 다섯이 답할 수 없는 물음에 답합니다. 다섯은 전부 판정기가 건네받은
호출에 관해 쓰는 낱말이라, 선언된 호출 없이 도착한 쓰기는 행을 하나도 남기지 않습니다.
인터프리터 안의 쓰기, 테스트 러너 자식 프로세스의 쓰기, 대상 경로를 자기 인자에서 조립하는
스크립트가 그런 경우입니다. 상태 대조는 철자가 아니라 결과를 관측하므로 그 쓰기를 사후에
기록합니다. 차단하지는 않습니다. 이미 일어난 쓰기이고, 대조는 판정의 양쪽 모두에서
fail-open입니다.

<a id="consumer-contract"></a>
### 사용자와의 접점

- **설정의 `disciplines:` 블록.** 항목 하나가 등록 하나로 컴파일되고 자기 텔레메트리
  라벨을 답니다.
- **`protectedPaths`.** 경로 라우팅 디스패처가 여기에 대조합니다.
- **`witness` 블록.** TTL 증인 밸브를 설정합니다.
- **`.polydeukes/roi.log`.** 판정 기록을 추가하는 로그입니다.

직접 불러올 필요는 없습니다. 통합 패키지가 두 표면에 필요한 구성을 조립합니다.

<a id="limits"></a>
### 선언된 한계

- **셸 축은 `skipped` 행을 남기고, 그 행이 계약입니다.** 셸 명령의 대상을 텍스트에서
  예측하는 일은 결정 불가능합니다. 그래서 이 축이 지키는 불변식은 "아무것도 빠져나가지
  못한다"가 아니라 **기록 없이 통과하는 호출이 없다**입니다. 새로운 명령 형태가 `skipped`로 기록되면 판정하지 못한 한계를 확인할 수 있습니다. 행이 아예 없는
  통과, 또는
  판정하지 않고 `passed`로 기록된 통과가 결함입니다.
- **세션을 읽는 선언은 세션 없이 판정할 수 없습니다.** 커밋 표면에는 세션이 없습니다. 적용 범위가 일치한
  `precedent`(그리고 대화 기록을 읽는 다른) 선언이 사유 `supply-pass`로 `skipped`를 남기는
  것은 그 선언의 `supply`가 `pass`일 때뿐입니다. 정책이 없으면 없는 세션은 판정 불가(exit
  2)로 처리하며 자동으로 건너뛰지 않습니다. 이 표면에서 세션 증거가 없다는 조건은 변하지 않습니다.
- **`command`를 적용 범위의 소스로 쓰는 선언은 커밋 표면에서 실행되지 않으며 기록도 남기지
  않습니다.** diff에는 명령줄이 없으므로 그 선언의 관측 대상이 되지 않습니다.
  `.polydeukes/roi.log`에 아무것도 남지 않아서, 발동한 적 없는 명령 규율과 명령을 관측한 적
  없는 표면의 규율을 로그로 가를 수 없습니다.
- **컴파일러가 해석하지 못하는 선언은 스킵 등록으로 컴파일됩니다.** 라우팅은 그대로 두고
  본체를 두지 않습니다. 등재 표 밖의 단계, 단계의 키 밖의 인자, 컴파일되지 않는 패턴,
  쌍/단일 불일치가 그 경우입니다. 그래서 조립은 예외를 던지지 않습니다. 해소되지 않는 항목
  하나가 형제 항목과 메타 약속과 밸브까지 무너뜨리면, 그것을 일으킨 설정을 고칠 길이
  사라지기 때문입니다. 예약 기전, 또는 카탈로그가 거부하는 축·관계는 다른 단계입니다.
  설정을 읽는 단계에서 파일을 거부하고(exit 2) skip 행은 남지 않습니다. 판정 시점에 세계에 없는
  소스는 세 번째 경우입니다. 선언 자신의 `supply` 정책이 처분하고, 정책이 없으면 본체가
  판정 불가(exit 2)로 답합니다. 통과로 답하지 않습니다.
- **완전 봉쇄는 목표가 아닙니다.** 여기에 차단 목록은 없습니다. 우회 철자를 열거하는 일은
  언제나 한 걸음 뒤지므로 논리를 뒤집었습니다. 보호 경로를 언급하면 안전이 증명되지 않는
  한 차단합니다. 간접 경로 계산 같은 잔여 벡터는 차단 대상이 아니라 텔레메트리 대상입니다.
  마찰 밸브 둘, 곧 읽기 전용 허용 목록과 TTL 증인은 둘 다 측정 가능한 흔적을 남깁니다.
- **밸브는 판정 뒤에 확인합니다.** 실제로 차단한 판정만 증언으로 열 수 있고, 문장 중간의 토큰
  언급은 밸브를 무장시키지 않으며, AI는 자기 밸브를 결코 스스로 열 수 없습니다.

<a id="polydeukes-failure-boundaries"></a>
## 실패 경계

- `runClaudeCodeHook()`는 예외를 던지지 않고 `{ exitCode: 0 \| 2 }`를 반환합니다.
- 숫자 코드는 `@polydeukes/core`의 `EXIT_UPHOLD`(`0`), `EXIT_BREAK_NON_BLOCKING`(`1`),
  `EXIT_BREAK_BLOCKING`(`2`)입니다. 우산 실행기는 `0` 또는 `2`만 노출하며 `1`을 반환하지 않습니다.
- `pdks covenant check`는 사람에게 묻지 않습니다. 표준 입력을 읽고 종료 코드 0 또는 2를 내며, 그 종료 코드의 뜻은 호출한 쪽이 정합니다.
- `pdks docs`와 `pdks explain`은 실패 시 중간 출력 없이 끝납니다.

<a id="polydeukes-see-also"></a>
## 함께 보기

- [`pdks covenant check`](../cli/covenant-check.ko.md)
- [`pdks init`](../cli/init.ko.md)
- [`pdks explain`](../cli/explain.ko.md)
- [설정 참조](../configuration/index.ko.md)
