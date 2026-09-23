# Polydeukes

**한국어** · [English](./README.md)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/huskyhoochu/polydeukes)

> AI 코딩 파트너와 함께 개발하기 위한 규율(discipline) 프레임워크.
> 결정론적 약속(covenant) · 검증 가능한 작업 기록 · 로컬 기억(memory) 그래프 · 적대적 검증을 얇은 코어 하나 위에 올립니다.

<a id="quick-start"></a>
## 빠른 시작 (Quick start)

**Node.js 24 이상**, pnpm, `package.json`이 있는 Git 프로젝트가 필요합니다.
아래 명령은 프로젝트 루트에서 직접 터미널로 실행하세요.

### 1. 설치하고 에이전트 연결하기

공통 패키지를 설치한 뒤, 사용하는 AI 코딩 파트너의 행을 골라 실행하세요.

```sh
pnpm add -D polydeukes @polydeukes/core
```

| 에이전트 | 어댑터 설치 | 초기화 |
|---|---|---|
| Claude Code | `pnpm add -D @polydeukes/adapter-claude-code` | `pnpm exec pdks-claude-code init` |
| Codex | `pnpm add -D @polydeukes/adapter-codex` | `pnpm exec pdks-codex init` |
| Grok | `pnpm add -D @polydeukes/adapter-grok` | `pnpm exec pdks-grok init` |

각 어댑터의 `init`은 `polydeukes.config.yaml`을 만들고, `.gitignore`에 `.polydeukes/`를
추가하며, 세션 훅을 등록합니다. Claude Code는 다시 열고, Codex는 `/hooks`에서 생성된 훅을
승인하고, Grok는 Hooks 탭을 새로 고치세요. Git diff만 판정하려면 공통 패키지를 설치한 뒤
`pnpm exec pdks init`을 실행하세요.

### 2. 첫 규율 설정하기

생성된 `polydeukes.config.yaml`을 편집기에서 여세요. `languages`의 임시 항목을 프로젝트의
소스 경로와 테스트 명령으로 바꿉니다. 예를 들면 다음과 같습니다.

```yaml
languages:
  typescript:
    productionGlob: 'src/**'
    testCmd: 'pnpm test'
```

생성된 `protectedPaths`와 `witness` 블록은 유지하세요. 아래 `disciplines` 목록을 추가하거나,
이미 목록이 있다면 항목만 덧붙이세요. `src/`에 새로 추가되는 줄에 `TODO`가 있으면 알려 줍니다.

```yaml
disciplines:
  - id: 'no-new-todo-lines'
    why: '소스에 줄을 추가하기 전에 TODO를 해결합니다.'
    enforce: advise
    declare:
      mechanism: 'added-only'
      scope: { source: 'target.path', include: ['^src/'] }
      supply: { pre: 'empty', post: 'empty' }
      extract:
        before:
          - { op: 'source', of: 'pre' }
          - { op: 'lines' }
          - { op: 'keyByPattern', re: '(.*TODO.*)' }
        after:
          - { op: 'source', of: 'post' }
          - { op: 'lines' }
          - { op: 'keyByPattern', re: '(.*TODO.*)' }
        added:
          - { op: 'onlyIn', of: 'after', notIn: 'before' }
      relate:
        - id: 'nothing-added'
          relation: { op: 'empty', of: 'added' }
          message: '이 TODO를 해결하세요: {value}'
```

변경하지 않은 TODO 줄은 허용하며, 기존 줄을 똑같이 반복해도 이미 있는 줄로 취급합니다.
`advise`는 위반을 알리고 작업을 계속 진행합니다. 해당 항목으로 세션 호출을 중단하려면
`enforce: block`을 선택하세요. diff 판정에서 차단 항목으로 작업을 중단하려면 명령에도
`--enforce block`이 필요합니다.

