# 폴리데우케스 문서

[English](./README.md) · **한국어**

폴리데우케스는 AI 코딩 파트너와 함께 개발하기 위한 규율(discipline) 프레임워크입니다. 아래에서
하려는 작업에 맞는 안내를 선택하세요.

<a id="여기서-시작하십시오"></a>

<a id="start-here"></a>
## 시작

| 하고 싶은 일               | 안내                                              |
| -------------------------- | ------------------------------------------------- |
| 설치 경로와 확장 선택      | [설치](./how-to/install.ko.md)                    |
| 정상·차단 결과를 직접 보기 | [첫 판정](./tutorials/first-judgment.ko.md)       |
| 에이전트·Git·CI에 연결     | [표면 연결](./how-to/connect-surfaces.ko.md)      |
| 프로젝트 설정 작성         | [프로젝트 설정](./how-to/configure-project.ko.md) |

<a id="recipes"></a>
## 레시피

[레시피 목록](./recipes/index.ko.md)에서 지금 하는 작업에 맞는 규율을 고르세요.

<a id="choose-a-tool"></a>
## 도구 고르기

[Polydeukes가 맞는 경우와 다른 도구가 맞는 경우](./when-to-use-polydeukes.ko.md)에서 검사에 맞는
도구를 고르세요.

<a id="help"></a>
## 도움말

| 하고 싶은 일                         | 안내                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| 건너뜀·차단·설치 오류 해결           | [문제 해결](./troubleshooting.ko.md)                 |
| 반복되는 실수를 규율로 표현          | [규율 작성](./how-to/write-disciplines.ko.md)        |
| 직접, CI, 훅에서 변경 집합 판정 실행 | [git 훅](./how-to/git-hooks.ko.md)                   |
| 결정과 근거를 다시 찾기              | [기억 사용](./how-to/use-memory.ko.md)               |
| 이전 설치 업그레이드                 | [Rust 이행](./how-to/migrate-to-rust.ko.md)          |
| 문서 작성과 유지                     | [문서 기여](./contributing.ko.md)                    |
| 프로그램에서 판정 호출               | [SDK와 참조 문서](./README.ko.md#reference-packages) |

<a id="reference"></a>
## 참조

정확한 키와 종료 코드가 필요하면 참조 문서를 사용하세요.

<a id="reference-cli"></a>
### CLI 명령어

| 명령어                                                        | 용도                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| [`pdks covenant check`](./reference/cli/covenant-check.ko.md) | 입력 IR이나 unified diff를 판정하고 결과와 종료 코드 확인 |
| [`pdks init`](./reference/cli/init.ko.md)                     | 프로젝트 설정 생성                                        |
| [`pdks explain`](./reference/cli/explain.ko.md)               | 등록된 규율과 강제 수준 확인                              |
| [`pdks docs`](./reference/cli/docs.ko.md)                     | 설치된 문서 검색과 조회                                   |
| [`pdks memory`](./reference/cli/memory.ko.md)                 | 현재 마크다운 문서를 검색하고 원문 조회                   |

<a id="reference-configuration"></a>
### 설정

[설정 참조](./reference/configuration/index.ko.md)에서 `polydeukes.config.yaml`의 키와 강제 수준,
규율 목록, 증인 설정을 확인합니다.

<a id="reference-declaration-language"></a>
### 선언 언어

[선언 언어 참조](./reference/declaration-language/index.ko.md)에서 소스, 추출 단계, 조합 연산, 관계,
기전의 전체 문법과 제약을 확인합니다.

<a id="reference-packages"></a>
### 패키지

| 패키지                                                               | 담당 기능                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`polydeukes` (`pdks` CLI)](./reference/packages/polydeukes.ko.md)   | 패키지 계약과 그 안에 있는 판정기. 서브커맨드는 [`reference/cli/`](./reference/cli/covenant-check.ko.md) |
| [입력 IR / 스키마](./reference/packages/core.ko.md)                  | 프로토콜, 입력 IR, 설정 스키마, 텔레메트리                                                               |
| [`pdks-claude-code`](./reference/packages/adapter-claude-code.ko.md) | Claude Code 세션 표면입니다. 훅 페이로드에서 입력 IR로                                                   |
| [`pdks-codex`](./reference/packages/adapter-codex.ko.md)             | Codex 세션 표면입니다. 훅 페이로드에서 입력 IR로, 패치가 건드리는 파일마다 원소 하나                     |
| [`@polydeukes/sdk-ts`](./reference/packages/sdk-ts.ko.md)            | TypeScript에서 판정기를 호출하고 결과를 처리하는 방법                                                    |
| [`pdks-memory`](./reference/packages/memory.ko.md)                   | 현재 마크다운에서 답을 계산하는 선택 확장입니다                                                          |

