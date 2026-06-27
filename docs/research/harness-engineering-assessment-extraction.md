---
area: harness
tags: [harness-engineering, ai-dev-workflow, guards, ledger, docs-db, pi-portability, framework-extraction, spec-driven-development, assessment]
---

# memoriq AI 주도 개발 하네스: 품질 평가 & 범용 프레임워크 추출 가능성 리포트

> 작성 기준일: 2026-06-28 · 방법: 6도메인 멀티에이전트 조사 → 도메인별 적대적 검증(REFUTE) → 외부 프레임워크 벤치마크 → 수석 종합(직접 코드 재검증)
> 분석 자체가 이 프로젝트의 `integrity-review.js` 철학("리뷰어 자기보고도 신뢰 대상이 아니다")을 메타 분석에 적용한 결과물이다 — survey 에이전트의 평가를 verify 에이전트가 반박하고, 종합 단계에서 결정적 주장을 다시 실파일로 확인했다.

---

## 0. 한 문장 결론

memoriq 하네스는 **"담론으로만 존재하던 4개 흐름 — SDD의 executable-spec, Hashimoto의 harness engineering, dotzlaw의 결정론적 훅, 멀티에이전트 Verifier 분리 — 을 한 모노레포에 통합해 실제로 굴린 레퍼런스 구현"**이다. 그 **설계 사상(아키텍처 패턴)은 등급 B로 추출 가능**하지만, **현재 구현체(코드)는 등급 C에 가깝게 memoriq의 스택·티켓체계·Claude Code 버전·worktree 정책에 4중 결합**되어 있다. 따라서 추출은 "코드 이식"이 아니라 **"패턴을 코어로 재작성 + memoriq 부분을 어댑터/템플릿으로 분리 + 검증된 구멍 3개의 선(先)수정"**이라는 작업이 된다.

---

## 1. 무엇을 평가했는가 — 하네스 6도메인

memoriq의 "AI 주도 개발 하네스"는 다음 6개 계층으로 구성된다. 각 계층을 독립 에이전트가 실파일 근거로 조사하고, 별도 에이전트가 적대적으로 반박 검증했다.

| # | 도메인 | 핵심 구성요소 |
|---|--------|--------------|
| 1 | **훅/가드 강제 계층** (결정론적 통제) | `.claude/settings.json` PreToolUse 훅 4종, `claude-hook-dispatch.sh`(경로 라우팅 디스패처), `harness-self-mod-guard.sh`(메타가드), `bash-guard.sh`, `_lib/transcript.ts`(세션 증거 추적), 44개 `dev-tools/src/*.ts` 가드, `lefthook.yml`(push 게이트) |
| 2 | **TDD 사이클 + 서브에이전트 오케스트레이션** | `.claude/skills/tdd/SKILL.md`(6단계 계약), 3종 서브에이전트(writer/auditor/implementer), B1/B2/B5 훅 가드 |
| 3 | **Task Ledger 시스템** (측정 가능한 워크플로우 SSOT) | `docs/ledger/*.json`, `outcomes.jsonl`, `ledger-{new,start,work,verify,finish}.ts`, `task-ledger-{schema,guard}.ts` |
| 4 | **docs.db 지식 저장소** | SQLite `node`(1959행) + FTS5 `section_fts` + `edge` VIEW, `docs-{search,add,edit,link,neighbors,show}` CLI, `docs-search-lazy-build.sh`(SessionStart pull) |
| 5 | **컨텍스트 엔지니어링** | `CLAUDE.md`, 21개 `.claude/rules/*.md`(paths 자동 활성화), 6개 skills, `integrity-review.js`/`test-delete-verify.js` 적대검증 워크플로우 |
| 6 | **멀티-하네스 이식성** (Claude Code ↔ pi) | `.pi/extensions/memoriq-guards/`(guard-runner, transcript-adapter), `.pi/agents/`, `AGENTS.md`→`CLAUDE.md` 심링크 |

평가 축 4개를 모든 도메인에 일관 적용했다: **결정론**(프롬프트 의존 vs 훅/게이트 강제), **측정가능성**(효과가 데이터로 추적되는가), **결합도**(범용 가능 vs memoriq 고유), **자가보호**(에이전트가 게이트 자체를 약화시키는 실패 모드를 막는가).

---

## 2. 핵심 발견 — 이 하네스가 잘한 것

### 2.1 "프로즈 룰 → 가드 외부화"라는 일관된 결정론 철학

dotzlaw의 통찰("프롬프트 70-90% 컴플라이언스 vs 훅 100%")이 표어가 아니라 코드 주석에 의도로 박혀 있다:

- `tdd-agent-required.ts:22-23` — "Externalises CLAUDE.md Implementation Workflow §1-§4"
- `tdd-phase-order.ts:9` — "Externalises .claude/skills/tdd/SKILL.md ordering"
- `claude-hook-dispatch.sh:176-177` — pg-aiguide 라우팅이 "Externalises CLAUDE.md Planning Workflow §3"

`.claude/rules/anti-patterns.md:11`은 모든 안티패턴에 `[enforcement: lint|test|measure|rule-only]` 태그를 강제해, **어떤 규칙이 100% 컴플라이언스(lint)로 승격됐고 어떤 것이 아직 프롬프트 의존(rule-only)인지** 데이터로 추적 가능하게 만든다.

### 2.2 같은 가드의 "이중 배선" (편집 시점 + push 시점)

동일한 `dev-tools/src/*.ts` 가드가:
- **편집 시점** — `claude-hook-dispatch.sh`의 `run_guard` 래퍼가 PreToolUse[Edit|Write]에서 호출 (위반이 편집 턴에 즉시 차단, exit 2)
- **push 시점** — `lefthook.yml:75-156`의 `guard-*` 잡들이 회귀 방어막

으로 동작한다. dispatcher 주석(`:17-18`)이 "lefthook pre-push remains the second-line defence (regression layer)"로 역할 분담을 명시한다. `run_guard`는 가드의 exit-1(non-blocking warn)을 PreToolUse exit-2(blocking)로 번역하고 호출마다 ROI 로그를 남긴다(`:59-68`).

### 2.3 transcript 기반 세션-컨텍스트 가드 (`_lib/transcript.ts`)

"X 에이전트/도구가 이 세션에 선행 호출됐나"를 결정론적으로 검사한다. 정교함의 디테일:
- **flush-race bounded retry** — `loadTranscriptWithRetry`가 `Atomics.wait`로 동기 훅에서 폴링(`:103-124`). text 블록 늦은 flush로 false-block이 5/5 발생한 회귀를 역설계.
- **사이드카 meta.json 이중 소스** — `countSubagentMetaInvocations`(`:175-199`)가 신규 하네스 빌드가 메인 JSONL에 Agent 블록을 안 쓰는 회귀에 대응.
- **sudo형 시간제 스킵 토큰** — `userMessageMatchesWithinTtl`(`:315-341`): user 메시지만 매칭(AI가 user 엔트리 합성 불가) + 10분 TTL + **타임스탬프 없으면 fail-closed** + 큐 취소(queue-operation remove) 토큰 무효화.

### 2.4 완료 권한의 "세션 → 하네스" 이전 (Ledger D3 불변식)

