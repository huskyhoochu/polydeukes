# `pdks-codex`

[English](./adapter-codex.md) · **한국어**

<a id="ownership"></a>
## 역할

호스트 이벤트를 입력 IR로 바꾸고 별도 `pdks covenant check --enforce block` 프로세스에 전달하는 Rust
실행 파일입니다. 소비자 계약은 `init`과 `hook` 명령입니다.

<a id="apply-patch"></a>
## 관측 증거

`apply_patch`를 파일별 IR로 나누고 셸 호출을 번역합니다. PostToolUse의 도구 이력은 세션별로
`.polydeukes/codex-sessions/`에 저장하고 SessionEnd에서 지웁니다. 프롬프트는 사람 증거가 아니며 증인
밸브를 열 수 없습니다.

<a id="consumer"></a>
## 연결

```sh
pdks-codex init
```

판정기와 어댑터를 먼저 설치하고 프로젝트 루트에서 실행합니다. 경로 변경 뒤에는 다시 등록합니다.
[설치](../../how-to/install.ko.md) ·
[등록
계약](../cli/init.ko.md)
· [이행](../../how-to/migrate-to-rust.ko.md)

<a id="code-mode-coverage"></a>
## 호스트 연결 확인

Codex `/hooks`에서 신뢰를 승인하고 실제 파일·셸 호출의 텔레메트리를 확인합니다. Active 표시는 호출
전달의 증거가 아닙니다.

<a id="limits"></a>
## 한계와 복구

호스트가 전달하는 호출을 판정하며 자식 프로세스의 모든 쓰기를 따로 관측하지 않습니다. 어댑터나
판정기가 시작되지 않으면 호출이 진행할 수 있으므로 실행 경로와 실제 로그를 확인합니다. 사람 증거가
없는 세션의 보호 편집은 터미널에서 합니다.
