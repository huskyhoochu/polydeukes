# `polydeukes`, 우산 패키지

[English](./polydeukes.md) · **한국어**

> 알파입니다. 아래 내용은 출하된 패키지에서 그대로 읽었습니다. `pdks` 실행 파일과 배럴,
> 그리고 exports 맵입니다. 이것들을 쓰는 절차는 [설치](../installation.ko.md)와
> [문제 해결](../troubleshooting.ko.md)에 있습니다.

설치하는 패키지는 우산 하나입니다. 코어와 판정기, 어댑터 둘을 자기 의존으로 안고 있으며,
그것들을 조립할 수 있는 유일한 패키지이기도 합니다. 이 저장소의 다른 모든 의존은 코어를
통해 한 방향으로만 흐릅니다. 그래서 이 문서가 소비자가 마주하는 진입점입니다. 스코프
패키지 넷은 설치하지도 불러오지도 않는 전이 의존입니다.

| 패키지 | 레퍼런스 | 소유하는 것 |
|---|---|---|
| `@polydeukes/core` | [core](./core.ko.md) | 프로토콜, 설정 스키마, 텔레메트리 |
| `@polydeukes/covenant` | [covenant](./covenant.ko.md) | 판정기입니다. 디스패처와 규율, 메타 약속, 밸브 |
| `@polydeukes/adapter-claude-code` | [adapter-claude-code](./adapter-claude-code.ko.md) | 세션 표면입니다. PreToolUse 페이로드에서 입력 IR로 |
| `@polydeukes/adapter-git` | [adapter-git](./adapter-git.ko.md) | 커밋 표면입니다. 스테이징된 diff에서 입력 IR로 |

## 서브커맨드

실행 파일 이름은 `pdks`이고 `polydeukes`가 별칭입니다. 모든 인자 형태는 유한한 표와
대조됩니다. `covenant check`는 관측 범위 플래그 하나를 선택적으로 받고, `init
claude-code`는 정확히 그 형태이며, `explain`은 한 단어, `docs`는 선택적 주제를 받습니다.

### `pdks covenant check`

`pdks covenant check [--worktree | --range <base>..<head>]`. 커밋 표면의 판정 실행기입니다.
작업 디렉터리에서 설정을 찾고, git 어댑터로 저장소의 관측 하나를 수집하고, 약속(covenant)
입력 IR로 번역한 다음, 세션 훅이 부르는 것과 같은 in-process 판정기로 보냅니다. 어느 관측인지는
관측 범위 플래그가 고릅니다. 같은 위반은 세 범위 모두에서 같은 판정 결과를 받습니다.

| 형태 | 관측 범위 | `pre` → `post` |
|---|---|---|
| `pdks covenant check` | 스테이징 영역. pre-commit 훅이 판정하는 것 | HEAD blob → 스테이징된 blob |
| `pdks covenant check --worktree` | 작업 트리. 미추적(무시되지 않은) 파일 포함 | HEAD blob → 디스크의 바이트 |
| `pdks covenant check --range <base>..<head>` | 두 ref. `<base>...<head>`는 둘의 merge-base부터 읽는 PR 읽기 | base blob → head blob |

`--worktree`와 `--range`는 진단 호출입니다. 작업을 마친 뒤, PR 전에, CI에서 부릅니다.
관문은 스테이징 형태뿐이라 증인 토큰을 묻는 것도 그 형태뿐입니다. 나머지 둘은 묻지 않고
종료 `2`로 보고합니다. 사람이 열어 줄 커밋이 없기 때문입니다.