`ledger-verify.ts:23-24`: **"Completion authority moves from the session ('I'm done') to the harness ('the actions passed')"**. task의 `verification_actions`(셸 명령)를 러너가 실행해 exit code를 verdict로 삼는다. `passes`/`retries`는 러너만 쓰는 필드(D3)이고 러너는 `fs.writeFileSync`로 훅을 우회하지만, AI가 Edit/Write 툴로 `passes`를 바꾸려 하면 `task-ledger-guard.ts:81-126`이 **waiver 없이 무조건 차단**한다. 자가검증 신뢰 문제(self-verification trust problem)에 대한 정확한 답이다.

### 2.5 재귀적 메타가드 (`harness-self-mod-guard.sh`)

가드 substrate(settings.json, lefthook.yml, dev-tools/src·scripts) 자체를 AI Edit/Write로부터 차단한다. 주석(`:15-17`)이 "Recursion is intentional — 자기약화 시도가 자기를 먼저 발동시킨다"를 명시. 실패 모드 인식이 깊다(`:24-27`): "An AI that hits a self-block in cleanup work has a strong gradient toward fix the guard instead of fix the violation." escape hatch(`HARNESS_SELF_MOD_OK=1`)는 의도적으로 약하되 `.hook-roi.log`에 'bypassed'로 기록되고, "env var 설정도 Bash 호출이라 로깅됨"으로 AI 자가-우회를 (명목상) 봉쇄한다.

### 2.6 측정 가능한 워크플로우 (`outcomes.jsonl`)

**유일하게 살아있는 측정 계층.** 실측 확인: 196 레코드(141 done / 49 doing / 5 parked / 1 todo). `failedAction` 분포 — `stryker-scoped.sh` 19건, `fallow audit --base main` 9건, server vitest 5건, app jest 4건. ledger는 `lead_time_ms`(벽시계 end-to-end)와 `active_elapsed_ms`(순수 코딩시간 Σ)를 분리 측정한다.

### 2.7 에이전트-중립 가드코어 + 얇은 어댑터 (이식성의 실증)

가드 로직을 `dev-tools/scripts/*.sh`에 1벌만 두고 stdin-JSON/exit-2 단일 프로토콜로 표준화한 뒤, pi 어댑터(`guard-runner.ts:5-7,138`)가 그 스크립트를 **0줄 수정으로** 호출한다. `transcript-adapter.ts:321-349`는 pi의 `subagent({agent:'tdd-*'})`를 Claude Code `{name:'Task',subagent_type}`로 합성 인코딩해, transcript 기반 가드(B1)를 포팅 없이 통과시킨다. `AGENTS.md` → `CLAUDE.md` 심링크로 두 에이전트가 컨텍스트 SSOT를 물리적으로 공유한다.

---

## 3. 적대적 검증이 드러낸 것 — 코드로 확인된 5개 결함

> survey 단독 평균 등급은 ★4.7이었다. 적대검증과 직접 재검증을 거쳐 **★3.5**로 보정됐다. 아래 5개는 종합 단계에서 실파일로 직접 재확인한, 의심의 여지가 없는 사실이다.

### (A) 자가보호가 "도구-shaped"라 Bash로 뚫린다 — 가장 심각

`harness-self-mod-guard.sh:50-53`은 `Edit|Write|MultiEdit`만 검사하고 그 외 도구는 `exit 0`이다. `bash-guard.sh`(132줄 전문)는 `LEFTHOOK=`/`core.hooksPath=`/worktree main-push만 차단할 뿐, **harness 파일에 대한 `sed -i` / heredoc redirect / `tee` / `printf >`는 한 줄도 검사하지 않는다.** 즉:

```bash
sed -i 's/exit 2/exit 0/' dev-tools/src/tdd-agent-required.ts
```

같은 Bash 한 줄로 메타가드 자신을 포함한 모든 가드를 무력화할 수 있다. "Recursion is intentional"은 **Edit-tool 경로에서만 참**이며, 가장 흔한 우회 벡터에 구멍이 있다.

### (B) 완료 권한 이전은 `passes`에만 물리적, 게이트가 읽는 `status`는 무방비

`task-ledger-guard.ts`는 `passes`/`retries`만 차단한다. 그런데 `ledger-finish.ts:18-21`은 머지 핸드오프 readiness를 **`task.status`만으로** 판정하고, `status`는 어떤 가드도 차단하지 않는다(스키마 정합성 검사에도 `passes↔status` coherence 없음). 세션이 `Edit`로 `"status": "done"`을 직접 써넣으면 `passes:false`라도 게이트가 ready로 통과한다. 현재 실데이터에 drift가 없는 것은 **"하네스가 막아서"가 아니라 "규율(프롬프트)이 막고 있어서"**다. 완료 권한 이전은 한 필드에 대한 진실이지 완료 판정 전체에 대한 진실이 아니다.

### (C) "프로즈를 가드로 외부화(제거)" 주장은 거짓 — 실제로는 이중화

`claude-hook-dispatch.sh:176-177`은 "the prose rule is removed in S8"이라고 단언하지만, `CLAUDE.md:106, :136`에 pg-aiguide/context7 강제 규칙이 그대로 살아 있고 가드들이 오히려 그 프로즈를 역참조한다. dotzlaw 패턴은 "대체"가 아니라 **"프로즈 + 훅 병존(dual-encoding)"**으로 구현됐고, S8 주석은 stale하다. (이 사실 주장 자체의 오류를 survey가 놓쳤다 — "의도가 주석에 박혀 있다"는 표어는 맞지만, 그 주석의 사실 주장이 틀렸다.)

### (D) 측정 인프라는 설계만 있고 실측값이 0건

직접 확인:
- `.hook-roi.log` — **부재** (gitignored, 디스크에 없음)
- `.docs-search.log` — **부재**
- `outcomes.jsonl` — 196행 실재 (유일하게 살아있는 측정)
- `lead_time_ms` — ~13개(최근) ledger만 채워지고 ~26개(구) null

즉 "가드 ROI 텔레메트리(signal vs theatre / dead-guard 판별)"·"검색 효과 추적"은 **코드는 있으나 한 줄도 수집되지 않았다.** `hook-roi-log.sh` 헤더 스스로 "머신 간 집계는 Wave 1 범위 밖"이라 자인한다. 데이터 없는 텔레메트리는 그 자체로 theatre 위험이다. **수집 ≠ 활용** — 살아있는 `outcomes.jsonl`조차 lead-effort 격차를 PRD 스코프 보정에 환류한 폐루프 산출물이 없다.

### (E) 지식 그래프는 데이터 층에서 사실상 미사용

실측: 1959 노드 / 429 엣지인데, 양방향 합산으로 엣지에 참여하는 노드가 18.5%(362개)뿐 — **81.5%가 완전 고립**이다. 엣지의 95%(409/429)가 generic `related`이고 의미적 관계(`refines` 16, `supersedes` 4)는 거의 없다. survey가 "진짜 그래프"라 광고하고 외부 벤치마크도 "단순 파일 기반과 질적으로 다름"이라 평가했지만, **실질 가치는 거의 전적으로 FTS5 검색에 있고 그래프는 장식**이다. 이 고립률은 관계 authoring을 강제하는 결정론 훅이 없고 dev-log/adr SKILL의 산문 규율(프롬프트-의존)에만 의존한 결과 — 정확히 dotzlaw 70-90%→100% 갭의 실패 증거다.

### 기타 확인된 위생 결함

