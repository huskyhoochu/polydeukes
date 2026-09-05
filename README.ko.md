# Polydeukes

**한국어** · [English](./README.md)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/huskyhoochu/polydeukes)

> AI 코딩 파트너와 함께 개발하기 위한 규율(discipline) 프레임워크.
> 결정론적 약속(covenant) · 검증 가능한 작업 기록 · 로컬 기억(memory) 그래프 · 적대적 검증을 얇은 코어 하나 위에 올립니다.

**상태: 알파(alpha).** 다섯 패키지가 발행되어 있습니다. `@polydeukes/core`(약속(covenant)
프로토콜), `@polydeukes/covenant`(판정기), 어댑터 둘(`adapter-claude-code` ·
`adapter-git`), 그리고 `pdks` bin(`polydeukes`의 별칭)이 CLI인 우산(umbrella) 패키지
`polydeukes`입니다. ledger·memory·verify 패키지는 아직 청사진 단계입니다. 오늘의 CLI는 이렇습니다.

```sh
pdks init claude-code    # 프로젝트에 Claude Code 세션 표면을 배선
pdks init grok           # 프로젝트에 Grok 세션 표면을 배선
pdks covenant check      # staged diff 판정 (pre-commit 진입점)
pdks covenant check --worktree            # 같은 판정을 작업 트리에
pdks covenant check --range main...HEAD   # ... 또는 ref 범위(PR의 범위)에
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
| `@polydeukes/covenant` | 편집·커밋 시점의 결정론적 판정 + 판정 사슬 자체를 보호하는 메타 약속(meta-covenant) |
| `@polydeukes/ledger` *(계획)* | 작업 단위 추적. 완료 권한을 "내가 끝냈다"가 아니라 "검증이 통과했다"는 사실로 이전 |
| `@polydeukes/memory` *(계획)* | 로컬 SQLite + FTS5 기반 저장소. 결정·시행착오를 검색 가능한 기억으로. 동기화는 선택 어댑터(기본 로컬) |
| `@polydeukes/verify` *(계획)* | 멀티에이전트 적대적 검증 오케스트레이터 |

지금 제공하는 패키지는 `core`, `covenant`, 어댑터 둘뿐입니다. 나머지가 갖춰진 뒤의 도입 순서는
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
| [`docs/how-to/connect-surfaces.ko.md`](./docs/how-to/connect-surfaces.ko.md) | 세션과 커밋 표면 연결, Grok 포함 |
| [`docs/how-to/configure-project.ko.md`](./docs/how-to/configure-project.ko.md) | 프로젝트 파일, IDE 지원, advise와 block |
| [`docs/how-to/write-disciplines.ko.md`](./docs/how-to/write-disciplines.ko.md) | 실전 선언 예제, 특히 locale key pairing |
| [`docs/troubleshooting.ko.md`](./docs/troubleshooting.ko.md) | fail-closed 상태, 증인 밸브, 텔레메트리 로그 |

<a id="reference-layer"></a>
### 레퍼런스

| 문서 | 내용 |
|------|------|
| [`docs/reference/configuration/index.ko.md`](./docs/reference/configuration/index.ko.md) | 설정 레퍼런스 — 모든 키와 각 키의 규칙·함정 |
| [`docs/reference/packages/polydeukes.ko.md`](./docs/reference/packages/polydeukes.ko.md) | 패키지 레퍼런스 — 서브커맨드와 종료 코드, 패키지 다섯이 각각 소유하는 것 |

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
