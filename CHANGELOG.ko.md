# 변경 이력(Changelog)

[English](./CHANGELOG.md) · **한국어**

이 프로젝트의 주요 변경 사항을 모두 이 파일에 기록한다.

서식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
이 프로젝트는 [유의적 버전(Semantic Versioning)](https://semver.org/lang/ko/)을 준수한다.

이 프로젝트는 **pre-alpha**다. 아직 배포된 버전이 없으므로 아래 모든 변경은 `[Unreleased]`로
묶는다. v0.1 MVP 마일스톤은 완료되었으며 첫 태그 릴리스가 된다. 아직 구현되지 않은 모든
것은 설계 문서가 정본이다.

## [Unreleased]

### v0.1 MVP — 약속(covenant) 코어 + 측정 (완료)

이 프로젝트 자신의 약속(covenant) substrate가 self-mod로부터 도구 축(Edit/Write/MultiEdit)과
Bash 축(`sed -i`/heredoc/tee/redirect, 상위 디렉터리 조작, 인용·이스케이프로 쪼갠 경로)
양쪽에서 결정론적으로 보호되고, 모든 약속(covenant) 호출이 ROI 텔레메트리에 기록된다.
자기-도그푸딩(self-dogfooding)이 켜져 있어, 프로젝트가 자신의 약속(covenant)을 통과하며
스스로를 개발한다.

### 추가됨(Added)

- **`@polydeukes/core`** — 얇고 도메인·에이전트 중립인 코어:
  - 약속(covenant) 프로토콜 계약: stdin-JSON ↔ `CovenantVerdict`, exit-code 의미론
    (0 준수 / 1 위반 / 2 차단). 잘못된 입력은 fail-closed.
  - ROI 텔레메트리: 전 패키지가 공유하는 append-only 단일 수집기 + `gain` 집계 CLI.
    동시 append에도 라인이 섞이지 않음.
  - `polydeukes.config.ts` 스키마 + `defineConfig()` 로더(언어를 1급 축으로). 코어에
    테스트 러너 리터럴 없음.
  - 위반 유형별 fail-open / fail-closed 정책 테이블.
  - 보호 경로 정규화 + 어댑터 디렉터리 자동 포함.
- **`@polydeukes/covenant`** — 약속(covenant) 실행·판정 계층:
  - 위반을 차단 exit-code로 번역하는 `run_covenant` 래퍼, 호출별 ROI 로깅 포함.
  - heredoc을 인지하는 멀티라인 Bash 명령 분석과 쓰기 탐지 규칙
    (redirect / tee / `printf` redirect / `sed -i` 인플레이스 / heredoc).
  - 3계층 모델로 보호 경로를 등록하는 경로 라우팅 디스패처.
  - escape hatch seam을 갖춘 self-mod 메타-약속(covenant)(도구 축).
  - 탐지 규칙을 읽기-전용 allowlist를 갖춘 판정으로 조립한 shell-mod 메타-약속(covenant)(Bash 축).
  - 디스패처와 두 판정기가 공유하는 경로-분절 매칭 프리미티브
    (정규화 세그먼트 기준 조상 / 자손 / 동일).
- **`@polydeukes/adapter-claude-code`** — 첫 에이전트 어댑터:
  - Claude Code PreToolUse 페이로드 → 에이전트-중립 약속(covenant) 입력 IR 변환.
  - 주입형 dispatch seam을 갖춘 어댑터 경로 ROI 텔레메트리 배선.
  - 디스크를 건드리지 않고 Edit/Write/MultiEdit 적용 결과를 계산하는 가상 사후 상태
    (virtual post-state) 파서(v0.2 신규-위반-only 트리거에 공급).
- **자기-도그푸딩 조립** — 모든 Edit/Write/MultiEdit/Bash 호출을 프로젝트 자신의
  약속(covenant)에 통과시키는 PreToolUse 훅. 모든 호출이 측정되고, escape hatch는 조용히
  통과하지 않고 `bypassed`로 기록된다.
- **`@polydeukes/polydeukes`** — unscoped 이름 예약 스텁.

### 수정됨(Fixed)

- 경로 매칭을 raw substring으로 판정해 상위 디렉터리 조작(`rm -rf packages/core`)과
  인용·이스케이프·줄연속으로 쪼갠 경로가 디스패처와 두 판정기를 우회했다. 이름 접두사만
  겹치는 무관 경로를 과잉 차단하지 않으면서, Claude Code가 실제로 보내는 절대경로 `file_path`도
  처리하는 경로-분절 매칭으로 교체.
- 자기-도그푸딩 훅의 fail-closed catch-all이 코어 모듈을 쓸 수 있는 상황에서도 텔레메트리를
  남기지 않고 차단했다. 이제 차단 1회마다 `blocked` 1행을 기록.
- `virtualPostState`가 `new_string`의 `$` 치환 패턴(`$&`, `$$`, `$'`)을 해석해 실제 Edit
  도구의 리터럴 치환과 어긋났다. 치환을 리터럴로 수정.
