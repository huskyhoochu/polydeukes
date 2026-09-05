# `@polydeukes/core`

[English](core.md) · **한국어**

> **모든 약속(covenant)이 말하는 프로토콜**입니다. 입력 IR과 판정 결과 형태, 설정 스키마,
> 텔레메트리 수집기가 여기 있습니다.
>
> 알파입니다. 일반 사용자는 이 패키지를 따로 설치하거나 불러올 필요가 없습니다. 통합 패키지의 의존성으로 설치되며, 사용자 진입점은
> [`polydeukes`](polydeukes.ko.md)입니다.

<a id="ownership"></a>
## 담당하는 기능

모든 약속이 사용하는 공통 프로토콜을 정의합니다. 개별 약속이 무엇을 판정하는지는 다루지 않습니다.

| 영역 | 무엇인가 |
|---|---|
| 약속 프로토콜 | 표준 입력 JSON 입력 IR, 판정 결과 형태, 종료 코드 계약 |
| 설정 스키마 | `defineConfig()`가 파싱된 yaml·json 데이터를 검증합니다. 대응하는 JSON Schema도 별도 파일로 제공합니다 |
| ROI 텔레메트리 | 모든 패키지가 공유하는 추가 전용 로그 기록기 |
| 실패 정책 | 실패 종류마다 fail-open과 fail-closed를 가르는 표 하나 |
| 보호 경로 정규화 | 선언된 목록이 디스패처가 대조하는 문자열이 됩니다 |
| 대화 기록(transcript) 이음매 | 약속이 세션 이력을 묻는 질의 인터페이스 |

이 패키지는 두 가지 제약을 따릅니다. **런타임 의존이 없습니다.** 검증은 손으로 짰고
배포하는 JSON Schema는 런타임 코드에서 읽지 않는 별도 파일입니다. **에이전트나 도구, 언어의
리터럴이 없습니다.** 편집기 도구 이름과 테스트 러너 이름은 설정과 어댑터가 채워 넣는
**값**이라서, 코어의 에이전트 중립성은 grep으로 확인되는 주장입니다. 다른 모든 패키지가
이 패키지에 의존하고, 이 패키지는 그 어느 것에도 의존하지 않습니다.

**판정기와 두 어댑터는 이 패키지를 `peerDependency`로 선언합니다.** 각각 설치하는 대신 같은 어휘를 공유합니다. `SOURCE_KINDS`와
`parseInput`은 검증기와 엔진이
같은 값을 참조해야 합니다. 서로 다른 사본을 사용하면 설치는 성공해도 동작이 달라질 수 있습니다.
통합 패키지가 일반 의존성으로 core를 제공하므로 사용자는 패키지 하나만 설치하면 됩니다.

<a id="protocol"></a>
## 판정 프로토콜

현재 판정기는 표면이 디스패처에 전달한 표준 입력 JSON 페이로드를 한 번 파싱한
`CovenantInput`을 받습니다. 판정 결과를 반환하면 래퍼가 종료 코드로 변환합니다.
`.polydeukes/roi.log`의 차단 기록도 이 판정 어휘를 사용합니다.

`world`는 표면이 공급합니다(`files`, `changes`, `channels`). 판정기가 디스크에서 읽지
않습니다.

```ts
type CovenantInput = {
  toolCalls: { name: string; args?: Record<string, unknown>; fileChange?: FileChange }[];
  subagentSpawns: { kind: string }[];
  userMessages: { text: string }[];
  actor?: { agentType?: string };
  world?: {
    files?: Record<string, string>;
    changes?: string[];
    channels?: { sidecar?: string };
  };
};

type FileChange =
  | { kind: 'create'; path: string; post: string }
  | { kind: 'modify'; path: string; pre: string; post: string }
  | { kind: 'delete'; path: string; pre?: string };

type CovenantVerdict = { upheld: true } | { upheld: false; reason: string };
```