[호스트 지원](./reference/host-support.ko.md)

[Rust SDK](./reference/packages/sdk-rust.ko.md) ·
[Python
SDK](./reference/packages/sdk-python.ko.md)

<a id="further-reading"></a>
## 더 읽을거리

[판정 모델과 관측 한계](./concepts/judgment.ko.md)에서 규율이 확인할 수 있는 범위를 읽고,
[설계 설명](./why-polydeukes.ko.md)에서 프로젝트의 설계 근거를 읽으세요.

<a id="the-shape-of-the-thing-in-one-page"></a>

<a id="shape-of-the-thing"></a>
### 한 페이지로 보는 구조

폴리데우케스는 개발자나 AI 에이전트가 하려는 일을 판정하고 결과를 기록합니다. 기본값으로는 작업을
차단하지 않습니다. 설계의 바탕은 다음 세 가지입니다.

**약속(covenant)은 합의한 개발 관행을 검사합니다.** 같은 규율을 사람과 AI의 작업에 적용하며, 이
프로젝트의 작성자도 일상적인 개발에서 사용합니다.

**판정과 차단은 별도로 정합니다.** 선언된 규율은 적용 범위에 해당하는 호출을 판정합니다.
기본값으로는 위반 사유를 기록하고 호출을 계속합니다. 위반을 차단하려면 항목에 `enforce: block`을
설정합니다. 프레임워크 자체의 보호 기능은 세션 호출을 기본으로 차단합니다.

**판정 결과를 기록합니다.** `.polydeukes/roi.log`에 판정 결과와 관련 정보가 쌓입니다. 이 로그로
위반, 건너뛴 검사, 예상과 다른 결과를 조사할 수 있습니다. [설계 설명](./why-polydeukes.ko.md)에서는
기록을 바탕으로 프로젝트를 개선한 과정을 다룹니다.
[Polydeukes가 맞는 경우와 다른 도구가 맞는 경우](./when-to-use-polydeukes.ko.md)에서 검사에 맞는
도구를 고를 수 있습니다.

<a id="two-surfaces"></a>
### 두 표면

| 표면     | 판정 대상                                                 | 배선 방법                                                                     | 대상                               |
| -------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| **세션** | 도구 호출, 실행되기 전에                                  | `pdks-claude-code init` 또는 `pdks-codex init`                                | AI 파트너와 함께 개발하는 프로젝트 |
| **커밋** | stdin의 unified diff — 스테이징 영역, 작업 트리, ref 범위 | `git diff --cached`를 파이프로 넘기는 pre-commit 훅, 또는 필요할 때 직접 실행 | 혼자 개발하는 사람, 그리고 CI      |

커밋 판정기는 필요할 때 직접 실행할 수도 있습니다. 작업 후에는
`git diff HEAD | pdks covenant check --diff`, PR 전에는 `git diff main...HEAD | …`를 사용합니다.
같은 판정 기준을 종료 코드로 답하며 묻지 않습니다. 관문은 그 코드를 소비하는 쪽입니다.
