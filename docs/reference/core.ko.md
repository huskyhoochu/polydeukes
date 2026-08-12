# `@polydeukes/core`

[English](./core.md) · **한국어**

> **모든 약속(covenant)이 말하는 프로토콜**입니다. 입력 IR과 판정 결과 형태, 설정 스키마,
> 텔레메트리 수집기가 여기 있습니다.
>
> 알파입니다. 우산의 전이 의존이라서 설치하지도 불러오지도 않습니다. 소비자 진입점은
> [`polydeukes`](./polydeukes.ko.md)입니다.

## 이 패키지가 소유하는 것

모든 약속(covenant)이 말하는 프로토콜입니다. 약속이 무엇에 **관한** 것인지는 알지
못합니다.

| 영역 | 무엇인가 |
|---|---|
| 약속 프로토콜 | 표준 입력 JSON 입력 IR, 판정 결과 형태, 종료 코드 계약 |
| 설정 스키마 | `defineConfig()`가 파싱된 yaml·json 데이터를 검증합니다. 짝이 되는 JSON Schema는 형제 자산으로 출하됩니다 |
| ROI 텔레메트리 | 모든 패키지가 통과해 쓰는 덧붙이기 전용 줄 수집기 하나 |
| 실패 정책 | 실패 종류마다 fail-open과 fail-closed를 가르는 표 하나 |
| 보호 경로 정규화 | 선언된 목록이 디스패처가 대조하는 문자열이 됩니다 |
| 전사(transcript) 이음매 | 약속이 세션 이력을 묻는 질의 인터페이스 |

이 패키지의 모양을 잡는 제약이 둘입니다. **런타임 의존이 없습니다.** 검증은 손으로 짰고
발행 JSON Schema는 소스가 결코 읽지 않는 형제 자산입니다. **에이전트나 도구, 언어의
리터럴이 없습니다.** 편집기 도구 이름과 테스트 러너 이름은 설정과 어댑터가 채워 넣는
**값**이라서, 코어의 에이전트 중립성은 grep으로 확인되는 주장입니다. 다른 모든 패키지가
이 패키지에 의존하고, 이 패키지는 그 어느 것에도 의존하지 않습니다.

## 판정 프로토콜

출하된 판정 본체가 말하는 계약입니다. 본체는 표준 입력에서 `CovenantInput`을 읽고 종료
코드로 답합니다. `.polydeukes/roi.log`의 모든 행이 이 판정 가운데 하나로 거슬러 올라가므로,
차단된 행이 적힌 언어가 곧 이 어휘입니다.

```ts
type CovenantInput = {
  toolCalls: { name: string; args?: Record<string, unknown>; fileChange?: FileChange }[];
  subagentSpawns: { kind: string }[];
  userMessages: { text: string }[];
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
때문입니다.

**증거의 거처는 정확히 하나, 그 증거가 속한 호출입니다.** `fileChange`가 없다는 것은 이
호출이 증명되지 않았다는 뜻이고, 형제 호출의 증거가 그 자리를 대신하지 않습니다.

```ts
function parseInput(stdinJson: string):
  | { ok: true; value: CovenantInput }
  | { ok: false; exitCode: 2 };

function verdictToExitCode(verdict: CovenantVerdict): 0 | 1;

function allFileChanges(input: CovenantInput): FileChange[];
```

`parseInput`은 예외를 던지지 않습니다. 파싱되지 않는 JSON, 빈 페이로드, 객체가 아닌 값,
필수 컬렉션 누락이 각각 차단하는 `{ ok: false, exitCode: 2 }`로 풀립니다. 판정할 수 없는
입력이 유효한 입력으로 오인될 길이 없습니다.

`verdictToExitCode`는 `0`이나 `1`을 반환하고 `2`는 결코 반환하지 않습니다. 위반을 차단으로
번역하는 것은 본체가 아니라 래퍼의 정책입니다. [종료 코드](./polydeukes.ko.md#종료-코드)를
보십시오.

`allFileChanges`는 귀속이 필요 없는 소비자를 위해 모든 호출의 증거를 호출 순서대로
평탄화합니다. 증거 없는 호출은 건너뛰고 무엇으로도 대체하지 않습니다.

## 소비자가 닿는 곳

셋이고 전부 간접입니다.

- **설정 파일.** 그 스키마가 여기서 정의됩니다. 어휘 레퍼런스는
  [configuration.md](../configuration.ko.md)입니다.
- **JSON Schema 자산.** `@polydeukes/core/schema.json` exports 서브패스입니다. 이 패키지를
  직접 설치한 프로젝트가 쓰는 경로입니다. 우산을 설치한 소비자는 그쪽에 동봉된 사본을
  가리킵니다. 두 철자 모두
  [configuration.md의 IDE 절](../configuration.ko.md#ide-지원)에 있습니다.
- **위의 프로토콜.** `blocked` 행을 읽는다는 것은 본체가 답한 어휘를 읽는다는 뜻입니다.

나머지는 전부 `polydeukes`를 통해 닿습니다.

## 선언된 한계

- **어댑터 네임스페이스는 이름이 아니라 형태로 검증합니다.** `defineConfig()`는 `adapters`가
  평범한 객체의 맵인지, 각 네임스페이스 값이 객체인지를 봅니다. 네임스페이스 **이름**이
  누군가 구현한 것인지는 보지 않고, 네임스페이스 안쪽은 들여다보지 않습니다.
  `adapters.git` 안의 미지 어휘는 git 어댑터의 검증기가 자기 층위에서 거부합니다. 여기가
  아닙니다.
- **`requirePrecedent` 증거도 같은 방식으로 층이 나뉩니다.** 코어는 `command` 키를 완전히
  검증합니다. 셸 명령이 에이전트가 시스템으로 건너오는 표면이기 때문입니다. 다른 키는
  컨테이너 형태만 봅니다. 키 하나를 담은 평평한 객체인지까지이고, 값은 그대로 통과해
  주인 어댑터가 판정합니다.
- **기본 전사는 아무것도 하지 않습니다.** 실제 전사를 주입하지 않은 소비자는 "아무 일도
  없었다"로 수렴합니다. 밸브에게는 이쪽이 안전한 방향입니다. 결코 열리지 않기 때문입니다.
  실제 전사는 어댑터 뒤에 있습니다.
- **fail-open은 텔레메트리 하나뿐입니다.** 기록이 실패해도 판정은 바뀌지 않습니다. 표에 든
  다른 모든 실패 종류는 차단 쪽으로 떨어집니다.
