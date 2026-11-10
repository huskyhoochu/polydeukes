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

<a id="keep-files-consistent"></a>
## 파일 사이의 일치 지키기

- [기존 표현을 모두 고치지 않고 금지 낱말의 새 사용 감지하기](./no-new-banned-words.ko.md) 필요한
  조건: 소스와 테스트에서 피할 낱말 목록. 표면: 세션 표면과 변경 집합 표면. 기본 강제 수준: 권고.
  수정할 값: 소스 경로와 낱말 목록.
- [변경 이력의 릴리스 제목을 모두 유지하기](./changelog-keeps-every-release.ko.md) 필요한 조건:
  `## 1.2.3` 또는 `## [1.2.3]` 형식의 릴리스 제목을 쓰는 CHANGELOG.md. 표면: 세션 표면과 변경 집합
  표면. 기본 강제 수준: 권고. 수정할 값: 형식이 다르면 변경 이력 경로와 두 제목 패턴.
- [두 JSON 스키마의 enum 값을 같게 유지하기](./schema-enums-agree.ko.md) 필요한 조건: 선택한 enum
  배열이 같은 값을 담아야 하는 유효한 JSON 스키마 두 개. 표면: 세션 표면과 변경 집합 표면. 기본 강제
  수준: 권고. 수정할 값: 두 파일 경로, 범위 패턴, 두 선택자.
- [영어 문서와 한국어 문서가 함께 바뀌는지 확인하기](./docs-stay-bilingual.ko.md) 필요한 조건:
  쌍으로 관리하는 영어와 한국어 Markdown 문서. 표면: 변경 집합 표면 전용. 기본 강제 수준: 권고.
  수정할 값: 폴더와 언어 접미사.