이 어휘에는 도구 이름도 에이전트 이름도 없습니다. 구체적인 도구 이름은 어댑터가 `name`에
채우는 **값**이고, 스폰의 `kind`도 마찬가지입니다. `FileChange`가 판별 유니온인 이유는
삭제를 표현할 수 없는 예외가 아니라 일급 증거로 두기 위해서입니다. 불가능한 상태는 아예
적을 수 없습니다. 결과 내용을 든 삭제나 기준선을 든 생성이 그렇습니다. `delete.pre`는
기준선이 바이너리 blob이었을 때 없습니다. 삭제를 판정하는 데는 내용이 필요 없기
때문입니다. `actor`는 호스트 봉투가 증명하는 관측의 주체(actor)입니다. 서브에이전트 안에서는
`agentType`, 주 세션에서는 `{}`이고, 표면이 주체를 증명하지 못하면 없습니다. 판정기는 기본값을
채우지 않습니다.

**증거는 해당 호출에만 속합니다.** `fileChange`가 없다는 것은 이
호출이 증명되지 않았다는 뜻이고, 형제 호출의 증거가 그 자리를 대신하지 않습니다.

```ts
function parseInput(stdinJson: string):
  | { ok: true; value: CovenantInput }
  | { ok: false; exitCode: 2 };

function verdictToExitCode(verdict: CovenantVerdict): 0 | 1;

function allFileChanges(input: CovenantInput): FileChange[];
```

`parseInput`은 예외를 던지지 않습니다. 파싱되지 않는 JSON, 빈 페이로드, 객체가 아닌 값,
필수 컬렉션 누락은 모두 `{ ok: false, exitCode: 2 }`로 반환합니다. 판정할 수 없는
입력이 유효한 입력으로 오인될 길이 없습니다.

`verdictToExitCode`는 `0`이나 `1`을 반환하고 `2`는 결코 반환하지 않습니다. 위반을 차단으로
번역하는 것은 본체가 아니라 래퍼의 정책입니다. [종료 코드](polydeukes.ko.md#polydeukes-failure-boundaries)를
보십시오. 내보내는 상수는 `EXIT_UPHOLD`(`0`), `EXIT_BREAK_NON_BLOCKING`(`1`),
`EXIT_BREAK_BLOCKING`(`2`)입니다.

`allFileChanges`는 귀속이 필요 없는 소비자를 위해 모든 호출의 증거를 호출 순서대로
평탄화합니다. 증거 없는 호출은 건너뛰고 무엇으로도 대체하지 않습니다.

<a id="consumer-contract"></a>
## 사용자와의 접점

일반 사용자는 다음 세 경로로 이 패키지의 기능을 사용합니다.

- **설정 파일.** 그 스키마가 여기서 정의됩니다. 어휘 레퍼런스는
  [설정 레퍼런스](../configuration/index.ko.md)입니다.
- **JSON Schema 자산.** `@polydeukes/core/schema.json` exports 서브패스입니다. 이 패키지를
  직접 설치한 프로젝트가 쓰는 경로입니다. 우산을 설치한 소비자는 그쪽에 동봉된 사본을
  가리킵니다. 두 철자 모두
  [configuration.md의 IDE 절](../../how-to/configure-project.ko.md#add-ide-support)에 있습니다.
- **위의 프로토콜.** `blocked` 행을 읽는다는 것은 본체가 답한 어휘를 읽는다는 뜻입니다.

그 밖의 기능은 `polydeukes`를 통해 사용합니다.

<a id="limits"></a>
## 선언된 한계

- **어댑터 네임스페이스는 이름이 아니라 형태로 검증합니다.** `defineConfig()`는 `adapters`가
  평범한 객체의 맵인지, 각 네임스페이스 값이 객체인지를 봅니다. 네임스페이스 **이름**이
  누군가 구현한 것인지는 보지 않고, 네임스페이스 안쪽은 들여다보지 않습니다.
  `adapters.git` 안의 미지 어휘는 git 어댑터의 검증기가 자기 층위에서 거부합니다. 여기가
  아닙니다.
- **기본 대화 기록은 아무것도 하지 않습니다.** 실제 대화 기록을 주입하지 않은 소비자는
  "아무 일도 없었다"는 결과를 받습니다. 이 상태에서는 증인 밸브가 작업을 허용하지 않으므로
  차단을 유지합니다. 실제 대화 기록은 어댑터 뒤에 있습니다.
- **fail-open은 텔레메트리 하나뿐입니다.** 기록이 실패해도 판정은 바뀌지 않습니다. 표에 든
  다른 모든 실패 종류는 차단으로 처리합니다.