설정 파일 자체도 에이전트 세션에서 보호됩니다. 직접 편집하거나, 에이전트에게 의도적인 편집을
맡길 때는 [증인 절차](./docs/how-to/connect-surfaces.ko.md#witness-and-recovery)를 따르세요.
Claude Code에서는 설치된 `discipline-draft` 스킬에 문제를 설명하면 규율 항목 작성을 도와줍니다.

### 3. 결과 확인하기

```sh
pnpm exec pdks explain
git diff HEAD | pnpm exec pdks covenant check --diff
```

`explain`은 두 표면 모두에서 `no-new-todo-lines`를 `declare`로 표시해야 합니다.
위반을 확인하려면 `src/` 아래 Git이 추적 중인 파일에 `// TODO: quick-start check` 줄을
새로 추가하고 diff 명령을 다시 실행하세요. 규율 이름이 담긴 진단 메시지,
`.polydeukes/roi.log`의 `advised` 행, 종료 코드 0을 확인할 수 있습니다.
추가한 줄을 지우고 다시 실행하면 해당 진단 메시지가 사라져야 합니다.

이어서 [다른 규율 예제](./docs/how-to/write-disciplines.ko.md),
[pre-commit 연결](./docs/how-to/connect-surfaces.ko.md#change-set-surface)을 읽거나,
`pnpm exec pdks docs`로 설치된 판본의 문서를 확인하세요.

<a id="status-and-cli"></a>
## 현재 상태와 CLI

**상태: 베타(beta)** (v0.7.0부터, 2026-09-16). 여섯 패키지가 발행되어 있습니다. `@polydeukes/core`(약속(covenant)
프로토콜), 세션 어댑터(`adapter-claude-code`, `adapter-grok`, `adapter-codex`), 프로그램에서 입력 IR을 판정기에
넘기는 TypeScript 클라이언트 `@polydeukes/sdk-ts`, 그리고 판정기를 포함하며 `pdks`
bin(`polydeukes`의 별칭)이 CLI인 우산(umbrella) 패키지 `polydeukes`입니다.
ledger·memory·verify 패키지는 아직 청사진 단계입니다. 오늘의 CLI는 이렇습니다.

```sh
pdks init                # 프로젝트 초기 파일 생성. 설정 파일과 텔레메트리 제외 항목
pdks-claude-code init    # Claude Code 세션 표면을 배선 (@polydeukes/adapter-claude-code가 제공)
pdks-grok init           # Grok 세션 표면을 배선 (@polydeukes/adapter-grok가 제공)
pdks-codex init          # Codex 세션 표면을 배선 (@polydeukes/adapter-codex가 제공)
git diff --cached | pdks covenant check --diff      # staged diff 판정 (pre-commit 진입점)
git diff HEAD | pdks covenant check --diff          # 같은 판정을 작업 트리에
git diff main...HEAD | pdks covenant check --diff   # ... 또는 ref 범위(PR의 범위)에
pdks covenant check < input.json                    # 또는 다른 프로그램이 만든 입력 IR에
pdks explain             # 각 표면이 판정·건너뜀·제외하는 것을 출력 — 판정 없음
pdks docs [topic]        # 동봉된 문서를 네트워크 없이 열람
```

설치기는 `.claude/skills/`에 `discipline-draft` 스킬도 만듭니다. 반복되는 문제를 AI
파트너에게 설명하면 현재 선언 문법으로 표현할 수 있는지에 따라 설정 항목을 분류합니다.
표현할 수 있으면 `advise` 판정 항목으로, 없으면 `draft: true` 항목으로 작성합니다.

v0.5.0부터 기본 자세는 진단입니다. 규율을 어겨도 기본적으로 호출을 거부하지 않고 권고를
기록합니다. 종료 코드는 0이며, 텔레메트리에 `advised` 1행을 남기고 항목의 `why`를 stderr로 출력합니다.
묻지 않고 차단하는 것은 판정 사슬의 자기 보호뿐이고, 항목의 `enforce: block`은 작성자가
선택하는 승격이며, 승격 사다리는 `draft` → advise → block입니다.

문서는 패키지 안에 함께 실립니다. 그래서 `pdks docs`는 판정을 수행하는 바로 그 판본의 답을
돌려주고, 검색 엔진이 색인한 판본과 설치된 판본이 어긋나는 일이 없습니다. 아래
[문서](#문서) 표에는 동봉 문서와 백서·저널을 시작 안내부터 참조 문서까지 유형별로 묶었습니다.
아직 계획 중인 명령도 있습니다. `pdks verify`(적대 검증)와
`pdks ledger start <id>`(작업 추적)는 각자의 패키지와 함께 옵니다.

---

<a id="what-it-is"></a>
## 무엇인가

Polydeukes는 개발자가 스스로 지켜 온 규율을 AI 에이전트(Claude Code 등)와 함께 지키기 위한
프레임워크입니다. 테스트 우선, 커밋 전 검증, 결정 기록, 같은 실수의 반복 방지를
**프롬프트로 부탁하는 대신 결정론적 장치로 확인**합니다.

핵심 관점은 통제가 아니라 파트너십입니다. 약속(covenant)은 AI를 가두는 울타리가 아니라, 사람과 AI에게 똑같이 적용되는 공유된 약속입니다. 이름의 유래와 그 철학은
[`STORY.md`](./STORY.md)에 있습니다.

설계는 실제 운영 중인 모노레포의 AI 개발 장치에서 출발했습니다. 그 장치를
범용 규율 프레임워크로 분리할 수 있는지 분석한 결과가 청사진의 바탕이 되었습니다.

<a id="thin-core-and-packages"></a>
## 구성. 얇은 코어와 독립 패키지

모두 설치할 필요 없이 필요한 부분만 골라 쓰는 구조를 지향합니다. 각 패키지는 코어에만 의존하고 서로를 모릅니다.

| 패키지 | 역할 |
|--------|------|
| `@polydeukes/core` | 약속(covenant) 프로토콜(stdin-JSON / exit-2), 설정 스키마와 그 검증, 대수 선언(algebra declaration) 스키마, transcript 인터페이스 — 도메인·에이전트에 무지한 최소 코어. 설정을 디스크에서 읽는 일은 core가 아니라 우산의 `loadConfig`가 진다. core가 여는 파일은 자기 텔레메트리 로그뿐이다 |
| `polydeukes`의 판정기(`src/covenant/`) | 편집·커밋 시점의 결정론적 판정 + 판정 사슬 자체를 보호하는 메타 약속(meta-covenant) |
| `@polydeukes/ledger` *(계획)* | 작업 단위 추적. 완료 권한을 "내가 끝냈다"가 아니라 "검증이 통과했다"는 사실로 이전 |
| `@polydeukes/memory` *(계획)* | 로컬 SQLite + FTS5 기반 저장소. 결정·시행착오를 검색 가능한 기억으로. 동기화는 선택 어댑터(기본 로컬) |
| `@polydeukes/verify` *(계획)* | 멀티에이전트 적대적 검증 오케스트레이터 |

지금 제공하는 패키지는 `core`, 우산 `polydeukes`, 세션 어댑터 셋입니다. 나머지가 갖춰진 뒤의 도입 순서는
`covenant` → `memory` → `ledger` → `verify`로 계획하고 있습니다. `covenant`와 `memory`는 프로젝트
규모와 무관하게 가치를 낼 것으로 보고, `ledger`·`verify`는 다중 워크트리·팀 워크플로 규모를
대상으로 합니다.

<a id="design-blueprint"></a>
## 설계 청사진 (요약)

추출 전략의 핵심은 단방향 층위입니다. **범용 코어가 안쪽, 도메인이 바깥**이고, 모든 의존은 안쪽
코어를 향하며 되돌아 나오는 의존은 없습니다. 코어는 특정 제품도, 특정 AI 런타임도 모릅니다.

```text
@polydeukes/core            도메인·에이전트에 무지한 패턴 (covenant 프로토콜·ledger 엔진·메타-covenant·memory 엔진)
        △
        │ depends on (단방향)
@polydeukes/adapter-*        런타임/인프라 결합을 코어 뒤로 숨김
        │                   · adapter-claude-code  (PreToolUse 페이로드 ↔ canonical)
        │                   · adapter-grok         (PreToolUse 페이로드 ↔ canonical)
        │                   · adapter-codex        (PreToolUse 페이로드 ↔ canonical)
        │                   · adapter-pi 등
        │                   · sync(선택): 로컬 기본, s3/git/gcs/nfs는 어댑터
        △
        │ scaffolds into
create-polydeukes           도메인 고유값을 템플릿·config로 외부화
                            (ticket regex, 경로 glob, scope→명령 매핑 등)
```

분리 원칙은 셋입니다.

- **언어 ⊥ 에이전트.** 테스트 명령·경로 glob 같은 언어(TS/Python/Go) 결합은 `polydeukes.config.yaml`로, transcript 스키마 같은
  AI 런타임 결합은 `adapter-*`로 갑니다. 둘은 직교합니다.
- **본질 대 우연.** "검증은 exit code로 판정한다"가 본질이고 "그 명령이 vitest다"는 우연이라 config로 갑니다. "지식은 로컬 SQLite 파일이다"가
  본질이고 "그 파일이 S3에 산다"는 우연이라 동기화 어댑터로 갑니다.
- **측정을 1급 시민으로.** covenant ROI와 기억(memory) 검색 텔레메트리를 수집해 폐루프로 되돌립니다. "더 안전한 코드를 만든다"를 데이터로 입증합니다.

<a id="documents"></a>
## 문서

[`docs/README.ko.md`](./docs/README.ko.md)는 문서 색인입니다. 아래 목록과 함께 프레임워크의
동작을 한 페이지로 요약했습니다. 필요한 문서 유형을 골라 읽으면 됩니다.

<a id="tutorials-and-guides"></a>
### 튜토리얼과 가이드

| 문서 | 내용 |
|------|------|
| [`docs/tutorials/first-judgment.ko.md`](./docs/tutorials/first-judgment.ko.md) | 첫 눈에 보이는 판정 — 설치하고 Claude Code를 배선한 뒤 보호된 편집이 판정되는 모습 |
| [`docs/how-to/connect-surfaces.ko.md`](./docs/how-to/connect-surfaces.ko.md) | 세션과 변경 집합 표면 연결, Grok와 Codex 포함 |
| [`docs/how-to/configure-project.ko.md`](./docs/how-to/configure-project.ko.md) | 프로젝트 파일, IDE 지원, advise와 block |
| [`docs/how-to/write-disciplines.ko.md`](./docs/how-to/write-disciplines.ko.md) | 실전 선언 예제, 특히 locale key pairing |
| [`docs/troubleshooting.ko.md`](./docs/troubleshooting.ko.md) | fail-closed 상태, 증인 밸브, 텔레메트리 로그 |

<a id="reference-layer"></a>
### 레퍼런스

| 문서 | 내용 |
|------|------|
| [`docs/reference/configuration/index.ko.md`](./docs/reference/configuration/index.ko.md) | 설정 레퍼런스 — 모든 키와 각 키의 규칙·함정 |
| [`docs/reference/packages/polydeukes.ko.md`](./docs/reference/packages/polydeukes.ko.md) | 패키지 레퍼런스 — 서브커맨드와 종료 코드, 패키지 셋이 각각 소유하는 것 |

<a id="why-and-the-journal"></a>
### 철학과 저널

| 문서 | 내용 |
|------|------|
| [`STORY.md`](./STORY.md) | 이름의 유래와 설계 철학 (창업자 서사) |
| [`docs/why-polydeukes.ko.md`](./docs/why-polydeukes.ko.md) | 왜 폴리데우케스인가? — 설계 백서. 원칙과 그 원칙을 만든 실패담, 그리고 각각을 결론지은 측정 |
| [`docs/build-in-public/`](./docs/build-in-public/2026-07-v0.1-covenant-core.ko.md) | 빌드 인 퍼블릭 시리즈 — 마일스톤마다 한 편, v0.1(약속(covenant) 코어 + 측정)부터 시작 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 마일스톤별 릴리스 노트 |

<a id="license"></a>
## 라이선스

[MIT](./LICENSE)