- **ADR SKILL drift** — `adr/SKILL.md:38-39`의 next-ID 조회 스니펫이 `WHERE kind='doc'`/`SELECT id`를 쓰는데, 실제 `node` 스키마에 `kind`도 `id`도 없다(실행 시 Parse error). 스킬과 스키마가 drift.
- **area 메타데이터 결손** — 788/1959(40%)가 빈 area. 단 dev-log(0.6%)·adr(0%)는 사실상 완전하고 결손은 prd·research에 집중.
- **content 원자성 분산** — 평균 998자(원자적)이나 max 67775자 row가 존재(원자성 위반), median은 612자.
- **pi 자가보호 비대칭** — `harness-self-mod-guard.sh`의 보호 표면에 `.pi/extensions/` 어댑터와 `.pi/agents/`가 없다. 두 번째 하네스의 게이트는 에이전트가 자유롭게 약화 가능하고, pi 경로는 ROI 로깅도 0.
- **verbatim 동기화 깨짐** — `.pi/agents/*.md`가 `.claude/agents/`에서 "system prompt body verbatim"으로 생성된다는 문서 주장(`tdd-subagents-workflow.md:15`)과 달리, 실제로는 Glob→find, Read→bash 같은 도구 차이를 본문에 반영(9.7K→10.1K). 수동 재생성이라 drift가 구조적.

### 도메인별 등급 재조정

| 도메인 | survey | verify | 재검증 | 핵심 깎임 사유 (검증된 것만) |
|---|---|---|---|---|
| hooks-guards | ★5 | ★4 | **★4** | 자가보호 도구-shaped (Bash 우회), "프로즈 제거" 거짓 |
| tdd-cycle | ★5 | ★4 | **★4** | B5는 순서 아닌 존재만, B2는 헤더만 검사, 측정 0 |
| ledger | ★5 | ★4 | **★3.5** | 완료권한 이전이 `passes`에만, `status` 무방비; `risk`는 dead metadata |
| knowledge-db | ★4 | ★3 | **★3** | 그래프 사실상 미사용, 측정 미가동, ADR 스킬 drift |
| skills-rules-context | ★5 | ★4 | **★4** | 태그 회계가 전체 강제표면(44가드)의 1/3만 포착, 효과 미측정 |
| pi-portability | ★4 | ★3 | **★3** | "0줄 이식"은 어댑터가 비용 흡수, 운영 검증 0, 자가보호 비대칭 |

**종합 가중 등급: ★3.5** — 설계는 우수하나 측정·자가보호·이식성의 실증이 주장에 미달한다.

---

## 4. 외부 프레임워크 지형에서의 위치

| 프레임워크 | 무엇을 표준화했나 | memoriq와의 겹침/차이 |
|-----------|----------------|---------------------|
| **GitHub Spec Kit** | requirements/plan/tasks.md를 에이전트-중립 스펙 포맷으로, install 가능한 툴킷 | memoriq의 PRD→ledger 흐름과 직접 겹침. **차이**: Spec Kit은 마크다운이 SSOT, memoriq는 PRD(.md)→ledger(JSON, 기계검증)로 한 단계 더 경화 + `verification_actions` 자동주입. **단 Spec Kit은 install 가능, memoriq는 `"private": true`로 설치 경로 전무** |
| **SDD 담론** (arXiv 2026-02, EARS, Coordinator/Implementor/Verifier) | "executable spec = SSOT", EARS notation, 멀티에이전트 역할 분리 | `/tdd` 사이클이 Implementor/Verifier 분리를 구현하고, VALIDATE를 `ledger:verify` 러너에 위임해 Verifier를 결정론으로 강제. **갭**: EARS 같은 표준 spec notation 부재(grep 0건) |
| **Harness Engineering** (Hashimoto / 逆瀬川 2026-03) | "시스템이 모델보다 중요" — AGENTS.md 지속개선 + 자가검증 툴체인 (철학 수준) | memoriq 전체가 이 담론의 실전 구현. Hashimoto가 철학으로 남긴 것을 hook+guard+ledger로 기계화 |
| **Claude Code Hooks** (dotzlaw) | PreToolUse/PostToolUse/SessionStart 결정론 통제 (메커니즘만) | memoriq의 핵심 결정론 계층. 4종 PreToolUse 매처를 풀스택 적용 |
| **Cursor rules / Codex AGENTS.md / Aider** | 프로젝트별 규칙 파일 (확률적 프롬프트 주입) | `.claude/rules/*` + CLAUDE.md가 해당. **차별점**: 검증 가능한 규칙은 lint 가드로 승격 |
| **Ralph loop** | 동일 프롬프트 반복 자율 루프 (무상태) | `pnpm work→/tdd→verify→finish`가 goal-driven loop. **차이**: ledger(retries, outcomes.jsonl)로 상태·측정 동반 |

### memoriq만의 고유 기여 4가지 (외부 프레임워크에 부재)

1. **harness-self-mod 메타가드** — 가드 substrate 자체를 보호하는 재귀적 자가보호 (단 §3-A 구멍 수정 필요)
2. **"강제(enforcement) 계층 중립"** — Spec Kit의 "스펙 포맷 중립"을 넘어, 같은 가드를 두 에이전트가 공유 (단 진짜 중립 IR로 승격 필요)
3. **완료권한을 러너로 이전한 D3 불변식** — Verifier 분리를 신뢰 아닌 기계로 (단 `status`까지 확장 필요)
4. **신규-위반-only 트리거** — 디스크 pre-state 대비 새 위반만 차단, baseline 부채 비차단. 게이트 채택 시 기존 부채로 전 작업이 막히는 채택 실패를 정면 회피하는 **incremental adoption** 해법

---

## 5. 추출 가능성 3등급 판정

> **(A) 거의 그대로** / **(B) 일반화 후 추출 가능** / **(C) memoriq 고착, 템플릿화하거나 버림**

### 등급 A — 패턴이 곧 코드, 거의 그대로

- **3계층 강제 모델** (deny → PreToolUse hook → push lefthook) + 역할분담 — 단 `defaultMode:bypassPermissions` 전제는 어댑터화
- **dispatcher + run_guard 래퍼** (exit-1→exit-2 + ROI 로깅) — 도메인 무관
- **sudo형 시간제 스킵 토큰** — escape-hatch 범용 템플릿 (단 transcript 스키마 결합 → 어댑터 뒤로)
- **신규-위반-only 트리거** — incremental adoption의 핵심
- **fail-open/fail-closed 위반유형별 분기** — 일률 "안전 기본값"이 아닌 비용 축별 판단

### 등급 B — 일반화/재작성 후 추출 가능

