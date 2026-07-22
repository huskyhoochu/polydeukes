# @polydeukes/core

**한국어** · [English](./README.md)

> Polydeukes의 얇은 코어입니다. 도메인과 에이전트를 모르는 최소 기반 위에, AI 코딩 파트너와 함께 쓰는 규율(discipline) 프레임워크가 올라갑니다.

**pre-alpha 단계입니다.** npm에는 아직 공개되지 않았고, 마일스톤 사이에 API가 바뀔 수 있습니다. 여기 구현되지 않은 부분은 저장소의 설계 문서가 기준입니다.

## 여기 담긴 것

아래 유닛은 청사진이 아니라 전부 구현되고 테스트된 상태입니다.

- **약속(covenant) 프로토콜.** 모든 약속이 말하는 계약입니다. 입력은 stdin-JSON(`CovenantInput`, `parseInput`)으로 들어오고 판정은 exit code로 나갑니다. 약속 본체는 `0`(지켜짐)과 `1`(어겨짐, 비차단)만 내고, `1`을 차단인 `2`로 바꾸는 일은 래퍼의 몫입니다. 파싱은 fail-closed라서 판정할 수 없는 입력은 조용히 통과하는 대신 `2`로 끝납니다. IR은 선택적으로 `fileChanges`를 싣습니다. 어댑터가 각자의 원천(가상 적용, git blob)에서 채우는 에이전트 중립 pre/post 내용 쌍이라, 델타 판정이 디스크를 만지지 않습니다.
- **ROI 텔레메트리.** append 전용 라인 수집기(`appendRecord`, `readRecords`)와 `gain` 집계(`runGain`)입니다. 모든 패키지가 공유 fail-open 래퍼(`appendRecordFailOpen`)를 거쳐 이 수집기 하나로 기록합니다. 관측은 fail-open이라서 기록 실패가 판정을 바꾸지 않습니다.
- **config 스키마 v2, 설정은 데이터.** `defineConfig(unknown)`가 파싱된 yml/json 데이터를 검증합니다. 미지의 키는 모든 층위에서 시끄럽게 거부됩니다. 오타가 규율을 조용히 꺼 버리면 안 되기 때문입니다. `testCmd`는 `{scope}` 템플릿 문자열이고, 호출형 함수로 컴파일되어 돌아옵니다. 같은 계약의 JSON Schema가 `@polydeukes/core/schema.json`으로 배포되며, 검증기와의 동치는 계약 테스트가 강제합니다. 스키마에 `disciplines:`가 추가됐습니다. 사용자가 선언하는 규율(discipline) 항목(`forbid` / `immutable` / `forbidCommand`, 항목당 술어 정확히 하나)을 순수 데이터로 검증하고, 컴파일은 covenant 패키지가 맡습니다.
- **실패 정책 테이블.** 실패 유형별 fail-open과 fail-closed를 테이블 하나(`resolveFailMode`)가 정합니다. "판정 불가"는 언제나 차단입니다.
- **보호 경로 정규화.** `normalizeProtectedPaths`가 선언된 경로와 등록된 어댑터 디렉터리를 합칩니다. 어댑터는 등록되는 순간 보호 대상이 됩니다.
- **정규 대화 기록(canonical transcript) 이음새(seam).** 약속이 세션 이력을 물을 때 쓰는 질의 인터페이스 `CanonicalTranscript`입니다. 기본값은 noop이고, 실제 대화 기록은 어댑터 뒤에 있습니다.

## 불변식

- **런타임 의존성 0.** 검증은 직접 작성했고, 배포되는 JSON Schema는 소스가 읽지 않는 별도 산출물입니다.
- **에이전트·도구·언어 리터럴 없음.** 편집 도구의 동사나 테스트 러너의 이름은 config와 어댑터가 채우는 값이지, 이 패키지의 어휘가 아닙니다. 검증 기준의 grep 게이트가 이를 지킵니다.
- **의존은 단방향.** 다른 `@polydeukes/*` 패키지는 core에만 의존하고, core는 그 무엇에도 의존하지 않습니다.

아키텍처 청사진과 설계 근거는 [프로젝트 저장소](https://github.com/huskyhoochu/polydeukes)에 있습니다.

## 라이선스

MIT
