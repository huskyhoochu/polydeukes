# 소스 파일 이름의 대문자와 밑줄 감지하기

[English](./file-names-follow-the-convention.md) · **한국어**

이 규율(discipline)은 `src/` 아래 파일 경로의 마지막 구성 요소에 대문자나 밑줄이 있으면 권고합니다.
그런 이름의 기존 파일을 편집해도 권고합니다. 새 파일을 만들 때만 적용되는 검사가 아닙니다.

세션 표면과 변경 집합 표면 · 기본 강제 수준은 권고 · 경로와 패턴을 바꾸세요. 호스트 지원:
[파일
편집](../reference/host-support.ko.md#file-edits).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 설정이 없다면 프로젝트 루트에 저장하세요. 이미
`disciplines:` 키가 있으면 그 아래 항목만 추가하고 기존 항목을 유지하세요. 파일은 있지만 키가 없다면
블록 전체를 끝에 추가하세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "file-names-follow-the-convention"
    why: "consistent file names make source paths easier to read and find."
    declare:
      mechanism: "naming"
      scope: { source: "target.path", include: ["^src/"] }
      extract:
        invalidNames:
          - { op: "source", of: "target.path" }
          - { op: "matches", re: "[^/]*[A-Z_][^/]*$" }
      relate:
        - id: "file-name"
          relation: { op: "empty", of: "invalidNames" }
          message: "use a file name without uppercase letters or underscores: {value}"
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트에서 사용하는 Claude Code나 Codex에 다음 프롬프트를 붙여 넣으세요.

````text
아래 항목을 이 프로젝트의 polydeukes.config.yaml에 있는 disciplines: 밑에 추가하세요.
기존 키 밑에 항목만 추가하고 같은 키를 두 번 만들지 마세요. 다른 항목, 보호 경로, 증인 설정을
유지하세요. 같은 id가 있으면 변경 전에 보고하세요.
설정 파일이 보호되어 있다면 정확한 패치를 보여 주고 사람이 적용하도록 요청하세요.
보호를 우회하지 마세요. "수정하기"의 값을 프로젝트에 맞추세요.
pdks explain을 실행하여 file-names-follow-the-convention 행을 확인하세요.
기본 강제 수준은 권고이므로 enforce: block이 표시되면 안 됩니다.
프로젝트 밖의 빈 디렉터리에 파일 쓰기 도구로 아래 원래 YAML과 "직접 확인하기"의 두 JSON을
저장하세요. violating.json을 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 검사하고,
valid.json을 --enforce block으로 검사하세요. 각각의 판정 결과 단어, 종료 코드, 강제 수준과
기록 행을 보고하세요. skipped 판정 결과는 검사 성공이 아닙니다. JSON 안의 명령은 실행하지 마세요.
수정한 패턴도 별도의 입력으로 확인하세요. 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "file-names-follow-the-convention"
    why: "consistent file names make source paths easier to read and find."
    declare:
      mechanism: "naming"
      scope: { source: "target.path", include: ["^src/"] }
      extract:
        invalidNames:
          - { op: "source", of: "target.path" }
          - { op: "matches", re: "[^/]*[A-Z_][^/]*$" }
      relate:
        - id: "file-name"
          relation: { op: "empty", of: "invalidNames" }
          message: "use a file name without uppercase letters or underscores: {value}"
```
````

<a id="try-it"></a>
## 직접 확인하기

빈 디렉터리에 위 YAML을 `polydeukes.config.yaml`로 저장하고 다음 두 입력을 저장하세요. 판정기는
JSON을 읽으며 그 안의 명령이나 편집을 실행하지 않습니다.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "src/Cart.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/Cart.ts",
        "pre": "old\n",
        "post": "new\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "MultiEdit", "Write", "NotebookEdit"],
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
        "file_path": "src/cart-item.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/cart-item.ts",
        "pre": "old\n",
        "post": "new\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "MultiEdit", "Write", "NotebookEdit"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  }
}
```

`tools` 객체는 파일 편집 도구와 셸 도구를 알려 줍니다. 연결된 세션에서는 어댑터가 제공합니다.

먼저 강제 수준 플래그 없이 실행합니다.

```sh
pdks covenant check < violating.json
```

표준 오류 출력:

```text
discipline 'file-names-follow-the-convention' broken on src/Cart.ts: use a file name without uppercase letters or underscores: src/Cart.ts — why: consistent file names make source paths easier to read and find.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 이 항목은 권고하므로 편집은 진행됩니다.

세션과 같은 강제 수준으로 위반 입력을 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'file-names-follow-the-convention' broken on src/Cart.ts: use a file name without uppercase letters or underscores: src/Cart.ts — why: consistent file names make source paths easier to read and find.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 이 항목은 권고하며 `--enforce block`만으로 차단으로 올릴 수 없습니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않으며 종료 코드는 0입니다.

`.polydeukes/roi.log`에 다음 행이 추가됩니다. 시각은 실행할 때마다 달라집니다.

```text
2026-11-12T11:49:13.542Z	advised	file-names-follow-the-convention	src/Cart.ts	[{"id":"file-name","witnesses":[{"key":"0","value":"src/Cart.ts"}],"total":1}]
2026-11-12T11:49:13.545Z	advised	file-names-follow-the-convention	src/Cart.ts	[{"id":"file-name","witnesses":[{"key":"0","value":"src/Cart.ts"}],"total":1}]
2026-11-12T11:49:13.547Z	passed	file-names-follow-the-convention	src/cart-item.ts
```

**다른 입력**

`violating.json`의 `post`는 `new\n`으로 두고 `fileChange.path`와 `args.file_path`를 아래 경로로 함께
바꾸세요. 다른 필드를 유지한 채 다시 검사하면 `advised`를 기록하고 종료 코드 0으로 끝납니다.

- 이름에 밑줄이 있는 파일 `src/cart_item.ts`: `new`

진단 줄 전체는 다음과 같습니다:

```text
discipline 'file-names-follow-the-convention' broken on src/cart_item.ts: use a file name without uppercase letters or underscores: src/cart_item.ts — why: consistent file names make source paths easier to read and find.
```

이 줄은 진단 줄 전체이며, 각 실행에서는 그 뒤에 위와 같은 권고 요약 줄(`covenant advisory: …`)이
출력됩니다.

- 정상 입력의 파일 내용과 경로를 유지하면 이 항목의 `passed`를 기록합니다.
- 위반 편집의 경로를 `tests/Cart.ts`로 바꾸면 범위 밖이므로 `passed covenant-check`를 기록합니다.
  아무것도 출력하지 않으며 종료 코드는 0입니다.

**변경 집합 표면에서 확인하기**

다음을 `change.diff`로 저장하세요:

```diff
--- a/src/Cart.ts
+++ b/src/Cart.ts
@@ -1 +1 @@
-old
+new
```

```sh
pdks covenant check --diff < change.diff
```

표준 오류 출력:

```text
discipline 'file-names-follow-the-convention' broken on src/Cart.ts: use a file name without uppercase letters or underscores: src/Cart.ts — why: consistent file names make source paths easier to read and find.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 다음 행이 추가됩니다:

```text
2026-11-12T11:49:13.550Z	advised	file-names-follow-the-convention	src/Cart.ts	[{"id":"file-name","witnesses":[{"key":"0","value":"src/Cart.ts"}],"total":1}]
```

**실제 세션에서 확인하기**

```sh
pdks explain
```

종료 코드는 0입니다. 세션 항목의 행은 다음과 같습니다:

```text
  declare  file-names-follow-the-convention naming · change · empty file-name · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

이 행에는 `enforce: block`이 표시되지 않습니다. 어댑터를 연결한 뒤 범위 안의 편집이나 명령을
실행하고 `.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
[표면 연결 안내](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 수정하기

검사할 폴더는 `scope.include`에서, 허용하지 않는 파일 이름 패턴은 `matches.re`에서 바꾸세요.
`[^/]*[A-Z_][^/]*$`는 마지막 경로 구성 요소만 봅니다. 기존 파일이 다른 이름을 쓴다면 해당 경로를
`scope.exclude`에 넣으세요. 예를 들어 `scope` 안에 `exclude: ['^src/Cart\.ts$']`를 추가하면 위의
`src/Cart.ts` 편집은 아무것도 출력하지 않고 종료 코드 0으로 끝납니다. `src/Cart.ts`의
`passed covenant-check` 행만 남고 이 규율의 판정은 받지 않습니다.

세션에서 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요. 직접 실행할 때는
`--enforce block`도 필요합니다. 위반 입력은 종료 코드 2로 끝나고 `blocked`를 기록합니다. 이 플래그
없이 실행하면 종료 코드는 0이고 `advised`를 기록합니다. 규율을 없애려면 항목을 삭제하세요. 수정한 뒤
`pdks explain`을 실행하고 일치하는 입력과 지나가는 입력을 확인하세요.

<a id="limits"></a>
## 한계

마지막 경로 구성 요소만 검사하므로 `src/MyDir/file.ts` 편집은 판정을 받고 지나갑니다. 기존
`src/Cart.ts`를 편집하거나 삭제하면 권고합니다. `src/Cart.ts`를 `src/cart.ts`로 바꾸는 이름 변경
diff는 옛 경로에 권고하고 새 경로에 `passed`를 기록합니다. 반대 방향의 이름 변경도 `src/Cart.ts`에
권고합니다.

셸 명령 `echo content > src/Cart.ts`는 `no-observation` 사유로 `skipped`를 기록하고 아무것도
출력하지 않으며 종료 코드 0으로 끝납니다. 그 결과 파일의 diff는 변경 집합 표면에서 판정할 수
있습니다.

이 JSON 검사는 판정기의 동작을 보여 주며 실제 호스트의 증거 전달을 증명하지 않습니다. 어댑터나
판정기가 시작되지 못하면 호출은 판정 없이 지나갑니다. 연결한 뒤 `.polydeukes/roi.log`에서 이 항목의
행을 확인하세요.