- **transcript-as-evidence 가드** — Claude Code JSONL 스키마를 canonical 인터페이스 뒤로 숨기고 에이전트별 어댑터
- **가상 post-state 계산** — Edit/Write 페이로드 파서를 어댑터화
- **TDD 6단계 계약 + 도구권한 분리 + AUDIT-before-GREEN** — 에이전트 런타임별 재구현, B5에 timestamp 순서비교 추가 권장
- **완료권한 이전** — `status`까지 보호 표면에 포함시켜야 완결
- **exit-code-as-verdict** — scope→명령 매핑을 설정주입형으로(현재 jest/vitest/fallow/esbuild 하드코딩)
- **row-first 지식모델 + 식별자-heavy FTS5 튜닝** — doc_type/area enum, ticket regex를 config로
- **로컬 SQLite 저장 (본질) + 선택적 동기화 채널 (우연)** — 저장소는 항상 로컬, 동기화는 `SyncChannel` 어댑터로 기본 OFF. memoriq의 S3는 여러 동기화 구현 중 하나일 뿐 (§6.4 개선 ⑥)
- **가드코어↔어댑터 분리** — 단 "0줄 이식"은 어댑터가 Claude Code를 에뮬레이트한 것이므로 진짜 중립 IR로 재설계 필요
- **컨텍스트 SSOT 공유** (심링크 + rules 런타임 직접읽기) — 에이전트 정의는 심링크 불가라 오버레이 구조로
- **enforcement 태그 체계** — 메타패턴만 범용
- **멀티에이전트 적대검증 + 비가역행위 게이트** — 입력 SSOT(seam registry)는 도메인 고유

### 등급 C — memoriq 고착, 버리거나 템플릿화

- **개별 도메인 가드 다수** (drizzle/expo/i18n/hardcoded-hex/companion/python-venv) — 추출 대상은 가드 카탈로그가 아니라 "가드를 호출하는 프로토콜"
- **ripple table = seam registry** — 펫미디어/구독 도메인 고유, 추출하면 빈 껍데기
- **`risk` 분류 → 라우팅** — 적대검증 확인: `risk`는 어디서도 read 안 되는 **dead metadata**
- **티켓 스킴** (T-YYMMDD[a-z] / MQ-NNN) + 파일명 regex 4개 CLI 중복
- **worktree wave-merge 게이트** (`memoriq-wt-*` 리터럴)
- **PRD 한국어 컬럼 파싱** — 외부 벤치마크가 지목한 "EARS 표준 notation 부재"와 직결
- **dev-tools 패키징** — `"private": true`, 설치 경로 전무 ("레퍼런스 구현" 가설의 최대 약점)

---

## 6. 심화: 지식 기록 시스템 (설계결정 / 시행착오 / PRD) 평가 & 추출 개선

> 도메인 3(ledger)과 도메인 4(docs.db)를 가로지르는 교차 분석. 핵심 통찰은 **ledger의 작업 측정 신호(retries/risk)와 docs.db의 지식 기록을 잇는 것** — memoriq는 둘을 별개로 두지만, "무엇이 기록될 가치가 있는가"는 ledger가 이미 알고 있다.

### 6.1 기록 시스템의 구조 — 4종 문서 × 라이프사이클

memoriq의 "개발 과정 기록 시스템"은 4종 문서 타입과 각각의 라이프사이클로 구성된다. 철학은 **"code shows *what*, dev-logs show *how*, ADRs explain *why*"**(adr SKILL 인용) — 코드/dev-log/ADR이 세 층위로 지식을 분담한다.

| 타입 | 무엇을 기록 | 라이프사이클 | 작성 규율 |
|------|-----------|------------|-----------|
| **prd** | 기획/티켓/핫픽스 계획 | 작업 중 `docs/prd/*.md` 파일 → 완료 시 `docs:add` 아카이브 + `git rm` | `/prd` 스킬 |
| **dev-log** | 시행착오·삽질·비자명한 통찰 | 처음부터 docs.db row (파일 없음) | `/dev-log` (search-first → 중복이면 edge case만 + `docs:link`) |
| **adr** | 되돌리기 어려운 설계 결정의 *왜* | worktree에선 `_draft/*.md`(id TBD) → merge 세션에서 ID 할당+ingest | `/adr` (draft→promote 게이트) |
| **research** | 진행 중 조사 | gitignored scratch → 사용자 요청 시만 아카이브 | (수동) |

### 6.2 잘 설계된 점 (검증됨)

1. **search-first 중복 방지 규율** — dev-log 스킬이 "새 row 쓰기 전 `docs:search` → 기존 row가 invariant를 담으면 edge case만 별도 row + `docs:link`, 부정확하면 `docs:edit` in-place 수정"을 의무화. near-duplicate 오염 방지 의도 명확.
2. **ADR draft→promote 게이트** — worktree에서 `_draft/`(id TBD) staging, merge 세션에서만 sequential ID 할당 → **병렬 worktree 간 ID 충돌을 구조적으로 방지**.
3. **PRD 라이프사이클의 깔끔한 상태 전이** — 실측: 활성 PRD 파일 9개 vs 아카이브된 prd doc 73개. "작업 중엔 파일(편집 쉬움), 완료되면 docs.db(검색 가능)"가 실제로 작동.
4. **타입별 역할 구분이 enum으로 강제 + 분포 건강** — dev-log 644 / prd 511 / research 498 / adr 306. 어느 타입도 죽지 않음.

### 6.3 검증된 약점 (추출 시 복제하면 안 되는 것)

#### (A) 쓰기 *형식*만 강제하고 쓰기 *행위/내용*은 비결정론
`dev-log-frontmatter.ts`는 4가지만 검사한다: `no-frontmatter`/`parse-error`/`missing-area`/`insufficient-tags`(tags≥2). 즉 **"area와 tags 2개가 있는가"라는 형식**만 본다. 정작:
- **"애초에 dev-log를 작성했는가"** → 전혀 강제 안 됨. `/dev-log`는 description 매칭(확률적)으로만 트리거.
- **"내용이 진짜 통찰인가 요식행위인가"** → 검사 불가.
- **`docs:link`로 관계를 달았는가** → 가드 없음.

정확히 dotzlaw 70-90% 갭. `/tdd`는 PreToolUse 훅으로 결정론 강제되는데 **지식 기록은 산문 규율(스킬 description)에만 의존**한다.

#### (B) 그래프 연결성 사실상 실패 — 81.5% 고립, ADR-티켓 단절
- **81.5% 고립** (1959노드 중 362개만 엣지 참여). 엣지 95%가 generic `related`, `supersedes`는 단 4개.
- **ADR 306개 *전부* `ticket=''`** — 설계 결정이 어느 티켓/ledger 작업에서 나왔는지 구조적 추적이 끊김. dev-log는 36%(233/644), research는 6%(32/498)만 ticket 연결.
- 결과: **"이 ADR이 왜 나왔지? → 그 티켓의 PRD → 그 시행착오 dev-log" 같은 인과 추적이 불가능.** `docs:neighbors`는 코퍼스의 1/5에서만 의미 있다.

#### (C) 측정 미가동 — 어느 지식이 실제로 읽히는지 모름
`.docs-search.log`(검색 텔레메트리)가 디스크에 부재. **"고립된 1693개 노드가 한 번이라도 검색돼 의사결정을 바꿨는가"를 답할 데이터가 0.** 코퍼스 품질 자가평가 루프가 없다.

#### (D) 스킬-스키마 drift
`adr/SKILL.md`의 next-ID 조회가 `WHERE kind='doc'`/`SELECT id`를 쓰는데 실제 `node` 스키마엔 `kind`도 `id`도 없음(실행 시 Parse error). 기록 워크플로우의 자동화 스니펫이 깨져 있다.

#### 종합 평가
**docs.db는 "탁월한 검색 가능 저장소(★4)이되 연결된 지식 그래프(★2)는 아니다."** 강점은 전부 검색/저장 인프라(row-first, FTS5 튜닝, S3 동기화, 라이프사이클 분리)에, 약점은 전부 지식 *그래프*로서의 기능(연결성·인과 추적·측정)에 있다. 가중 ★3.

