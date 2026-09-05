# `pdks init`

[English](./init.md) · **한국어**

프로젝트를 세션 표면에 연결합니다. `claude-code`와 `grok` 두 형식 모두 대상 프로젝트에서
설치된 패키지를 찾을 수 있는지 먼저 검사합니다. 그 검사가 끝나기 전에는 파일을 쓰지 않습니다.

<a id="init-syntax"></a>
## 구문

```sh
pdks init claude-code
pdks init grok
```

두 형식 모두 다시 실행할 수 있습니다. 이미 있는 산출물은 보존하고 `skipped`로 보고합니다.
사전 검사에 실패하면 파일을 쓰지 않고 종료 코드 `2`를 반환합니다.

<a id="init-common"></a>
## 공통 사전 검사와 초기 파일

설치 순서는 다음과 같습니다.

1. 대상 프로젝트에서 `polydeukes`를 찾을 수 있는지 확인합니다.
2. 공통 설정과 텔레메트리 제외 항목을 만듭니다.
3. 표면별 등록 파일을 추가합니다.

두 설치기가 공통으로 만드는 것은 `polydeukes.config.yaml`과 `.gitignore`의 `.polydeukes/`
항목입니다. 설정 파일에는 언어 블록, 보호 목록, 증인 블록, 주석으로 된 규율 예제가 있습니다.
완성된 정책이 아니라 프로젝트에 맞춰 고칠 출발점입니다.

<a id="init-claude-code"></a>
## `pdks init claude-code`

Claude Code 세션 표면에 필요한 파일은 다음과 같습니다.

- `.claude/hooks/covenant-pretooluse.mjs`
- `.claude/settings.json`
- `.claude/rules/polydeukes.md`
- `.claude/skills/discipline-draft/SKILL.md`
- `polydeukes.config.yaml`
- `.gitignore`

훅은 `polydeukes/claude-code`에 판정을 맡깁니다. 설정에는 PreToolUse 등록을 병합하고,
문서 안내 파일은 AI 파트너가 웹 검색 대신 `pdks docs`를 쓰도록 알려 줍니다.
스킬은 설명된 규율 문제를 설정 항목으로 바꾸는 절차를 제공합니다.

기존 훅, 설정 데이터, 문서 안내, 스킬 파일은 보존합니다. 호스트 설정에는 필요한 등록을
병합하고 `.gitignore`에는 빠진 항목만 추가합니다. 아래 설명처럼 기존 Grok 등록을 조정할
수도 있으므로 재실행이 언제나 아무것도 바꾸지 않는 것은 아닙니다.

패키지 버전을 올려도 사용자가 수정한 스킬은 덮어쓰지 않습니다. 임시 프로젝트에서 새 사본을
만들어 기존 파일과 비교한 뒤, 백업하고 필요한 부분만 반영하세요. 강제로 다시 만들려고
작업 중인 프로젝트의 스킬을 지우지는 마세요.

<a id="init-grok"></a>
## `pdks init grok`

Grok 전용 프로젝트에는 다음 파일을 만듭니다.

- `.grok/hooks/covenant-pretooluse.mjs`
- `.grok/hooks/covenant-pretooluse.json`
- `polydeukes.config.yaml`
- `.gitignore`

Claude Code 형식과의 차이는 다음과 같습니다.

- `.claude/` 파일을 만들지 않고 Grok 훅 JSON에 등록합니다.
- Claude 위임 훅이 이미 있으면 새 훅을 만들지 않고 Grok JSON에서 기존 파일을 지정합니다.
- 새 등록의 제한 시간은 60초입니다. Grok 호스트 기본값은 5초이며, 훅 실행이 시간 초과로
  끝나면 해당 호출을 차단하지 않습니다(fail-open). Claude 설정에 같은 명령이 등록돼 있으면
  Grok의 매칭 조건도 맞춰
  명령과 조건이 모두 같게 만듭니다.
- 어느 설치기를 다시 실행하든, 설치기가 만든 Grok 훅 명령을 기존 Claude 파일로 바꾸고
  매칭 조건을 맞출 수 있습니다. 사용자가 다른 곳을 지정한 명령은 그대로 두며 기존 제한
  시간도 유지합니다.
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
pdks init claude-code
pdks init grok
```

설치기는 CLI 명령입니다. `polydeukes`나 `polydeukes/claude-code` 계약의 공개 심볼이
아닙니다.

<a id="init-see-also"></a>
## 함께 보기

- [`pdks docs`](./docs.ko.md)
- [`pdks explain`](./explain.ko.md)
- [설정 참조](../configuration/index.ko.md)
- [`polydeukes`](../packages/polydeukes.ko.md)
