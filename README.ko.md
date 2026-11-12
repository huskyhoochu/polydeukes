# Polydeukes

**한국어** · [English](./README.md)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/huskyhoochu/polydeukes)

> AI 코딩 파트너와 함께 개발하기 위한 규율(discipline) 프레임워크. 결정론적 약속(covenant) · 검증
> 가능한 작업 기록 · 로컬 기억(memory) 그래프 · 적대적 검증을 얇은 코어 하나 위에 올립니다.

<a id="quick-start"></a>
## 빠른 시작 (Quick start)

[네 설치 경로](./docs/how-to/install.ko.md) 중 하나를 선택합니다. Homebrew 예제입니다.

```sh
brew install huskyhoochu/polydeukes/pdks
brew install huskyhoochu/polydeukes/pdks-claude-code
```

첫 명령은 Rust 판정기, 둘째는 선택 설치 Claude Code 어댑터입니다. Codex는 `pdks-codex`, 프로젝트
기억(memory)은 `pdks-memory`를 각각 설치합니다.

### 1. 에이전트 연결

소유자 터미널에서 프로젝트 루트로 이동해 실행합니다.

```sh
pdks-claude-code init
# Codex 확장을 설치했다면:
# pdks-codex init
```

Claude Code를 다시 열거나 Codex `/hooks`에서 승인한 뒤 실제 호출의 `.polydeukes/roi.log`를
확인합니다. Git diff만 검사한다면 `pdks init`을 실행하세요. 기존 설치에는
[이행 안내](./docs/how-to/migrate-to-rust.ko.md)를 적용합니다.

### 2. 첫 규율 설정하기

생성된 `polydeukes.config.yaml`을 편집기에서 여세요. 생성된 `protectedPaths`와 `witness` 블록은
유지하세요. 아래 `disciplines` 목록을 추가하거나, 이미 목록이 있다면 항목만 덧붙이세요. `src/`에
새로 추가되는 줄에 `TODO`가 있으면 알려 줍니다.

```yaml
disciplines:
  - id: "no-new-todo-lines"
    why: "소스에 줄을 추가하기 전에 TODO를 해결합니다."
    enforce: advise
    declare:
      mechanism: "added-only"
      scope: { source: "target.path", include: ["^src/"] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: "(.*TODO.*)" }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: "(.*TODO.*)" }
        added:
          - { op: "onlyIn", of: "after", notIn: "before" }
      relate:
        - id: "nothing-added"
          relation: { op: "empty", of: "added" }
          message: "이 TODO를 해결하세요: {value}"
```

변경하지 않은 TODO 줄은 허용하며, 기존 줄을 똑같이 반복해도 이미 있는 줄로 취급합니다. `advise`는
위반을 알리고 작업을 계속 진행합니다. 해당 항목으로 세션 호출을 중단하려면 `enforce: block`을
선택하세요. diff 판정에서 차단 항목으로 작업을 중단하려면 명령에도 `--enforce block`이 필요합니다.