### 6.4 추출 개선 설계 — `kb-engine` + `knowledge-graph` 모듈

추출 원칙: **memoriq의 강점(검색)은 등급 B로 그대로, 약점(그래프·강제·측정)은 추출 *시점에 구조적으로* 메운다.** 약점을 그대로 복제하면 안 된다.

**개선 ① 쓰기 *행위*를 결정론 강제 — "지식 부채 가드"**
ledger와 docs.db를 연결하는 새 가드. "무엇이 기록될 가치가 있는가"를 ledger가 이미 안다 — `retries`가 높았던 task(삽질 증거)나 `seam` risk task(설계 결정)는 dev-log/ADR 대상이다.
```
[knowledge-debt-guard]  (코어, finish 게이트 또는 PreToolUse[Agent|Task])
  ledger task가 risk='seam' 이거나 retries >= CAUTION_THRESHOLD 인데
  그 ticket에 연결된 dev-log/adr row가 0건이면
    → finish 게이트에서 경고(soft) 또는 차단(hard, config 선택)
```
memoriq는 이 신호를 갖고도(`outcomes.jsonl`에 retries 실측) 기록 강제에 안 쓴다. 추출 시 둘을 잇는다.

**개선 ② 그래프 연결을 ingest 시점에 강제 + 자동 추론**
- **(a) ingest-time link 요구** — `docs:add` 시 같은 ticket/area의 기존 row가 있는데 link가 0개면 "최소 1개 관계 또는 `--no-link` 명시" 요구.
- **(b) 자동 관계 추론 (memoriq엔 없음)** — 같은 `ticket`의 prd↔dev-log↔adr를 자동 `related` 연결(ticket 있는 658개 즉시 가능). 같은 area에 새 ADR ingest 시 "기존 ADR을 supersede하나?"를 LLM 질의(supersedes가 4개뿐 = 결정 진화 추적 부재).
- **(c) ADR↔ticket 연결 복구** — `/adr`가 ID 할당 시 현재 ledger ticket을 frontmatter에 자동 주입. 306개 단절 원인은 "ADR이 merge 세션에서 ingest될 때 원 ticket 컨텍스트 유실" → draft frontmatter에 ticket을 박아 promote까지 보존.

**개선 ③ 측정을 1급 시민으로 — "지식 ROI 루프"**
`.docs-search.log`를 gitignore 로컬에서 집계 가능 텔레메트리로 승격:
```
[kb-telemetry]  (코어)
  검색마다: query / hit_count / top_score / clicked_public_id
  주기 집계:
    - dead knowledge: 90일간 0회 검색된 row → 아카이브/병합 후보
    - hot topics: 반복 검색 query → 누락된 dev-log 신호
    - FTS-miss: hit=0 query → 코퍼스 갭
```
memoriq가 설계했지만 가동 안 한 "signal vs theatre" 판별을 지식 저장소에 적용. **"쓰인 지식이 실제로 읽히는가"를 데이터로 닫는 폐루프** — 추출 프레임워크의 차별점.

**개선 ④ 검색 인프라는 등급 B로 거의 그대로 (config 역전만)**

