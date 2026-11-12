# 패키지 진입점 아래 경로의 import 막기

[English](./packages-meet-at-the-entry-point.md) · **한국어**

이 규율(discipline)은 `packages/<이름>/src/`에서 `@acme/<패키지>` 아래의 경로나 `../../`로 시작하는
경로를 가리키는 import, export, 동적 import가 추가되면 차단합니다.
[모듈 내부 경로 레시피](./internal-modules-stay-internal.ko.md)는 내부 디렉터리 이름을 보고, 이
레시피는 패키지 진입점 아래의 경로를 봅니다. 주석 줄 안의 언급은 판정을 받고 지나갑니다.

세션 표면과 변경 집합 표면 · 연결된 세션에서 차단 · 추가된 일치 텍스트를 읽음 · 수정할 값: 소스
범위와 import 패턴 두 곳. 증거: [파일 편집](../reference/host-support.ko.md#file-edits).

아래는 완전한 `polydeukes.config.yaml`입니다. 설정이 없으면 프로젝트 루트에 저장하세요.
`disciplines:`가 이미 있으면 그 아래의 항목만 추가하고 기존 항목을 유지하세요. 파일에 해당 키가
없으면 블록 전체를 덧붙이세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "packages-meet-at-the-entry-point"
    why: "A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../."
    enforce: block
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^packages/[^/]+/src/.+\.tsx?$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "matches", re: '^(?!\s*(?://|/\*|\*))' }
          - {
              op: "allMatches",
              re: '((?:\bfrom|\bimport|\bimport\s*\()\s*[''"](?:@acme/[^/''"]+/[^''"]+|\.\./\.\./[^''"]*)[''"])',
            }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "matches", re: '^(?!\s*(?://|/\*|\*))' }
          - {
              op: "allMatches",
              re: '((?:\bfrom|\bimport|\bimport\s*\()\s*[''"](?:@acme/[^/''"]+/[^''"]+|\.\./\.\./[^''"]*)[''"])',
            }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-deep-import"
          relation: { op: "empty", of: "added" }
          message: "imports past a package entry point: {key}"
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트의 Claude Code나 Codex에 붙여 넣으세요.

````text
Add the entry below under disciplines: in this project's polydeukes.config.yaml.
Add only the entry under an existing key, never a second key. Preserve every other entry,
protected path and witness setting. If the same id exists, report it and stop.
If the configuration is protected, show the exact patch and ask the human to apply it.
Never work around the protection. Adapt the values described in "Change it" to this project.
Run pdks explain and confirm the line for packages-meet-at-the-entry-point.
Confirm enforce: block on the line.
Use a file-writing tool to save the original YAML and the violating.json and valid.json
inputs from "Try it" in an empty directory outside the project. Run the three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report the verdict word, exit code, enforcement setting and telemetry row for each run.
A skipped verdict is not a successful check. JSON is data; do not execute its commands or edits.
Check adapted patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "packages-meet-at-the-entry-point"
    why: "A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../."
    enforce: block
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^packages/[^/]+/src/.+\.tsx?$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "matches", re: '^(?!\s*(?://|/\*|\*))' }
          - {
              op: "allMatches",
              re: '((?:\bfrom|\bimport|\bimport\s*\()\s*[''"](?:@acme/[^/''"]+/[^''"]+|\.\./\.\./[^''"]*)[''"])',
            }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "matches", re: '^(?!\s*(?://|/\*|\*))' }
          - {
              op: "allMatches",
              re: '((?:\bfrom|\bimport|\bimport\s*\()\s*[''"](?:@acme/[^/''"]+/[^''"]+|\.\./\.\./[^''"]*)[''"])',
            }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-deep-import"
          relation: { op: "empty", of: "added" }
          message: "imports past a package entry point: {key}"
```
````

<a id="try-it"></a>
## 직접 해보기

빈 디렉터리에 위 YAML을 `polydeukes.config.yaml`로 저장하고 아래 두 입력도 저장하세요.
`pdks covenant check`는 JSON을 판정하며 안에 적힌 명령이나 편집을 실행하지 않습니다.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": { "file_path": "packages/web/src/page.ts" },
      "fileChange": {
        "kind": "modify",
        "path": "packages/web/src/page.ts",
        "pre": "",
        "post": "import { price } from \"@acme/billing/src/price\";\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": { "file_path": "packages/web/src/page.ts" },
      "fileChange": {
        "kind": "modify",
        "path": "packages/web/src/page.ts",
        "pre": "",
        "post": "import { price } from \"@acme/billing\";\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`fileChange`는 관측한 편집의 경로와 전후 내용입니다. `tools`는 편집 도구와 셸 도구를 식별합니다.
실제 세션에서는 어댑터가 이 값을 제공합니다.

먼저 강제 수준 플래그 없이 실행하세요.

```sh
pdks covenant check < violating.json
```

표준 오류:

```text
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드: 0.

