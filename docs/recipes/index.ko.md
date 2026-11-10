# 지금 하는 작업에 맞는 규율 복사하기

[English](./index.md) · **한국어**

레시피를 고르고 필요한 조건을 확인한 뒤 설정을 복사하세요. 각 레시피에는 직접 실행할 수 있는 작은
정상 예제와 위반 예제가 있습니다.

<a id="keep-work-recoverable"></a>
## 작업을 복구할 수 있게 두기

- [에이전트가 복구할 수 없는 작업을 지우지 못하게 하기](./work-stays-recoverable.ko.md) 필요한 조건:
  Claude Code 또는 Codex 세션. 표면: 세션(Claude Code, Codex). 기본 강제 수준: 차단. 수정할 값:
  없음.
- [에이전트가 rm으로 디렉터리 전체를 지우지 못하게 하기](./deletes-name-their-target.ko.md) 필요한
  조건: Claude Code 또는 Codex 세션. 표면: 세션(Claude Code, Codex). 기본 강제 수준: 차단. 수정할
  값: 없음.

<a id="run-checks-and-read-output"></a>
## 검사를 실행하고 결과 읽기

- [에이전트가 Git 커밋 훅을 건너뛰지 못하게 하기](./hooks-stay-armed.ko.md) 필요한 조건: 저장소의
  커밋 훅. 표면: 세션(Claude Code, Codex). 기본 강제 수준: 차단. 수정할 값: 없음.
- [head나 tail로 잘린 테스트·검색 출력 감지하기](./output-is-read-whole.ko.md) 필요한 조건: Claude
  Code 또는 Codex 세션. 표면: 세션(Claude Code, Codex). 기본 강제 수준: 권고. 수정할 값: 사용 도구에
  맞는 검사·검색 명령 목록.

<a id="change-dependencies"></a>
## 의존성 바꾸기

- [pnpm 밖에서 한 의존성 변경 감지하기](./pnpm-only.ko.md) 필요한 조건: pnpm을 사용하는 프로젝트.
  표면: 세션(Claude Code, Codex). 기본 강제 수준: 권고. 수정할 값: 없음.
