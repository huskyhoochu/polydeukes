# 입력 IR과 스키마

[English](./core.md) · **한국어**

<a id="contract"></a>
## 계약의 위치

설정과 입력 IR은 Rust 판정기가 검증하는 데이터입니다. 공개 스키마는 저장소 `schema/`에 있으며 SDK
3종의 전송 타입은 이 스키마에서 생성합니다. 실행 파일을 설치한다고 JavaScript core 라이브러리가
생기지는 않습니다.

<a id="schemas"></a>
## 스키마

| File                                                                                 | Contract            |
| ------------------------------------------------------------------------------------ | ------------------- |
| [polydeukes.schema.json](../../../schema/polydeukes.schema.json)                     | Configuration       |
| [algebra-declaration.schema.json](../../../schema/algebra-declaration.schema.json)   | Declaration grammar |
| [covenant-input.schema.json](../../../schema/covenant-input.schema.json)             | Judgment input IR   |
| [memory-search-output.schema.json](../../../schema/memory-search-output.schema.json) | Search response     |

편집기에는 사용하는 릴리스와 맞는 스키마를 연결합니다. 생성 타입과 실행 시 검증은 별개이므로 CLI
오류도 처리해야 합니다.

<a id="input-ir"></a>
## 입력 IR

IR의 최상위 배열은 toolCalls, subagentSpawns, userMessages입니다. 호스트의 tools·session·actor
증거는 계약에 맞게 공급합니다. 호출자가 world를 넣으면 거부됩니다. 파일 변경의 pre/post와 도구
역할을 정확히 제공해야 판정할 수 있습니다.
[covenant
check](../cli/covenant-check.ko.md)는
형태·실패·표면 계약을 설명합니다.

<a id="consumer-contract"></a>
## SDK 선택

[TypeScript](./sdk-ts.ko.md) · [Rust](./sdk-rust.ko.md) · [Python](./sdk-python.ko.md)

SDK는 별도 pdks 실행 파일을 호출합니다. 명시한 실행 파일 경로나 PATH와 프로젝트 루트를 전달하고,
판정 결과와 실행 실패를 구별하세요. 기억 검색은 별도 기억 확장도 필요합니다.
