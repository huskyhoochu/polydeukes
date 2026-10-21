# `pdks init`와 어댑터 연결

[English](./init.md) · **한국어**

설치한 단일 `pdks`로 프로젝트 설정과 세 호스트 연결을 관리합니다. 별도 Node·npm·프로젝트 패키지 설치가 필요하지 않습니다. 모든 초기화 명령은 현재 디렉터리에
설치합니다.

<a id="init-syntax"></a>
## 문법

```sh
pdks init
pdks adapter claude-code init
pdks adapter codex init
pdks adapter grok init
```

<a id="init-common"></a>
## `pdks init` — 초기 파일

`polydeukes.config.yaml`을 만들고 `.gitignore`에 `.polydeukes/`를 추가합니다. 기존 설정은 보존합니다.
`.yaml`·`.yml`·`.json` 설정 파일이 둘 이상 있으면 거부합니다. 초기 설정에는 보호 경로·증인(witness)·규율(discipline) 예제가 있습니다.

<a id="init-claude-code"></a>
## Claude Code — `pdks adapter claude-code init`

공통 초기 파일을 준비하고 `.claude/settings.json`에 현재 실행 파일·프로젝트 루트의 절대 경로를 등록합니다.
`PreToolUse`·`UserPromptSubmit`·`PostToolUse`·`SessionEnd`를 병합하며 다른 handler와 사용자 키는 보존합니다.

문서 안내 `.claude/rules/polydeukes.md`와 `discipline-draft` 스킬도 없을 때 생성합니다. Claude Code에서 프로젝트를 다시 여세요.

<a id="init-grok"></a>
## Grok — `pdks adapter grok init`

공통 초기 파일을 준비하고 `.grok/hooks/covenant-pretooluse.json`에 현재 실행 파일·프로젝트 루트의 절대 경로를 등록합니다.
`PreToolUse`·`UserPromptSubmit`·`PostToolUse`·`SessionEnd`를 병합하며 다른 handler와 사용자 키는 보존합니다.

Grok에서 프로젝트 신뢰를 승인하고 Hooks 탭을 다시 불러오세요. Claude 호환 등록은 Grok 환경에서 건너뛰므로 Grok 자체 등록이 필요합니다. 현재 Grok 증거로
증인 밸브를 열 수 없으므로 보호 변경은 자신의 터미널에서 수행하세요.

<a id="init-codex"></a>
## Codex — `pdks adapter codex init`

공통 초기 파일을 준비하고 `.codex/hooks.json`에 현재 실행 파일·프로젝트 루트의 절대 경로를 등록합니다.
`PreToolUse`·`UserPromptSubmit`·`PostToolUse`·`SessionEnd`를 병합하며 다른 handler와 사용자 키는 보존합니다.

Codex `/hooks`에서 정의를 승인하세요. 신뢰는 정의의 hash에 연결됩니다. 현재 prompt는 사람 출처를 증명하지 않아 증인 밸브를 열지 않습니다. 보호 변경은
자신의 터미널에서 수행하세요.

<a id="init-results"></a>
## 결과와 이전

성공은 exit 0, 잘못된 인자·설정 JSON·모호한 설정·쓰기 실패는 exit 2입니다. 출력은 `created`·`updated`·`unchanged`·`preserved`와
필수 보호 경로를 구분합니다. 기존 설정의 `protectedPaths`에 출력 경로가 포함되는지 확인하세요. PreToolUse는 60초, prompt/post는 30초, 종료는
5초로 등록합니다.

구형 `pdks-claude-code`·`pdks-codex`·`pdks-grok` 대신 위 명령을 사용하세요. 설치기는 자체 구형 handler를 교체하고 원본과 일치하는 생성
`.mjs`만 제거합니다. 수정한 위임자는 보존합니다. 실행 파일이나 프로젝트를 옮기면 재설치하고 호스트 신뢰를 확인하세요. 전역 설정은 변경하지 않습니다.

쓰기 실패는 일부 산출물을 남길 수 있습니다. 오류를 고치고 재실행하세요.

<a id="init-examples"></a>
## 훅 직접 확인

```sh
pdks adapter claude-code hook --project-root /absolute/project < event.json
```

이 명령은 완전한 호스트 이벤트를 판정하며 도구 자체는 실행하지 않습니다. 실제 호스트가 등록을 불러왔는지는 별도로 확인해야 합니다.

<a id="init-see-also"></a>
## 관련 문서

- [표면 연결](../../how-to/connect-surfaces.ko.md)
