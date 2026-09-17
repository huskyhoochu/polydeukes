# Polydeukes

이 저장소에서 작업하기 전에 `CLAUDE.md`를 읽으세요. 아키텍처, 어휘, 개발 절차, dogfooding
복구에 관한 프로젝트 전체 정본입니다. 그다음 수정할 경로에 적용되는 `.claude/rules/` 파일을
모두 읽으세요. 경로별 규칙은 Claude Code뿐 아니라 Codex에도 적용됩니다.

계획된 제품 작업은 `_docs/roadmap.md`, 외부 이슈 작업은 `_docs/roadmap.issues.md`를 기준으로
진행합니다. 티켓 구현은 저장소의 ticket workflow로 시작하고, 영문·한글 문서 쌍을 함께
유지하며, 변경한 패키지에 맞는 검증을 실행하세요.

이 저장소는 `.codex/hooks.json`을 통해 `@polydeukes/adapter-codex`를 dogfooding합니다. 생성된
훅은 `pdks-codex init` 출력과 바이트 단위로 같아야 합니다. 훅 승인은 정의 해시에 묶입니다.
Code Mode `exec`와 그 안의 중첩 도구 호출은 현재 `PreToolUse` 범위 밖이므로, Active 훅을 완전한
범위로 설명하지 마세요. Codex 세션 증거는 등록된 `UserPromptSubmit`·`PostToolUse` 생명주기
이벤트에서만 오고, `SessionEnd`에서 제거되며, 불안정한 대화 기록에서는 절대 읽지 않습니다.
이 증거가 없으면 의도적으로 차단된 편집은 사용자의 터미널에서 복구해야 합니다.

이 저장소에서는 Transcodes를 사용하거나 도입하지 마세요. Transcodes 플러그인, 스킬, MCP 도구,
CLI 명령, Persona workflow, 훅, 생성 파일, 의존성을 호출하거나 추가하지 마세요. Codex 프로젝트
지침은 이 `AGENTS.md`와 저장소 소유 규칙 파일에서 직접 관리합니다.
