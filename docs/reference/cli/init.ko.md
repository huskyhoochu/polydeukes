# `pdks init`

[English](./init.md) · **한국어**

`pdks init`은 에이전트와 무관한 초기 파일을 만듭니다. 설정 파일과 텔레메트리 제외 항목
둘입니다. 이 명령은 어느 에이전트도 알지 못합니다. 세션 표면 등록은 그 에이전트의 어댑터가
맡는 별도 명령입니다. Claude Code는 `pdks-claude-code init`, Grok는 `pdks init grok`입니다.

<a id="init-syntax"></a>
## 구문

```sh
pdks init
pdks init grok
```

이 명령이 받는 형식은 이 둘입니다. 다른 인자를 주면 사용법을 출력하고 종료 코드 `2`를
반환합니다. 두 형식 모두 다시 실행할 수 있습니다. 이미 있는 산출물은 보존하고 `skipped`로
보고하며, 사전 검사에 실패하면 파일을 쓰지 않고 종료 코드 `2`를 반환합니다.

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
npm install --save-dev polydeukes @polydeukes/adapter-claude-code
npx pdks-claude-code init
```

이 명령은 먼저 `pdks init`으로 초기 파일을 만든 뒤 Claude Code 등록 산출물을 씁니다.

- `.claude/hooks/covenant-pretooluse.mjs`
- `.claude/settings.json`
- `.claude/rules/polydeukes.md`
- `.claude/skills/discipline-draft/SKILL.md`

산출물별 동작은 [표면 연결하기](../../how-to/connect-surfaces.ko.md#claude-code)에 있습니다.

<a id="init-grok"></a>
## `pdks init grok`

Grok 전용 프로젝트에는 다음 파일을 만듭니다.

- `.grok/hooks/covenant-pretooluse.mjs`
- `.grok/hooks/covenant-pretooluse.json`
- `polydeukes.config.yaml`
- `.gitignore`

Claude Code 설치기와의 차이는 다음과 같습니다.

- `.claude/` 파일을 만들지 않고 Grok 훅 JSON에 등록합니다.
- Claude 위임 훅이 이미 있으면 새 훅을 만들지 않고 Grok JSON에서 기존 파일을 지정합니다. 이 형태는
  `pdks-claude-code init` 뒤에 실행합니다. 순서가 반대이면 두 표면이 각자 위임자를 갖고, 두 등록을
  모두 가진 프로젝트는 호출마다 판정기를 두 번 실행합니다.
- 새 등록의 제한 시간은 60초입니다. Grok 호스트 기본값은 5초이며, 훅 실행이 시간 초과로
  끝나면 해당 호출을 차단하지 않습니다(fail-open). Claude 설정에 같은 명령이 등록돼 있으면
  Grok의 매칭 조건도 맞춰 명령과 조건이 모두 같게 만듭니다.
- 사용자가 다른 곳을 지정한 명령은 그대로 두며 기존 제한 시간도 유지합니다.
- 나중에 Claude 설정을 제거했다면 Grok JSON을 다시 만들어 Grok 기본 매칭 조건을 복원하세요.
  사용자 설정부터 백업해야 합니다. 변경 뒤에는 Grok의 Hooks 탭을 다시 불러오거나 새 세션을
  시작합니다.

Grok는 Claude 세션 증인 밸브가 요구하는 인간 메시지 증거를 제공하지 않습니다.
대화 기록은 Claude JSONL이 아니라 ACP `updates.jsonl`입니다.
[Grok 복구 안내](../../troubleshooting.ko.md#grok-witness)를 참고하세요.

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
pdks init grok
npx pdks-claude-code init
```

설치기는 CLI 명령입니다. `polydeukes` 계약의 공개 심볼이 아닙니다.

<a id="init-see-also"></a>
## 함께 보기

- [`@polydeukes/adapter-claude-code`](../packages/adapter-claude-code.ko.md) — Claude Code 설치
단위와 그 실행 파일
- [`pdks docs`](./docs.ko.md)
- [`pdks explain`](./explain.ko.md)
- [설정 참조](../configuration/index.ko.md)
- [`polydeukes`](../packages/polydeukes.ko.md)