| 상황 | 결과 |
|---|---|
| 관측 범위의 변경이 아무것도 깨지 않음 | 종료 `0` |
| 스테이징된 변경이 약속을 깼고 `enforce: block`, 설정에 `witness` 블록이 있음 | `/dev/tty`로 증인 토큰을 한 번 묻습니다. 답이 없거나 틀리면 종료 `2` |
| 같은 상황인데 설정에 `witness` 블록이 없음 | 묻지 않고 종료 `2`. 밸브는 그 블록으로 조립되므로 블록이 없으면 차단을 열 방법이 없습니다 |
| 작업 트리나 범위의 변경이 약속을 깼고 `enforce: block` | 종료 `2`, 묻지 않습니다 |
| 변경이 약속을 깼고 `enforce: advise` | 권고 한 줄을 stderr에 쓰고 종료 `0`, `advised`로 기록 |
| 관측 범위가 빔(스테이징 없음, 깨끗한 트리, 같은 ref 둘) | 종료 `0`. 건너뛴 실행이 아니라 판정을 받고 지나간 것입니다 |
| git이 해소하지 못하는 ref를 담은 범위, 또는 merge-base가 없는 두 ref | 종료 `2`, `blocked` 한 행 |
| 인자 없는 `--range`, `..` 없는 인자, 두 플래그 동시 사용, 모르는 플래그 | usage 줄을 stderr에, 종료 `2` |
| 설정이 없거나 둘 이상이거나 무효 | 종료 `2` |
| 판정 본체를 적재할 수 없음 | 종료 `2` |

맥락 계열 규율(discipline)인 `requirePrecedent`는 다른 항목과 똑같이 조립되지만, 이 표면에는
읽을 세션이 없습니다. 매치되면 `skipped`를 기록하고 커밋은 진행됩니다. 결함이 아니라 커밋
표면의 항구적 조건입니다.

### `pdks init claude-code`

세션 표면 설치기입니다. **무엇을 쓰기 전에** 자기가 호출된 디렉터리에서 `polydeukes`가
해소되는지 먼저 증명하고, 그다음 산출물 여섯을 만듭니다.

