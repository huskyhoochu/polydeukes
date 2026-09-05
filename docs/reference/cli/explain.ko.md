# `pdks explain`

[English](./explain.md) · **한국어**

`pdks explain`은 등록된 항목을 판정 없이 보여 줍니다. 실제 세션·커밋 실행에 쓰는 조립 함수를 호출하므로, 별도로 추정한 결과가 아니라 실제 등록 내용을 확인할 수
있습니다.

<a id="explain-syntax"></a>
## 구문

```sh
pdks explain
```

추가 인자는 허용하지 않습니다. 작업 디렉터리의 설정과 설치된 판정 패키지를 읽고, 두 표면을 조립한 뒤 결과를 출력합니다.

<a id="explain-what-it-shows"></a>
## 무엇을 보여 주는가

출력은 표면별로 나뉩니다. 각 표면의 등록 항목과 집계를 보여 주며, 등록 항목은 한 줄씩 표시합니다.

행 종류는 다음과 같습니다.

- `meta` — 판정 사슬 자체를 지키는 등록
- `declare` — 컴파일된 규율 항목 하나
- `skip` — 판정할 수 없는 사유를 표시하는 등록
- `draft` — 아직 판정 대상으로 전환하지 않은 `draft: true` 항목

이 명령은 판정기에 입력을 전달하지 않으며 텔레메트리나 대화 기록 파일도 읽고 쓰지 않습니다. 세션 표면에는 파일을 읽지 않는 대화 기록 대체물을 넘겨
`transcript-mod` 등록도 실제 훅을 조립할 때처럼 표시합니다.

<a id="explain-failure-conditions"></a>
## 실패 조건

| 상황 | 결과 |
|---|---|
| 설정이 유효하고 판정 패키지를 찾을 수 있음 | 종료 `0` |
| 추가 인자 | 종료 `2`, stderr에 사용법 출력 |
| 설정이 없거나 여러 개이거나 유효하지 않음 | 종료 `2` |
| 판정 패키지를 불러올 수 없음 | 종료 `2` |
| 그 밖의 조립 실패 | 종료 `2` |

실패 시 stdout은 0바이트로 남습니다. 중간 테이블을 출력하지 않습니다.

<a id="explain-example"></a>
## 예제

```sh
pdks explain
```

출력은 설정 파일 경로로 시작하고, 그다음 세션 표면 블록 하나와 커밋 표면 블록 하나가 나옵니다.
추가 규율이 없는 시작 설정은 이런 모양입니다.

```text
pdks explain — polydeukes.config.yaml

surface: session (claude-code hook) · disciplines: advise unless enforce: block · meta: block
  registrations 3 · declare 0 · skip 0 · meta 3 · draft 0
  meta     self-mod        paths N (common; includes the config file itself)
  meta     shell-mod       paths N (common)
  meta     transcript-mod  content predicate · conditional: transcript_path

surface: commit (git pre-commit) · enforce: block · disciplines: advise unless enforce: block
  registrations 2 · declare 0 · skip 0 · meta 2 · draft 0
  meta     self-mod   paths N (common ∪ adapters.git; deduped, includes the config file itself)
  meta     shell-mod  paths N (common)
```

`N`은 조립된 경로 개수입니다. `declare` 행의 라벨은 항목 `id`이고 설명은 카탈로그 좌표입니다.
`skip` 행은 건너뛴 이유를 적습니다. `draft` 행은 `unpromoted — no judgment`입니다.

<a id="explain-see-also"></a>
## 함께 보기

- [`pdks covenant check`](./covenant-check.ko.md)
- [`pdks init`](./init.ko.md)
- [`@polydeukes/covenant`](../packages/covenant.ko.md)
- [설정 참조](../configuration/index.ko.md)
