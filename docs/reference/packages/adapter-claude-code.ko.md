# `pdks-claude-code`

[English](./adapter-claude-code.md) · **한국어**

<a id="ownership"></a>
## 역할

호스트 이벤트를 입력 IR로 바꾸고 별도 `pdks covenant check --enforce block` 프로세스에 전달하는 Rust
실행 파일입니다. 소비자 계약은 `init`과 `hook` 명령입니다.

<a id="translation"></a>
## 관측 증거

파일 도구는 디스크의 변경 전 내용과 계산한 변경 후 내용을 제공합니다. 셸은 명령줄을 제공합니다.
Claude 대화 기록의 `origin.kind: human`인 메시지만 사람 증거입니다. SDK가 만든 user 메시지는 사람의
발화와 같지 않습니다.

<a id="consumer-contract"></a>
## 연결

```sh
pdks-claude-code init
```

판정기와 어댑터를 먼저 설치하고 프로젝트 루트에서 실행합니다. 경로 변경 뒤에는 다시 등록합니다.
[설치](../../how-to/install.ko.md) ·
[등록
계약](../cli/init.ko.md)
· [이행](../../how-to/migrate-to-rust.ko.md)

<a id="limits"></a>
## 한계와 복구

호스트가 전달하는 호출을 판정하며 자식 프로세스의 모든 쓰기를 따로 관측하지 않습니다. 어댑터나
판정기가 시작되지 않으면 호출이 진행할 수 있으므로 실행 경로와 실제 로그를 확인합니다. 사람 증거가
없는 세션의 보호 편집은 터미널에서 합니다.
