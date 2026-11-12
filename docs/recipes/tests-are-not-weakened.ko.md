# 테스트 건너뛰기·스냅샷·타임아웃 설정의 추가 감지하기

[English](./tests-are-not-weakened.md) · **한국어**

이 규율(discipline)은 JavaScript나 TypeScript 테스트 파일에 건너뛰기 표시, 스냅샷 단언, 타임아웃
설정이 더해지면 권고합니다. 각 줄에서 처음 일치한 표기별로 줄 수를 셉니다. 타임아웃 설정 줄의 추가를
확인하며 숫자가 늘어났는지는 확인하지 않습니다.

세션 표면과 변경 집합 표면 · 기본 강제 수준은 권고 · 경로와 패턴을 바꾸세요. 호스트 지원:
[파일
편집](../reference/host-support.ko.md#file-edits).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 설정이 없다면 프로젝트 루트에 저장하세요. 이미
`disciplines:` 키가 있으면 그 아래 항목만 추가하고 기존 항목을 유지하세요. 파일은 있지만 키가 없다면
블록 전체를 끝에 추가하세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "tests-are-not-weakened"
    why: "new skipped tests, snapshot assertions, and timeout settings need review."
    declare:
      mechanism: "added-only"
      scope: { source: "target.path", include: ['\.(test|spec)\.[jt]sx?$'] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - {
              op: "keyByPattern",
              re: '(\.skip\s*\(|\b(?:xit|xdescribe|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\b(?:jest|vi)\.setTimeout\s*\(|\bthis\.timeout\s*\(|\b(?:testTimeout|hookTimeout|timeout)\s*:)',
            }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - {
              op: "keyByPattern",
              re: '(\.skip\s*\(|\b(?:xit|xdescribe|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\b(?:jest|vi)\.setTimeout\s*\(|\bthis\.timeout\s*\(|\b(?:testTimeout|hookTimeout|timeout)\s*:)',
            }
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
pdks explain을 실행하여 tests-are-not-weakened 행을 확인하세요.
기본 강제 수준은 권고이므로 enforce: block이 표시되면 안 됩니다.
프로젝트 밖의 빈 디렉터리에 파일 쓰기 도구로 아래 원래 YAML과 "직접 확인하기"의 두 JSON을
저장하세요. violating.json을 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 검사하고,
valid.json을 --enforce block으로 검사하세요. 각각의 판정 결과 단어, 종료 코드, 강제 수준과
기록 행을 보고하세요. skipped 판정 결과는 검사 성공이 아닙니다. JSON 안의 명령은 실행하지 마세요.
수정한 패턴도 별도의 입력으로 확인하세요. 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "tests-are-not-weakened"
    why: "new skipped tests, snapshot assertions, and timeout settings need review."
    declare:
      mechanism: "added-only"
      scope: { source: "target.path", include: ['\.(test|spec)\.[jt]sx?$'] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - {
              op: "keyByPattern",
              re: '(\.skip\s*\(|\b(?:xit|xdescribe|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\b(?:jest|vi)\.setTimeout\s*\(|\bthis\.timeout\s*\(|\b(?:testTimeout|hookTimeout|timeout)\s*:)',
            }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - {
              op: "keyByPattern",
              re: '(\.skip\s*\(|\b(?:xit|xdescribe|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\b(?:jest|vi)\.setTimeout\s*\(|\bthis\.timeout\s*\(|\b(?:testTimeout|hookTimeout|timeout)\s*:)',
            }
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
        "file_path": "src/cart.test.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/cart.test.ts",
        "pre": "",
        "post": "it.skip(\"works\", () => {});\n"
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
        "file_path": "src/cart.test.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/cart.test.ts",
        "pre": "",
        "post": "it(\"works\", () => {});\n"
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
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 이 항목은 권고하므로 편집은 진행됩니다.

세션과 같은 강제 수준으로 위반 입력을 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
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
2026-11-12T11:49:13.494Z	advised	tests-are-not-weakened	src/cart.test.ts	[{"id":"nothing-added","witnesses":[{"key":".skip(","value":"it.skip(\"works\", () => {});"}],"total":1}]
2026-11-12T11:49:13.497Z	advised	tests-are-not-weakened	src/cart.test.ts	[{"id":"nothing-added","witnesses":[{"key":".skip(","value":"it.skip(\"works\", () => {});"}],"total":1}]
2026-11-12T11:49:13.501Z	passed	tests-are-not-weakened	src/cart.test.ts
```

**다른 입력**

`violating.json`의 `fileChange.post`를 아래 입력으로 하나씩 바꿔 다시 검사하세요. `pre`는 빈
문자열로 둡니다. 경로를 따로 적지 않은 입력은 `src/cart.test.ts`를 씁니다. 다른 경로를 쓸 때는
`fileChange.path`와 `args.file_path`를 함께 바꾸세요. 아래 입력은 모두 `advised`를 기록하고 종료
코드 0으로 끝납니다.

- 주석 안의 언급: `// it.skip("works", () => {});`
- 훅 타임아웃 옵션: `const options = { hookTimeout: 5000 };`
- 인라인 스냅샷 단언: `expect(cart).toMatchInlineSnapshot();`
- Jest 타임아웃 호출: `jest.setTimeout(5000);`
- `src/other.test.ts`로 옮겨 온 줄: `it.skip("works", () => {});`
- 스냅샷 단언: `expect(cart).toMatchSnapshot();`
- `.spec.ts` 파일인 `tests/cart.spec.ts`: `it.skip("works", () => {});`
- 문자열 안의 언급: ``const example = `it.skip("works", () => {});`;``
- `.test.jsx` 파일인 `tests/cart.test.jsx`: `it.skip("works", () => {});`
- 테스트 타임아웃 옵션: `const options = { testTimeout: 5000 };`
- 타임아웃 메서드: `this.timeout(5000);`
- 개별 테스트의 타임아웃 옵션: `test("works", { timeout: 5000 }, () => {});`
- Vitest 타임아웃 호출: `vi.setTimeout(5000);`
- 테스트 묶음 건너뛰기: `xdescribe("cart", () => {});`
- 테스트 건너뛰기: `xit("works", () => {});`

입력 순서대로 진단 줄 전체를 모으면 다음과 같습니다:

```text
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: // it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds hookTimeout:: const options = { hookTimeout: 5000 }; — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds toMatchInlineSnapshot(: expect(cart).toMatchInlineSnapshot(); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds jest.setTimeout(: jest.setTimeout(5000); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/other.test.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds toMatchSnapshot(: expect(cart).toMatchSnapshot(); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on tests/cart.spec.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: const example = `it.skip("works", () => {});`; — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on tests/cart.test.jsx: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds testTimeout:: const options = { testTimeout: 5000 }; — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds this.timeout(: this.timeout(5000); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds timeout:: test("works", { timeout: 5000 }, () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds vi.setTimeout(: vi.setTimeout(5000); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds xdescribe(: xdescribe("cart", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds xit(: xit("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
```

각 줄은 진단 줄 전체이며, 각 실행에서는 그 뒤에 위와 같은 권고 요약 줄(`covenant advisory: …`)이
출력됩니다.

- 정상 입력의 파일 내용과 경로를 유지하면 이 항목의 `passed`를 기록합니다.
- 위반 편집의 경로를 `src/cart.ts`로 바꾸면 범위 밖이므로 `passed covenant-check`를 기록합니다.
  아무것도 출력하지 않으며 종료 코드는 0입니다.

**변경 집합 표면에서 확인하기**

다음을 `change.diff`로 저장하세요:

```diff
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-old
+it.skip("works", () => {});
```

```sh
pdks covenant check --diff < change.diff
```

표준 오류 출력:

```text
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 다음 행이 추가됩니다:

```text
2026-11-12T11:49:13.505Z	advised	tests-are-not-weakened	src/cart.test.ts	[{"id":"nothing-added","witnesses":[{"key":".skip(","value":"it.skip(\"works\", () => {});"}],"total":1}]
```

**실제 세션에서 확인하기**

```sh
pdks explain
```

종료 코드는 0입니다. 세션 항목의 행은 다음과 같습니다:

```text
  declare  tests-are-not-weakened added-only · change · empty nothing-added · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

이 행에는 `enforce: block`이 표시되지 않습니다. 어댑터를 연결한 뒤 범위 안의 편집이나 명령을
실행하고 `.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
[표면 연결 안내](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 수정하기

`scope.include`로 검사할 테스트 파일을 고르세요. 설정 파일의 타임아웃도 보려면 그 경로의 패턴을
`scope.include`에 더하세요. 패턴의 갈래는 세 종류입니다.

- 건너뛰기 표시: `\.skip\s*\(`와 이름 묶음 안의 `xit|xdescribe`입니다.
- 스냅샷 단언: 이름 묶음 안의 `toMatchSnapshot|toMatchInlineSnapshot`입니다.
- 타임아웃 설정: `\b(?:jest|vi)\.setTimeout\s*\(`, `\bthis\.timeout\s*\(`,
  `\b(?:testTimeout|hookTimeout|timeout)\s*:`입니다.

검사에서 뺄 표기는 `before`와 `after` 양쪽에서 해당 갈래와 인접한 `|`를 지우세요. 예를 들어 스냅샷
단언을 허용하려면 두 패턴에서 `|toMatchSnapshot|toMatchInlineSnapshot`을 지우세요. 바깥 캡처 그룹과
`count: true`는 유지하세요. 메시지의 `{key}`에는 `.skip(`나 `jest.setTimeout(`처럼 더해진 표기가,
`{value}`에는 그 줄이 나옵니다.

세션에서 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요. 직접 실행할 때는
`--enforce block`도 필요합니다. 위반 입력은 종료 코드 2로 끝나고 `blocked`를 기록합니다. 이 플래그
없이 실행하면 종료 코드는 0이고 `advised`를 기록합니다. 규율을 없애려면 항목을 삭제하세요. 수정한 뒤
`pdks explain`을 실행하고 일치하는 입력과 지나가는 입력을 확인하세요.

<a id="limits"></a>
## 한계

패턴은 JavaScript·TypeScript 테스트 러너의 표기를 맞추며 테스트의 의미를 해석하지 않습니다.
`// it.skip("works", () => {});` 같은 주석과 ``const example = `it.skip("works", () => {});`;`` 같은
문자열도 권고합니다.

`jest.setTimeout(5000);`을 `jest.setTimeout(30000);`으로 바꾸면 일치 키와 줄 수가 같아서 판정을 받고
지나갑니다. `it.only("works", () => {});`나 `const options = { timeoutMs: 5000 };`를 더해도 판정을
받고 지나갑니다. 타임아웃이 늘었는지가 아니라 설정 줄이 더해졌는지를 봅니다.

줄마다 첫 일치만 셉니다. `it.skip("works", () => {});`을 같은 줄에서 두 번 쓰도록 바꾸면 판정을 받고
지나갑니다. 별도의 `it.skip("works", () => {});` 줄을 하나 더하면 권고합니다. 일치하는 줄을 유지한
채 다른 줄의 `old`를 `new`로 바꾸면 판정을 받고 지나갑니다. 그 일치 줄을 `src/other.test.ts`로
옮기면 받는 파일에서 권고합니다. 파일별로 비교하기 때문입니다.

일치한 표기가 키이므로 같은 파일 안에서 각 표기가 일치하는 줄 수가 같으면 판정을 받고 지나갑니다.
예를 들어 `it.skip("a", () => {});` 다음 줄에 `it("b", () => {});`가 있는 내용을
`it("a", () => {});` 다음 줄에 `it.skip("b", () => {});`가 있도록 바꾸면 `passed`를 기록합니다.

`scope.include`는 테스트 파일만 고릅니다. `vitest.config.ts`에
`export default { test: { testTimeout: 60000 } };`를 더하는 편집은 범위 밖이라
`passed covenant-check`만 기록합니다.

다음 셸 쓰기는 `no-observation` 사유로 `skipped`를 기록하고 아무것도 출력하지 않으며 종료 코드 0으로
끝납니다:

```text
echo 'it.skip("works", () => {});' > src/cart.test.ts
```

세션 JSON은 공급된 파일 전체의 전후 내용을 비교하고 diff는 지운 줄과 더한 줄을 비교합니다. 셸 쓰기의
결과 diff는 변경 집합 표면에서 판정할 수 있습니다.

이 JSON 검사는 판정기의 동작을 보여 주며 실제 호스트의 증거 전달을 증명하지 않습니다. 어댑터나
판정기가 시작되지 못하면 호출은 판정 없이 지나갑니다. 연결한 뒤 `.polydeukes/roi.log`에서 이 항목의
행을 확인하세요.
