# `@polydeukes/adapter-codex`

[English](adapter-codex.md) · **한국어**

<a id="ownership"></a>
## 소유 범위

호스트의 이벤트·도구 이름은 이 모듈에서 공통 약속(covenant) 입력 IR로 바뀝니다. 세 어댑터 모두 같은
세 함수를 제공합니다.

| 함수                 | 입력과 결과                                                                           |
| -------------------- | ------------------------------------------------------------------------------------- |
| `prepareHook`        | `PrepareHookSpec` → `PrepareHookOutcome`: `check`·`recorded`·`unavailable`            |
| `registerHook`       | `RegisterHookSpec` → `RegisterHookOutcome`: 생성·갱신·변경 없음·보존 경로와 보호 경로 |
| `renderHookResponse` | `RenderHookResponseSpec` → `RenderHookResponseOutcome`: exit code·stdout·stderr       |

공통 `pdks` 실행 경로가 stdin을 받고 현재 실행 파일의 `covenant check --enforce block`에 IR을
전달합니다. 입력 EOF 기한과 자식 통신 기한은 각각 10초입니다. 등록된 PreToolUse 기한은 60초,
prompt/post는 30초, 종료는 5초입니다.

번역 불가·잘린 입력·잘못된 UTF-8은 `--input-failure`로 전달합니다. 공통 판정기가 원인을 한 번
출력하고 `blocked covenant-check` 행 한 건을 기록합니다. 자식 실행 실패·시그널·예상 밖 status·기한
초과도 거부하며, 판정기가 시작되지 못하면 telemetry 행이 없을 수 있습니다.

<a id="apply-patch"></a>
## 패치와 세션 증거

`apply_patch` 텍스트를 파일별 IR로 나눕니다. 하위 cwd의 경로는 등록한 프로젝트 루트 기준으로 바뀌며
프로젝트 밖 대상은 거부합니다. `PostToolUse`로 관측한 도구 증거는 세션·하위 에이전트별로 분리하고
`SessionEnd`에 정리합니다. 불안정한 Codex 대화 기록 파일은 읽지 않습니다. 현재 prompt 이벤트가 사람
출처를 증명하지 않으므로 자동 증인 밸브를 열지 않습니다. 보호된 변경은 사용자 터미널에서 수행하세요.

<a id="consumer"></a>
## 연결과 이전

```sh
pdks adapter codex init
```

프로젝트 루트에서 실행하세요. 단일 실행 파일에 세 어댑터가 포함되며 별도 Node·npm 설치가 필요하지
않습니다. 등록에는 현재 실행 파일과 프로젝트 루트의 절대 경로가 고정됩니다. 실행 파일이나 프로젝트를
옮기면 새 위치에서 다시 실행하세요.

설치기는 자체 등록을 갱신하고 다른 handler와 사용자 설정을 보존합니다. 구형 생성 `.mjs`는 원본과
일치할 때 제거하고 사용자가 수정한 파일은 보존합니다. 기존 설정을 덮어쓰지 않으므로 출력한 필수 보호
경로를 설정의 `protectedPaths`와 대조하세요.

<a id="code-mode-coverage"></a>
## Code Mode 관측 범위

Codex에서 `/hooks`로 등록을 승인하세요. 신뢰는 정의의 hash에 연결되며 경로 변경 뒤 재승인이 필요할
수 있습니다. Code Mode 중첩 호출 관측은 버전에 따라 달라지므로 설치한 버전으로 실제 파일·셸 호출과
telemetry를 확인하세요. `Active` 표시는 실행 증거가 아닙니다.

Grok은 stdout JSON의 `decision: allow|deny`로 응답하고 Claude·Codex는 빈 stdout과 exit 0·2로
응답합니다. 관측 전용 생명주기 이벤트는 도구 판정 JSON 없이 exit 0으로 끝납니다.

셸 경로는 이벤트의 cwd를 기준으로 읽습니다. Codex CLI 0.163.0에서 `workdir`를 지정한 중첩
`exec_command` 한 건은 보호 파일의 mtime 변경을 막지 못했습니다. 원시 훅 payload를 수집하지
않았으므로 도구별 작업 디렉터리 지정의 관측 범위는 미확인입니다. 해당 payload를 확보하면 다시
확인합니다.

<a id="limits"></a>
## 관측 한계

훅은 호스트가 전달한 도구 호출을 판정합니다. 자식 프로세스의 개별 파일 쓰기를 별도로 관측하지
않습니다. 증거가 없으면 해당 선언의 공급 정책을 따르며 없는 기록을 합성해 `passed`로 만들지
않습니다. 호스트가 훅을 신뢰하지 않거나 비활성화했다면 이 경로의 판정이 시작되지 않습니다.

Claude와 Grok을 함께 등록한 프로젝트에서는 Grok의 호환 Claude callback을 `GROK_WORKSPACE_ROOT`가
있을 때 건너뛰고 Grok 자체 등록으로 판정합니다. Grok 연결에도 자체 `init`이 필요합니다. 전역 호스트
설정은 변경하지 않습니다.

[설치 참조](../cli/init.ko.md#init-codex)
