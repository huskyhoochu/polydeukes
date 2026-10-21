# `@polydeukes/adapter-claude-code`

[English](adapter-claude-code.md) · **한국어**

<a id="ownership"></a>
## 소유 범위

호스트의 이벤트·도구 이름은 이 모듈에서 공통 약속(covenant) 입력 IR로 바뀝니다. 세 어댑터 모두 같은 세 함수를 제공합니다.

| 함수 | 입력과 결과 |
|---|---|
| `prepareHook` | `PrepareHookSpec` → `PrepareHookOutcome`: `check`·`recorded`·`unavailable` |
| `registerHook` | `RegisterHookSpec` → `RegisterHookOutcome`: 생성·갱신·변경 없음·보존 경로와 보호 경로 |
| `renderHookResponse` | `RenderHookResponseSpec` → `RenderHookResponseOutcome`: exit code·stdout·stderr |

공통 `pdks` 실행 경로가 stdin을 받고 현재 실행 파일의 `covenant check --enforce block`에 IR을 전달합니다. 입력 EOF 기한과 자식 통신
기한은 각각 10초입니다. 등록된 PreToolUse 기한은 60초, prompt/post는 30초, 종료는 5초입니다.

번역 불가·잘린 입력·잘못된 UTF-8은 `--input-failure`로 전달합니다. 공통 판정기가 원인을 한 번 출력하고 `blocked covenant-check` 행 한
건을 기록합니다. 자식 실행 실패·시그널·예상 밖 status·기한 초과도 거부하며, 판정기가 시작되지 못하면 telemetry 행이 없을 수 있습니다.

<a id="translation"></a>
## 번역과 증거

`Edit`·`Write`·`MultiEdit`·`NotebookEdit`와 셸 `Bash`를 등록합니다. 파일 호출은 디스크의 이전 상태와 계산한 이후 상태를 짝지으며 셸 호출은
명령을 전달합니다. 사용 가능한 Claude 대화 기록은 세션 증거를 공급합니다. 사람 메시지는 `origin.kind: human`으로 확인한 경우에만 증인(witness)
밸브의 근거가 됩니다. `role: user`만으로 사람이라고 판단하지 않습니다.

<a id="consumer-contract"></a>
## 연결과 이전

```sh
pdks adapter claude-code init
```

프로젝트 루트에서 실행하세요. 단일 실행 파일에 세 어댑터가 포함되며 별도 Node·npm 설치가 필요하지 않습니다. 등록에는 현재 실행 파일과 프로젝트 루트의 절대 경로가
고정됩니다. 실행 파일이나 프로젝트를 옮기면 새 위치에서 다시 실행하세요.

설치기는 자체 등록을 갱신하고 다른 handler와 사용자 설정을 보존합니다. 구형 생성 `.mjs`는 원본과 일치할 때 제거하고 사용자가 수정한 파일은 보존합니다. 기존 설정을
덮어쓰지 않으므로 출력한 필수 보호 경로를 설정의 `protectedPaths`와 대조하세요.

Grok은 stdout JSON의 `decision: allow|deny`로 응답하고 Claude·Codex는 빈 stdout과 exit 0·2로 응답합니다. 관측 전용 생명주기
이벤트는 도구 판정 JSON 없이 exit 0으로 끝납니다.

<a id="limits"></a>
## 관측 한계

훅은 호스트가 전달한 도구 호출을 판정합니다. 자식 프로세스의 개별 파일 쓰기를 별도로 관측하지 않습니다. 증거가 없으면 해당 선언의 공급 정책을 따르며 없는 기록을 합성해
`passed`로 만들지 않습니다. 호스트가 훅을 신뢰하지 않거나 비활성화했다면 이 경로의 판정이 시작되지 않습니다.

Claude와 Grok을 함께 등록한 프로젝트에서는 Grok의 호환 Claude callback을 `GROK_WORKSPACE_ROOT`가 있을 때 건너뛰고 Grok 자체 등록으로
판정합니다. Grok 연결에도 자체 `init`이 필요합니다. 전역 호스트 설정은 변경하지 않습니다.

[설치 참조](../cli/init.ko.md#init-claude-code)
