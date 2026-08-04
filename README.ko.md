# Polydeukes

**한국어** · [English](./README.md)

> AI 코딩 파트너와 함께 개발하기 위한 규율(discipline) 프레임워크.
> 결정론적 약속(covenant) · 검증 가능한 작업 기록 · 로컬 기억(memory) 그래프 · 적대적 검증을 얇은 코어 하나 위에 올립니다.

**상태: 알파(alpha).** 첫 유닛들이 다섯 패키지에 구현되었습니다. `@polydeukes/core`는 약속(covenant) 프로토콜, ROI 텔레메트리, config
로더, fail-open/fail-closed 정책 테이블, 정규 대화 기록(canonical transcript) 질의 이음새(seam)를 담습니다.
`@polydeukes/covenant`는 run_covenant 래퍼, heredoc을 인지하는 멀티라인 Bash 분석과 쓰기 탐지 규칙(redirect/tee/`sed
-i`), 경로 라우팅 디스패처, 증인(witness) 이음새를 갖춘 self-mod 메타-약속(covenant), 탐지 규칙을 읽기 전용 allowlist와 함께 Bash 축
판정으로 조립한 shell-mod 메타-약속(covenant), 그리고 대화 기록 이음새로 판정하며 판정 뒤에만 조회되는 시간제 증인(TTL witness) 밸브까지 갖췄습니다.
`@polydeukes/adapter-claude-code`는 PreToolUse 페이로드를 약속(covenant) 입력 IR로 바꾸는 번역, 주입형 dispatch seam을
갖춘 어댑터 경로 ROI 텔레메트리 배선, 디스크를 건드리지 않고 Edit/Write/MultiEdit 적용 결과를 계산하는 가상 사후 상태(virtual post-state)
파서, 시간제 증인(TTL witness)에 실물 인간 발화를 공급하는 대화 기록(transcript) JSONL 공급자를 담습니다.
`@polydeukes/adapter-git`은 커밋 표면 어댑터입니다. `staged diff`를 약속(covenant) 입력 IR로 바꾸고 HEAD와 인덱스의 blob으로 같은
에이전트 중립 호출별 `fileChange` 증거(삭제를 1급으로 표현하는 판별 유니온(discriminated union))를 채우는 제2 어댑터이며, 코어 0줄 수정의 IR
중립성 증명입니다. umbrella `polydeukes` 패키지는 `loadConfig` 디스커버리 로더와 첫 실물 `pdks` 서브커맨드이자 pre-commit 판정 진입점인
`pdks covenant check`를 담습니다. `block` 수위에서 그 증인(witness) 밸브는 터미널 앞의 인간만 답할 수 있는 TTY 프롬프트입니다. 수위 자체는
git 어댑터의 네임스페이스 설정 `adapters.git.enforce: block | advise`이고, `advise`는 판정을 `advised` 이벤트로 기록한 뒤 커밋을
진행시킵니다. 같은 네임스페이스의 `adapters.git.protectedPaths`는 공통 목록 위에 커밋 표면만 판정하는 가산 관측 범위이며, 세션 표면은 읽지 않습니다.
나머지는 아직 청사진 단계입니다. 이 저장소는 그 초기 코어와 아키텍처 청사진, 설계 근거를 담고 있습니다. 아래에서 무엇을 만들려는지 설명합니다.

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

| 문서 | 내용 |
|------|------|
| [`STORY.md`](./STORY.md) | 이름의 유래와 설계 철학 (창업자 서사) |
| [`docs/why-polydeukes.ko.md`](./docs/why-polydeukes.ko.md) | 왜 폴리데우케스인가? — 설계 원칙 백서 (골격, 공개적으로 확장 중) |
| [`docs/installation.ko.md`](./docs/installation.ko.md) | 설치 가이드 — 세션 표면(`pdks init claude-code`)과 수동 배선 커밋 표면 |
| [`docs/troubleshooting.ko.md`](./docs/troubleshooting.ko.md) | fail-closed 상태들과 회복 절차, 판정 기록 읽는 법, 증인(witness) 밸브 |
| [`docs/configuration.ko.md`](./docs/configuration.ko.md) | 설정 레퍼런스 — 전체 키와 규율(discipline) 가족, 집행이 어떤 모습인지 |
| [`docs/reference/`](./docs/reference/polydeukes.ko.md) | 패키지 레퍼런스 — 서브커맨드와 종료 코드, 패키지 다섯이 각각 소유하는 것 |
| [`docs/build-in-public/`](./docs/build-in-public/2026-07-v0.1-covenant-core.ko.md) | 빌드 인 퍼블릭 시리즈 — 마일스톤마다 한 편, v0.1(약속(covenant) 코어 + 측정)부터 시작 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 마일스톤별 릴리스 노트 |

## CLI

`pdks` bin에는 오늘 서브커맨드 둘이 실려 있습니다(v0.3.0 릴리스로 출판되며, 그 전의 npm
버전은 이름 선점용 스텁입니다).

```sh
pdks init claude-code    # 프로젝트에 세션 표면을 배선
pdks covenant check      # staged diff 판정 (pre-commit 진입점)
```

예정 — 각자의 패키지와 함께 옵니다. `pdks verify`(적대 검증), `pdks ledger start <id>`(작업
추적).

`pdks`는 `polydeukes`의 별칭입니다.

## 라이선스

[MIT](./LICENSE)
