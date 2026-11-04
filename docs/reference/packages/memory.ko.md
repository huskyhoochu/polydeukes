# `pdks-memory`

[English](./memory.md) · **한국어**

<a id="consumer-contract"></a>
## 실행 계약

기억 확장은 현재 마크다운에서 답을 계산하는 별도 Rust 실행 파일입니다. `pdks memory`는 PATH의
`pdks-memory`를 실행합니다. 명령은 search, show, obligations, supersession, lint, stats,
usage입니다. [사용 안내](../../how-to/use-memory.ko.md)와
[CLI
참조](../cli/memory.ko.md)를
함께 읽으세요.

<a id="ownership"></a>
## 데이터와 책임

설정의 memory.include와 exclude로 문서를 선택합니다. 문서 본문과 링크는 파일에서 매번 읽고, 질의
이력은 `.polydeukes/memory-log.jsonl`에 보관합니다. 내장 한국어 분석기와 영한 사전은 네트워크 없이
동작합니다. 판정기는 기억 확장을 실행하지 않습니다.

<a id="limits"></a>
## 한계

검색 순위는 진실성의 보증이 아닙니다. 결과의 원문과 검증 정보를 확인하세요. 사용 이력은 원문으로
복구할 수 없습니다. [설정](../configuration/index.ko.md#memory)을 바꾸면 다음 질의부터 반영됩니다.
