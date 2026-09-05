<!-- markdownlint-disable MD013 -- npm renders this page; its prose is authored as single-line paragraphs. -->

# @polydeukes/core

**한국어** · [English](./README.md)

> Polydeukes의 얇은 코어입니다. 도메인과 에이전트를 모르는 최소 기반 위에, AI 코딩 파트너와 함께 쓰는 규율(discipline) 프레임워크가 올라갑니다.

**알파(alpha) 단계입니다.** 마일스톤 사이에 API가 바뀔 수 있습니다. 여기 구현되지 않은 부분은 저장소의 설계 문서가 기준입니다.

## 여기 담긴 것

아래 유닛은 청사진이 아니라 전부 구현되고 테스트된 상태입니다.

- **약속(covenant) 프로토콜.** 모든 약속이 말하는 계약입니다. 입력은 stdin-JSON(`CovenantInput`, `parseInput`)으로 들어오고 판정은 exit code로 나갑니다. 약속 본체는 `0`(지켜짐)과 `1`(어겨짐, 비차단)만 내고, `1`을 차단인 `2`로 바꾸는 일은 래퍼의 몫입니다. 파싱은 fail-closed라서 판정할 수 없는 입력은 조용히 통과하는 대신 `2`로 끝납니다. 각 도구 호출은 선택적으로 자기 `fileChange` 증거를 싣습니다. 판별 유니온(discriminated union, `create`/`modify`/`delete`, 삭제도 1급)으로 표현되는 에이전트 중립 증거를 어댑터가 각자의 원천(가상 적용, git blob)에서 채우므로, 델타 판정이 디스크를 만지지 않습니다. 귀속이 필요 없는 소비자는 `allFileChanges`로 평면 순회합니다.
- **ROI 텔레메트리.** append 전용 라인 수집기(`appendRecord`, `readRecords`)와 `gain` 집계(`runGain`)입니다. 모든 패키지가 공유 fail-open 래퍼(`appendRecordFailOpen`)를 거쳐 이 수집기 하나로 기록합니다. 관측은 fail-open이라서 기록 실패가 판정을 바꾸지 않습니다.
- **config 스키마 v2, 설정은 데이터.** `defineConfig(unknown)`가 파싱된 yml/json 데이터를 검증합니다. 미지의 키는 이 패키지가 소유하는 층위에서 오류로 거부됩니다. 오타가 규율을 조용히 꺼 버리면 안 되기 때문입니다. 어댑터 네임스페이스 안쪽의 내용은 그 어댑터가 검증합니다. `testCmd`는 `{scope}` 템플릿 문자열이고, 호출형 함수로 컴파일되어 돌아옵니다. 같은 계약의 JSON Schema가 `@polydeukes/core/schema.json`으로 배포되며, 검증기와의 동치는 계약 테스트가 강제합니다. 스키마에 `disciplines:`가 추가됐습니다. 사용자가 선언하는 규율(discipline) 항목(`declare` / `forbidCommand` / `requirePrecedent`, 항목당 술어 정확히 하나)을 순수 데이터로 검증하고, 컴파일은 covenant 패키지가 맡습니다. `requirePrecedent`의 증거 어휘는 `adapters:`와 같은 방식으로 계층이 나뉩니다. 셸 명령은 에이전트를 넘나드는 표면이라 코어가 `command` 키를 전부 검증하고, 나머지 키는 컨테이너 형태만(키가 정확히 하나인 평면 객체) 검증한 뒤 값은 그대로 넘겨 그 어휘를 가진 어댑터가 판정합니다.
- **대수 선언 스키마(`ALGEBRA-01`).** `validateAlgebraDeclaration(unknown)`이 선언 하나의 형상을 검사하고 데이터 그대로 돌려줍니다. 판정은 `judge = relate ∘ extract`이고 블록은 `scope` · `supply` · `extract` · `relate` · `witness` 다섯입니다. 관계(relation) 자리는 일곱 이름으로, 이진 결합자(combinator) 자리는 셋으로 닫혀 있고, 단항 추출(extract) 어휘는 열려 있습니다. 같은 계약의 JSON Schema가 `@polydeukes/core/algebra-declaration.schema.json`으로 배포되며 동치는 같은 방식의 계약 테스트가 강제합니다. 코어는 형상만 검증합니다. 추출을 실행하지도 관계를 평가하지도 않으며, 엔진(`ALGEBRA-02`)이 서기 전까지 `disciplines:`는 이 블록을 받지 않습니다.
- **실패 정책 테이블.** 실패 유형별 fail-open과 fail-closed를 테이블 하나(`resolveFailMode`)가 정합니다. "판정 불가"는 언제나 차단입니다.
- **보호 경로 정규화.** `normalizeProtectedPaths`가 선언된 `protectedPaths` 목록을 디스패처가 대조하는 리터럴 경로 문자열로 다듬습니다(공백 정리, 접두·접미 제거, 중복 제거). 어댑터 설정은 `adapters:` 네임스페이스 맵에 삽니다. 어댑터마다 객체 하나이며, 내용의 검증은 그 어댑터의 몫이고 코어는 그대로 넘깁니다.
- **정규 대화 기록(canonical transcript) 이음새(seam).** 약속이 세션 이력을 물을 때 쓰는 질의 인터페이스 `CanonicalTranscript`입니다. 서브에이전트 호출, 사용자 메시지, 도구 호출(`findToolCalls`, 이름과 인자 모두 어댑터가 채우는 값)을 묻습니다. 기본값은 noop이라 주입받지 못한 소비자는 "아무 일도 없었다"로 수렴하고, 실제 대화 기록은 어댑터 뒤에 있습니다.

## 불변식

- **런타임 의존성 0.** 검증은 직접 작성했고, 배포되는 JSON Schema는 소스가 읽지 않는 별도 산출물입니다.
- **에이전트·도구·언어 리터럴 없음.** 편집 도구의 동사나 테스트 러너의 이름은 config와 어댑터가 채우는 값이지, 이 패키지의 어휘가 아닙니다. 검증 기준의 grep 게이트가 이를 지킵니다.
- **의존은 단방향.** 다른 `@polydeukes/*` 패키지는 core에만 의존하고, core는 그 무엇에도 의존하지 않습니다.

아키텍처 청사진과 설계 근거는 [프로젝트 저장소](https://github.com/huskyhoochu/polydeukes)에 있습니다.

## 라이선스

MIT
