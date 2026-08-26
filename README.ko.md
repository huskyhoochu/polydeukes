# Polydeukes

**한국어** · [English](./README.md)

> AI 코딩 파트너와 함께 개발하기 위한 규율(discipline) 프레임워크.
> 결정론적 약속(covenant) · 검증 가능한 작업 기록 · 로컬 기억(memory) 그래프 · 적대적 검증을 얇은 코어 하나 위에 올립니다.

**상태: 알파(alpha).** 다섯 패키지가 발행되어 있습니다. `@polydeukes/core`(약속(covenant)
프로토콜), `@polydeukes/covenant`(판정기), 어댑터 둘(`adapter-claude-code` ·
`adapter-git`), 그리고 `pdks` bin(`polydeukes`의 별칭)이 CLI인 우산(umbrella) 패키지
`polydeukes`입니다. ledger·memory·verify 패키지는 아직 청사진 단계입니다. 오늘 실린
서브커맨드는 셋입니다(v0.3.0 릴리스로 출판됐고, 그 전의 npm 버전은 이름 선점용
스텁입니다).

```sh
pdks init claude-code    # 프로젝트에 세션 표면을 배선
pdks covenant check      # staged diff 판정 (pre-commit 진입점)
pdks covenant check --worktree            # 같은 판정을 작업 트리에
pdks covenant check --range main...HEAD   # ... 또는 ref 범위(PR의 범위)에
pdks explain             # 각 표면이 판정·건너뜀·제외하는 것을 출력 — 판정 없음
pdks docs [topic]        # 동봉된 문서를 네트워크 없이 열람
```

문서는 패키지 안에 함께 실립니다. 그래서 `pdks docs`는 판정을 수행하는 바로 그 판본의 답을
돌려주고, 검색 엔진이 색인한 판본과 설치된 판본이 어긋나는 일이 없습니다. 아래
[문서](#문서) 표는 같은 집합에 백서·저널을 더해 시작하기부터 레퍼런스까지 층으로
묶었습니다. 예정된 것도 있습니다. `pdks verify`(적대 검증)와
`pdks ledger start <id>`(작업 추적)는 각자의 패키지와 함께 옵니다.

---

## 무엇인가

Polydeukes는 AI 에이전트(Claude Code 등)와 함께 일할 때 개발자가 스스로에게 적용해온 규율(테스트 우선, 커밋 전 검증, 결정의 기록, 같은 실수 반복
방지)을 **프롬프트 부탁이 아니라 결정론적 장치로 외부화**하는 프레임워크입니다.

핵심 관점은 통제가 아니라 파트너십입니다. 약속(covenant)은 AI를 가두는 울타리가 아니라, 사람과 AI에게 똑같이 적용되는 공유된 약속입니다. 이름의 유래와 그 철학은
[`STORY.md`](./STORY.md)에 있습니다.

설계의 출발점은 실제 운영 중인 한 모노레포에 내장된 AI 개발 장치, 곧 이 프로젝트가 되찾고자 하는 바로 그 "harness engineering" 프레임입니다. 그 장치를
범용 프레임워크로 추출할 수 있는지 평가한 분석이 청사진의 바탕이 되었습니다.

## 구성. 얇은 코어와 독립 패키지

전부 아니면 전무가 아니라, 필요한 조각만 골라 설치하는 구조를 지향합니다. 각 패키지는 코어에만 의존하고 서로를 모릅니다.

| 패키지 | 역할 |
|--------|------|
| `@polydeukes/core` | 약속(covenant) 프로토콜(stdin-JSON / exit-2), config 로더, transcript 인터페이스 — 도메인·에이전트에 무지한 최소 코어 |
| `@polydeukes/covenant` | 편집·push 시점의 결정론적 PreToolUse 훅 + 약속 자체를 보호하는 self-mod 메타-약속(meta-covenant) |
| `@polydeukes/ledger` | 작업 단위 추적. 완료 권한을 "내가 끝냈다"가 아니라 "검증이 통과했다"는 사실로 이전 |
| `@polydeukes/memory` | 로컬 SQLite + FTS5 기반 저장소. 결정·시행착오를 검색 가능한 기억으로. 동기화는 선택 어댑터(기본 로컬) |
| `@polydeukes/verify` | 멀티에이전트 적대적 검증 오케스트레이터 |

도입 우선순위는 `covenant` → `memory` → `ledger` → `verify` 순을 권장합니다. `covenant`와 `memory`는 프로젝트 규모와 무관하게
즉시 가치를 내지만, `ledger`·`verify`는 다중 워크트리·팀 워크플로 같은 규모에서 빛납니다.

## 설계 청사진 (요약)

추출 전략의 핵심은 의존성이 **항상 안쪽(범용 코어) → 바깥(도메인) 단방향**이어야 한다는 것입니다. 코어는 특정 제품도, 특정 AI 런타임도 모릅니다.

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

추출 전에 먼저 메울 검증된 구멍은 셋입니다. 자가보호의 Bash 우회 경로, 완료 판정의 `status` 누수, 그리고 측정 인프라 미가동입니다.

## 문서

[`docs/README.ko.md`](./docs/README.ko.md)이 문서 색인입니다. 아래와 같은 지도에 프레임워크가
어떻게 동작하는지 한 쪽 요약을 더했습니다. 아래 표는 층으로 묶었으니 필요한 층에서 바로
시작하면 됩니다.

### 시작하기

| 문서 | 내용 |
|------|------|
| [`docs/installation.ko.md`](./docs/installation.ko.md) | 설치 가이드 — 세션 표면(`pdks init claude-code`)과 수동 배선 커밋 표면 |

### 가이드

| 문서 | 내용 |
|------|------|
| [`docs/configuration.ko.md`](./docs/configuration.ko.md) | 설정 가이드 — 파일과 발견 규칙, IDE 배선, 강제가 어떤 모습인지 |
| [`docs/troubleshooting.ko.md`](./docs/troubleshooting.ko.md) | fail-closed 상태들과 회복 절차, 판정 기록 읽는 법, 증인(witness) 밸브 |

### 레퍼런스

| 문서 | 내용 |
|------|------|
| [`docs/reference/configuration.ko.md`](./docs/reference/configuration.ko.md) | 설정 레퍼런스 — 모든 키와 각 키의 규칙·함정 |
| [`docs/reference/`](./docs/reference/polydeukes.ko.md) | 패키지 레퍼런스 — 서브커맨드와 종료 코드, 패키지 다섯이 각각 소유하는 것 |

### 철학과 저널

| 문서 | 내용 |
|------|------|
| [`STORY.md`](./STORY.md) | 이름의 유래와 설계 철학 (창업자 서사) |
| [`docs/why-polydeukes.ko.md`](./docs/why-polydeukes.ko.md) | 왜 폴리데우케스인가? — 설계 백서. 원칙과 그 원칙을 만든 실패담, 그리고 각각을 결론지은 측정 |
| [`docs/build-in-public/`](./docs/build-in-public/2026-07-v0.1-covenant-core.ko.md) | 빌드 인 퍼블릭 시리즈 — 마일스톤마다 한 편, v0.1(약속(covenant) 코어 + 측정)부터 시작 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 마일스톤별 릴리스 노트 |

## 라이선스

[MIT](./LICENSE)