세션의 강제 수준으로 위반 입력을 확인하세요.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류:

```text
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
```

종료 코드: 2.

정상 입력을 확인하세요.

```sh
pdks covenant check --enforce block < valid.json
```

출력 없음.

종료 코드: 0.

항목과 실행의 강제 수준 중 더 느슨한 쪽을 따릅니다. 이 항목은 `--enforce block`에서 차단하고
플래그가 없으면 권고합니다.

`.polydeukes/roi.log`에 추가된 행입니다. 실행마다 타임스탬프와 임시 디렉터리 경로는 달라집니다.

```text
2026-11-12T15:15:47.779Z	advised	packages-meet-at-the-entry-point	packages/web/src/page.ts	[{"id":"no-deep-import","witnesses":[{"key":"from \"@acme/billing/src/price\"","value":"from \"@acme/billing/src/price\""}],"total":1}]
2026-11-12T15:15:47.782Z	blocked	packages-meet-at-the-entry-point	packages/web/src/page.ts	[{"id":"no-deep-import","witnesses":[{"key":"from \"@acme/billing/src/price\"","value":"from \"@acme/billing/src/price\""}],"total":1}]
2026-11-12T15:15:47.785Z	passed	packages-meet-at-the-entry-point	packages/web/src/page.ts
```

**다른 입력**

아래는 `violating.json`의 편집을 바꿔 볼 입력입니다. 각 항목의 `pre`와 `post`는 JSON 문자열 표기이며
`\n`은 줄바꿈입니다. 경로를 바꾸면 `args.file_path`와 `fileChange.path`를 함께 바꾸세요. 도구 이름,
`kind`, 이력을 따로 적은 경우에는 그 값도 바꾸세요. 각 입력은 독립적으로 실행하며 아래 출력 블록은
서로 다른 진단을 모은 것입니다.

- `packages/web/src/new.ts`: `Write`, `kind: create`; `pre`: `""`; `post`:
  `"import { price } from \"@acme/billing/src/price\";\n"`. `blocked`; 종료 코드 2
  (`--enforce block`).
