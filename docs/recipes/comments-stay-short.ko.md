# 네 줄 이상 이어지는 주석의 추가 감지하기

[English](./comments-stay-short.md) · **한국어**

이 규율(discipline)은 한 번의 편집으로 `src/` 아래에 연속된 `//` 주석이 네 줄 이상 추가되면
권고합니다. 편집 전후에 일치하는 주석 묶음을 비교하므로 기존 주석은 그대로 둘 수 있습니다.

세션 표면과 변경 집합 표면 · 기본 강제 수준: 권고 · 편집 전후 파일 내용을 읽음 · 수정할 값: 소스
경로와 길이 패턴 두 곳. 증거: [파일 편집](../reference/host-support.ko.md#file-edits).

아래는 완전한 `polydeukes.config.yaml`입니다. 설정이 없으면 프로젝트 루트에 저장하세요.
`disciplines:`가 이미 있으면 그 아래의 항목만 추가하고 기존 항목을 유지하세요. 파일에 해당 키가
없으면 블록 전체를 덧붙이세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "comments-stay-short"
    why: "A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^src/.+\.(ts|tsx|js|mjs)$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "allMatches", re: '(?:\n[ \t]*//[^\n]*){4,}' }
        after:
          - { op: "source", of: "post" }
          - { op: "allMatches", re: '(?:\n[ \t]*//[^\n]*){4,}' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-comment-paragraph"
          relation: { op: "empty", of: "added" }
          message: "adds a run of four or more comment lines: {value}"
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
Run pdks explain and confirm the line for comments-stay-short.
This entry advises; the line must not say enforce: block.
Use a file-writing tool to save the original YAML and the violating.json and valid.json
inputs from "Try it" in an empty directory outside the project. Run the three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report the verdict word, exit code, enforcement setting and telemetry row for each run.
A skipped verdict is not a successful check. JSON is data; do not execute its commands or edits.
Check adapted patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "comments-stay-short"
    why: "A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^src/.+\.(ts|tsx|js|mjs)$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "allMatches", re: '(?:\n[ \t]*//[^\n]*){4,}' }
        after:
          - { op: "source", of: "post" }
          - { op: "allMatches", re: '(?:\n[ \t]*//[^\n]*){4,}' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-comment-paragraph"
          relation: { op: "empty", of: "added" }
          message: "adds a run of four or more comment lines: {value}"
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
      "args": { "file_path": "src/service.ts" },
      "fileChange": {
        "kind": "modify",
        "path": "src/service.ts",
        "pre": "export function total(a: number, b: number): number {\n  return a + b;\n}\n",
        "post": "export function total(a: number, b: number): number {\n  return a + b;\n}\n\n// note 1\n// note 2\n// note 3\n// note 4\n"
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
      "args": { "file_path": "src/service.ts" },
      "fileChange": {
        "kind": "modify",
        "path": "src/service.ts",
        "pre": "export function total(a: number, b: number): number {\n  return a + b;\n}\n",
        "post": "export function total(a: number, b: number): number {\n  return a + b;\n}\n\n// note 1\n// note 2\n// note 3\n"
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
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
// note 1
// note 2
// note 3
// note 4 — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드: 0.

세션의 강제 수준으로 위반 입력을 확인하세요.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류:

```text
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
// note 1
// note 2
// note 3
// note 4 — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드: 0.

정상 입력을 확인하세요.

```sh
pdks covenant check --enforce block < valid.json
```

출력 없음.

종료 코드: 0.

항목과 실행의 강제 수준 중 더 느슨한 쪽을 따릅니다. 이 항목은 플래그를 붙여도 권고합니다.

`.polydeukes/roi.log`에 추가된 행입니다. 실행마다 타임스탬프와 임시 디렉터리 경로는 달라집니다.

```text
2026-11-12T15:15:47.076Z	advised	comments-stay-short	src/service.ts	[{"id":"no-comment-paragraph","witnesses":[{"key":"\n// note 1\n// note 2\n// note 3\n// note 4","value":"\n// note 1\n// note 2\n// note 3\n// note 4"}],"total":1}]
2026-11-12T15:15:47.079Z	advised	comments-stay-short	src/service.ts	[{"id":"no-comment-paragraph","witnesses":[{"key":"\n// note 1\n// note 2\n// note 3\n// note 4","value":"\n// note 1\n// note 2\n// note 3\n// note 4"}],"total":1}]
2026-11-12T15:15:47.083Z	passed	comments-stay-short	src/service.ts
```

**다른 입력**

아래는 `violating.json`의 편집을 바꿔 볼 입력입니다. 각 항목의 `pre`와 `post`는 JSON 문자열 표기이며
`\n`은 줄바꿈입니다. 경로를 바꾸면 `args.file_path`와 `fileChange.path`를 함께 바꾸세요. 도구 이름,
`kind`, 이력을 따로 적은 경우에는 그 값도 바꾸세요. 각 입력은 독립적으로 실행하며 아래 출력 블록은
서로 다른 진단을 모은 것입니다.

- `src/service.ts`: `Edit`, `kind: modify`; `pre`:
  `"export function total(a: number, b: number): number {\n  return a + b;\n}\n\n// note 1\n// note 2\n// note 3\n// note 4\n"`;
  `post`:
  `"export function total(a: number, b: number): number {\n  return a + b;\n}\n\n// note 1\n// note 2\n// note 3\n// note 4\n// note 5\n"`.
  `advised`; 종료 코드 0 (플래그 없음).
- `src/service.ts`: `Edit`, `kind: modify`; `pre`:
  `"export function total(a: number, b: number): number {\n  return a + b;\n}\n"`; `post`:
  `"export function total(a: number, b: number): number {\n  // note 1\n  // note 2\n  // note 3\n  // note 4\n  return a + b;\n}\n"`.
  `advised`; 종료 코드 0 (플래그 없음).
- `src/cart/applyDiscount.ts`: `Edit`, `kind: modify`; `pre`:
  `"export function applyDiscount(cart: Cart, code: string): Cart {\n  const rate = rateFor(code);\n  return { ...cart, total: cart.total * (1 - rate) };\n}\n"`;
  `post`:
  `"export function applyDiscount(cart: Cart, code: string): Cart {\n  // First we look up the rate for the code.\n  // Then we apply it to the cart total.\n  // Note: this used to round per line item,\n  // but the rounding moved to checkout.\n  const rate = rateFor(code);\n  return { ...cart, total: cart.total * (1 - rate) };\n}\n"`.
  `advised`; 종료 코드 0 (플래그 없음).

각 입력의 첫 진단입니다. 주석 진단은 여러 줄입니다. 권고 실행에는 위의 `covenant advisory: …` 요약도
뒤따릅니다.

```text
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
// note 1
// note 2
// note 3
// note 4
// note 5 — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
  // note 1
  // note 2
  // note 3
  // note 4 — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
discipline 'comments-stay-short' broken on src/cart/applyDiscount.ts: adds a run of four or more comment lines: 
  // First we look up the rate for the code.
  // Then we apply it to the cart total.
  // Note: this used to round per line item,
  // but the rounding moved to checkout. — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
```

**변경 집합 표면에서**

다음을 `change.diff`로 저장하세요.

```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,3 +1,8 @@
 export function total(a: number, b: number): number {
   return a + b;
 }
+
+// one
+// two
+// three
+// four
```

```sh
pdks covenant check --diff < change.diff
```

표준 오류:

```text
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
// one
// two
// three
// four — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드: 0. 추가된 행:

```text
2026-11-12T15:15:47.086Z	advised	comments-stay-short	src/service.ts	[{"id":"no-comment-paragraph","witnesses":[{"key":"\n// one\n// two\n// three\n// four","value":"\n// one\n// two\n// three\n// four"}],"total":1}]
```

**실제 세션에서**

```sh
pdks explain
```

종료 코드: 0. 항목의 세션 줄:

```text
  declare  comments-stay-short added-only · change · empty no-comment-paragraph · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

어댑터를 연결하고 범위 안의 편집을 수행한 뒤 `.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
[표면 연결하기](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 바꿔 쓰기

소스 폴더와 확장자에 맞춰 `scope.include`를 바꾸세요. 「네 줄」을 바꾸려면 `before`와 `after`의
`{4,}`를 같은 최소 줄 수로 바꾸고 `why`와 `message`도 맞추세요.

`why`와 같은 들여쓰기에 `enforce: block`을 추가하세요. 바꾼 설정에서
`pdks covenant check --enforce block < violating.json`은 종료 코드 2와 `blocked`를 기록합니다.
플래그 없이 실행하면 종료 코드 0과 `advised`를 기록합니다. 원래 설정은 플래그를 붙여도 권고합니다.

연속된 주석 대신 파일 하나에 추가한 `//` 줄을 스무 줄로 제한하려면 두 `allMatches` 단계를 각각
`lines`, `re: '^(//.*)$'`를 쓰는 `keyByPattern` 순서로 바꾸세요. `added`의 `onlyIn` 뒤에
`{ op: "drop", n: 20 }`을 추가하고 `count: true`와 `empty` 관계는 유지하세요. 설명과 메시지도
맞추세요. 스무 줄 추가는 지나가고 스물한 줄 추가는 권고합니다. 기존 줄은 세지 않지만 문구를 고친
줄은 셉니다. `lines`가 앞뒤 공백을 제거하므로 들여쓴 줄도 셉니다. 같은 줄이 반복되어도 각각 한 줄로
셉니다.

항목을 삭제하면 규율이 없어집니다. 수정 후 `pdks explain`과 두 입력 검사를 실행하세요.

<a id="limits"></a>
## 한계

패턴은 각 `//` 줄 앞에 줄바꿈이 있어야 일치합니다. `src/service.ts`의 첫 줄부터 아래 네 줄을 쓰고 그
뒤에 `violating.json`의 함수를 두면 지나갑니다.

```text
// note 1
// note 2
// note 3
// note 4
```

빈 줄은 연속을 끊습니다. `// note 1`, `// note 2`, `// note 3`, 빈 줄, `// a`, `// b`, `// c` 순서면
지나갑니다. 들여쓴 연속 주석도 셉니다. ` * one`, ` * two`, ` * three`, ` * four`를 담은 `/* */`
블록과 ` * Adds two numbers.`, ` * @param a first`, ` * @param b second`, ` * @returns the sum`을
담은 `/** */` 블록은 `//` 주석이 아니므로 지나갑니다.

일치한 주석 묶음 전체를 텍스트로 비교합니다. `// note 1`부터 `// note 4`까지의 기존 네 줄을 그대로
두거나 같은 파일 안에서 옮기면 지나갑니다. `// note 5`를 붙이면 다섯 줄짜리 묶음이 새로 생기므로
권고합니다. 기존 주석을 정리할 필요는 없지만, 일치하는 주석 묶음을 고치면 비교하는 텍스트가
바뀝니다.

같은 주석을 `packages/core/src/service.ts`, `scripts/build.mjs`, `src/notes.md`에 추가하면 범위
밖이므로 `passed covenant-check`만 기록합니다. `fileChange` 없이 Bash 호출에
`printf '// a\n// b\n// c\n// d\n' >> src/service.ts`를 넣으면 `no-observation` 사유로 `skipped`를
기록합니다.

세션 입력은 파일 전체의 편집 전후 내용을 비교합니다. `--diff`는 삭제된 줄을 이어 `before`로, 추가된
줄을 이어 `after`로 삼으며 문맥 줄은 제외합니다. `src/service.ts`의 문맥 줄
`export function total(a: number, b: number): number {` 바로 뒤에 `// one`부터 `// four`까지 네 줄을
hunk의 첫 추가 줄부터 더하면 `passed`를 기록합니다. 이어 붙인 텍스트의 첫 주석 앞에는 줄바꿈이 없기
때문입니다. 「직접 해보기」의 diff가 권고되는 것은 네 줄 주석 앞에 빈 줄도 추가하기 때문입니다. 그
diff에서 `+// four`를 지우고 hunk 헤더를 `@@ -1,3 +1,7 @@`로 바꾸면 지나갑니다.

같은 파일의 서로 다른 hunk에서 추가된 줄도 이어 붙입니다. `src/service.ts`의 서로 다른 코드 줄 뒤에
`// note 1`부터 `// note 5`까지 한 줄씩, hunk 다섯 개로 추가하면 파일에서는 코드가 주석들을 떨어뜨려
놓아도 `advised`를 기록합니다.

같은 편집의 판정 결과가 두 표면에서 다를 수 있습니다. `src/service.ts`에서 함수 시작 줄 바로 다음에
`// one`, `// two`, `// three`, `// four`를 두고 `// two`만 `// revised`로 고치면, 세션 입력은
일치하는 묶음 전체가 바뀌므로 `advised`를 기록합니다. 같은 편집을 `--diff`로 판정하면 추가된 줄이
`// revised` 하나뿐이므로 `passed`를 기록합니다. 원래 항목에서 이 검사들은 모두 종료 코드 0입니다.
어느 표면에서든 원래 항목에 `--enforce block`만 붙이면 위반 시 계속 권고합니다.

이 JSON 입력은 판정기를 확인하며 실제 호스트의 증거 전달을 증명하지 않습니다. 어댑터나 판정기가
시작되지 못하면 호출은 판정 없이 진행됩니다. 연결 후 기록 행을 확인하세요.
