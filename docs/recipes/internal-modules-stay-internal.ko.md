# 모듈 내부 경로를 가리키는 줄의 추가 감지하기

[English](./internal-modules-stay-internal.md) · **한국어**

이 레시피는 `src/billing/internal/`을 예로 듭니다. `scope.exclude`와 추출 패턴 두 곳의 모듈 경로를
자기 프로젝트에 맞게 바꾸세요. 이 규율(discipline)은 `src/billing/` 밖의 `src/` 파일에 따옴표 안
경로가 `billing/internal` 구성 요소를 포함하는 줄이 더해지면 권고합니다. 줄의 글자를 맞추며 import
문을 해석하지 않습니다.

세션 표면과 변경 집합 표면 · 기본 강제 수준은 권고 · 경로와 패턴을 바꾸세요. 호스트 지원:
[파일
편집](../reference/host-support.ko.md#file-edits).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 설정이 없다면 프로젝트 루트에 저장하세요. 이미
`disciplines:` 키가 있으면 그 아래 항목만 추가하고 기존 항목을 유지하세요. 파일은 있지만 키가 없다면
블록 전체를 끝에 추가하세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "internal-modules-stay-internal"
    why: "imports from other modules should use the billing public entry point."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ["^src/"]
        exclude: ["^src/billing/"]
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '["'']((?:[^"'']*/)?billing/internal(?:/[^"'']*)?)["'']' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '["'']((?:[^"'']*/)?billing/internal(?:/[^"'']*)?)["'']' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "nothing-added"
          relation: { op: "empty", of: "added" }
          message: "adds {key}: {value}"
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
pdks explain을 실행하여 internal-modules-stay-internal 행을 확인하세요.
기본 강제 수준은 권고이므로 enforce: block이 표시되면 안 됩니다.
프로젝트 밖의 빈 디렉터리에 파일 쓰기 도구로 아래 원래 YAML과 "직접 확인하기"의 두 JSON을
저장하세요. violating.json을 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 검사하고,
valid.json을 --enforce block으로 검사하세요. 각각의 판정 결과 단어, 종료 코드, 강제 수준과
기록 행을 보고하세요. skipped 판정 결과는 검사 성공이 아닙니다. JSON 안의 명령은 실행하지 마세요.
수정한 패턴도 별도의 입력으로 확인하세요. 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "internal-modules-stay-internal"
    why: "imports from other modules should use the billing public entry point."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ["^src/"]
        exclude: ["^src/billing/"]
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '["'']((?:[^"'']*/)?billing/internal(?:/[^"'']*)?)["'']' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '["'']((?:[^"'']*/)?billing/internal(?:/[^"'']*)?)["'']' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "nothing-added"
          relation: { op: "empty", of: "added" }
          message: "adds {key}: {value}"
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
        "file_path": "src/checkout.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/checkout.ts",
        "pre": "",
        "post": "import { charge } from \"src/billing/internal/charge\";\n"
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
        "file_path": "src/checkout.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/checkout.ts",
        "pre": "",
        "post": "import { charge } from \"src/billing\";\n"
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
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 이 항목은 권고하므로 편집은 진행됩니다.

세션과 같은 강제 수준으로 위반 입력을 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
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
2026-11-12T11:49:13.472Z	advised	internal-modules-stay-internal	src/checkout.ts	[{"id":"nothing-added","witnesses":[{"key":"src/billing/internal/charge","value":"import { charge } from \"src/billing/internal/charge\";"}],"total":1}]
2026-11-12T11:49:13.475Z	advised	internal-modules-stay-internal	src/checkout.ts	[{"id":"nothing-added","witnesses":[{"key":"src/billing/internal/charge","value":"import { charge } from \"src/billing/internal/charge\";"}],"total":1}]
2026-11-12T11:49:13.478Z	passed	internal-modules-stay-internal	src/checkout.ts
```

**다른 입력**

`violating.json`의 `fileChange.post`를 아래 입력으로 하나씩 바꿔 다시 검사하세요. `pre`는 빈
문자열로 둡니다. 경로를 따로 적지 않은 입력은 `src/checkout.ts`를 씁니다. 다른 경로를 쓸 때는
`fileChange.path`와 `args.file_path`를 함께 바꾸세요. 아래 입력은 모두 `advised`를 기록하고 종료
코드 0으로 끝납니다.

- 별칭 경로: `import { charge } from "@/billing/internal/charge";`
- 접두 없는 경로: `import { charge } from "billing/internal/charge";`
- 주석 안의 언급: `// import { charge } from "src/billing/internal/charge";`
- 동적 import: `const billing = import("src/billing/internal/charge");`
- internal 디렉터리 자체: `import { charge } from "src/billing/internal";`
- `src/other.ts`로 옮겨 온 줄: `import { charge } from "src/billing/internal/charge";`
- 여러 줄 import에서는 경로가 있는 줄이 일치합니다:

  ```text
  import {
    charge,
  } from "src/billing/internal/charge";
  ```

- 재수출: `export { charge } from "src/billing/internal/charge";`
- 상대 경로: `import { charge } from "../billing/internal/charge";`
- 이름이 비슷한 이웃 디렉터리의 `src/billing-ui/form.ts`:
  `import { charge } from "src/billing/internal/charge";`
- 작은따옴표로 감싼 경로: `import charge from 'src/billing/internal/charge';`
- 문자열 안의 언급: ``const example = `import { charge } from "src/billing/internal/charge";`;``

입력 순서대로 진단 줄 전체를 모으면 다음과 같습니다:

```text
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds @/billing/internal/charge: import { charge } from "@/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds billing/internal/charge: import { charge } from "billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: // import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: const billing = import("src/billing/internal/charge"); — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal: import { charge } from "src/billing/internal"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/other.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: export { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds ../billing/internal/charge: import { charge } from "../billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/billing-ui/form.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: import charge from 'src/billing/internal/charge'; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: const example = `import { charge } from "src/billing/internal/charge";`; — why: imports from other modules should use the billing public entry point.
```

각 줄은 진단 줄 전체이며, 각 실행에서는 그 뒤에 위와 같은 권고 요약 줄(`covenant advisory: …`)이
출력됩니다.

- 정상 입력의 파일 내용과 경로를 유지하면 이 항목의 `passed`를 기록합니다.
- 위반 편집의 경로를 `tests/checkout.ts`로 바꾸면 범위 밖이므로 `passed covenant-check`를
  기록합니다. 아무것도 출력하지 않으며 종료 코드는 0입니다.

**변경 집합 표면에서 확인하기**

다음을 `change.diff`로 저장하세요:

```diff
--- a/src/checkout.ts
+++ b/src/checkout.ts
@@ -1 +1 @@
-old
+import { charge } from "src/billing/internal/charge";
```

```sh
pdks covenant check --diff < change.diff
```

표준 오류 출력:

```text
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 다음 행이 추가됩니다:

```text
2026-11-12T11:49:13.481Z	advised	internal-modules-stay-internal	src/checkout.ts	[{"id":"nothing-added","witnesses":[{"key":"src/billing/internal/charge","value":"import { charge } from \"src/billing/internal/charge\";"}],"total":1}]
```

**실제 세션에서 확인하기**

```sh
pdks explain
```

종료 코드는 0입니다. 세션 항목의 행은 다음과 같습니다:

```text
  declare  internal-modules-stay-internal added-only · change · empty nothing-added · scope target.path · include 1 · exclude 1 · sources 0 · valve — · why ✓ · unattended: judge
```

이 행에는 `enforce: block`이 표시되지 않습니다. 어댑터를 연결한 뒤 범위 안의 편집이나 명령을
실행하고 `.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
[표면 연결 안내](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 수정하기

`^src/`를 소스 경로 접두로 바꾸세요. `scope.exclude`의 `^src/billing/`을 모듈 자체의 폴더로 바꾸고
`before`와 `after` 두 곳의 `billing/internal`을 바꾸세요. 두 패턴을 캡처 그룹까지 서로 같게 두고
`count: true`를 유지하세요. 제외 경로는 편집 대상 파일에, 추출 패턴은 파일 내용에서 언급한 경로에
적용됩니다. 호출하는 쪽에서는 `src/billing` 같은 공개 진입점을 쓰세요.

세션에서 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요. 직접 실행할 때는
`--enforce block`도 필요합니다. 위반 입력은 종료 코드 2로 끝나고 `blocked`를 기록합니다. 이 플래그
없이 실행하면 종료 코드는 0이고 `advised`를 기록합니다. 규율을 없애려면 항목을 삭제하세요. 수정한 뒤
`pdks explain`을 실행하고 일치하는 입력과 지나가는 입력을 확인하세요.

<a id="limits"></a>
## 한계

패턴은 주석과 문자열 안에서도 글자를 맞춥니다.
`// import { charge } from "src/billing/internal/charge";`나 위의 문자열 예를 더해도 권고합니다.
따옴표 안의 `src/billing/internal/charge`, `@/billing/internal/charge`,
`../billing/internal/charge`, `billing/internal/charge`, `src/billing/internal`이 일치합니다. 위
입력처럼 재수출, 동적 `import()`, 여러 줄 import의 경로 줄도 권고합니다. `src/billing-ui/form.ts`는
범위 안입니다.

`import { charge } from "@billing/internal/charge";`를 더하거나
``const billing = import(`src/billing/internal/charge`);``를 더하면 판정을 받고 지나갑니다. 이
별칭과 백틱으로 감싼 경로는 일치하지 않습니다.

줄마다 첫 일치만 셉니다. `import { charge } from "src/billing/internal/charge";`을 같은 줄에서 두 번
쓰도록 바꾸면 판정을 받고 지나갑니다. 별도의 `import { charge } from "src/billing/internal/charge";`
줄을 하나 더하면 권고합니다. 일치하는 줄을 유지한 채 다른 줄의 `old`를 `new`로 바꾸면 판정을 받고
지나갑니다. 그 일치 줄을 `src/other.ts`로 옮기면 받는 파일에서 권고합니다. 파일별로 비교하기
때문입니다.

다음 셸 쓰기는 `no-observation` 사유로 `skipped`를 기록하고 아무것도 출력하지 않으며 종료 코드 0으로
끝납니다:

```text
echo 'import { charge } from "src/billing/internal/charge";' > src/checkout.ts
```

세션 JSON은 공급된 파일 전체의 전후 내용을 비교하고 diff는 지운 줄과 더한 줄을 비교합니다. 셸 쓰기의
결과 diff는 변경 집합 표면에서 판정할 수 있습니다.

이 JSON 검사는 판정기의 동작을 보여 주며 실제 호스트의 증거 전달을 증명하지 않습니다. 어댑터나
판정기가 시작되지 못하면 호출은 판정 없이 지나갑니다. 연결한 뒤 `.polydeukes/roi.log`에서 이 항목의
행을 확인하세요.