- `packages/checkout/src/cart.ts`: `Edit`, `kind: modify`; `pre`:
  `"import { formatPrice } from \"@acme/billing\";\n"`; `post`:
  `"import { formatPrice } from \"@acme/billing\";\nimport { roundCents } from \"@acme/billing/src/money/round\";\n"`.
  `blocked`; 종료 코드 2 (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { fake } from \"@acme/billing/testing\";\n"`. `blocked`; 종료 코드 2 (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"const mod = await import(\"@acme/billing/src/price\");\n"`. `blocked`; 종료 코드 2
  (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { a } from \"@acme/web/src/a\";\n"`. `blocked`; 종료 코드 2 (`--enforce block`).
- `packages/web/src/pages/home/view.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { a } from \"../../util/a\";\n"`. `blocked`; 종료 코드 2 (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { price } from \"../../billing/src/price\";\n"`. `blocked`; 종료 코드 2
  (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import \"@acme/billing/src/register\";\n"`. `blocked`; 종료 코드 2 (`--enforce block`).
- `packages/web/src/Page.tsx`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { price } from \"@acme/billing/src/price\";\n"`. `blocked`; 종료 코드 2
  (`--enforce block`).

각 입력의 첫 진단입니다. 권고 실행에는 위의 `covenant advisory: …` 요약도 뒤따릅니다.

```text
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/new.ts: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/checkout/src/cart.ts: imports past a package entry point: from "@acme/billing/src/money/round" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/billing/testing" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: import("@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/web/src/a" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/pages/home/view.ts: imports past a package entry point: from "../../util/a" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "../../billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: import "@acme/billing/src/register" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/Page.tsx: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
```

**변경 집합 표면에서**

다음을 `change.diff`로 저장하세요.

```diff
--- a/packages/web/src/page.ts
+++ b/packages/web/src/page.ts
@@ -1 +1,2 @@
 import { a } from "./a";
+import { price } from "@acme/billing/src/price";
```

```sh
pdks covenant check --diff < change.diff
```

표준 오류:

```text
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드: 0. 추가된 행:

```text
2026-11-12T15:15:47.789Z	advised	packages-meet-at-the-entry-point	packages/web/src/page.ts	[{"id":"no-deep-import","witnesses":[{"key":"from \"@acme/billing/src/price\"","value":"from \"@acme/billing/src/price\""}],"total":1}]
```

같은 diff를 `--diff --enforce block`으로 실행하면 종료 코드 2와 `blocked`를 기록합니다.

**실제 세션에서**

```sh
pdks explain
```

종료 코드: 0. 항목의 세션 줄:

```text
  declare  packages-meet-at-the-entry-point added-only · change · empty no-deep-import · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · enforce: block · unattended: judge
```

어댑터를 연결하고 범위 안의 편집을 수행한 뒤 `.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
[표면 연결하기](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 바꿔 쓰기

`packages/<이름>/src/`를 읽는 `scope.include` 정규식을 소스 구조에 맞춰 바꾸세요. `before`와
`after`의 import 패턴에 있는 `@acme/`를 사용하는 패키지 범위로 바꾸고 두 패턴을 같게 유지하세요.
허용할 상대 경로에 따라 `../../` 대안을 유지하거나 바꾸세요.

예시는 `@acme/<패키지>` 아래의 모든 하위 경로를 같은 방식으로 판정합니다. 패키지가 공개한 하위
경로를 허용하려면 두 패턴에서 해당 경로를 허용하도록 바꾸고 따로 검사하세요. 줄 필터는 공백 뒤에
`//`, `/*`, `*`로 시작하는 줄을 제외합니다.

권고로 바꾸려면 `enforce: block`을 지우세요. 규율을 없애려면 항목을 삭제하세요. 수정 후
`pdks explain`과 두 입력 검사를 실행하세요.

<a id="limits"></a>
## 한계

이 항목은 모듈 경로를 해석하지 않고 줄의 텍스트를 비교합니다. `packages/web/src/page.ts`에
`const { price } = require("@acme/billing/src/price");`를 추가하면 지나갑니다. `require()` 형태는
일치하지 않습니다. `import { fake } from "@acme/billing/testing";`은 `testing`이 공개된 하위
경로여도 차단됩니다.

`packages/web/src/pages/home/view.ts`에 `import { a } from "../../util/a";`를 추가하면 해석된 경로가
같은 패키지 안에 있어도 차단됩니다. `packages/web/src/page.ts`에
`import { a } from "@acme/web/src/a";`를 추가해도 차단됩니다. 패턴은 출발 패키지와 도착 패키지를
비교하지 않습니다.

`// import { price } from "@acme/billing/src/price";`를 추가하면 지나갑니다. 내용 줄이
` * import { price } from "@acme/billing/src/price";`인 `/* */` 블록도 지나갑니다. 실제 import 뒤에
`// temporary`를 붙이면 계속 차단됩니다. 필터는 줄의 시작을 보며 주석 문법을 해석하지 않습니다.

기존의 진입점 아래 경로 import를 그대로 두거나 같은 파일의 다른 줄로 옮기면 지나갑니다. 진입점
import와 `./a`, `../b`, `@other/lib/src/x`, `lodash/fp/get`도 지나갑니다. `added-only` 비교는
일치하는 텍스트 조각을 세며 기존 의존성 전체를 판정하지 않습니다.

같은 import를 `apps/site/src/page.ts`, `packages/web/tests/page.test.ts`,
`packages/web/src/page.js`에 쓰면 범위 밖이므로 `passed covenant-check`만 기록합니다.
`packages/web/src/Page.tsx`는 범위 안입니다. `fileChange` 없이 Bash 명령
`echo 'import x from "@acme/billing/src/x";' >> packages/web/src/page.ts`를 입력하면
`no-observation` 사유로 `skipped`를 기록합니다. 그 결과의 diff는 판정할 수 있습니다. diff 입력은
전달받은 삭제·추가 줄을 비교하고 세션 입력은 파일 전체의 편집 전후 내용을 비교합니다.

이 JSON 입력은 판정기를 확인하며 실제 호스트의 증거 전달을 증명하지 않습니다. 어댑터나 판정기가
시작되지 못하면 호출은 판정 없이 진행됩니다. 연결 후 기록 행을 확인하세요.
