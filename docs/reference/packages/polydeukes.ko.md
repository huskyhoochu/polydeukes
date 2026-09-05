# `polydeukes`

[English](./polydeukes.md) · **한국어**

일반 사용자는 통합 패키지인 `polydeukes` 하나만 설치하면 됩니다. CLI 실행 파일, 설정 로더, 커밋 표면 실행기, 세션 표면 실행기 서브패스, 동봉된 스키마 자산을
모두 이 패키지가 맡습니다.

<a id="polydeukes-entry-points"></a>
## 진입점

| 지정자 | 내보내는 것 |
|---|---|
| `polydeukes` | `loadConfig`, `runCovenantCheck`, `ResolvedConfig` |
| `polydeukes/claude-code` | `runClaudeCodeHook`과 입력·결과 타입 |
| `polydeukes/schema.json` | 동봉된 설정 JSON Schema |

같은 CLI를 `pdks`와 별칭 `polydeukes`로 실행할 수 있습니다.

<a id="polydeukes-bin"></a>
## CLI 명령

| 명령 | 목적 |
|---|---|
| `pdks covenant check` | 스테이징한 변경, 작업 트리, 리비전 범위를 판정 |
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

<a id="root-export"></a>
### `.` 루트 진입점

| 심볼 | 종류 | 메모 |
|---|---|---|
| `loadConfig` | 함수 | `rootDir` 아래의 `polydeukes.config.*` 파일 하나를 찾아 읽습니다. 없거나, 둘 이상이거나, 파싱이나 검증에서 실패하면 예외를 던집니다. |
| `runCovenantCheck` | 함수 | 커밋 표면을 실행하고 `{ exitCode: 0 \| 2 }`를 반환합니다. |
| `ResolvedConfig` | 타입 | `@polydeukes/core`에서 다시 내보냅니다. |
| `LoadConfigSpec`, `LoadedConfig` | 타입 | 설정 로더의 입력과 결과입니다. |
| `CovenantCheckSpec`, `CovenantCheckOutcome`, `CheckDomain` | 타입 | 커밋 실행기의 입력, 결과, 관측 범위입니다. |

<a id="session-export"></a>
### `./claude-code`

| 심볼 | 종류 | 메모 |
|---|---|---|
| `runClaudeCodeHook` | 함수 | 세션 표면을 실행하고 `{ exitCode: 0 \| 2 }`를 반환합니다. |
| `ClaudeCodeHookSpec` | 타입 | 세션 실행기 입력입니다. |
| `ClaudeCodeHookOutcome` | 타입 | 세션 실행기 결과입니다. |

생성된 훅은 배럴 대신 이 서브패스를 가져옵니다. ESM의 정적 가져오기는 모듈을 즉시 평가하므로,
배럴을 사용하면 세션 도구 호출에 필요 없는 커밋 표면 실행기와 Git 어댑터까지 매번 불러옵니다.

<a id="schema-export"></a>
### `./schema.json`

| 자산 | 메모 |
|---|---|
| `polydeukes.schema.json` | 통합 패키지에 동봉한 설정 스키마 사본입니다. |

<a id="polydeukes-signatures"></a>
## 시그니처와 예제

```ts
function loadConfig(spec: LoadConfigSpec): LoadedConfig;

type LoadConfigSpec = { rootDir: string };

type LoadedConfig = {
  config: ResolvedConfig;
  configPath: string;
};

function runCovenantCheck(spec: CovenantCheckSpec): Promise<CovenantCheckOutcome>;

type CovenantCheckSpec = {
  repoRoot: string;
  telemetryPath?: string;
  covenantDist?: string;
  ttyPrompt?: (prompt: string) => string | null;
  domain?: CheckDomain;
};

type CheckDomain =
  | { kind: 'staged' }
  | { kind: 'worktree' }
  | { kind: 'range'; base: string; head: string; ancestry?: 'merge-base' };

function runClaudeCodeHook(spec: ClaudeCodeHookSpec): Promise<ClaudeCodeHookOutcome>;

type ClaudeCodeHookSpec = {
  repoRoot: string;
  rawPayload?: string;
  telemetryPath?: string;
  covenantDist?: string;
};
```

`ancestry: 'merge-base'`는 `<base>...<head>`와 같이 공통 조상을 기준으로 비교한다는 뜻입니다.
`rawPayload`가 없으면 훅은 표준 입력인 파일 디스크립터 0을 읽습니다. 훅 타입은 루트 배럴이 아니라 `polydeukes/claude-code`에 있습니다.

```ts
import { loadConfig, runCovenantCheck } from 'polydeukes';
import { runClaudeCodeHook } from 'polydeukes/claude-code';

const { configPath } = loadConfig({ rootDir: process.cwd() });
const check = await runCovenantCheck({ repoRoot: process.cwd() });
const hook = await runClaudeCodeHook({ repoRoot: process.cwd(), rawPayload: '{}' });
```

<a id="polydeukes-failure-boundaries"></a>
## 실패 경계

- `loadConfig()`는 설정이 없거나, 둘 이상이거나, 파싱이나 검증에서 실패하면 예외를 던집니다.
- `runCovenantCheck()`와 `runClaudeCodeHook()`는 예외를 던지지 않고 `{ exitCode: 0 \| 2 }`를 반환합니다.
- 숫자 코드는 `@polydeukes/core`의 `EXIT_UPHOLD`(`0`), `EXIT_BREAK_NON_BLOCKING`(`1`),
  `EXIT_BREAK_BLOCKING`(`2`)입니다. 우산 실행기는 `0` 또는 `2`만 노출하며 `1`을 반환하지 않습니다.
- `pdks covenant check`가 증인 토큰을 요청하는 것은 스테이징한 변경을 검사할 때뿐입니다. `--worktree`와 `--range`에서는 묻지 않습니다.
- `pdks docs`와 `pdks explain`은 실패 시 중간 출력 없이 끝납니다.

<a id="polydeukes-see-also"></a>
## 함께 보기

- [`pdks covenant check`](../cli/covenant-check.ko.md)
- [`pdks init`](../cli/init.ko.md)
- [`pdks explain`](../cli/explain.ko.md)
- [설정 참조](../configuration/index.ko.md)