설정 파일 자체도 에이전트 세션에서 보호됩니다. 직접 편집하거나, 에이전트에게 의도적인 편집을 맡길
때는
[증인
절차](./docs/how-to/connect-surfaces.ko.md#witness-and-recovery)를
따르세요. Claude Code에서는 설치된 `discipline-draft` 스킬에 문제를 설명하면 규율 항목 작성을
도와줍니다.

### 3. 결과 확인하기

```sh
pdks explain
git diff HEAD | pdks covenant check --diff
```

`explain`은 두 표면 모두에서 `no-new-todo-lines`를 `declare`로 표시해야 합니다. 위반을 확인하려면
`src/` 아래 Git이 추적 중인 파일에 `// TODO: quick-start check` 줄을 새로 추가하고 diff 명령을 다시
실행하세요. 규율 이름이 담긴 진단 메시지, `.polydeukes/roi.log`의 `advised` 행, 종료 코드 0을 확인할
수 있습니다. 추가한 줄을 지우고 다시 실행하면 해당 진단 메시지가 사라져야 합니다.

이어서 [다른 규율 예제](./docs/how-to/write-disciplines.ko.md),
[pre-commit
연결](./docs/how-to/connect-surfaces.ko.md#change-set-surface)을
읽거나, `pdks docs`로 설치된 판본의 문서를 확인하세요.

<a id="status-and-cli"></a>
## 현재 상태와 CLI

Rust 본체와 세 선택 확장, TypeScript·Rust·Python SDK를 제공합니다. 판정은 기본적으로 조언을
기록하며, 작성자가 규율별로 차단을 선택합니다. 설정과 등록 경로의 보호는 별도로 동작합니다.

```sh
pdks init
pdks explain
git diff --cached | pdks covenant check --diff
git diff main...HEAD | pdks covenant check --diff
pdks docs install
pdks docs search 'configuration'
```

기억 확장을 설치하고 문서 모음을 설정한 뒤에는 `pdks memory search <질의>`와
`pdks memory show <ID>`로 근거를 찾습니다.
[사용
예제](./docs/how-to/use-memory.ko.md)를
따라 하세요.

<a id="what-it-is"></a>
## 무엇인가

Polydeukes는 개발자가 스스로 지켜 온 규율을 AI 에이전트(Claude Code 등)와 함께 지키기 위한
프레임워크입니다. 테스트 우선, 커밋 전 검증, 결정 기록, 같은 실수의 반복 방지를
**프롬프트로 부탁하는 대신 결정론적 장치로 확인**합니다.

핵심 관점은 통제가 아니라 파트너십입니다. 약속(covenant)은 AI를 가두는 울타리가 아니라, 사람과
AI에게 똑같이 적용되는 공유된 약속입니다. 이름의 유래와 그 철학은 [`STORY.md`](./STORY.md)에
있습니다.

설계는 실제 운영 중인 모노레포의 AI 개발 장치에서 출발했습니다. 그 장치를 범용 규율 프레임워크로
분리할 수 있는지 분석한 결과가 청사진의 바탕이 되었습니다.

<a id="thin-core-and-packages"></a>
## 실행 파일과 SDK

| Component                | Role                                                |
| ------------------------ | --------------------------------------------------- |
| `pdks`                   | Configuration, judgment, explanation, embedded docs |
| `pdks-claude-code`       | Claude Code 이벤트 번역과 훅 등록                   |
| `pdks-codex`             | Codex 이벤트 번역, 도구 이력, 훅 등록               |
| `pdks-memory`            | 현재 마크다운 조회, 링크와 로컬 사용 이력           |
| `@polydeukes/sdk-ts`     | TypeScript 프로세스 클라이언트                      |
| `polydeukes-sdk` (crate) | Rust 프로세스 클라이언트                            |
| `polydeukes-sdk` (PyPI)  | Python 프로세스 클라이언트                          |

<a id="design-blueprint"></a>
## 설계 원칙

어댑터가 관측 증거를 공급하고 판정기는 선언된 약속과 비교합니다. 증거가 없으면 그 한계를 결과로
드러냅니다. [설계 설명](./docs/why-polydeukes.ko.md)은 관측 경계, 증인, 조언과 차단의 이유를
설명합니다.

<a id="documents"></a>
## 문서

[`docs/README.ko.md`](./docs/README.ko.md)는 문서 색인입니다. 아래 목록과 함께 프레임워크의 동작을
한 페이지로 요약했습니다. 필요한 문서 유형을 골라 읽으면 됩니다.

<a id="tutorials-and-guides"></a>
### 튜토리얼과 가이드

| 문서                                                                           | 내용                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [`docs/tutorials/first-judgment.ko.md`](./docs/tutorials/first-judgment.ko.md) | 첫 눈에 보이는 판정 — 설치하고 Claude Code를 배선한 뒤 보호된 편집이 판정되는 모습 |
| [`docs/how-to/connect-surfaces.ko.md`](./docs/how-to/connect-surfaces.ko.md)   | 세션과 변경 집합 표면 연결, Codex 포함                                             |
| [`docs/how-to/configure-project.ko.md`](./docs/how-to/configure-project.ko.md) | 프로젝트 파일, IDE 지원, advise와 block                                            |
| [`docs/how-to/write-disciplines.ko.md`](./docs/how-to/write-disciplines.ko.md) | 추가된 줄 검사로 시작하는 실전 선언 예제                                           |
| [`docs/troubleshooting.ko.md`](./docs/troubleshooting.ko.md)                   | fail-closed 상태, 증인 밸브, 텔레메트리 로그                                       |

<a id="reference-layer"></a>
### 레퍼런스

| 문서                                                                                                   | 내용                                                            |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [`docs/reference/configuration/index.ko.md`](./docs/reference/configuration/index.ko.md)               | 설정 레퍼런스 — 모든 키와 각 키의 규칙·함정                     |
| [`docs/reference/declaration-language/index.ko.md`](./docs/reference/declaration-language/index.ko.md) | 선언 언어 참조 — 모든 소스, 추출 단계, 관계, 기전의 문법과 제약 |
| [`docs/reference/packages/polydeukes.ko.md`](./docs/reference/packages/polydeukes.ko.md)               | 패키지 레퍼런스 — 서브커맨드와 종료 코드, 패키지 계약           |

<a id="why-and-the-journal"></a>
### 배경과 릴리스

| 문서                                                                    | 내용                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Polydeukes 소개 글](https://funes-days.com/dev/polydeukes-open-source) | 개발자가 funes-days 블로그에 쓴 프로젝트 소개                                               |
| [`STORY.md`](./STORY.md)                                                | 이름의 유래와 설계 철학 (창업자 서사)                                                       |
| [`docs/why-polydeukes.ko.md`](./docs/why-polydeukes.ko.md)              | 왜 폴리데우케스인가? — 설계 백서. 원칙과 그 원칙을 만든 실패담, 그리고 각각을 결론지은 측정 |
| [`CHANGELOG.md`](./CHANGELOG.md)                                        | 마일스톤별 릴리스 노트                                                                      |

<a id="license"></a>
## 라이선스

[MIT](./LICENSE)

<a id="learning-path"></a>
## 가이드 읽는 순서

처음 사용하는 사람은 **설치 → 첫 판정 → 연결·설정 → 규율 작성** 순서로 시작하세요.

| 하고 싶은 일                | 안내                                                      |
| --------------------------- | --------------------------------------------------------- |
| 설치 경로와 확장 선택       | [설치](./docs/how-to/install.ko.md)                       |
| 정상·차단 결과를 직접 보기  | [첫 판정](./docs/tutorials/first-judgment.ko.md)          |
| 에이전트·Git·CI에 연결      | [표면 연결](./docs/how-to/connect-surfaces.ko.md)         |
| 반복되는 실수를 규율로 표현 | [규율 작성](./docs/how-to/write-disciplines.ko.md)        |
| 결정과 근거를 다시 찾기     | [기억 사용](./docs/how-to/use-memory.ko.md)               |
| 프로그램에서 판정 호출      | [SDK와 참조 문서](./docs/README.ko.md#reference-packages) |
| 건너뜀·차단·설치 오류 해결  | [문제 해결](./docs/troubleshooting.ko.md)                 |
| 이전 설치 업그레이드        | [Rust 이행](./docs/how-to/migrate-to-rust.ko.md)          |

전체 학습 경로와 명령별 참조는 [문서 홈](./docs/README.ko.md)에 있습니다.
