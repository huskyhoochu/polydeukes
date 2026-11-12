# 편집 없이 테스트 반복 실행 감지하기

[English](./few-test-runs-per-edit.md) · **한국어**

이 규율(discipline)은 마지막으로 성공한 편집 뒤 네 번째 테스트 실행에서 권고합니다. 판정 대상 호출을
포함한 세션 이력을 읽습니다. 기본 강제 수준은 권고이므로 테스트 명령은 그대로 실행됩니다.

세션 표면 · 호출 성공 여부와 세션 이력을 읽음 · 기본 강제 수준은 권고 · 명령 패턴과 횟수를 바꾸세요.
호스트 지원:
[이전
호출](../reference/host-support.ko.md#earlier-calls),
[호출 성공
여부](../reference/host-support.ko.md#call-success),
[이력
범위](../reference/host-support.ko.md#history-scope).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 설정이 없다면 프로젝트 루트에 저장하세요. 이미
`sessionDisciplines:` 키가 있으면 그 아래 항목만 추가하고 기존 항목을 유지하세요. 파일은 있지만 키가
없다면 블록 전체를 끝에 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "few-test-runs-per-edit"
    why: "several test runs without an edit between them repeat the same check; read the first failure."
    declare:
      mechanism: "scoped-valve"
      scope:
        source: "command"
        include: ['\b(?:(?:pnpm|npm)\s+(?:run\s+)?test|vitest)\b']
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        excessRuns:
          - { op: "source", of: "session" }
          - {
              op: "toolUses",
              names: ["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"],
            }
          - {
              op: "afterLast",
              when: [{ field: "name", ne: "Bash" }, { field: "succeeded", eq: true }],
            }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\b(?:(?:pnpm|npm)\s+(?:run\s+)?test|vitest)\b' }
          - { op: "drop", n: 3 }
      relate:
        - {
            id: "few-runs",
            relation: { op: "empty", of: "excessRuns" },
            message: "more than three test runs since the last edit",
          }
      witness:
        relate:
          - {
              id: "few-runs-valve",
              relation: { op: "empty", of: "excessRuns" },
              message: "more than three test runs since the last edit",
            }
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트에서 사용하는 Claude Code나 Codex에 다음 프롬프트를 붙여 넣으세요.

````text
아래 항목을 이 프로젝트의 polydeukes.config.yaml에 있는 sessionDisciplines: 밑에 추가하세요.
기존 키 밑에 항목만 추가하고 같은 키를 두 번 만들지 마세요. 다른 항목, 보호 경로, 증인 설정을
유지하세요. 같은 id가 있으면 변경 전에 보고하세요.
설정 파일이 보호되어 있다면 정확한 패치를 보여 주고 사람이 적용하도록 요청하세요.
보호를 우회하지 마세요. "수정하기"의 값을 프로젝트에 맞추세요.
pdks explain을 실행하여 few-test-runs-per-edit 행을 확인하세요.
기본 강제 수준은 권고이므로 enforce: block이 표시되면 안 됩니다.
프로젝트 밖의 빈 디렉터리에 파일 쓰기 도구로 아래 원래 YAML과 "직접 확인하기"의 두 JSON을
저장하세요. violating.json을 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 검사하고,
valid.json을 --enforce block으로 검사하세요. 각각의 판정 결과 단어, 종료 코드, 강제 수준과
기록 행을 보고하세요. skipped 판정 결과는 검사 성공이 아닙니다. JSON 안의 명령은 실행하지 마세요.
수정한 패턴도 별도의 입력으로 확인하세요. 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "few-test-runs-per-edit"
    why: "several test runs without an edit between them repeat the same check; read the first failure."
    declare:
      mechanism: "scoped-valve"
      scope:
        source: "command"
        include: ['\b(?:(?:pnpm|npm)\s+(?:run\s+)?test|vitest)\b']
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        excessRuns:
          - { op: "source", of: "session" }
          - {
              op: "toolUses",
              names: ["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"],
            }
          - {
              op: "afterLast",
              when: [{ field: "name", ne: "Bash" }, { field: "succeeded", eq: true }],
            }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\b(?:(?:pnpm|npm)\s+(?:run\s+)?test|vitest)\b' }
          - { op: "drop", n: 3 }
      relate:
        - {
            id: "few-runs",
            relation: { op: "empty", of: "excessRuns" },
            message: "more than three test runs since the last edit",
          }
      witness:
        relate:
          - {
              id: "few-runs-valve",
              relation: { op: "empty", of: "excessRuns" },
              message: "more than three test runs since the last edit",
            }
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
      "name": "Bash",
      "args": {
        "command": "pnpm test"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "MultiEdit", "Write", "NotebookEdit"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  },
  "session": {
    "userMessages": [],
    "toolCalls": [
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      }
    ]
  }
}
```

`valid.json`:

```json
{
  "toolCalls": [
    {
      "name": "Bash",
      "args": {
        "command": "pnpm test"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "MultiEdit", "Write", "NotebookEdit"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  },
  "session": {
    "userMessages": [],
    "toolCalls": [
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Edit",
        "args": {
          "file_path": "src/cart.ts"
        },
        "fileChange": {
          "kind": "modify",
          "path": "src/cart.ts",
          "pre": "old",
          "post": "new"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      }
    ]
  }
}
```

`tools` 객체는 파일 편집 도구와 셸 도구를 알려 줍니다. 연결된 세션에서는 어댑터가 제공합니다.

여기서 `session.toolCalls`는 현재 호출을 포함합니다. 일치하는 호출 네 번이면 권고하고 성공한 `Edit`
뒤 세 번이면 판정을 받고 지나갑니다. 실제 세션에서는 어댑터가 이력을 제공합니다. 빈 디렉터리에서
처음 실행하면 기준선이 없어 아래의 `unattributed` 행도 남습니다.

먼저 강제 수준 플래그 없이 실행합니다.

```sh
pdks covenant check < violating.json
```

표준 오류 출력:

```text
discipline 'few-test-runs-per-edit' broken on -: more than three test runs since the last edit — why: several test runs without an edit between them repeat the same check; read the first failure.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 이 항목은 권고하므로 테스트 명령은 실행됩니다.

세션과 같은 강제 수준으로 위반 입력을 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'few-test-runs-per-edit' broken on -: more than three test runs since the last edit — why: several test runs without an edit between them repeat the same check; read the first failure.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 이 항목은 권고하며 `--enforce block`만으로 차단으로 올릴 수 없습니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않으며 종료 코드는 0입니다.

`.polydeukes/roi.log`에 다음 행이 추가됩니다. 타임스탬프와 기준선 경로는 실행 환경에 따라
달라집니다.

```text
2026-11-12T11:49:13.518Z	unattributed	baseline	/tmp/docs47-namahoqp/.polydeukes/baseline.json
2026-11-12T11:49:13.519Z	advised	few-test-runs-per-edit	-	[{"id":"few-runs","witnesses":[{"key":"3","value":"pnpm test"}],"total":1}]
2026-11-12T11:49:13.522Z	advised	few-test-runs-per-edit	-	[{"id":"few-runs","witnesses":[{"key":"3","value":"pnpm test"}],"total":1}]
2026-11-12T11:49:13.525Z	passed	few-test-runs-per-edit	-
```

`unattributed`는 기준선에 대한 관측이며 이 항목의 판정 결과가 아닙니다.
[문제 해결 안내](../troubleshooting.ko.md)를 참고하세요.

**다른 입력**

- 현재 명령과 이력의 네 호출을 각각 `npm test`, `npm run test`, `vitest`로 바꾸면 위와 같은 표준
  오류를 출력하며 권고하고 종료 코드는 0입니다.
- 성공한 `src/cart.ts`의 `Write` 뒤 `pnpm test` 세 번도 `Edit`처럼 판정을 받고 지나갑니다.
- 성공한 `apply_patch` 호출 뒤의 `pnpm test` 세 번도 `Edit`처럼 판정을 받고 지나갑니다.
- 현재 명령이 `pnpm build`이면 `pnpm test` 네 번 뒤에도 범위 밖입니다. `-`의
  `passed covenant-check`만 기록하고 아무것도 출력하지 않으며 종료 코드는 0입니다.

**변경 집합 표면에서 확인하기**

다음을 `change.diff`로 저장하세요:

```diff
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1 +1 @@
-old
+new
```

```sh
pdks covenant check --diff < change.diff
```

아무것도 출력하지 않습니다. 이 표면은 이 세션 항목을 판정하지 않습니다.

종료 코드는 0입니다. 다음 행이 추가됩니다:

```text
2026-11-12T11:49:13.528Z	passed	covenant-check	src/cart.ts
```

**실제 세션에서 확인하기**

```sh
pdks explain
```

종료 코드는 0입니다. 세션 항목의 행은 다음과 같습니다:

```text
  declare  few-test-runs-per-edit scoped-valve · history · empty few-runs · scope command · include 1 · exclude 0 · sources 1 (transcript 1) · valve ✓ · why ✓ · unattended: judge
```

이 행에는 `enforce: block`이 표시되지 않습니다. 어댑터를 연결한 뒤 범위 안의 편집이나 명령을
실행하고 `.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
[표면 연결 안내](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 수정하기

횟수는 `drop`의 `n`입니다. `n: 3`이면 넷째 실행에서 권고합니다. 횟수를 바꾸면 메시지 두 곳도
맞추세요. 테스트 명령 패턴은 `scope.include`와 `matches`에 같은 글자로 있으므로 함께 바꾸세요.
`witness` 블록은 `scoped-valve`가 요구하며 본문과 같은 `excessRuns`를 검사하므로 위반을 지나가게
하지 않습니다.
[추출 결과의 개수 제한하기](../reference/declaration-language/index.ko.md#bound-the-count)를
참고하세요.

`toolUses`의 `names`는 셸 도구와 횟수를 되돌리는 경계가 되는 편집 도구의 이름 목록이며, 목록에 없는
도구의 호출은 경계가 되지 않으므로 호스트의 편집 도구 이름이 다르면 더하세요.

차단으로 올리기 전에 [호출 성공 여부](../reference/host-support.ko.md#call-success)를 확인하세요.
성공 여부가 공급되지 않으면 편집이 경계가 되지 않아 넷째 실행부터 계속 차단됩니다.

세션에서 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요. 직접 실행할 때는
`--enforce block`도 필요합니다. 위반 입력은 종료 코드 2로 끝나고 `blocked`를 기록합니다. 이 플래그
없이 실행하면 종료 코드는 0이고 `advised`를 기록합니다. 규율을 없애려면 항목을 삭제하세요. 수정한 뒤
`pdks explain`을 실행하고 일치하는 입력과 지나가는 입력을 확인하세요.

<a id="limits"></a>
## 한계

현재 명령이 `pnpm test`일 때 `session`이 없으면 `supply-pass` 사유로 `skipped`를 기록합니다.
`session.toolCalls`가 비어 있으면 이 항목의 `passed`를 기록합니다. 둘 다 아무것도 출력하지 않고 종료
코드 0으로 끝납니다.

`pnpm test` 세 번 뒤 `src/cart.ts`의 `old`를 `new`로 바꾸는 `Edit`에 `succeeded: false`가 있거나
`succeeded`가 없으면, 이어지는 넷째 `pnpm test`에서 권고합니다. 그 편집은 횟수를 세는 경계가 되지
않습니다. 실패한 `pnpm test` 네 번도 권고합니다. 테스트 성공 여부로 실행을 거르지 않습니다.
`pnpm test` 세 번 뒤 `echo "pnpm test"`가 와도 명령 글자가 일치하여 권고합니다.
[호출 성공
여부](../reference/host-support.ko.md#call-success)와
[이력
범위](../reference/host-support.ko.md#history-scope)를
참고하세요.

변경 집합 표면은 세션 이력을 판정하지 않습니다. 위의 `src/cart.ts` diff는 일반
`passed covenant-check`만 남기며 이 규율의 판정 결과가 아닙니다.

이 JSON 검사는 판정기의 동작을 보여 주며 실제 호스트의 증거 전달을 증명하지 않습니다. 어댑터나
판정기가 시작되지 못하면 호출은 판정 없이 지나갑니다. 연결한 뒤 `.polydeukes/roi.log`에서 이 항목의
행을 확인하세요.
