# `pdks init`

[English](./init.md) · **한국어**

`pdks init`은 에이전트와 무관한 초기 파일을 만듭니다. 설정 파일과 텔레메트리 제외 항목
둘입니다. 이 명령은 어느 에이전트도 알지 못합니다. 세션 표면 등록은 그 에이전트의 어댑터가
맡는 별도 명령입니다. Claude Code는 `pdks-claude-code init`, Grok는 `pdks-grok init`,
Codex는 `pdks-codex init`입니다.

<a id="init-syntax"></a>
## 구문

```sh
pdks init
```

다른 인자를 주면 사용법을 출력하고 종료 코드 `2`를 반환합니다. 이미 있는 산출물은 보존하고
`skipped`로 보고하며, 사전 검사에 실패하면 파일을 쓰지 않고 종료 코드 `2`를 반환합니다.

<a id="init-common"></a>
## `pdks init` — 초기 파일

이 명령의 순서는 다음과 같습니다.

1. 대상 프로젝트에서 `polydeukes`를 찾을 수 있는지 확인합니다.
2. 공통 설정과 텔레메트리 제외 항목을 만듭니다.

어느 표면이든 여기서 출발합니다.

- `polydeukes.config.yaml`
- `.gitignore`의 `.polydeukes/` 항목

설정 파일에는 언어 블록, 보호 목록, 증인(witness) 블록, 주석으로 된 규율(discipline) 예제가
있습니다. 완성된 정책이 아니라 프로젝트에 맞춰 고칠 출발점입니다.

<a id="init-claude-code"></a>
## Claude Code — `pdks-claude-code init`

Claude Code 세션 표면은
[`@polydeukes/adapter-claude-code`](../packages/adapter-claude-code.ko.md)가 설치합니다. 이
어댑터에는 자체 실행 파일이 있습니다.

```sh
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-claude-code
npx pdks-claude-code init
```

이 명령은 먼저 `pdks init`으로 초기 파일을 만든 뒤 Claude Code 등록 산출물을 씁니다.

- `.claude/hooks/covenant-pretooluse.mjs`
- `.claude/settings.json`
- `.claude/rules/polydeukes.md`
- `.claude/skills/discipline-draft/SKILL.md`

