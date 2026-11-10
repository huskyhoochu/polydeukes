# 기존 설치를 Rust 실행 파일로 옮기기

[English](./migrate-to-rust.md) · **한국어**

Node 판정기나 이전 통합 실행 파일에서 업그레이드할 때 사용하는 체크리스트입니다. 설정과 훅은 소유자
터미널에서 편집하고 새 에이전트 세션을 여세요.

<a id="inventory"></a>
## 현재 설치 기록

`pdks --version`, 실행 파일 경로, 현재 설정과 호스트 설정을 기록하고 편집 전 사본을 보관합니다. 본체
명령은 `covenant check`, `init`, `explain`, `docs`입니다. Claude Code, Codex, 기억(memory)은
[설치 안내](./install.ko.md)에 따라 별도로 설치합니다.

<a id="configuration"></a>
## 설정과 명령 변경

| 이전 인터페이스                                 | 현재 인터페이스                                      |
| ----------------------------------------------- | ---------------------------------------------------- |
| `pdks adapter claude-code init`                 | `pdks-claude-code init` 또는 `pdks claude-code init` |
| `pdks adapter codex init`                       | `pdks-codex init` 또는 `pdks codex init`             |
| `pdks memory ingest`                            | search/show를 바로 실행; 매번 현재 마크다운을 읽음   |
| 설정의 `languages`                              | 키 제거; Rust 설정은 이 키를 받지 않음               |
| 설치된 `@polydeukes/core` 안의 스키마           | 저장소의 버전별 `schema/` 파일로 편집기 지원         |
| `pdks-linux-x64` / `pdks-darwin-arm64` 다운로드 | 실행 파일별 대상 압축본; 설치 안내 참조              |

`pdks init`은 프로젝트 설정과 텔레메트리 무시 항목을 만듭니다. 호스트별 보호와 훅 등록은 어댑터
init이 담당합니다. 생성 설정에는 YAML language-server 스키마 주석이 없습니다. 편집기의 스키마 경로를
별도로 확인하세요.

<a id="hooks"></a>
## 옛 훅 등록 교체

`.claude/settings.json` 또는 `.codex/hooks.json`을 살펴봅니다. 다른 도구의 핸들러와 설정은
유지하면서 이전 Polydeukes 핸들러와 오래된 Node·`.mjs` 위임자 등록을 제거합니다. Rust init은 현재
등록을 추가하거나 갱신하며, 옛 TypeScript 핸들러와 생성된 `.mjs` 파일을 정리하지 않습니다. 위임자
파일은 남은 핸들러가 사용하지 않는지 확인한 뒤 지웁니다.

프로젝트 루트에서 선택한 어댑터 init을 실행하고 결과의 실행 파일·루트 경로를 확인합니다. 새 등록에는
`onFailure`나 `|| exit 2`가 없습니다. Claude Code를 다시 열거나 Codex `/hooks`에서 정의를 승인한 뒤
일반 호출을 실행해 새 텔레메트리 행을 확인합니다.
[직접 판정
예제](../tutorials/first-judgment.ko.md)로
판정기와 호스트 로딩을 따로 확인할 수 있습니다.

<a id="behavior"></a>
## 규율이 읽는 관측 재확인

셸 보호는 보호 경로의 언급을 보수적으로 판정합니다. 셸 쓰기는 내용 규율에 필요한 파일 내용을
제공하지 못해 `no-observation` 사유의 `skipped`가 될 수 있으므로 완성된 diff도 검사합니다. Codex는
도구 이력을 기록하지만 사람 메시지를 증명하지 못합니다. 프롬프트에 증인 토큰을 넣어도 보호 편집이
열리지 않습니다. Claude Code는 대화 기록의 사람 출처를 요구하며 SDK로 시작한 세션에는 이 증거가 없을
수 있습니다. 사람 채널이 없는 호스트에서는 터미널로 보호 파일을 편집합니다.

기억은 색인 파일이나 ingest 단계 없이 동작합니다. 검색 JSON에는 `results`가 있고 `ingestedAt`은
없습니다. 옛 SDK ingest 동사를 사용하던 코드는 search를 바로 호출하도록 바꿉니다. TypeScript SDK는
Node 24 이상이 필요합니다. SDK는 실행 파일 프로세스를 호출하며 현재 계약은
[SDK
참조](../README.ko.md#reference-packages)에
있습니다.

<a id="verify"></a>
## 이행 확인

```sh
pdks --version
pdks explain
git diff HEAD | pdks covenant check --diff
pdks memory search configuration
```

마지막 명령은 기억 확장과 문서 모음 설정이 필요합니다. exit 0뿐 아니라 stderr와 텔레메트리도
확인합니다. 조언과 건너뛴 관측도 성공 코드가 됩니다. 실행 파일이 시작되지 않으면 설치나 경로를 고친
뒤 호스트를 다시 실행하세요. [문제 해결](../troubleshooting.ko.md)을 참고합니다.
