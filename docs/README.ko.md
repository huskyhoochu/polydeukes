# 폴리데우케스 문서

[English](./README.md) · **한국어**

> AI 코딩 파트너와 함께 개발하기 위한 규율 프레임워크입니다. 궁금한 곳부터 읽으십시오.

<a id="start-here"></a>
## 여기서 시작하십시오

| 하려는 것 | 읽을 문서 |
|---|---|
| 첫 눈에 보이는 판정을 보고 싶다 | [첫 판정](./tutorials/first-judgment.ko.md) — 설치하고 Claude Code를 배선한 뒤 보호된 편집이 판정되는 모습을 봅니다 |
| Claude Code, Grok, git을 연결하고 싶다 | [표면 연결하기](./how-to/connect-surfaces.ko.md) — 세션과 커밋 배선, Grok 포함 |
| 프로젝트 설정을 다듬고 싶다 | [프로젝트 설정하기](./how-to/configure-project.ko.md) — 발견, IDE 지원, advise와 block의 선택 |
| 실제 규율을 쓰고 싶다 | [규율 작성하기](./how-to/write-disciplines.ko.md) — 실전 선언 예제, 특히 locale key pairing |
| 차단이나 건너뜀에서 회복하고 싶다 | [문제 해결](./troubleshooting.ko.md) — fail-closed 상태, 증인 밸브, 로그 |
| 이 프레임워크가 왜 있는지 알고 싶다 | [왜 폴리데우케스인가?](./why-polydeukes.ko.md) — 설계 백서 |
| 이 문서에 기여하고 싶다 | [문서에 기여하기](./contributing.ko.md) — 영한 쌍, 안정 ID, 카탈로그, 검사 |

<a id="reference"></a>
## 레퍼런스

설정 키, 하위 명령, 종료 코드를 설명합니다. 계획이 아니라 현재 동작을 기준으로 서술합니다.

| 문서 | 답하는 것 |
|---|---|
| [설정 레퍼런스](./reference/configuration/index.ko.md) | `polydeukes.config.yaml`에 무엇을 넣을 수 있고 각 키가 무엇을 하는지 |
| [`polydeukes` (`pdks` CLI)](./reference/packages/polydeukes.ko.md) | 패키지 계약. 서브커맨드는 [`reference/cli/`](./reference/cli/covenant-check.ko.md) |
| [`@polydeukes/core`](./reference/packages/core.ko.md) | 프로토콜, 입력 IR, 설정 스키마, 텔레메트리 |
| [`@polydeukes/covenant`](./reference/packages/covenant.ko.md) | 판정기입니다. 디스패처와 규율 라이브러리, 메타 약속, 밸브 |
| [`@polydeukes/adapter-claude-code`](./reference/packages/adapter-claude-code.ko.md) | 세션 표면입니다. 훅 페이로드에서 입력 IR로 |
| [`@polydeukes/adapter-git`](./reference/packages/adapter-git.ko.md) | 커밋 표면입니다. 스테이징·작업 트리·범위 diff에서 입력 IR로 |

<a id="shape-of-the-thing"></a>
## 한 페이지로 보는 구조

폴리데우케스는 개발자나 AI 에이전트가 하려는 일을 판정하고 결과를 기록합니다.
기본값으로는 작업을 차단하지 않습니다. 설계의 바탕은 다음 세 가지입니다.

**약속은 가두기 위한 울타리가 아닙니다.** 여기서 확인하는 규율은 개발자가 이미 스스로 지켜 온 것들입니다. AI에게만큼 사람에게도 똑같이 적용되고, 프레임워크를 만든
사람도 매일 그 판정을 받습니다.

**판정과 차단은 별개의 결정입니다.** 선언된 규율은 적용 범위에 해당하는 호출마다 판정합니다.
위반했을 때 호출을 차단할지는 별도로 정합니다. 기본값으로는 사유를 기록하고 호출을 계속합니다.
작성자는 `enforce: block`으로 차단을 선택할 수 있습니다. 별도 선택 없이 차단하는 것은
프레임워크 자체를 보호하는 경우뿐입니다.

**모든 판정은 행 하나를 남깁니다.** `.polydeukes/roi.log`가 판정 결과마다 한 줄씩, 낱말 여섯 개짜리 어휘로 담습니다. 이 프로젝트가 자기 결함을 찾는
방법이 그 기록입니다. 백서에 적힌 결함들도 전부 코드를 읽어서가 아니라 행을 세어서 나왔습니다.

<a id="two-surfaces"></a>
## 두 표면

| 표면 | 판정 대상 | 배선 방법 | 대상 |
|---|---|---|---|
| **세션** | 도구 호출, 실행되기 전에 | `pdks init claude-code` 또는 `pdks init grok` | AI 파트너와 함께 개발하는 프로젝트 |
| **커밋** | diff — 스테이징 영역, 작업 트리, ref 범위 | pre-commit 훅, 또는 필요할 때 직접 실행 | 혼자 개발하는 사람, 그리고 CI |

커밋 판정기는 필요할 때 직접 실행할 수도 있습니다. 작업 후에는 `pdks covenant check --worktree`,
PR 전에는 `--range`를 사용합니다. 같은 판정 기준으로 결과를 보고하며 증인 입력은 요청하지 않습니다.