산출물별 동작은 [표면 연결하기](../../how-to/connect-surfaces.ko.md#claude-code)에 있습니다.

<a id="init-grok"></a>
## Grok — `pdks-grok init`

Grok 세션 표면은
[`@polydeukes/adapter-grok`](../packages/adapter-grok.ko.md)가 설치합니다. 이
어댑터에는 자체 실행 파일이 있습니다.

```sh
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-grok
npx pdks-grok init
```

이 명령은 먼저 `pdks init`으로 초기 파일을 만든 뒤 Grok 등록 산출물을 씁니다.

- `.grok/hooks/covenant-pretooluse.mjs`
- `.grok/hooks/covenant-pretooluse.json`

`.claude/` 파일을 만들거나 고치지 않습니다. 새 등록의 제한 시간은 60초입니다. Grok 호스트
기본값은 5초이며, 훅 실행이 시간 초과로 끝나면 해당 호출을 차단하지 않습니다(fail-open).
세션 어댑터를 한 프로젝트에 둘 이상 설치하면 호출마다 판정기가 두 번 실행될 수 있습니다.

Grok는 Claude 세션 증인(witness) 밸브가 요구하는 인간 메시지 증거를 제공하지 않습니다.
대화 기록은 Claude JSONL이 아니라 ACP `updates.jsonl`입니다.
[Grok 복구 안내](../../troubleshooting.ko.md#grok-witness)를 참고하세요. 산출물별 동작은
[표면 연결하기](../../how-to/connect-surfaces.ko.md#grok)에 있습니다.

<a id="init-codex"></a>
## Codex — `pdks-codex init`

Codex 세션 표면은
[`@polydeukes/adapter-codex`](../packages/adapter-codex.ko.md)가 설치합니다. 이
어댑터에는 자체 실행 파일이 있습니다.

```sh
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-codex
npx pdks-codex init
```

이 명령은 먼저 `pdks init`으로 초기 파일을 만든 뒤 Codex 등록 산출물을 씁니다.

- `.codex/hooks/covenant-pretooluse.mjs`
- `.codex/hooks.json`

`hooks.json`에는 `PreToolUse`, `UserPromptSubmit`, `PostToolUse`, `SessionEnd` 항목이
생깁니다. 파일은 덮어쓰지 않고 병합합니다. 사용자 항목, 같은 항목의 다른 handler, 다른
이벤트, 설치기가 모르는 키는 그대로 둡니다. 초기 설정은 기본적으로 `.codex/hooks`를
보호하므로, 이 설치기가 만드는 등록 파일은 같은 설치가 만든 설정이 지킵니다.

**훅 승인까지가 설치입니다.** Codex는 훅 정의의 해시로 신뢰를 기록하므로, 생성된 훅은 검토
대상으로 표시되고 `/hooks`에서 승인하기 전까지 건너뛰어집니다. 누군가 승인하기 전까지는
아무것도 판정되지 않습니다. `init`이 실행할 때마다 바이트가 같은 명령 문자열을 쓰는 이유가
이것입니다. 문자열이 바뀌면 다시 승인해야 합니다.

Codex는 훅에 도달하는 모든 파일 편집을 `apply_patch` 하나로 정규화하고, 경로 인자가 아니라 패치 텍스트를
보냅니다. `Edit`과 `Write`는 `.codex/hooks.json`에 적을 수 있는 matcher 별칭이며 도구 이름으로
도착하지 않습니다. 패치 하나가 여러 파일을 건드리면 파일마다 IR 원소 하나가 실리고, 그중
하나라도 차단되면 호출 전체가 차단됩니다.

불안정한 Codex 대화 기록은 해석하지 않습니다. `UserPromptSubmit`은 시각을 붙인 사람
메시지를, `PostToolUse`는 완료된 도구 호출을 공급하고, `SessionEnd`는 어댑터 소유 증거
파일을 정리합니다. 따라서 설정된 증인 토큰으로 다시 시도한 보호 호출을 허용할 수 있습니다.
프롬프트 증거가 기록되지 않았다면 복구 메시지가 안내하는 사용자 터미널을 사용합니다.
산출물별 동작은 [표면 연결하기](../../how-to/connect-surfaces.ko.md#codex)에 있습니다.

<a id="init-results"></a>
## 결과와 실패 조건

| 상황 | 결과 |
|---|---|
| 패키지를 찾고 대상 프로젝트의 초기 파일을 만들 수 있음 | 종료 `0` |
| 요청한 산출물이 이미 있음 | `skipped`로 보고하고 종료 `0` |
| 대상 프로젝트에서 패키지를 찾을 수 없음 | 종료 `2`, 파일을 쓰지 않음 |
| 설정 파일이 여러 개라 모호함 | 종료 `2`, 파일을 쓰지 않음 |
| 호스트 설정 파일을 읽거나 구문을 분석할 수 없음 | 종료 `2`, 파일을 쓰지 않음 |
| 그 밖의 사전 검사 또는 파일 쓰기 실패 | 종료 `2` |

사전 검사는 파일을 쓰기 전에 끝납니다. 하지만 이후 파일 쓰기에서 실패하면 일부 파일이
이미 만들어졌을 수 있습니다. 설치 전체를 한꺼번에 되돌리는 기능은 아닙니다. 오류를 확인하고
파일시스템 문제를 고친 뒤 다시 실행하세요. 설치가 실패했으니 아무 파일도 없을 것이라고
가정해서는 안 됩니다.

<a id="init-examples"></a>
## 예제

```sh
pdks init
npx pdks-claude-code init
npx pdks-grok init
npx pdks-codex init
```

설치기는 CLI 명령입니다. `polydeukes` 계약의 공개 심볼이 아닙니다.

<a id="init-see-also"></a>
## 함께 보기

- [`@polydeukes/adapter-claude-code`](../packages/adapter-claude-code.ko.md) — Claude Code 설치
단위와 그 실행 파일
- [`@polydeukes/adapter-grok`](../packages/adapter-grok.ko.md) — Grok 설치 단위와 그 실행 파일
- [`@polydeukes/adapter-codex`](../packages/adapter-codex.ko.md) — Codex 설치 단위와 그 실행
파일
- [`pdks docs`](./docs.ko.md)
- [`pdks explain`](./explain.ko.md)
- [설정 참조](../configuration/index.ko.md)
- [`polydeukes`](../packages/polydeukes.ko.md)
