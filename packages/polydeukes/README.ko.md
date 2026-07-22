# polydeukes

**한국어** · [English](./README.md)

> 스코프 없는 umbrella 패키지입니다. `pdks` CLI 진입점과 config 디스커버리 로더가 살고, 프레임워크의 조각을 저장소가 실제로 돌리는 표면에 맞게 조립하는 유일한 자리입니다.

**pre-alpha 단계입니다.** npm에는 아직 공개되지 않았습니다. 이 패키지는 스코프 없는 `polydeukes` 이름을 예약하고, 스코프 모듈(`@polydeukes/*`)을 조립할 수 있는 유일한 패키지로 그 위에 섭니다. 다른 모든 의존은 코어를 통해서만 단방향으로 흐릅니다.

## 여기 담긴 것

- **`loadConfig(rootDir)`.** config 디스커버리입니다. 주어진 루트 바로 아래에서 정확히 하나의 데이터 config(`polydeukes.config` 파일의 yaml·yml·json 형태)를 찾아, 안전 스키마로 해석하고(설정 데이터는 결코 실행되지 않습니다) 코어의 `defineConfig()`에 검증을 맡깁니다. 모든 실패 분기는 예외를 던집니다(throw). 조용한 기본값은 금지이고, 발견된 파일은 자기 자신을 보호 표면에 편입시킵니다.
- **`pdks covenant check`.** `pdks` bin의 첫 실물 서브커맨드입니다(`polydeukes`는 별칭). pre-commit 판정 러너로, 스테이징 영역의 변경을 `@polydeukes/adapter-git`이 수집해 약속(covenant) 입력 IR로 번역하고, 세션 훅이 띄우는(spawn) 바로 그 판정 본체에 흘립니다. 판정기는 하나, 표면은 여럿입니다. 빈 스테이징은 명시적 통과이고, config가 없거나 불량이면 닫힌 실패(exit 2)입니다.
- **커밋 표면 유예 밸브.** `block` 수위(기본값)에서 스테이징 영역의 변경이 보호 표면에 걸리면 러너가 `/dev/tty`에서 유예 토큰 전문을 1회 묻습니다(부분 문자열은 거부합니다). TTY가 없으면, 즉 CI나 에이전트가 띄운 `git commit`이면 프롬프트도 우회도 없습니다. 밸브는 터미널 앞의 인간에게만 닿고, 어떤 상태도 남기지 않으며, 모든 우회는 `bypassed`로 기록됩니다. 조용한 우회는 없습니다.
- **시행 수위.** git 어댑터의 네임스페이스 설정 `adapters.git.enforce: block | advise`가 커밋 표면 판정의 처분을 고릅니다. `advise`에서는 밸브 자체가 조립되지 않습니다. 판정은 `advised` 이벤트로 기록되고, stderr에 권고 한 줄이 남으며, 커밋은 진행됩니다. 차단하는 대신 측정하는 백스톱입니다. 완화되는 것은 판정뿐이라, 판정 자체가 불가능한 실행(설정 없음·무효, 판정 본체 해석 불가)은 어느 수위에서든 exit 2로 닫힙니다.

## 전체 지도

| 모듈 | 역할 |
|---|---|
| `@polydeukes/core` | 약속(covenant) 프로토콜, config 스키마, ROI 텔레메트리, 대화 기록 이음새 |
| `@polydeukes/covenant` | 디스패처, 판정 본체, Bash 분석, 규율(discipline) 라이브러리 |
| `@polydeukes/adapter-claude-code` | 세션 표면. PreToolUse 페이로드를 약속(covenant) 입력 IR로 번역 |
| `@polydeukes/adapter-git` | 커밋 표면. `staged diff`를 약속(covenant) 입력 IR로 번역 |
| `@polydeukes/ledger` · `@polydeukes/memory` · `@polydeukes/verify` | 청사진 단계 |

아키텍처 청사진과 설계 근거는 [프로젝트 저장소](https://github.com/huskyhoochu/polydeukes)에 있습니다.

## 라이선스

MIT
