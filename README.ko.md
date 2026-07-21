# Polydeukes

**한국어** · [English](./README.md)

> AI 코딩 파트너와 함께 개발하기 위한 규율(discipline) 프레임워크.
> 결정론적 약속(covenant) · 검증 가능한 작업 기록 · 로컬 기억(memory) 그래프 · 적대적 검증을 얇은 코어 위에 올린 dev-tool.

**상태: pre-alpha.** 첫 유닛들이 `@polydeukes/core`(약속(covenant) 프로토콜, ROI 텔레메트리, config 로더, fail-open/fail-closed 정책 테이블, 정규 대화 기록(canonical transcript) 질의 이음새(seam)), `@polydeukes/covenant`(run_covenant 래퍼, heredoc을 인지하는 멀티라인 Bash 분석과 쓰기 탐지 규칙(redirect/tee/`sed -i`), 경로 라우팅 디스패처, escape hatch를 갖춘 self-mod 메타-약속(covenant), 탐지 규칙을 읽기-전용 allowlist를 갖춘 Bash 축 판정으로 조립한 shell-mod 메타-약속(covenant), 그리고 대화 기록 이음새로 판정하는 시간제 유예(TTL waiver) 밸브), `@polydeukes/adapter-claude-code`(PreToolUse 페이로드 → 약속(covenant) 입력 IR 변환, 주입형 dispatch seam을 갖춘 어댑터 경로 ROI 텔레메트리 배선, 그리고 디스크를 건드리지 않고 Edit/Write/MultiEdit 적용 결과를 계산하는 가상 사후 상태(virtual post-state) 파서)에 구현되었습니다. 나머지는 아직 청사진 단계입니다. 이 저장소는 그 초기 코어와 아키텍처 청사진, 설계 근거를 담고 있습니다. 아래는 무엇을 만들려는지에 대한 안내입니다.

---

## 무엇인가

Polydeukes는 AI 에이전트(Claude Code 등)와 함께 일할 때, 개발자가 스스로에게 적용해온 규율 — 테스트 우선, 커밋 전 검증, 결정의 기록, 같은 실수 반복 방지 — 을 **프롬프트 부탁이 아니라 결정론적 장치로 외부화**하는 프레임워크입니다.

핵심 관점은 통제가 아니라 파트너십입니다. 약속(covenant)은 AI를 가두는 울타리가 아니라, 사람과 AI에게 똑같이 적용되는 공유된 약속입니다. 이름의 유래와 그 철학은 [`STORY.md`](./STORY.md)에 있습니다.

설계의 출발점은 실제 운영 중인 한 모노레포에 내장된 AI 개발 하네스 — 이 프로젝트가 되찾고자 하는 바로 그 "harness engineering" 프레임 — 이며, 그 장치를 범용 프레임워크로 추출할 수 있는지 평가하고 청사진을 세운 분석입니다.

## 구성 — 얇은 코어 + 독립 패키지

전부 아니면 전무가 아니라, 필요한 조각만 골라 설치하는 구조를 지향합니다. 각 패키지는 코어에만 의존하고 서로를 모릅니다.

| 패키지 | 역할 |
|--------|------|
| `@polydeukes/core` | 약속(covenant) 프로토콜(stdin-JSON / exit-2), config 로더, transcript 인터페이스 — 도메인·에이전트에 무지한 최소 코어 |
| `@polydeukes/covenant` | 편집·push 시점의 결정론적 PreToolUse 훅 + 약속 자체를 보호하는 self-mod 메타-약속(meta-covenant) |
| `@polydeukes/ledger` | 작업 단위 추적. 완료 권한을 "내가 끝냈다"가 아니라 "검증이 통과했다"는 사실로 이전 |
| `@polydeukes/memory` | 로컬 SQLite + FTS5 기반 저장소. 결정·시행착오를 검색 가능한 기억으로. 동기화는 선택 어댑터(기본 로컬) |
| `@polydeukes/verify` | 멀티에이전트 적대적 검증 오케스트레이터 |

도입 우선순위는 `covenant` → `memory` → `ledger` → `verify` 순을 권장합니다. `covenant`와 `memory`는 프로젝트 규모와 무관하게 즉시 가치를 내지만, `ledger`·`verify`는 다중 워크트리·팀 워크플로 같은 규모에서 빛납니다.

## 설계 청사진 (요약)

추출 전략의 핵심은 의존성이 **항상 안쪽(범용 코어) → 바깥(도메인) 단방향**이어야 한다는 것입니다. 코어는 특정 제품도, 특정 AI 런타임도 모릅니다.

```
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

세 가지 분리 원칙:

- **언어 ⊥ 에이전트** — 테스트 명령·경로 glob 같은 언어(TS/Python/Go) 결합은 `polydeukes.config.yaml`로, transcript 스키마 같은 AI 런타임 결합은 `adapter-*`로. 둘은 직교합니다.
- **본질 vs 우연** — "검증은 exit code로 판정한다"가 본질, "그 명령이 vitest다"는 우연(config로). "지식은 로컬 SQLite 파일이다"가 본질, "그 파일이 S3에 산다"는 우연(동기화 어댑터로).
- **측정을 1급 시민으로** — covenant ROI·기억(memory) 검색 텔레메트리를 수집하고 폐루프로 환류. "더 안전한 코드를 만든다"를 데이터로 입증.

추출 전에 먼저 메울 검증된 구멍 세 가지: 자가보호의 Bash 우회 경로, 완료 판정의 `status` 누수, 측정 인프라 미가동.

## 문서

| 문서 | 내용 |
|------|------|
| [`STORY.md`](./STORY.md) | 이름의 유래와 설계 철학 (창업자 서사) |
| [`docs/why-polydeukes.ko.md`](./docs/why-polydeukes.ko.md) | 왜 폴리데우케스인가? — 설계 원칙 백서 (골격, 공개적으로 확장 중) |
| [`docs/build-in-public/`](./docs/build-in-public/2026-07-v0.1-covenant-core.ko.md) | 빌드 인 퍼블릭 시리즈 — 마일스톤마다 한 편, v0.1(약속(covenant) 코어 + 측정)부터 시작 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 마일스톤별 릴리스 노트 |

## CLI (예정)

```sh
$ pdks verify              # 검증 액션 실행
$ pdks ledger start <id>   # 작업 시작
$ pdks covenant check      # 약속(covenant) 점검
```

`pdks`는 `polydeukes`의 별칭입니다.

## 라이선스

[MIT](./LICENSE)