| 가져갈 것 (등급 B) | memoriq 결합 → config 역전 |
|------------------|--------------------------|
| row-first 모델 (## H2 = 원자 토픽, public_id 앵커) | `doc_type` enum → `config.docTypes` |
| 식별자-heavy FTS5 튜닝 (tokenchars `-_` + phrase quote) | 거의 그대로 (A급) |
| AND-first → OR recall 폴백 | 그대로 |
| **로컬 SQLite 저장** (검색 가능 + 단일 파일 + 트랜잭션) | **본질적 — 코어. 이게 저장소다** |
| ETag 낙관적 동시성 + lazy pull | **우연적 — 동기화 채널. 어댑터 옵션, 기본 OFF** (개선 ⑥) |
| 라이프사이클 분리 (작업 중 파일 → 완료 시 DB) | ticket regex → `config.ticketPattern` |

**개선 ⑤ 스킬-스키마 계약 테스트**
스킬 내 SQL 스니펫을 CI에서 실행 검증. `adr/SKILL.md`가 깨진 채 방치된 건 "스킬은 산문이라 테스트 안 됨"이기 때문 → 추출 프레임워크는 스킬 내 실행 가능 명령을 스냅샷 테스트.

**개선 ⑥ 저장소 ⊥ 동기화 분리 — 로컬 기본, 클라우드는 선택 어댑터**
memoriq가 docs.db를 S3(`bfai-pulumi-state`)에 둔 것은 **"이미 Pulumi state 버킷이 있으니 재사용"이라는 우연적 인프라 상황**이지, 지식 저장소가 본질적으로 S3를 요구하기 때문이 아니다. 실제로 memoriq조차 이미 **로컬-우선**이다 — S3는 항상 로컬로 *pull*된 뒤 그 로컬 SQLite를 쿼리하고(`docs-search-lazy-build.sh`), `DOCS_S3_SYNC=0`이면 오프라인 graceful degrade한다. 즉 S3는 "저장소"가 아니라 **"여러 머신/세션이 같은 docs.db를 공유하는 동기화 채널"**일 뿐이다.

추출 프레임워크는 이 숨은 두 계층을 명시적 경계로 분리한다:

| 계층 | 본질/우연 | 추출 후 |
|------|----------|--------|
| **저장소** (로컬 SQLite 파일 + FTS5 + 트랜잭션) | 본질적 | **코어. 항상 로컬. 동기화 없이도 완전히 동작** |
| **동기화 채널** (여러 머신 간 같은 KB 공유) | 우연적 | **선택적 어댑터. 기본 OFF (1인/1머신은 불필요)** |

```typescript
// 코어가 의존하는 유일한 동기화 추상 (구현 미포함)
interface SyncChannel {
  pull(localDbPath: string): Promise<'updated' | 'noop' | 'offline'>   // 세션 시작 시 best-effort
  push(localDbPath: string, mutate: (db) => void): Promise<void>        // 낙관적 동시성 + 멱등 재적용
}
// 기본값: NoopSync (로컬 전용). 동기화를 켜면 어댑터 하나를 주입:
```

| 어댑터 | 대상 팀 | 동시성 메커니즘 |
|--------|--------|----------------|
| `NoopSync` (**기본**) | 1인/1머신 | 없음 — 로컬 파일이 SSOT |
| `adapter-sync-git` | 소규모, 이미 git 쓰는 팀 | docs.db를 git LFS/브랜치로 — 인프라 0, merge는 "last-write + 재ingest" |
| `adapter-sync-s3` / `-gcs` / `-r2` | 클라우드 팀 (memoriq 경로) | ETag/generation 낙관적 동시성 (현 `withRemoteWrite` 패턴) |
| `adapter-sync-nfs` / `-shared-fs` | 온프렘 공유 볼륨 | 파일 락 |

핵심은 **memoriq의 `awsCliS3Ops`가 코어가 아니라 여러 `SyncChannel` 구현 중 하나로 강등**된다는 것이다. 코어는 "동기화가 존재하는지"조차 모르고 — `SyncChannel`이 주입되지 않으면 그냥 로컬 SQLite를 읽고 쓴다. 이것이 §6.0의 "본질적 vs 우연적 결합" 원칙을 저장 계층에 적용한 형태다: **"docs.db는 SQLite 파일이다"는 본질, "그 파일이 S3에 산다"는 우연.**

이 분리는 채택 장벽도 낮춘다 — Spec Kit처럼 `npx create-harness`로 부트스트랩한 팀이 AWS 계정·Pulumi·버킷 설정 없이 **즉시 로컬에서 전체 하네스를 돌릴 수 있고**, 팀이 커져 공유가 필요해질 때만 동기화 어댑터를 켠다. memoriq의 현 구조는 S3 자격증명이 없으면 graceful degrade는 하되 "S3가 기본 전제"라 외부인에게 진입 마찰이 된다.

### 6.5 핵심 차별점 요약

| 축 | memoriq 현재 | 추출 후 목표 |
|----|------------|------------|
| 쓰기 강제 | 형식만(frontmatter), 행위는 확률적 | **ledger 신호(retries/seam) 기반 결정론 부채 가드** |
| 그래프 연결 | 81.5% 고립, ADR-티켓 단절 | **ticket 기반 자동 엣지 + ingest-time link 요구 + supersedes 추론** |
| 측정 | `.docs-search.log` 미가동 | **dead/hot knowledge 폐루프** |
| 검색 인프라 | 우수하나 memoriq 결합 | **그대로 + config 역전** |
| 저장/공유 | S3가 기본 전제 (진입 마찰) | **로컬 기본, 동기화는 선택 어댑터 (git/s3/gcs/nfs)** |

가장 중요한 통찰: **ledger(작업 측정)와 docs.db(지식 기록)를 잇는 것.** "삽질한 작업은 반드시 dev-log를, 설계 결정 작업은 반드시 ADR을 남기되, 그것이 원 티켓과 자동 연결되는" 닫힌 루프가 핵심 개선이다. 이 모듈들(`kb-engine` + `knowledge-graph` + `knowledge-debt-guard` + `kb-telemetry`)은 §8 아키텍처의 `kb-engine` 코어를 구체화한 것이다.

---

## 7. 실제 목표 재정의 — dogfooding 우선 개인 템플릿

> **중요**: 이 리포트의 §5·§6·§8은 "memoriq 하네스를 *제품/프레임워크로* 추출할 수 있는가"라는 렌즈로 쓰였다. 그러나 실제 1차 목표는 **본인의 dogfooding + 다음 프로젝트에서 재사용할 범용 템플릿**이다. 이 렌즈에선 시장·ICP·카테고리·수요 입증 같은 제품 고민이 전부 무의미해진다 — 사용자는 한 명(본인)이고, 추측 리스크가 0이며, 최적화 대상이 "시장 적합성"에서 **"재사용 마찰 + 점진 도입성"**으로 바뀐다.

### 7.1 설계 원칙 3가지 (제품형과 다름)

1. **독립 4패키지 + 얇은 코어** — `@harness/core`(프로토콜 + config 로더 + transcript 인터페이스, 최소) 위에 `guard`/`ledger`/`kb`/`verify`를 **각각 독립 설치 가능한 패키지**로. 새 프로젝트에서 필요한 것만 `pnpm add`. "전부 아니면 전무"가 아니라 한 조각씩.
2. **사후 도입 가능 (pluggable)** — 프로젝트 *시작 시점*에 다 깔 필요 없이, 진행 중 아무 때나 `@harness/kb` 하나를 추가해도 기존 동작을 깨지 않는다. 각 패키지는 `core`에만 의존하고 서로를 모른다(횡적 의존 금지).
3. **풀 프레임워크가 아니라 작은 코어 + pluggable** — 제품형(§8)의 7개 코어 모듈을 통째로 짓는 대신, 코어는 "디스패처 + config + 플러그인 인터페이스"로 최소화하고 4대 기능은 그 위의 플러그인으로.

### 7.2 다언어(TS/Python/Go)는 이미 절반 해결돼 있다

본인이 TS·Python·Go를 쓰고, **memoriq는 이미 `apps/pipeline`(Python)을 같은 하네스로 굴리고 있다.** 코드를 보면 다언어 대응이 두 계층에서 **비대칭적으로** 존재한다:

| 계층 | 현재 상태 | 추출 작업 |
|------|----------|----------|
| **검증 *실행*** (ledger `verification_actions`) | **이미 언어 중립** — 그냥 셸 문자열이라 `pnpm exec vitest`든 `.venv/bin/python -m pytest`든 동일하게 exit code로 판정. `outcomes.jsonl`에 pytest 실측 2건 + lambda splits-worker `.venv/bin/python -m pytest` 6건 존재 | **거의 공짜** — exit-code-as-verdict가 본질적으로 언어 무관 |
| **검증 *명령 생성*** (`ledger-new.ts:202 baselineFor`) | **TS 하드코딩** — `apps/app→jest, 그 외→vitest`만 알고 pytest/go test는 모름 | **config 주입으로 역전** (아래) |
| **production 경로 라우팅** (`tdd-agent-required.ts:46-59`) | **Python을 예외로 땜질** — `apps/pipeline/(ml|api).py`를 명시 패턴으로 추가했으나 주석이 "harness gap"이라 자인. 다언어를 1급이 아니라 사후 패치로 다룸 | **언어별 production glob을 config로** |

즉 **다언어는 "실행"에선 이미 준비됐고, "생성·라우팅"에서만 config화가 필요**하다. memoriq가 Python을 예외로 땜질한 바로 그 지점이, 템플릿에선 1급 config가 되어야 할 곳이다:

```typescript
// harness.config.ts — 언어를 1급으로 (memoriq의 baselineFor TS 하드코딩을 역전)
export default defineHarness({
  languages: {
    ts:     { productionGlob: '**/src/**/*.{ts,tsx}', testCmd: (scope) => `pnpm -F ${pkg(scope)} test` },
    python: { productionGlob: 'apps/*/{ml,api}/**/*.py', testCmd: (scope) => `cd ${dir(scope)} && .venv/bin/python -m pytest` },
    go:     { productionGlob: '**/*.go',                 testCmd: (scope) => `go test ./${dir(scope)}/...` },
  },
})
// 코어는 "vitest"도 "pytest"도 모른다 — 셸 문자열을 받아 exit code만 본다.
```

**검증 기준**: 코어/ledger 패키지에 `vitest`·`pytest`·`go` 문자열이 단 한 번도 등장하지 않는다(언어 어휘는 전부 config). 이건 §6.0의 "본질(exit-code 판정) vs 우연(그 명령이 pytest다)" 분리를 언어 축에 적용한 것이다.

### 7.3 격리해야 할 두 축 — 언어(config) ⊥ 에이전트(adapter)

dogfooding 템플릿에서 코어가 모르고 있어야 할 것이 두 개의 직교 축으로 갈린다:

- **언어 축** → `harness.config.ts` (TS/Python/Go의 테스트 명령·production glob·린트). 1인 결정이라 추측 리스크 0 — 본인이 쓰는 3언어만 채우면 됨.
- **에이전트 축** → `adapter-*` (Claude Code / pi / 향후). transcript 스키마·도구 페이로드 결합. **이게 영구 유지보수 부채의 핵심**(memoriq `.pi/` 19커밋이 실증)이므로 어댑터 한 곳에 가둠.

이 둘이 직교라는 게 중요하다 — Python 프로젝트를 Claude Code로 하든 pi로 하든, 언어 config와 에이전트 adapter는 독립적으로 조합된다. memoriq는 이 둘이 dev-tools 안에서 뒤섞여 있어 `tdd-agent-required.ts`가 *경로(언어)*와 *transcript(에이전트)*를 한 파일에서 다룬다 — 템플릿에선 분리한다.

### 7.4 dogfooding에 맞춘 우선순위 — "내가 다음 프로젝트에서 제일 먼저 깔 것"

제품형 로드맵(§10)은 수요 입증·canonical IR 같은 *추측성 미래*를 포함하지만, dogfooding은 **본인이 실제로 가장 먼저·자주 쓸 것** 순서다:

| 순위 | 패키지 | 이유 (dogfooding 관점) | memoriq에서 이식 난이도 |
|------|--------|----------------------|----------------------|
| 1 | `@harness/core` + `@harness/guard` | 새 프로젝트 첫날 "AI가 헛짓 못 하게" 거는 가드가 가장 즉효. self-mod 메타가드 포함 (단 §3-A Bash 구멍 선수정) | 中 — 프로토콜은 깨끗, 도메인 가드는 버리고 예시만 |
| 2 | `@harness/kb` (검색만, 로컬 SQLite, 동기화 OFF) | 두 번째 프로젝트부터 "지난 프로젝트 dev-log 검색"이 복리로 가치. 로컬 기본이라 셋업 0 (§6.4 개선 ⑥) | 低 — row-first + FTS5는 등급 B, config 역전만 |
| 3 | `@harness/ledger` | TDD 규율을 강제하고 싶을 때. 단 PRD/티켓 워크플로가 있어야 가치 — 가벼운 개인 프로젝트엔 과할 수 있음 | 高 — baselineFor 다언어화 + status 누수(§3-B) 선수정 |
| 4 | `@harness/verify` | 멀티에이전트 적대검증. 가장 무겁고 가장 가끔 씀(wave merge급) — 마지막 | 高 — seam-registry 의존, 개인 프로젝트엔 대개 과함 |

**핵심 통찰**: dogfooding 순서에서 `ledger`와 `verify`가 뒤로 밀린다는 건 의미심장하다 — 이 둘은 **memoriq의 규모(다중 워크트리·wave merge·팀 워크플로)에 맞춰 설계된 것**이라 1인 프로젝트에선 종종 과하다. 반대로 `guard`와 `kb`는 프로젝트 규모와 무관하게 즉시 가치를 낸다. 즉 **"4대 기능을 독립 패키지로 쪼개라"는 본인의 직관이 정확히 옳다** — 넷을 묶으면 작은 프로젝트가 ledger/verify의 무게까지 떠안지만, 쪼개면 guard+kb만 가볍게 시작할 수 있다.

---

## 8. 추출 전략 — 코어 / 어댑터 / 템플릿 (제품형 참고 아키텍처)

의존성은 **항상 안쪽(범용 코어) → 바깥(도메인) 방향이 금지**되어야 한다. 코어는 memoriq를 모른다.

```
┌─────────────────────────────────────────────────────────────┐
│  @harness/core  (등급 A·B 패턴, 도메인·에이전트 무지)          │
│  • guard-protocol   : stdin-JSON / exit-2 / run_guard 래퍼     │
│  • transcript-iface : CanonicalTranscript 인터페이스 +        │
│                       findSubagentInvocations / TTL waiver /   │
│                       virtual-post-state (Claude 스키마 제거)  │
│  • ledger-engine    : exit-code-as-verdict 러너 +             │
│                       runner-owned 필드(passes+retries+STATUS)│
│                       + outcomes append + lead/effort 측정     │
│  • meta-guard       : self-protection (도구+경로 BOTH 차단)   │
│  • roi-telemetry    : append-only TSV + 집계 CLI(필수 신설)    │
│  • kb-engine        : row-first parser + FTS5 튜닝 +          │
│                       knowledge-graph + debt-guard (§6.4)      │
│                       로컬 SQLite (저장소) — 동기화 무지       │
│  • verify-workflow  : 적대검증 오케스트레이터(confidence≥N)   │
└──────────────────────────────△──────────────────────────────┘
                               │ depends on (단방향)
┌──────────────────────────────┴──────────────────────────────┐
│  @harness/adapter-*   (런타임/인프라 결합을 코어 뒤로 숨김)    │
│  • adapter-claude-code : PreToolUse 페이로드 ↔ canonical       │
│  • adapter-pi          : pi subagent ↔ canonical              │
│  • sync(선택) : SyncChannel 인터페이스 — 기본 OFF(로컬 전용)   │
│      adapter-sync-s3 / -gcs / -r2 / -git / -nfs ...           │
│      (memoriq의 awsCliS3Ops는 이 중 한 구현일 뿐)             │
└──────────────────────────────△──────────────────────────────┘
                               │ scaffolds into (템플릿)
┌──────────────────────────────┴──────────────────────────────┐
│  create-harness  (등급 C를 템플릿·config로 외부화)            │
│  • harness.config.ts : ticket-regex, doc-type/area enum,      │
│                        production-path glob, scope→cmd 매핑,   │
│                        worktree 네이밍, seam-registry 경로     │
│  • guards/_examples/  : drizzle/expo/i18n 가드를 예시로만      │
│  • rules/_template/   : enforcement 태그 규약 + 빈 ripple table│
└─────────────────────────────────────────────────────────────┘
```

**버릴 것**: `risk` 필드→라우팅(dead metadata), verbatim 에이전트 정의 동기화(이미 깨짐 → 공통 프롬프트 + 어댑터별 도구섹션 오버레이로), 태그 회계를 강제표면 SSOT로 쓰는 것(dev-tools에 44개 가드인데 lint 태그는 8건 → "배포된 가드 = SSOT, 태그 = 문서 보조"로 역전).

---

## 9. 추출의 핵심 난관과 완화책

| # | 난관 | 완화책 |
|---|------|--------|
| 1 | **canonical transcript의 "Claude Code 특권화"** — pi가 "0줄 이식"된 진짜 이유는 어댑터가 pi를 Claude Code인 척 위장시켰기 때문. 이식 비용은 사라진 게 아니라 어댑터로 전가됨 | canonical을 **에이전트-중립 IR**로 재정의(toolCalls/subagentSpawns/userMessages). Claude도 pi도 동등하게 IR로 up-translate. 제3 에이전트 추가가 O(1) |
| 2 | **자가보호 도구-shaped** (§3-A) | meta-guard를 **경로-shaped로 전환** — PreToolUse[Bash]에서도 호출해 `sed -i`/heredoc/`>` 검사. **추출 전 코어에서 먼저 수정** |
| 3 | **완료 판정 `status` 누수** (§3-B) | `status`를 runner-owned로 격상하거나, 최소한 finish 게이트가 `status:done & passes:false` task를 reject. ledger-engine 불변식으로 박음 |
| 4 | **측정 0건** (§3-D) | roi-telemetry를 **코어 1급 시민**으로: 로그를 머신 간 집계 산출물로 승격 + 집계 CLI 포함 + lead/effort→PRD 스코프 보정 폐루프 1개. **측정 없는 하네스는 "더 안전한 코드를 만든다"는 핵심 가치를 입증 못 함** |
| 5 | **지식 그래프 ROI 부재** (§3-E) | 두 갈래: (a) 그래프 포기하고 FTS5만 추출(정직한 축소), 또는 (b) "ingest 시 최소 1 link 요구" 결정론 훅으로 81.5% 고립률 해소 |
| 6 | **seam-registry 없이는 적대검증이 일반 코드리뷰로 퇴화** | verify-workflow는 "seam-registry를 입력으로 받는 오케스트레이터"로만 추출, registry는 템플릿 작성 가이드로 |
| 7 | **어댑터/에이전트정의 자가보호 비대칭** (pi 미보호) | 보호 표면을 case 하드코딩에서 `harness.config.ts`의 `protectedPaths`로 외부화 + 어댑터 디렉터리 자동 포함 |

---

## 10. 단계적 로드맵 (MVP → v1)

각 단계는 검증 기준을 동반한다(goal-driven).

### MVP (v0.1) — "한 에이전트, 두 구멍 메움, 측정 가동"
1. **코어 골격 추출** — guard-protocol + ledger-engine + meta-guard. *verify*: 도메인 가드 0개로 "writer 스폰 없이 production 편집 차단" 작동
2. **두 구멍 선수정** (추출 전 필수) — meta-guard 경로-shaped(난관 2) + `status` runner-owned(난관 3). *verify*: `sed -i` 가드 수정 차단 + `Edit` status 직접쓰기 차단
3. **roi-telemetry 1급화 + 집계 CLI** — *verify*: 100회 가드 호출 후 `harness gain`이 가드별 카운트 출력 (현재 0건 → N건)
4. **harness.config.ts 도입** — production-path glob / scope→cmd를 config로. *verify*: memoriq config로 기존 동작 재현 + 더미 config로 다른 레이아웃

### v0.5 — "지식 + 컨텍스트 SSOT"
5. **kb-engine 추출** (FTS5만, 그래프 옵션) — row-first parser + 식별자 튜닝 + **로컬 SQLite 저장(동기화 없이 완전 동작)**. *verify*: 식별자 단일 토큰 검색이 `SyncChannel` 미주입 상태에서 통과. 그 뒤 `adapter-sync-s3` 주입 시 ETag 412 재시도 동작 (개선 ⑥)
6. **컨텍스트 SSOT** — AGENTS.md↔config 심링크 + rules 런타임 직접읽기 + enforcement 태그 규약
7. **(선택) 그래프 결정론 훅** (난관 5b)

### v1.0 — "멀티 에이전트 + 적대검증 + 진짜 중립 IR"
8. **canonical IR 재설계** (난관 1) — *verify*: **제3 가짜 어댑터**가 코어 가드를 0줄 수정으로 통과 (위장이 아니라 IR up-translate로)
9. **transcript-iface + virtual-post-state + sudo-TTL waiver**를 IR 위에 재구현
10. **verify-workflow 추출** (난관 6) — seam-registry 입력형 오케스트레이터
11. **create-harness CLI + 측정 폐루프** (난관 4 완성)

**우선순위 원칙**: §3에서 검증된 구멍 2개(자가보호 도구-shaped, status 누수)와 측정 0을 **MVP에서 먼저** 메운다. 이를 메우지 않고 추출하면 약점까지 그대로 복제한다.

---

## 11. 최종 답: "범용 프레임워크로 추출 가능한가?"

**가능하다 — 단 "코드 이식"이 아니라 "패턴의 코어화 + memoriq의 어댑터/템플릿화 + 검증된 구멍 3개의 선(先)수정"으로서.**

- **추출 가능성 종합 등급: B** (일반화 작업 후 추출 가능).
  - **A가 아닌 이유**: 코어로 부를 패턴조차 현재 코드는 Claude Code 스키마·memoriq 경로어휘·티켓체계에 결합돼 있고, dev-tools가 `"private": true`로 설치 경로가 없다.
  - **C가 아닌 이유**: 결합이 **본질적이 아니라 우연적**이다. 경로 어휘는 config로, 스키마는 어댑터로, 도메인 가드는 템플릿으로 분리 가능하며, 그 경계가 이미 (불완전하게나마) pi 이식으로 한 번 그어졌다.

- **추출을 정당화하는 단 하나의 전제**: §9-4의 측정 폐루프를 살려 "이 하네스가 실제로 더 안전한/빠른 코드를 만든다"를 데이터로 보여야 한다. 현재 그 데이터는 `outcomes.jsonl` 196행(task pass/fail)뿐이고 lead/effort 환류는 미입증이다. **측정 없이는 "정교한 통합 증명"일 뿐 "추출할 가치가 입증된 프레임워크"가 아니다.**

이것이 survey의 낙관(★4.7)과 verify의 회의(★3.7) 사이에서 도달한 **근거 기반 균형점(★3.5)**이다.

---

## 부록 A — 분석 방법론 (재현용)

이 리포트는 `Workflow` 멀티에이전트 오케스트레이션(14 에이전트, 1.04M 토큰, 13분)으로 생성됐다:

1. **Survey** (6 에이전트 병렬) — 도메인별 실파일 조사, 4축 점수 + strengths/weaknesses/extractable/memoriq_specific + evidence(file:line)
2. **Verify** (6 에이전트, 파이프라인) — 각 survey를 **REFUTE**(기본 회의주의): overrated_claims / unmeasured_assertions / extraction_blockers / missed_strengths + adjusted_grade
3. **Benchmark** (1 에이전트) — 외부 프레임워크 6종 대비 포지셔닝
4. **Synthesize** (1 에이전트, max effort) — verify가 깎은 부분을 반영해 종합, 결정적 주장 5개를 직접 코드로 재검증

핵심 설계 결정은 **적대적 검증 단계**였다. 단일 에이전트라면 정교한 하네스를 보고 "훌륭하다"로 끝났을 분석이, verify 덕분에 검증된 사실과 과대평가된 주장을 분리해냈다. 이는 이 프로젝트 자체의 `integrity-review.js` 철학("리뷰어 자기보고도 신뢰 대상이 아니다")을 메타 분석에 적용한 것이다.

## 부록 B — 검증에 사용한 핵심 파일

`dev-tools/scripts/harness-self-mod-guard.sh`, `dev-tools/scripts/claude-hook-dispatch.sh`, `dev-tools/scripts/bash-guard.sh`, `dev-tools/scripts/hook-roi-log.sh`, `dev-tools/src/_lib/transcript.ts`, `dev-tools/src/_lib/docs-db.ts`, `dev-tools/src/_lib/docs-s3.ts`, `dev-tools/src/task-ledger-guard.ts`, `dev-tools/src/ledger-verify.ts`, `dev-tools/src/ledger-finish.ts`, `dev-tools/src/ledger-new.ts`, `dev-tools/src/tdd-{preflight,agent-required,phase-order}.ts`, `.claude/settings.json`, `.claude/skills/tdd/SKILL.md`, `.claude/agents/tdd-*.md`, `.claude/workflows/{integrity-review,test-delete-verify}.js`, `.pi/extensions/memoriq-guards/{guard-runner,transcript-adapter,index}.ts`, `.pi/tdd-subagents-workflow.md`, `CLAUDE.md`, `docs/ledger/outcomes.jsonl`, `dev-tools/docs.db`, `AGENTS.md`(symlink).
