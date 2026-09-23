# 폴리데우케스 문서

[English](./README.md) · **한국어**

폴리데우케스는 AI 코딩 파트너와 함께 개발하기 위한 규율(discipline) 프레임워크입니다.
아래에서 하려는 작업에 맞는 안내를 선택하세요.

<a id="여기서-시작하십시오"></a>
<a id="start-here"></a>
## 시작하기

| 하려는 것 | 읽을 문서 |
|---|---|
| 첫 판정을 확인하고 싶다 | [첫 판정](./tutorials/first-judgment.ko.md) — 설치와 Claude Code 연동을 마치고 보호 파일 편집에 대한 판정을 확인합니다 |
| Claude Code, Grok, Codex, git을 연결하고 싶다 | [표면 연결하기](./how-to/connect-surfaces.ko.md) — 세션과 커밋 연동 설정, Grok와 Codex 포함 |
| 프로젝트 설정을 다듬고 싶다 | [프로젝트 설정하기](./how-to/configure-project.ko.md) — 설정 파일 찾기, IDE 지원, advise와 block 선택 |
| 실제 규율을 쓰고 싶다 | [규율 작성하기](./how-to/write-disciplines.ko.md) — 번역 키 짝 맞춤을 포함한 선언 예제 |
| 차단이나 건너뜀에서 회복하고 싶다 | [문제 해결](./troubleshooting.ko.md) — fail-closed 상태, 증인 밸브, 로그 |
| 이 프레임워크가 왜 있는지 알고 싶다 | [왜 폴리데우케스인가?](./why-polydeukes.ko.md) — 설계 백서 |
| 이 문서에 기여하고 싶다 | [문서에 기여하기](./contributing.ko.md) — 영한 쌍, 안정 ID, 카탈로그, 검사 |

<a id="reference"></a>
## 레퍼런스

설정 키, 선언 문법, CLI 명령, 패키지 계약을 조회합니다.

| 문서 | 답하는 것 |
|---|---|
| [설정 레퍼런스](./reference/configuration/index.ko.md) | `polydeukes.config.yaml`에 무엇을 넣을 수 있고 각 키가 무엇을 하는지 |
| [선언 언어 참조](./reference/declaration-language/index.ko.md) | 소스, 추출 단계, 조합 연산, 관계, 기전의 전체 문법과 제약 |
| [`polydeukes` (`pdks` CLI)](./reference/packages/polydeukes.ko.md) | 패키지 계약과 그 안에 있는 판정기. 서브커맨드는 [`reference/cli/`](./reference/cli/covenant-check.ko.md) |
| [`@polydeukes/core`](./reference/packages/core.ko.md) | 프로토콜, 입력 IR, 설정 스키마, 텔레메트리 |
| [`@polydeukes/adapter-claude-code`](./reference/packages/adapter-claude-code.ko.md) | Claude Code 세션 표면입니다. 훅 페이로드에서 입력 IR로 |
| [`@polydeukes/adapter-grok`](./reference/packages/adapter-grok.ko.md) | Grok 세션 표면입니다. 훅 페이로드에서 입력 IR로 |
| [`@polydeukes/adapter-codex`](./reference/packages/adapter-codex.ko.md) | Codex 세션 표면입니다. 훅 페이로드에서 입력 IR로, 패치가 건드리는 파일마다 원소 하나 |
| [`@polydeukes/sdk-ts`](./reference/packages/sdk-ts.ko.md) | TypeScript에서 판정기를 호출하고 결과를 처리하는 방법 |

<a id="shape-of-the-thing"></a>
## 한 페이지로 보는 구조

폴리데우케스는 개발자나 AI 에이전트가 하려는 일을 판정하고 결과를 기록합니다.
기본값으로는 작업을 차단하지 않습니다. 설계의 바탕은 다음 세 가지입니다.

**약속(covenant)은 합의한 개발 관행을 검사합니다.** 같은 규율을 사람과 AI의 작업에
적용하며, 이 프로젝트의 작성자도 일상적인 개발에서 사용합니다.

**판정과 차단은 별도로 정합니다.** 선언된 규율은 적용 범위에 해당하는 호출을 판정합니다.
기본값으로는 위반 사유를 기록하고 호출을 계속합니다. 위반을 차단하려면 항목에
`enforce: block`을 설정합니다. 프레임워크 자체의 보호 기능은 세션 호출을 기본으로 차단합니다.

**판정 결과를 기록합니다.** `.polydeukes/roi.log`에 판정 결과와 관련 정보가 쌓입니다.
이 로그로 위반, 건너뛴 검사, 예상과 다른 결과를 조사할 수 있습니다.
[설계 설명](./why-polydeukes.ko.md)에서는 기록을 바탕으로 프로젝트를 개선한 과정을 다룹니다.

<a id="two-surfaces"></a>
## 두 표면

| 표면 | 판정 대상 | 배선 방법 | 대상 |
|---|---|---|---|
| **세션** | 도구 호출, 실행되기 전에 | `pdks-claude-code init`, `pdks-grok init`, 또는 `pdks-codex init` | AI 파트너와 함께 개발하는 프로젝트 |
| **커밋** | stdin의 unified diff — 스테이징 영역, 작업 트리, ref 범위 | `git diff --cached`를 파이프로 넘기는 pre-commit 훅, 또는 필요할 때 직접 실행 | 혼자 개발하는 사람, 그리고 CI |

커밋 판정기는 필요할 때 직접 실행할 수도 있습니다. 작업 후에는 `git diff HEAD | pdks covenant check --diff`,
PR 전에는 `git diff main...HEAD | …`를 사용합니다. 같은 판정 기준을 종료 코드로 답하며 묻지
않습니다. 관문은 그 코드를 소비하는 쪽입니다.
