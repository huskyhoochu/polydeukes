# Polydeukes가 맞는 경우와 다른 도구가 맞는 경우

[English](./when-to-use-polydeukes.md) · **한국어**

Polydeukes는 설정 파일을 기준으로 변경을 검사하는 명령줄 프로그램(`pdks`)입니다. 지원하는 코딩
에이전트(Claude Code 또는 Codex)에서 파일을 바꾸는 도구나 셸 호출 직전, 또는 커밋 훅이나 CI에서
파이프로 diff를 전달할 때 검사합니다 ([검사가 실행되는 시점](./concepts/judgment.ko.md#terms)).
읽기, 웹, MCP 도구 같은 다른 호출은 검사하지 않습니다
([호스트 기능](./reference/host-support.ko.md#capabilities)). 규율(discipline)은 설정 파일에 항목
하나로 적는 검사입니다 ([YAML 또는 JSON](./how-to/configure-project.ko.md#find-the-config)). 권고를
기록하고 작업을 계속하게 하거나, 작업을 차단할 수 있습니다. 자세한 판정 결과(verdict)와 종료 코드는
[권고와 차단 선택](./how-to/configure-project.ko.md#choose-advise-or-block)과
[diff 명령 계약](./how-to/git-hooks.ko.md#contract)에 있습니다.
[증거](./concepts/judgment.ko.md#declarations)에는 변경 전후의 파일 내용, 설정에서 지정한 다른 파일,
변경한 경로, 명령줄, 세션의 이전 호출, 도구를 호출한 서브에이전트의 신원 등이 포함됩니다. 검사에
필요한 증거와 검사 시점을 기준으로 이 페이지에서 도구를 고르세요.

<a id="what-it-is-not"></a>
## Polydeukes가 맡지 않는 일은 무엇인가요?

- **에이전트를 실행하지 않습니다.** Claude Code나 Codex 같은 호스트가 에이전트를 실행하고
  [훅을 통해 Polydeukes를 호출합니다](./how-to/connect-surfaces.ko.md).
- **샌드박스가 아닙니다.** 호스트 훅과 `pdks` 사이를 잇는 어댑터 프로그램이 `pdks`를 시작합니다.
  어댑터나 `pdks`를 시작하지 못하면 호출이 검사 없이 진행될 수 있습니다. 실행을 제한하려면 호스트의
  샌드박스, 운영 체제 권한 또는 컨테이너를 사용하세요.
  [시작 실패](./troubleshooting.ko.md#judge-cannot-be-loaded)를 참고하세요.
- **린터와 테스트를 대체하지 않습니다.** 그런 검사에는 린터, 정적 분석기, 테스트 실행기를 쓰세요.
  Polydeukes는 구문 트리를 읽지 않습니다. 줄, 정규식, JSON 연산으로 텍스트를 추출합니다.
  [추출 단계 표](./reference/declaration-language/index.ko.md)를 참고하세요.
- **검사 중에 벤치마크나 테스트를 실행하지 않습니다.** 세션의 이전 호출에서 실행했는지 확인할 수
  있습니다 ([이전 호출 보기](#fits)).
- **작성한 설명이 참임을 증명하지 않습니다.** 규율마다 적는 이유 설명(`why` 필드)은 실행하지
  않습니다. 설명의 타당성은 사람이 검토하세요.
  [설정에서 실행하는 부분](./concepts/judgment.ko.md#declarations)을 참고하세요.
- **검증 가능한 작업 장부(ledger)나 적대적 검증은 아직 제공하지 않습니다.**
  [README 소개 문구](../README.ko.md)는 둘을 언급하고, 설계 설명은 출시된 구성 요소가 아닌 로드맵의
  구성 요소로 명시합니다 ([아직 계획인 것](./why-polydeukes.ko.md#what-remains-a-plan)). 장부에서는
  작업자의 보고가 아닌 통과한 검사가 작업 완료를 보여 주며, 적대적 검증에서는 자기 보고 대신
  검사들이 서로의 결과를 검증합니다. 지금은 코드 검토와 CI 기록이 그 역할을 합니다. 판정
  로그(`.polydeukes/roi.log`)는 그 장부가 아닙니다.

<a id="fits"></a>
## Polydeukes는 언제 쓰면 좋을까요?

<a id="fits-approach"></a>
### 검사를 어떻게 관리하고 싶으신가요?

1. **검사 코드를 작성하고 유지하는 대신 설정으로 관리하고 싶습니다.** 규율 하나는 스키마가 있는 설정
   파일의 항목 하나입니다. 명령 금지, 추가된 줄 검사, 이름 규약, 앞선 호출 요구, 호출 순서를 모두
   소스·추출 단계·관계라는 같은 어휘와 정해진 타입으로 적습니다. 로더는 이 구조를 검증하고 맞지 않는
   설정을 거절합니다. [선언 언어](./reference/declaration-language/index.ko.md)를 참고하세요.

2. **글로 적은 지시를 결과가 기록되는 검사로 옮기고 싶습니다.** Claude Code는
   [CLAUDE.md를 강제되는 설정이 아닌 맥락으로 설명합니다](https://code.claude.com/docs/en/memory).
   Polydeukes는 호스트의 훅에서 모델 없이 검사합니다. 같은 설정과 입력에는 같은 결과가 나오고,
   판정마다 로그 한 줄을 남깁니다. 호출을 차단하면 에이전트에게 사유를 돌려주고, 권고일 때는 위반을
   기록하고 호출을 진행시킵니다. [판정 과정](./concepts/judgment.ko.md)을 참고하세요.

3. **동료와 검사를 공유하고 여러 저장소와 에이전트에서 재사용하고 싶습니다.** 규율은 다른 저장소의
   설정 파일에 복사할 수 있는 설정 항목입니다. 경로, 패턴, 강제 수준은 해당 프로젝트에 맞게
   고칩니다. 선언에 필요한 증거가 공급되는 곳에서 같은 선언을 적용할 수 있습니다. 파일 내용을 읽는
   선언은 Claude Code와 Codex 세션에서 호스트의 파일 편집 도구로 하는 편집과 diff 검사에 적용됩니다.
   명령 문자열을 읽는 선언은 세션에서만 적용됩니다.
   [호스트 지원 범위](./reference/host-support.ko.md)를 참고하세요.

4. **작업을 멈추게 하기 전에 검사에서 무엇을 보고하는지 보고 싶습니다.** 강제 수준을 적지 않은
   규율은 위반을 기록하고 호출을 진행시킵니다. `enforce: block`을 적은 항목은 규율을 위반한 호출을
   멈춥니다. diff 검사에서는 차단 항목의 위반으로 종료 코드 2를 반환하려면 `--enforce block`도
   필요합니다. 이 옵션이 없으면 권고를 기록합니다([검사 결과](#check-outcomes)).

<a id="fits-needs"></a>
### 무엇을 막거나 기록해야 하나요?

| 필요                                                | 무엇을 읽는가                    | 예                                                                                                                                                           |
| --------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 작업을 잃을 수 있는 명령을 막는다                   | 명령 문자열                      | [강제 push와 `git reset --hard`](./recipes/work-stays-recoverable.ko.md), [디렉터리 통째 삭제](./recipes/deletes-name-their-target.ko.md)                    |
| 검사 절차를 끄거나 건너뛰지 못하게 한다             | 명령 문자열                      | [커밋 훅 건너뛰기](./recipes/hooks-stay-armed.ko.md)                                                                                                         |
| 한 가지 진입점을 거쳐 호출하게 한다                 | 편집으로 추가된 줄               | [래퍼를 거치지 않은 직접 호출](./how-to/write-disciplines.ko.md#added-line-check), [모듈 경계를 넘는 import](./recipes/internal-modules-stay-internal.ko.md) |
| 정해 둔 낱말과 문구를 지키게 한다                   | 편집으로 추가된 줄               | [금지한 낱말의 새 사용](./recipes/no-new-banned-words.ko.md)                                                                                                 |
| 테스트를 약하게 만드는 변경을 잡는다                | 편집으로 추가된 줄               | [건너뛴 테스트, 스냅샷 단언, 타임아웃 설정 추가](./recipes/tests-are-not-weakened.ko.md)                                                                     |
| 검사 결과를 온전히 읽게 하고 불필요한 반복을 줄인다 | 명령 문자열, 세션의 이전 호출    | [검사 출력을 `head`나 `tail`로 자르기](./recipes/output-is-read-whole.ko.md), [편집 없이 같은 테스트 반복](./recipes/few-test-runs-per-edit.ko.md)           |
| 근거를 읽은 뒤에 편집하게 한다                      | 세션의 이전 호출                 | [버전 조회 뒤 의존성 수정](./recipes/manifest-needs-evidence.ko.md), [설계 문서를 읽은 뒤 소스 편집](./recipes/document-read-before-edit.ko.md)              |
| 역할 분담을 지키게 한다                             | 호출한 서브에이전트              | [구현 담당 서브에이전트의 테스트 수정](./recipes/tests-are-the-writers.ko.md)                                                                                |
| 이름과 위치 규약을 지키게 한다                      | 편집 대상의 경로                 | [파일명 규약](./recipes/file-names-follow-the-convention.ko.md)                                                                                              |
| 기록을 지우지 못하게 한다                           | 파일의 변경 전후 내용            | [변경 이력의 릴리스 제목](./recipes/changelog-keeps-every-release.ko.md)                                                                                     |
| 여러 파일의 내용을 맞춘다                           | 여러 파일, 변경 집합의 경로 목록 | [두 스키마의 enum 값](./recipes/schema-enums-agree.ko.md), [함께 바뀌는 영·한 문서](./recipes/docs-stay-bilingual.ko.md)                                     |

편집으로 추가된 줄, 파일의 변경 전후 내용, 선언에서 지정한 다른 파일, 편집 대상의 경로를 읽는 검사는
에이전트의 파일 편집 도구 호출과 diff 입력에서 실행합니다. 세션에서 셸 명령으로 바꾼 파일은 그
자리에서 내용 검사를 받지 않고, diff 입력 검사가 그 변경을 판정합니다. 변경 집합의 경로 목록을 읽는
검사는 diff 입력에서만 실행합니다. 명령 문자열, 세션의 이전 호출, 호출한 서브에이전트를 읽는 검사는
에이전트 세션에서만 실행합니다. Codex는
[호출 성공 여부](./reference/host-support.ko.md#call-success)와
[호출한 서브에이전트](./reference/host-support.ko.md#actor)를 공급하지 않습니다. 앞서 나온 버전
조회와 편집 전 읽기 레시피는 성공한 이전 호출을 요구하므로 Codex에서 관측 범위에 해당하는 편집을
위반으로 판정합니다. 파일 삭제를 비롯한 다른 차이는
[호스트 지원 표](./reference/host-support.ko.md#capabilities)에 있습니다.
[전체 설정 예제](./recipes/index.ko.md)도 참고하세요.

<a id="fits-elsewhere"></a>
## 다른 도구는 언제 쓰면 좋을까요?

- **구문 패턴을 찾으려면** [Biome](https://biomejs.dev/linter/plugins/#register_diagnostic)이나
  [ast-grep](https://ast-grep.github.io/advanced/tool-comparison.html#ast-grep)을 사용하세요.
- **함수 안이나 여러 파일에 걸친 분석이 필요하면**
  [Semgrep](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro)을 사용하세요. 파일 간
  분석은 Pro에서 제공합니다.
- **경로별로 검토할 사람을 정하려면** 브랜치 보호와
  [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-and-branch-protection)로
  병합 전에 담당자의 검토를 요구하세요.
- **커밋 메시지 형식을 검사하려면**
  [commitlint](https://commitlint.js.org/reference/plugins.html#rule-implementation)로 파싱한 필드를
  검사하세요.
- **에이전트에게 프로젝트 맥락을 알려주려면**
  [CLAUDE.md](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory)나
  [AGENTS.md](https://agents.md/)에 프로젝트 지침을 작성하세요.

<a id="comparison"></a>
## 검사 시점과 입력은 어떻게 다른가요?

| 도구                  | 검사 시점                                                                                                                                                                                                                                          | 읽는 정보                                                                                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biome 플러그인        | [`biome lint` 또는 `biome check`](https://biomejs.dev/linter/plugins/#gritql-plugins) 실행 중. [커밋 전에 스테이징한 파일을 검사할 수 있음](https://biomejs.dev/guides/integrate-in-vcs/#process-only-staged-files)                                | [JavaScript, CSS, JSON](https://biomejs.dev/linter/plugins/#target-languages)의 [구문 노드](https://biomejs.dev/linter/plugins/#register_diagnostic)                                                                                                                             |
| ast-grep              | [린터로 실행 시](https://ast-grep.github.io/guide/introduction.html#introduction)                                                                                                                                                                  | [깊은 의미 정보 없이 코드 구문을 읽음](https://ast-grep.github.io/advanced/tool-comparison.html#ast-grep)                                                                                                                                                                        |
| Semgrep               | 검사 실행 시. 예를 들어 pre-commit diff 검사는 [현재 커밋에 추가하는 변경만 검사함](https://docs.semgrep.dev/kb/integrations/customize-semgrep-precommit#useful-arguments)                                                                         | [Community Edition은 함수 하나 안에서만 분석함(intraprocedural analysis)](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro). [Pro는 파일을 넘나드는 taint 분석을 더함](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro#perform-cross-file-analysis) |
| commitlint            | [`commit-msg` 훅](https://commitlint.js.org/guides/local-setup.html#add-hook) 또는 [CI](https://commitlint.js.org/guides/local-setup.html#test-the-hook)에서 실행 시                                                                               | [커밋 메시지 파일](https://commitlint.js.org/reference/cli.html#cli)을 읽고 검사에 [파싱한 메시지](https://commitlint.js.org/reference/plugins.html#rule-implementation)를 전달함                                                                                                |
| Git 훅                | `pre-commit`은 [메시지를 받기 전, 커밋을 만들기 전에 실행됨](https://git-scm.com/docs/githooks#_pre_commit)                                                                                                                                        | `pre-commit`은 인자를 받지 않음. `commit-msg`는 [메시지 파일 이름](https://git-scm.com/docs/githooks#_commit_msg)을 받음                                                                                                                                                         |
| CODEOWNERS            | [담당 파일의 변경이 담긴 풀 리퀘스트가 열리면 검토를 요청함](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#about-code-owners)                              | [파일 경로 패턴과 담당자](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-syntax)                                                                                               |
| Claude Code 권한과 훅 | `PreToolUse`는 [권한 확인을 요청하기 전에 실행됨](https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks)                                                                                                                       | [도구 호출](https://code.claude.com/docs/en/permissions#manage-permissions)을 검사함. 훅은 추가로 [`transcript_path`, `agent_id`, `agent_type`](https://code.claude.com/docs/en/hooks#common-input-fields)을 받음                                                                |
| CLAUDE.md / AGENTS.md | Claude Code는 [대화를 시작할 때 맥락을 읽음](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory). Codex는 [실행을 시작할 때 지침을 구성함](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance) | 프로젝트 지침인 [CLAUDE.md 맥락](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory)과 [AGENTS.md 마크다운](https://agents.md/)                                                                                                                                     |
| Polydeukes            | [파일을 바꾸는 도구나 셸 호출 직전](./concepts/judgment.ko.md#terms), 또는 [`pdks covenant check --diff`](./how-to/git-hooks.ko.md#contract)에 diff 입력 시                                                                                        | 증거에는 [호스트](./reference/host-support.ko.md#capabilities)가 제공하는 [변경 전후 내용, 설정에서 지정한 다른 파일, 변경한 경로, 명령 텍스트, 세션의 이전 호출, 서브에이전트 신원](./reference/declaration-language/index.ko.md) 등이 포함됨                                   |

<a id="check-outcomes"></a>
### 검사가 위반을 찾으면 어떻게 되나요?

검사 시점과 강제 수준에 따라 결과가 달라집니다.

| 검사 시점                                | `enforce`가 없는 규율            | [`enforce: block`](./how-to/configure-project.ko.md#choose-advise-or-block)인 규율 또는 [`protectedPaths`](./reference/configuration/index.ko.md#protectedpaths) 경로의 변경                                        |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 파일을 바꾸는 도구나 셸 호출 직전        | 권고를 기록하고 호출을 계속함    | 호스트가 호출을 차단함(Claude Code에서는 설정된 증인(witness)으로 차단을 열 수 있음; [차단된 호출 열기](./troubleshooting.ko.md#opening-a-blocked-call)) (`protectedPaths` 경로라면 이를 언급하는 셸 명령도 차단함) |
| diff 입력 (`pdks covenant check --diff`) | 권고로 기록하고 종료 코드 0 반환 | 명령에 `--enforce block`이 있으면 종료 코드 2 반환, 없으면 권고로 기록                                                                                                                                              |

Polydeukes는 저장소 전체가 아닌 관측한 변경을 판정하며, 규율을 파일의 변경 전후를 비교해 일치하는 줄
수가 늘어날 때만 보고하도록 작성하면 파일에 이미 일치하는 줄이 있다는 이유만으로는 보고하지 않습니다
([금지어 예제](./recipes/no-new-banned-words.ko.md)).

권고를 포함한 판정 결과는 기본적으로 `.polydeukes/roi.log`에 기록합니다. diff 입력에서는 설정을
불러오지 못해도 종료 코드 2를, 입력을 읽을 수 없으면 종료 코드 3을 반환하며, 표준 오류 메시지로
차단과 구분합니다([diff 명령 계약](./how-to/git-hooks.ko.md#contract)).

<a id="q-biome"></a>
## Biome 플러그인만으로 충분한가요?

[`biome lint`나 `biome check`](https://biomejs.dev/linter/plugins/#gritql-plugins) 안에서 실행할
JavaScript, CSS, JSON 구문 검사라면 충분합니다. Biome 플러그인은 구문 노드에 진단을 붙입니다.
Polydeukes는 일반 텍스트, 줄, JSON 값을 비교하며
[두 파일의 값](./recipes/schema-enums-agree.ko.md)도 비교할 수 있습니다. 구문 검사에는 Biome을, 두
스키마의 enum 값을 같게 유지하는 비교에는 Polydeukes를 사용하세요. Biome의
[대상 언어](https://biomejs.dev/linter/plugins/#target-languages)와
[구문 노드 진단](https://biomejs.dev/linter/plugins/#register_diagnostic)을 참고하세요.

<a id="q-ast-grep"></a>
## ast-grep 규칙을 작성하는 게 나을까요?

구문 패턴으로 코드를 찾는 린트 규칙이 필요하면 ast-grep 규칙이 맞습니다. 구문 패턴에는 ast-grep을,
[Polydeukes를 쓰면 좋은 경우](#fits)의 텍스트·값·세션 증거 검사에는 Polydeukes를 사용하세요.
ast-grep의 [린터 소개](https://ast-grep.github.io/guide/introduction.html#introduction)와
[분석 범위](https://ast-grep.github.io/advanced/tool-comparison.html#ast-grep)를 참고하세요.

<a id="q-semgrep"></a>
## Semgrep으로도 할 수 있나요?

함수 내부의 코드 분석이나 파일을 넘나드는 taint 분석이라면 Semgrep으로 할 수 있습니다. Community
Edition은 함수 하나 안에서만 분석하고(intraprocedural analysis), Pro는 파일을 넘나드는 taint 분석을
더합니다. 코드 분석에는 Semgrep을 사용하세요.
[편집 전 패키지 레지스트리 조회](./recipes/manifest-needs-evidence.ko.md)처럼 세션의 이전 호출이나
도구를 호출한 서브에이전트가 필요한 검사에는 Polydeukes를 사용하세요. Semgrep의
[Community Edition 범위](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro)와
[Pro 분석](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro#perform-cross-file-analysis)을
참고하세요.

<a id="q-commitlint"></a>
## commitlint에서 검사하면 되나요?

커밋 시점에 검사하려면 커밋 메시지 형식에는 commitlint를, 커밋이 바꾸는 내용에는 Polydeukes를
쓰세요. Polydeukes는 파일 내용이나 영어·한국어 문서처럼
[함께 바뀌어야 하는 경로](./recipes/docs-stay-bilingual.ko.md)를 검사합니다. commitlint의
[검사 입력](https://commitlint.js.org/reference/plugins.html#rule-implementation),
[훅 설정](https://commitlint.js.org/guides/local-setup.html#add-hook),
[CI 안내](https://commitlint.js.org/guides/local-setup.html#test-the-hook)를 참고하세요.

<a id="q-git-hooks"></a>
## git pre-commit 훅 스크립트만으로 충분하지 않나요?

검사 코드를 직접 작성해서 커밋할 때 실행하려면 훅 스크립트로 충분합니다. Polydeukes에서는 비교를
스크립트 대신 설정으로 작성합니다. 같은 설정 파일에
[파일을 바꾸는 도구나 셸 호출 직전에 검사하는](./how-to/connect-surfaces.ko.md) 규율도 담을 수
있습니다. 직접 작성한 검사 코드를 실행하려면 스크립트를, 설정으로 비교를 작성하려면 Polydeukes를
사용하세요. [검사가 위반을 찾으면 어떻게 되나요](#check-outcomes),
[diff 명령 계약](./how-to/git-hooks.ko.md#contract), Git의
[pre-commit 계약](https://git-scm.com/docs/githooks#_pre_commit)을 참고하세요.

<a id="q-codeowners"></a>
## CODEOWNERS로 에이전트의 파일 변경을 막을 수 있나요?

CODEOWNERS는 에이전트의 파일 변경을 막지 않습니다. 풀 리퀘스트가 열리면 담당자에게 검토를 요청하고,
브랜치 보호와 함께 사용하면 병합 전에 담당자의 승인을 요구합니다. Polydeukes는
[에이전트의 편집을 실행 전에 검사](./concepts/judgment.ko.md#terms)할 수 있습니다. 에이전트의 편집
전 검사와 병합 전 담당자 승인이 모두 필요하면 둘을 함께 사용하세요. GitHub의
[검토 요청](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#about-code-owners)과
[필수 담당자 검토](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-and-branch-protection)를
참고하세요.

<a id="q-claude-code-permissions"></a>
## Claude Code의 권한 규칙과 훅도 도구 호출을 검사하지 않나요?

권한 규칙과 `PreToolUse` 훅도 호출 전에 실행됩니다. 차이는 판단 로직이 훅 스크립트의 코드인지, 설정
파일의 규율인지입니다. 훅 작성자는
[`transcript_path`, `agent_id`, `agent_type`](https://code.claude.com/docs/en/hooks#common-input-fields)을
읽는 코드를 작성합니다. Polydeukes를 사용하면 사용자가 검사 내용을
[설정 파일](./reference/declaration-language/index.ko.md)의 규율로 작성합니다. 같은 파일을
[Codex와 diff 입력](./how-to/connect-surfaces.ko.md)에서도 사용합니다. 도구 접근을 정하려면 권한을,
직접 작성한 코드를 실행하려면 사용자 정의 훅을, 설정으로 검사하려면 Polydeukes를 사용하세요.

<a id="q-agent-instructions"></a>
## CLAUDE.md나 AGENTS.md에 검사를 적어 두면 충분하지 않나요?

기록이나 차단이 필요하면 지침 파일과 Polydeukes를 함께 사용하세요. Claude Code 문서는
[CLAUDE.md를 강제되는 설정이 아닌 맥락으로 설명합니다](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory).
[AGENTS.md는 마크다운](https://agents.md/)이며, Codex가
[실행을 시작할 때 읽습니다](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance).
[편집 전 읽기 규율](./recipes/document-read-before-edit.ko.md)은 정해 둔 문서를 읽기 전에 편집하면
기본적으로 권고를 기록하고 `enforce: block`이면 편집을 차단합니다.
[앞서 설명한 Codex의 제약](#fits)이 적용됩니다.

<a id="choosing-order"></a>
## 어떤 순서로 고르면 되나요?

1. 필요한 증거를 정하세요. 파일 내용, 설정에서 지정한 다른 파일, 변경한 경로, 명령 텍스트, 세션의
   이전 호출, 도구를 호출한 서브에이전트, 구문, 커밋 메시지 중 무엇인지 확인하세요.
2. 위 비교표에서 그 증거를 읽는 도구를 찾으세요. Polydeukes는
   [호스트 기능](./reference/host-support.ko.md#capabilities)도 확인하세요.
3. 검사 시점이 충분히 이른지 확인하세요. 파일을 바꾸는 도구나 셸 호출 직전, 커밋 전, 병합 전 중 언제
   필요한가요?
4. 파일을 바꾸는 도구나 셸 호출 직전에 검사하려면
   [Claude Code](./how-to/connect-surfaces.ko.md#claude-code)나
   [Codex](./how-to/connect-surfaces.ko.md#codex) 훅을 연결하세요. 커밋이나 CI에서 검사하려면
   [diff 입력을 전달](./how-to/git-hooks.ko.md#contract)하세요
   ([검사가 위반을 찾으면 어떻게 되나요](#check-outcomes)).

Polydeukes를 사용해 보려면 [첫 실행 따라 하기](./tutorials/first-judgment.ko.md)를 진행하세요.
