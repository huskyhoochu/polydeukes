# `pdks init`

[English](./init.md) · **한국어**

프로젝트 루트에서 설정을 만들고, 설치한 어댑터로 호스트를 연결합니다. 각 init은 현재 디렉터리에
설치합니다.

<a id="init-syntax"></a>
## 문법

```sh
pdks init
pdks-claude-code init
pdks-codex init
```

어댑터는 선택 설치입니다. [설치 안내](../../how-to/install.ko.md)를 참고하세요.

<a id="init-common"></a>
## 프로젝트 설정

생성하는 것은 `polydeukes.config.yaml`과 `.gitignore`의 `.polydeukes/` 항목입니다. 기존 설정은
유지합니다. 설정 후보가 여러 개면 거부합니다. 생성 설정에는 증인 설정과 빈 규율 목록이 있습니다.
실제 보호 대상은 어댑터 init이 추가하며, 로더는 읽은 설정 파일을 자동으로 보호합니다.

<a id="init-claude-code"></a>
## claude-code

```sh
pdks-claude-code init
```

`pdks init`을 실행하고 `PreToolUse`를 등록합니다. 보호 경로는
`.claude/settings.json, .claude/settings.local.json`입니다. 등록에는 프로젝트 루트, 어댑터, PATH에서
찾은 판정기의 절대 경로가 들어갑니다. 다른 도구의 핸들러와 사용자 설정을 유지합니다.

`.claude/rules/polydeukes.md`와 `discipline-draft` 스킬을 없을 때 만듭니다. Claude Code를 다시 열어
실제 호출의 새 텔레메트리 행을 확인합니다.

<a id="init-codex"></a>
## codex

```sh
pdks-codex init
```

`pdks init`을 실행하고 `PreToolUse, PostToolUse, SessionEnd`를 등록합니다. 보호 경로는
`.codex/hooks.json, .codex/config.toml`입니다. 등록에는 프로젝트 루트, 어댑터, PATH에서 찾은
판정기의 절대 경로가 들어갑니다. 다른 도구의 핸들러와 사용자 설정을 유지합니다.

Codex `/hooks`에서 정의를 승인합니다. PostToolUse가 도구 이력을 저장하고 SessionEnd가 정리합니다.
사람 메시지 증거는 없으므로 보호 편집은 소유자 터미널에서 합니다.

<a id="init-results"></a>
## 결과와 경로 변경

성공은 exit 0, 인자·설정·쓰기 오류는 exit 2입니다. 프로젝트나 실행 파일을 옮기면 init을 다시
실행하고 호스트 신뢰를 확인합니다. 등록에는 `onFailure`나 `|| exit 2`가 없습니다. 어댑터가 시작되지
않으면 호스트가 조용히 호출을 진행할 수 있습니다. 어댑터가 판정기를 시작하지 못하면 설치 안내를
출력하고 호출을 진행합니다. 실제 판정 여부는 로그로 확인하세요.

옛 TypeScript 핸들러와 `.mjs` 파일은 자동 삭제되지 않습니다.
[이행 절차](../../how-to/migrate-to-rust.ko.md#hooks)를 따르세요. 쓰기 실패 뒤에는 일부 파일이 남을
수 있으므로 오류를 고치고 다시 실행합니다.

<a id="init-examples"></a>
## 직접 검사

```sh
pdks-claude-code hook --project-root /absolute/project --pdks /absolute/bin/pdks < event.json
```

두 경로는 절대 경로이며 플래그 순서를 유지합니다. 이 명령은 도구를 실행하지 않고 이벤트를
판정합니다.
[첫
판정](../../tutorials/first-judgment.ko.md)에서
완전한 예제를 실행하세요.

<a id="init-see-also"></a>
## 관련 문서

[Connection guide](../../how-to/connect-surfaces.ko.md)
