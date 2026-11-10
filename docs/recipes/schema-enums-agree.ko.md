# 두 JSON 스키마의 enum 값을 같게 유지하기

[English](./schema-enums-agree.md) · **한국어**

이 규율(discipline)은 여러분의 프로젝트에 같은 값을 담아야 하는 enum 배열을 가진 유효한 JSON 스키마
두 개가 있을 때 적용합니다. 어느 파일이든 바뀌면 선택한 값을 비교합니다.

세션 표면 · 변경 집합 표면 · 기본 강제 수준은 권고, 판정할 수 없는 입력은 차단 · 두 파일 경로, 범위
패턴, 두 선택자를 바꾸세요. 호스트 지원: [파일 편집](../reference/host-support.ko.md#file-edits).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 설정이 없다면 프로젝트 루트에 저장하세요. 이미
`disciplines:`가 있다면 그 키 아래에 항목만 추가하고 기존 항목은 유지하세요. 파일은 있지만 그 키가
없다면 블록 전체를 덧붙이세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "schema-enums-agree"
    why: "two schemas describing the same property must accept the same enum values."
    declare:
      mechanism: "pairing"
      scope: { source: "target.path", include: ['^schemas/(request|response)\.json$'] }
      sources:
        left: { file: "schemas/request.json" }
        right: { file: "schemas/response.json" }
      extract:
        leftValues:
          - { op: "source", of: "left" }
          - { op: "json" }
          - { op: "select", path: "properties.status.enum" }
        rightValues:
          - { op: "source", of: "right" }
          - { op: "json" }
          - { op: "select", path: "properties.status.enum" }
      relate:
        - id: "same-names"
          relation: { op: "equal", of: ["leftValues", "rightValues"] }
          message: "schema enum differs: {value}"
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트에서 사용하는 Claude Code나 Codex에 다음 프롬프트를 붙여 넣으세요.

````text
아래 항목을 이 프로젝트의 polydeukes.config.yaml에 있는 disciplines: 밑에 추가하세요.
기존 목록 키를 쓰고 같은 키를 두 번 만들지 마세요. 다른 항목, 보호 경로, 증인 설정은 유지하세요.
같은 id가 이미 있으면 알리고 멈추세요.
이 세션에서 설정이 보호되어 있다면 정확한 패치를 보여 주고 사람이 적용하도록 요청하세요.
보호를 우회하지 마세요.
"바꿔 쓰기"에서 설명하는 값을 이 프로젝트에 맞추세요. pdks explain을 실행하고
schema-enums-agree 행을 확인하세요. 권고 항목이므로 enforce: block이 표시되면 안 됩니다.
빈 임시 디렉터리에서 예제 설정 그대로 "직접 확인하기"를 재현하세요.
파일 쓰기 도구로 스키마 파일 둘과 JSON 입력 둘을 만드세요. JSON 검사 셋을 실행하고
각 판정 결과, 종료 코드, 강제 수준을 보고하세요. JSON은 편집을 설명하며 검사가 편집을 적용하지는
않습니다. skipped 판정 결과는 검사 성공이 아닙니다. 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "schema-enums-agree"
    why: "two schemas describing the same property must accept the same enum values."
    declare:
      mechanism: "pairing"
      scope: { source: "target.path", include: ['^schemas/(request|response)\.json$'] }
      sources:
        left: { file: "schemas/request.json" }
        right: { file: "schemas/response.json" }
      extract:
        leftValues:
          - { op: "source", of: "left" }
          - { op: "json" }
          - { op: "select", path: "properties.status.enum" }
        rightValues:
          - { op: "source", of: "right" }
          - { op: "json" }
          - { op: "select", path: "properties.status.enum" }
      relate:
        - id: "same-names"
          relation: { op: "equal", of: ["leftValues", "rightValues"] }
          message: "schema enum differs: {value}"
```
````

<a id="try-it"></a>
## 직접 확인하기

빈 임시 디렉터리에 위 YAML을 `polydeukes.config.yaml`로 저장하세요.

`schemas/request.json`과 `schemas/response.json`을 만들고 다음 명령으로 내용을 저장하세요.

```sh
mkdir -p schemas
printf '%s\n' '{"properties": {"status": {"enum": ["open"]}}}' > schemas/request.json
printf '%s\n' '{"properties": {"status": {"enum": ["open"]}}}' > schemas/response.json
```

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "schemas/request.json"
      },
      "fileChange": {
        "kind": "modify",
        "path": "schemas/request.json",
        "pre": "{\"properties\": {\"status\": {\"enum\": [\"open\"]}}}\n",
        "post": "{\"properties\": {\"status\": {\"enum\": [\"open\", \"closed\"]}}}\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  }
}
```

`valid.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "schemas/request.json"
      },
      "fileChange": {
        "kind": "modify",
        "path": "schemas/request.json",
        "pre": "{\"properties\": {\"status\": {\"enum\": [\"open\"]}}}\n",
        "post": "{\"properties\": {\"status\": {\"enum\": [\"open\"]}}}\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  }
}
```

`fileChange`는 어댑터가 관측한 편집으로, 종류, 경로, 편집 전후 내용을 담습니다. 판정기는 편집 대상
스키마의 `post`와 디스크의 다른 스키마를 읽으며, 이 검사가 제안한 내용을 파일에 쓰지는 않습니다.
`tools` 객체는 어댑터가 제공하는 편집 도구, 셸 도구, 명령 인자 이름을 나타냅니다.

```sh
pdks covenant check < violating.json
```

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: closed — why: two schemas describing the same property must accept the same enum values.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 불일치는 `advised`로 기록됩니다.

```sh
pdks covenant check --enforce block < violating.json
```

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: closed — why: two schemas describing the same property must accept the same enum values.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 불일치는 `advised`로 기록됩니다.

`--enforce block`만으로 이 권고 항목을 차단으로 올리지 않습니다.

```sh
pdks covenant check --enforce block < valid.json
```

출력 없이 종료 코드 0으로 끝납니다. `.polydeukes/roi.log`에 추가된 세 행은 다음과 같습니다.
타임스탬프는 달라집니다.

```text
2026-11-10T15:38:55.855Z	advised	schema-enums-agree	schemas/request.json	[{"id":"same-names","witnesses":[{"key":"1","value":"closed","side":"left"}],"total":1}]
2026-11-10T15:38:55.859Z	advised	schema-enums-agree	schemas/request.json	[{"id":"same-names","witnesses":[{"key":"1","value":"closed","side":"left"}],"total":1}]
2026-11-10T15:38:55.862Z	passed	schema-enums-agree	schemas/request.json
```

**다른 입력**

별도 내용이 없다면 두 파일은 원래의 `["open"]`을 유지하세요. 각 JSON 편집에서 원래 `pre`는 유지하고
설명대로 `post`를 바꾸세요. 아래 enum 배열의 위치는 `properties.status.enum`입니다.

request는 `["open"]`인 채 `schemas/response.json`을 `["open", "closed"]`로 편집합니다.

```text
discipline 'schema-enums-agree' broken on schemas/response.json: schema enum differs: closed — why: two schemas describing the same property must accept the same enum values.
```

종료 코드는 0입니다.

response는 `["open"]`인 채 request를 `[1]`로 편집합니다.

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: 1 (+1) — why: two schemas describing the same property must accept the same enum values.
```

종료 코드는 0입니다.

response에 `{}`를 저장하고 request를 `["open", "closed"]`로 편집합니다.

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: open (+1) — why: two schemas describing the same property must accept the same enum values.
```

종료 코드는 0입니다.

response에 `{ invalid`를 저장하고 `valid.json`을 제출합니다.

```text
discipline 'schema-enums-agree' cannot judge schemas/request.json: right — the value is not valid JSON
```

종료 코드는 2입니다.

임시 디렉터리에서 response를 지우고 `valid.json`을 제출합니다.

```text
discipline 'schema-enums-agree' cannot judge schemas/request.json: right — the world carries no source named 'right'
```

종료 코드는 2입니다.

앞의 세 입력은 권고합니다. 첫 줄 뒤에는 위와 같은 ` — why: …`와 권고 요약이 이어집니다. 마지막 둘은
선택한 값을 읽을 수 없으므로 `blocked`를 기록합니다.

다음 입력은 표준 오류 출력 없이 종료 코드 0으로 통과합니다. request의 `["closed", "open"]`과
response의 `["open", "closed"]`, request의 `["open", "open"]`과 response의 `["open"]`, 두 파일과
`pre`, `post` 모두 `{}`인 입력입니다. `notes.txt`를 `old\n`에서 `new\n`으로 바꾸는 편집은 범위
밖이므로 이 항목의 판정 결과 대신 `passed covenant-check`를 기록합니다.

**변경 집합 표면**

두 스키마 파일을 원래 `["open"]` 내용으로 복원하세요. 같은 임시 디렉터리에서 실행합니다.

```sh
git init -q
git config user.name Recipe
git config user.email recipe@example.invalid
git add schemas/request.json schemas/response.json
git commit -qm baseline
printf '%s\n' '{"properties": {"status": {"enum": ["closed"]}}}' > schemas/request.json
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff
```

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: closed (+1) — why: two schemas describing the same property must accept the same enum values.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 추가된 행은 다음과 같습니다.

```text
2026-11-10T15:38:55.881Z	advised	schema-enums-agree	schemas/request.json	[{"id":"same-names","witnesses":[{"key":"0","value":"closed","side":"left"},{"key":"0","value":"open","side":"right"}],"total":2}]
```

request의 `["open"]`을 `["closed"]`로 바꾸는 diff를 제출해도 디스크의 두 파일이 모두 `["open"]`이면
통과합니다. 판정기는 이름 붙인 두 소스를 diff가 아닌 작업 트리에서 읽습니다.

같은 `tools` 객체로 `echo changed > schemas/request.json`를 담은 `Bash` 호출을 JSON으로 제출하면
출력 없이 종료 코드 0으로 끝나며 다음을 기록합니다.

```text
2026-11-10T15:38:55.889Z	skipped	schema-enums-agree	schemas/request.json	no-observation
```

두 스키마가 `["open"]`을 담은 상태에서 `schemas/response.json`을 삭제하는 세션 편집을 제출하세요.
`kind`는 `delete`로 하고 내용을 `pre`로 유지하며 `post`는 생략하세요. `blocked`를 기록하며 종료
코드는 2입니다.

```text
discipline 'schema-enums-agree' cannot judge schemas/response.json: right — the world carries no source named 'right'
```

디스크에 두 스키마가 모두 없을 때 `properties.status.enum`에 `["open"]`을 담은
`schemas/request.json`을 만드는 세션 편집을 제출하세요. `kind`는 `create`로 하고 `pre`를 생략하며
해당 JSON을 `post`로 제공하세요. `blocked`를 기록하며 종료 코드는 2입니다.

```text
discipline 'schema-enums-agree' cannot judge schemas/request.json: right — the world carries no source named 'right'
```

request는 `["open"]`으로 유지하고 작업 트리에서 `schemas/response.json`을 삭제하세요. response를
삭제하는 diff를 `--enforce block` 없이 `pdks covenant check --diff`로 제출하면 `blocked`를 기록하며
종료 코드는 2입니다.

```text
discipline 'schema-enums-agree' cannot judge schemas/response.json: right — the world carries no source named 'right'
```

두 스키마를 `["1"]`로 시작한 뒤 request를 `[1]`로 편집하세요. `advised`를 기록하며 종료 코드는
0입니다. 첫 진단 행은 다음과 같이 시작하고 앞과 같은 ` — why: …`가 이어집니다.

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: 1 (+1)
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

**등록 확인하기**

`pdks explain`을 실행하세요(종료 코드 0). 항목의 행은 다음과 같습니다.

```text
  declare  schema-enums-agree pairing · world · equal same-names · scope target.path · include 1 · exclude 0 · sources 2 · valve — · why ✓ · unattended: judge
```

권고 항목이므로 행에 `enforce: block`이 없습니다. diff 생성과 파이프라인 실패 처리는
[Git
검사](../how-to/git-hooks.ko.md#without-a-hook)를
참고하세요.

<a id="change-it"></a>
## 바꿔 쓰기

`sources.left.file`의 `schemas/request.json`과 `sources.right.file`의 `schemas/response.json`을
여러분의 두 파일로 바꾸세요. `scope.include`의 `^schemas/(request|response)\.json$`도 같은 두 경로만
가리키도록 폴더, 파일명, 이스케이프한 점을 함께 바꾸세요. `sources`만 바꾸면 새 파일의 편집은 범위
밖에 남습니다.

`leftValues` 아래와 `rightValues` 아래의 `select.path`를 각각 바꾸세요. 이는
`properties.status.enum` 같은 점 경로이며 `/properties/status/enum` 같은 JSON Pointer가 아닙니다. 두
스키마의 구조가 다를 수 있으므로 선택자를 각각 정하고 enum 배열에 닿는지 확인하세요.

항목에 `why`와 같은 들여쓰기로 `enforce: block`을 추가하면 세션에서 판정하는 편집을 차단할 수
있습니다. 수동 실행에는 `--enforce block`도 필요하며, 없으면 여전히 권고합니다. 규율을 없애려면
항목을 삭제하세요. 바꾼 뒤에는 `pdks explain`을 실행하세요.

<a id="limits"></a>
## 한계

값은 집합으로 비교합니다. `["closed", "open"]`과 `["open", "closed"]`는 같고, `["open", "open"]`과
`["open"]`도 같습니다. 자료형은 구분합니다. request `[1]`과 response `["1"]`은 종료 코드 0으로
권고합니다. 이는 값의 동등성 검사이며 JSON Schema 검증은 아닙니다.

`schemas/response.json`이 없거나 그 내용이 `{ invalid`라면 판정할 수 없습니다. 항목이 권고여도
`blocked`, 종료 코드 2로 끝납니다. 두 파일이 `{}`이면 두 선택자가 빈 집합을 만들어 통과합니다.
response만 `{}`이고 request가 `["open", "closed"]`를 선택하면 권고합니다.

어느 스키마든 삭제하거나 다른 스키마가 없는 상태에서 첫 스키마를 만들어도 판정할 수 없습니다. 작업
트리에서 스키마를 삭제하는 diff도 마찬가지입니다. 두 표면 모두 판정할 수 없는 입력은
`--enforce block` 유무와 관계없이 `blocked`를 기록하며 종료 코드는 2입니다. 스키마를 더 이상
사용하지 않아 삭제할 때는 같은 변경에서 항목을 없애거나 바꾸세요. 두 파일이 모두 생긴 뒤에 항목을
추가하세요.

두 파일을 하나씩 편집하면 첫 편집에서 권고합니다. response가 아직 `open`만 담고 있을 때 request에
`closed`를 추가하면 잠시 값이 달라집니다. 세션에서는 제안한 내용과 디스크의 다른 파일을 비교합니다.

변경 집합 표면에서는 두 스키마를 작업 트리에서 읽습니다. diff가 `["closed"]`를 제안해도 현재 두
파일이 `["open"]`이면 통과합니다. 스테이징한 diff나 브랜치 diff를 검사할 때 작업 트리는 판정하려는
리비전의 내용과 같아야 합니다. CI에서는 깨끗한 체크아웃을 사용하세요. 부분 스테이징에서는 판정한
내용과 스테이징한 내용이 다를 수 있습니다.

`echo changed > schemas/request.json` 같은 셸 쓰기는 세션 표면에서 `skipped`와 `no-observation`을
기록합니다. diff를 생성하면 변경 집합 표면이 그 결과를 판정합니다.

이 검사들은 판정기를 확인하며 실제 호스트의 전달을 입증하지는 않습니다. 어댑터나 판정기가 시작되지
못하면 호출은 판정 없이 진행됩니다. 세션을 연결한 뒤 `.polydeukes/roi.log`에 예상한 행이 있는지
확인하세요.