| 산출물 | 방식 |
|---|---|
| `.claude/hooks/covenant-pretooluse.mjs` | 생성. 설치된 패키지에서 판정기를 적재하는 위임자입니다 |
| `.claude/settings.json` | 병합. PreToolUse 등록을 파일이 이미 담고 있는 것 위에 더합니다 |
| `polydeukes.config.yaml` | 생성. 자리표시자 `languages` 블록을 담은 출발 정책입니다 |
| `.claude/rules/polydeukes.md` | 생성. 웹을 검색하는 대신 [`pdks docs`](#pdks-docs-topic)에 물으라고 AI 파트너에게 일러 줍니다 |
| `.claude/skills/discipline-draft/SKILL.md` | 생성. 분류 절차입니다 — 서술된 문제가 설정 항목이 되고(advise 판정 항목 또는 `draft: true`), `advised` 행은 텔레메트리 로그에서 소비하도록 안내합니다 |
| `.gitignore` | 덧붙이기. `.polydeukes/` 한 줄입니다 |

이미 있는 것은 무엇도 덮어쓰지 않습니다. 실재하는 산출물은 건너뛴 것으로 보고하고 그대로
두므로 재실행은 언제나 아무 일도 하지 않습니다. 선행 조건 실패는 파일을 하나도 쓰지 않고
종료 `2`를 냅니다. 패키지가 해소되지 않는 경우, 설정 철자가 둘 공존하는 경우, settings
파일을 파싱할 수 없는 경우가 여기 듭니다. 반쯤 배선된 트리는 남지 않습니다.

### `pdks docs [topic]`

오프라인 문서 열람기입니다. 가이드와 이 레퍼런스 층이 패키지 안에 함께 실리므로, 답은
네트워크가 아니라 설치된 판본에서 나옵니다.

| 호출 | 결과 |
|---|---|
| `pdks docs` | 토픽 목록을 stdout에 쓰고 종료 `0` |
| `pdks docs <topic>` | 그 토픽의 절과 뒤따르는 `See also:` 한 줄, 종료 `0` |
| `pdks docs <모르는 토픽>` | 아는 토픽을 stderr에 열거하고 종료 `2` |
| `pdks docs a b` | usage 한 줄을 stderr에 쓰고 종료 `2` |

| 토픽 | 무엇에서 답하는가 |
|---|---|
| `install` | [installation](../installation.ko.md) 전문 |
| `config` | [설정 레퍼런스](./configuration.ko.md) 전문 |
| `discipline` | [설정 레퍼런스](./configuration.ko.md)의 `disciplines` 절 |
| `covenant` | [configuration](../configuration.ko.md)의 강제가 어떤 모습인지 다루는 절 |
| `witness` | [설정 레퍼런스](./configuration.ko.md)의 `witness` 절에 이어 [troubleshooting](../troubleshooting.ko.md)의 밸브 절 |

**실패는 어느 경우에나 stdout을 0바이트로 둡니다.** 동봉 문서가 없는 경우, 문서가 그 표제를
더는 담지 않는 경우, 모르는 토픽인 경우 모두 무엇이 없었는지 stderr에 이름을 적고 종료 `2`를
냅니다. 절반만 쓰인 답은 에이전트가 그것을 문서로 읽고 그대로 인용하게 만들므로, 그런 상태를
두지 않습니다.

동봉되는 본문은 영어뿐입니다. 답은 원문 그대로 돌아오므로, 각 문서 머리의
`[한국어](./X.ko.md)` 링크는 패키지 안이 아니라
[저장소](https://github.com/huskyhoochu/polydeukes/tree/main/docs)의 미러를 가리킵니다.
이 표의 링크도 그리로 갑니다.

`pdks init claude-code`가 만드는 발견 파일이 AI 파트너를 이 서브커맨드로 보냅니다. 위의
산출물 표에 있습니다.

### `pdks explain`

조립 상태를 읽는 명령입니다. 작업 디렉터리의 설정을 읽고, 두 판정 러너가 쓰는 것과 같은
함수로 두 표면의 등록표를 조립해, 판정 없이 출력합니다. 판정 썽크(thunk)를 부르지 않고,
텔레메트리 행을 쓰지 않으며, 대화 기록을 읽지 않습니다.

```text
pdks explain — polydeukes.config.yaml

surface: session (claude-code hook)
  registrations 23 · judged 11 · skip 9 · meta 3 · excluded 0 · draft 1
  meta     self-mod                 paths 13 (common; includes the config file itself)
  judge    covenant-vocabulary      forbid · in packages/*/src/** · except … · why ✓
  skip     covenant-vocabulary      a shell write in scope whose result this layer cannot compute
  draft    bilingual-docs-sync      unpromoted — no judgment
  ...
surface: commit (git pre-commit) · enforce: advise
  registrations 10 · judged 3 · skip 6 · meta 1 · excluded 3 · draft 1
  skip     manifest-needs-npm-view  no session transcript to read
  excluded hooks-stay-armed         forbidCommand — no shell axis on this surface
  draft    bilingual-docs-sync      unpromoted — no judgment
```

등록 하나가 한 줄이고, 순서는 그 표면이 디스패치하는 순서입니다. 종류 열의 낱말은 다섯입니다.

| 종류 | 뜻 |
|---|---|
| `meta` | 판정 사슬 자체를 보호하는 등록입니다. `self-mod`, `shell-mod`, 그리고 세션 표면의 `transcript-mod` |
| `judge` | 판정 본체를 가진 항목입니다. 계열과 라우팅 스코프, `why` 유무를 함께 적습니다 |
| `skip` | 판정 대신 `skipped`를 기록하는 등록입니다. 컴파일러가 준 사유를 함께 적습니다. 평소에는 설정 결함일 때만 stderr에 닿는 그 사유입니다 |
| `excluded` | 커밋 표면의 `forbidCommand` 항목입니다. 이 표면에는 셸 축이 없습니다 |
| `draft` | 미승격 `draft: true` 항목입니다. 어느 표면에도 속하지 않으므로 양쪽에 표시됩니다 |

`registrations`는 앞의 셋을 세고, `excluded`와 `draft`는 등록이 되지 않는 항목이라 따로
셉니다. 커밋 표면 머리에는 `adapters.git.enforce` 강제 수준도 같이 적습니다. 권고하는
표면은 같은 표를 기록하되 아무것도 차단하지 않기 때문입니다.

세션 표면은 훅이 정상 페이로드에서 보는 대로, 곧 대화 기록이 있는 상태로 렌더됩니다.
그래서 `transcript-mod`와 맥락 계열이 세션에서와 같이 나타나고, 커밋 표면은 맥락 계열을
skip으로 보여 줍니다. 그것이 그 표면의 영구 조건입니다.

| 호출 | 결과 |
|---|---|
| `pdks explain` | 두 표면을 stdout에, 종료 `0` |
| `pdks explain <무엇이든>` | usage 줄을 stderr에, 종료 `2` |
| 설정 없음 · 둘 · 불량 | `pdks explain: <사유>`를 stderr에, stdout 0바이트, 종료 `2` |

### 그 밖의 인자 형태

이 형태들이 아닌 것은 `usage: pdks covenant check [--worktree | --range <base>..<head>] |
pdks explain | pdks init claude-code | pdks docs [topic]`을 stderr에 쓰고 종료 `2`를 냅니다.

## 종료 코드

코드는 셋이고 층은 둘입니다. **소비자의 훅이 관측하는 것은 `0` 아니면 `2`뿐입니다.**
조립 루트 둘 다 `Promise<{ exitCode: 0 | 2 }>`를 반환합니다.

| 코드 | 상수 | 내는 곳 | 뜻 |
|---|---|---|---|
| `0` | `EXIT_UPHOLD` | 판정 결과, 래퍼, 실행 파일 | 약속이 지켜졌고 호출이나 커밋이 진행됩니다 |
| `1` | `EXIT_BREAK_NON_BLOCKING` | 판정 결과만 | 신호로 보고된 위반입니다. 래퍼가 번역합니다. `enforce: block`이면 `2`로, `advise`면 `0`과 `advised` 행으로 바뀝니다. 어느 쪽이든 표면까지 오지 않습니다 |
| `2` | `EXIT_BREAK_BLOCKING` | 래퍼, 실행 파일, fail-closed 경로 | 호출이나 커밋을 거부합니다 |

이 비대칭이 프로토콜의 책임 경계입니다. 판정기는 약속이 깨졌는지 **여부**를 정해 결과값
`0`이나 `1`로 답하고, 위반이 무엇을 **치르는지**는 래퍼가 정합니다. `enforce`를 읽는
자리가 거기 하나입니다. 그래서 판정기는 자기가 실릴 표면이 차단하는지 권고하는지 모르는
채로 실행되고 시험되고 검토됩니다. 느슨해지는 것은 판정 결과뿐입니다. 판정할 수 없는 결과,
곧 결과값이 `2` 이상이거나 판정기가 예외를 던지는 경우는 어느 강제 수준에서도 `2`로 남습니다.

**판정할 수 없는 것은 전부 `2`로 떨어집니다.** 설정이 없거나 무효인 경우, 페이로드를 파싱할
수 없는 경우, 판정 본체가 빌드된 적 없는 경우가 각각 fail-closed입니다. 열린 채로 남는 방향은
측정 하나입니다. 텔레메트리 기록이 실패해도 판정 결과는 바뀌지 않습니다.

## 프로그램 표면

배럴(`import … from 'polydeukes'`)이 내보내는 것은 심볼 여섯에 재노출 타입 하나입니다.
공개 API는 이것이 전부이고 스코프 패키지는 여기 들지 않습니다.

### `loadConfig`

**타입 시그니처.**

```ts
function loadConfig(rootDir: string): LoadedConfig;

type LoadedConfig = {
  config: ResolvedConfig;  // protectedPaths에 설정 파일 자신이 이미 들어 있습니다
  configPath: string;      // 찾아낸 파일의 rootDir 상대 경로
};
```

`rootDir` 바로 아래의 `polydeukes.config` 파일 하나를 찾습니다. 확장자는 `.yaml`과 `.yml`,
`.json`을 받습니다. **모든 실패 분기가 예외를 던집니다.** 하나도 없는 경우, 둘 이상인 경우,
파싱 오류, 스키마 위반이 그렇습니다. 조용한 기본값은 없습니다. 조용히 기본값이 실린 설정은
조용히 보호되지 않는 프로젝트를 뜻하기 때문입니다.

### `runCovenantCheck`

**타입 시그니처.**

```ts
function runCovenantCheck(spec: CovenantCheckSpec): Promise<{ exitCode: 0 | 2 }>;

type CovenantCheckSpec = {
  repoRoot: string;                                  // 설정 탐색과 수집이 여기 닻을 내립니다
  telemetryPath?: string;                            // 설정의 로그 경로를 덮어씁니다
  covenantDist?: string;                             // 해소된 판정기 디렉터리를 덮어씁니다
  ttyPrompt?: (prompt: string) => string | null;     // TTY 밸브 이음매
  domain?: CheckDomain;                              // 어느 관측을 판정할지. 없으면 staged
};

type CheckDomain =
  | { kind: 'staged' }
  | { kind: 'worktree' }
  | { kind: 'range'; base: string; head: string; ancestry?: 'merge-base' };
```

커밋 표면의 조립 루트이고
[`pdks covenant check`](#pdks-covenant-check)가 실행하는 것입니다. `ancestry: 'merge-base'`가
`<base>...<head>` 읽기이고, merge-base 해소는 어댑터가 맡습니다.

`ttyPrompt`가 없으면 TTY 없는 환경이라는 뜻이고, 그러면 밸브는 열릴 방법이 없습니다.
에이전트가 띄운 커밋과 CI 실행이 같은 상태에 닿습니다. 밸브는 터미널 앞의 사람이거나
아무것도 아닙니다.

### `runClaudeCodeHook`

**타입 시그니처.**

```ts
function runClaudeCodeHook(spec: ClaudeCodeHookSpec): Promise<{ exitCode: 0 | 2 }>;

type ClaudeCodeHookSpec = {
  repoRoot: string;         // 설정 탐색과 규율 glob 범위가 여기 닻을 내립니다
  rawPayload?: string;      // 없으면 fd 0을 읽습니다. 훅의 실제 표준 입력입니다
  telemetryPath?: string;
  covenantDist?: string;
};
```

세션 표면의 조립 루트이고 생성된 훅 위임자가 부르는 것입니다. 배럴이 아니라
[`polydeukes/claude-code`](#서브패스) 서브패스로 닿으십시오.

**조립 루트 둘 다 예외를 던지지 않습니다.** 잡히지 않은 거부는 위임자를 비차단으로
종료시키고, 그것이 가장 값싼 우회이기 때문입니다. 둘 다 실패를 텔레메트리 기록과 함께
`{ exitCode: 2 }`로 풀어냅니다.

### `ResolvedConfig`

[`@polydeukes/core`](./core.ko.md)에서 재노출합니다. `loadConfig`의 결과를 읽는 소비자가
두 번째 의존을 걸 필요가 없게 하려는 것입니다.

## 서브패스

| 지정자 | 담는 것 |
|---|---|
| `polydeukes` | 배럴입니다. `loadConfig`와 `runCovenantCheck`, `runClaudeCodeHook`, 각 스펙 타입, `ResolvedConfig` |
| `polydeukes/claude-code` | `runClaudeCodeHook`과 `ClaudeCodeHookSpec` 둘뿐입니다 |
| `polydeukes/schema.json` | 설정 JSON Schema입니다. 빌드 시점에 코어에서 복사됩니다 |

생성된 훅 위임자는 배럴이 아니라 서브패스를 불러옵니다. ESM 임포트는 즉시 적재라서, 배럴을
부르면 쓰지도 않을 커밋 표면 실행기와 그 뒤의 git 어댑터가 세션 도구 호출마다 따라
올라옵니다. 서브패스가 세션 표면의 진입점이고 배럴은 프로그램으로 부르는 소비자의
것입니다.

`polydeukes/schema.json`은 스키마를 읽는 코드가 쓰는 경로입니다. `$schema` 줄은 대신 파일
경로를 적습니다. 편집기가 그 문자열을 정적으로 읽으므로 모듈 해석기가 돌지 않기
때문입니다. 두 철자 모두 [configuration.md의 IDE 절](../configuration.ko.md#ide-지원)에
있습니다.
