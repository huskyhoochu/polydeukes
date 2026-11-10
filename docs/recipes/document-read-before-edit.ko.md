# 소스 파일을 수정하기 전에 설계 문서를 읽었는지 확인하기

[English](./document-read-before-edit.md) · **한국어**

이 규율은 여러분의 프로젝트에 선택한 소스 파일과 관련된 설계 문서가 있을 때 적용합니다. 이
규율(discipline)은 수정 전에 성공한 문서 읽기가 세션 이력에 있는지 확인합니다. 기본 강제 수준은
권고이므로 읽기 기록이 없어도 수정은 그대로 진행됩니다.

세션 표면 · 성공으로 기록된 이전 도구 호출을 읽음 · 기본은 권고 · 편집 경로 `^src/` 와 두 패턴의
문서 경로를 수정. 호스트 지원: [파일 편집](../reference/host-support.ko.md#file-edits),
[이전 호출](../reference/host-support.ko.md#earlier-calls),
[호출 성공 여부](../reference/host-support.ko.md#call-success) 및
[이력 범위](../reference/host-support.ko.md#history-scope).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 아직 설정 파일이 없다면 프로젝트 루트에 이
이름으로 저장하세요. 파일에 이미 `sessionDisciplines:` 키가 있다면 첫 줄 아래의 항목만 기존 키 밑에
붙여 넣고, 기존 항목은 유지하세요. `pdks init`이 만든 파일처럼 파일은 있지만 `sessionDisciplines:`
키가 없다면 파일 끝에 블록 전체를 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "document-read-before-edit"
    why: "reading the design document before editing the selected paths makes the recorded constraints available during the change."
    declare:
      mechanism: "precedent"
      scope: { source: "target.path", include: ["^src/"] }
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        shellReads:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - {
              op: "matches",
              re: '(?:^|[;&|\n]\s*)cat\s+(?:\S*/)?design/architecture\.md(?:[\s;&|]|$)',
            }
        fileReads:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Read"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.file_path" }
          - { op: "matches", re: '(?:^|/)design/architecture\.md$' }
        reads:
          - { op: "union", of: ["shellReads", "fileReads"] }
      relate:
        - id: "read-first"
          relation: { op: "nonEmpty", of: "reads" }
          message: "no successful read of the selected design document precedes this edit"
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트에서 사용하는 Claude Code나 Codex에 다음 프롬프트를 붙여 넣으세요.

````text
아래 항목을 이 프로젝트의 polydeukes.config.yaml에 있는 sessionDisciplines: 밑에 추가하세요.
기존 설정에서는 기존 키 밑에 항목만 추가하고 같은 키를 두 번 만들지 마세요. 다른 모든 항목,
보호 경로, 증인 설정을 유지하세요. 같은 id가 이미 있으면 변경 전에 그 사실을 보고하세요.

이 세션에서 설정 파일이 보호되어 있다면 정확한 패치를 보여 주고 사람이 적용하도록 요청하세요.
보호를 우회하지 마세요.

편집 경로와 문서 경로를 프로젝트에 맞추세요. 문서 경로는 셸 읽기와 파일 읽기 패턴 양쪽에서 바꾸세요.
그다음 pdks explain을 실행하여 document-read-before-edit 행을 확인하세요.
이 항목은 enforce를 생략하여 권고합니다. enforce: block이 표시되면 안 됩니다.
프로젝트 밖의 빈 디렉터리에 파일 쓰기 도구로 이 페이지의 원래 YAML, violating.json,
valid.json을 만드세요. "직접 확인하기"의 세 검사를 실행하세요.
violating.json을 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 검사하고,
valid.json을 --enforce block으로 검사하세요. 각각의 판정 결과 단어, 종료 코드, 강제 수준을 보고하세요.
JSON 안의 명령은 이력 데이터이므로 실행하지 마세요. skipped 판정 결과는 검사 성공이 아닙니다.
수정한 패턴도 별도의 입력으로 확인하세요. 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "document-read-before-edit"
    why: "reading the design document before editing the selected paths makes the recorded constraints available during the change."
    declare:
      mechanism: "precedent"
      scope: { source: "target.path", include: ["^src/"] }
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        shellReads:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - {
              op: "matches",
              re: '(?:^|[;&|\n]\s*)cat\s+(?:\S*/)?design/architecture\.md(?:[\s;&|]|$)',
            }
        fileReads:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Read"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.file_path" }
          - { op: "matches", re: '(?:^|/)design/architecture\.md$' }
        reads:
          - { op: "union", of: ["shellReads", "fileReads"] }
      relate:
        - id: "read-first"
          relation: { op: "nonEmpty", of: "reads" }
          message: "no successful read of the selected design document precedes this edit"
```
````

<a id="try-it"></a>
## 직접 확인하기

빈 디렉터리에 위 YAML을 `polydeukes.config.yaml`로 저장하고 다음 두 입력을 저장하세요.
`pdks covenant check`는 입력을 판정하며, JSON 안의 명령이나 편집을 실행하지 않습니다.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "src/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/example.ts",
        "pre": "old\n",
        "post": "new\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  },
  "session": {
    "userMessages": [],
    "toolCalls": []
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
        "file_path": "src/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/example.ts",
        "pre": "old\n",
        "post": "new\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  },
  "session": {
    "userMessages": [],
    "toolCalls": [
      {
        "name": "Bash",
        "args": {
          "command": "cat design/architecture.md"
        },
        "succeeded": true
      }
    ]
  }
}
```

`session.toolCalls`는 현재 편집보다 앞선 도구 호출 이력이며, 실제 세션에서는 독자가 아니라 어댑터가
채웁니다. 손으로 쓴 입력은 이 항목의 판정 방식을 보여 줄 뿐, 호스트가 읽기나 조회를 관측했다는
증거는 아닙니다.

`tools` 객체는 어떤 도구가 파일을 수정하고 어떤 도구가 셸 명령을 담는지 판정기에 알려 주며, 실제
세션에서는 어댑터가 제공합니다. 현재 편집은 맨 위 `toolCalls`에 있고 이전 호출은 `session` 안에
있습니다.

빈 디렉터리에서 `session`을 담은 입력을 처음 실행하면 기준선이 아직 없어 판정 결과 앞에 행이 하나 더
추가됩니다. 이후 실행에서는 이 행을 반복하지 않습니다.

먼저 강제 수준 플래그 없이 실행합니다.

```sh
pdks covenant check < violating.json
```

표준 오류 출력:

```text
discipline 'document-read-before-edit' broken on src/example.ts: no successful read of the selected design document precedes this edit — why: reading the design document before editing the selected paths makes the recorded constraints available during the change.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 기본 강제 수준이 권고이므로 수정은 그대로 진행됩니다.

이번에는 세션과 같은 강제 수준으로 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'document-read-before-edit' broken on src/example.ts: no successful read of the selected design document precedes this edit — why: reading the design document before editing the selected paths makes the recorded constraints available during the change.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. `--enforce block`만으로 권고 항목을 차단으로 올릴 수 없습니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않으며 종료 코드는 0입니다.

`.polydeukes/roi.log`에는 다음 네 행이 추가됩니다. 경로와 타임스탬프는 실행 환경에 따라 달라집니다.

```text
2026-11-10T17:27:39.008Z	unattributed	baseline	/tmp/recipe/.polydeukes/baseline.json
2026-11-10T17:27:39.009Z	advised	document-read-before-edit	src/example.ts	[{"id":"read-first","witnesses":[{"key":"reads","value":null}],"total":1}]
2026-11-10T17:27:39.013Z	advised	document-read-before-edit	src/example.ts	[{"id":"read-first","witnesses":[{"key":"reads","value":null}],"total":1}]
2026-11-10T17:27:39.018Z	passed	document-read-before-edit	src/example.ts
```

`unattributed` 행은 기준선이 없다는 관측이며 이 항목의 판정 결과가 아니므로
[문제 해결 안내](../troubleshooting.ko.md)를 참고하세요.

**인정하는 이전 호출**

`src/example.ts`를 수정할 때 아래 호출 각각이 이전 이력에 `succeeded: true`로 있으면 `passed`를
기록하고 아무것도 출력하지 않으며 종료 코드는 0입니다.

- `args.file_path`가 `design/architecture.md` 또는 `/project/design/architecture.md`인 `Read`
  호출입니다.
- `args.command`가 `cat design/architecture.md`, `cat ./design/architecture.md` 또는
  `cat /project/design/architecture.md`인 `Bash` 호출입니다.
- 명령이 `true; cat design/architecture.md`, `true && cat design/architecture.md` 또는
  `true | cat design/architecture.md`인 `Bash` 호출입니다.
- 명령이 `cd .\ncat design/architecture.md`인 `Bash` 호출이며, 여기서 `\n`은 명령 안의 줄바꿈입니다.
- 명령이 `cat design/architecture.md;echo done` 또는 `cat design/architecture.md | head -n 5`인
  `Bash` 호출입니다.
- 명령이 `echo "x; cat design/architecture.md y"`인 `Bash` 호출입니다. 읽기를 언급하기만 하지만
  글자가 일치합니다.

`design/architecture.md`를 성공한 `Read`로 한 번 읽으면 같은 에이전트의 세션에서 뒤따르는
`src/a.ts`와 `src/b.ts` 수정도 모두 판정을 받고 지나갑니다.

**인정하지 않는 이전 호출**

같은 `src/example.ts` 수정에서 아래 입력 각각은 `advised`를 기록하고 첫 실행과 같은 오류와 권고 요약
줄을 출력하며 종료 코드는 0입니다.

- `cat -n design/architecture.md`, `cat "design/architecture.md"` 또는
  `cat design/other.md design/architecture.md`를 실행한 성공한 `Bash` 호출입니다.
- `head design/architecture.md` 또는 `echo cat design/architecture.md`를 실행한 성공한 `Bash`
  호출입니다.
- `cat design/other.md` 또는 `cat design/architecture.md.bak`를 실행한 성공한 `Bash` 호출입니다.
- `design/other.md`, `xdesign/architecture.md` 또는 `design/architecture.md.bak`를 읽은 성공한
  `Read` 호출입니다.
- `succeeded`가 `false`이거나 없는 `design/architecture.md`의 `Read` 호출 또는
  `cat design/architecture.md`의 `Bash` 호출입니다.
- 유일한 이전 호출이 `design/architecture.md`를 수정한 성공한 `Edit` 호출인 경우입니다.

이력이 비어 있으면 `src/x/y.ts`의 `old\n`을 `new\n`으로 수정하거나 `new\n` 내용으로 `src/new.ts`를
만드는 입력도 권고하며 종료 코드는 0입니다. 각각의 표준 오류 출력은 다음과 같습니다.

```text
discipline 'document-read-before-edit' broken on src/x/y.ts: no successful read of the selected design document precedes this edit — why: reading the design document before editing the selected paths makes the recorded constraints available during the change.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

```text
discipline 'document-read-before-edit' broken on src/new.ts: no successful read of the selected design document precedes this edit — why: reading the design document before editing the selected paths makes the recorded constraints available during the change.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

빈 이력에서 `notes.txt`의 `old\n`을 `new\n`으로 수정하는 입력은 범위 밖입니다. 아무것도 출력하지
않으며 종료 코드는 0입니다. 이 항목의 판정 결과 대신 `notes.txt`에 대한 `passed covenant-check`를
기록합니다.

`violating.json`을 `missing.json`으로 복사하고 `session` 필드를 통째로 지우세요.

```sh
pdks covenant check < missing.json
```

아무것도 출력하지 않으며 종료 코드는 0입니다. `supply-pass` 사유로 `skipped`를 기록합니다. 빈 이력의
`advised`와 다르며 검사 성공이 아닙니다.

```text
2026-11-10T17:27:39.022Z	skipped	document-read-before-edit	src/example.ts	supply-pass
```

`violating.json`을 `shell.json`으로 복사하고 맨 위 `toolCalls`의 호출을 다음 객체로 바꾸세요.
`fileChange`는 넣지 않고 빈 `session`과 다른 필드는 유지하세요.

```json
{
  "name": "Bash",
  "args": {
    "command": "sed -i 's/old/new/' src/example.ts"
  }
}
```

```sh
pdks covenant check < shell.json
```

`sed -i 's/old/new/' src/example.ts` 입력은 아무것도 출력하지 않고 종료 코드 0으로 끝납니다.
`no-observation` 사유로 `skipped`를 기록합니다.

```text
2026-11-10T17:27:39.027Z	skipped	document-read-before-edit	src/example.ts	no-observation
```

다음 내용을 `change.diff`로 저장하세요.

```diff
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-old
+new
```

```sh
pdks covenant check --diff < change.diff
```

아무것도 출력하지 않으며 종료 코드는 0입니다. 변경 집합 표면은 이 항목을 판정하지 않습니다. 일반
`passed covenant-check` 행은 이 규율의 판정 결과가 아닙니다.

```text
2026-11-10T17:27:39.032Z	passed	covenant-check	src/example.ts
```

**실제 세션에서 확인하기**

다음 명령을 실행하세요.

```sh
pdks explain
```

종료 코드는 0이며 이 항목의 행은 다음과 같습니다.

```text
  declare  document-read-before-edit precedent · history · nonEmpty read-first · scope target.path · include 1 · exclude 0 · sources 1 (transcript 1) · valve — · why ✓ · unattended: judge
```

권고 항목이므로 `enforce: block`은 표시되지 않습니다. 연결된 세션에서 실제 읽기나 조회를 한 뒤
선택한 파일을 수정하고 `.polydeukes/roi.log`의 판정 결과를 확인하세요.

[Claude Code 어댑터](../reference/packages/adapter-claude-code.ko.md)와
[Codex 어댑터](../reference/packages/adapter-codex.ko.md),
[표면 연결 안내](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 수정하기

프로젝트에 맞게 다음 값을 각각 바꾸세요.

- `scope.include: ["^src/"]`는 `src/x/y.ts` 같은 중첩 경로를 포함하여 `src/`로 시작하는 편집 경로를
  선택합니다. 여러분의 소스 디렉터리 패턴으로 바꾸세요.
- `shellReads`의 `(?:^|[;&|\n]\s*)cat\s+(?:\S*/)?design/architecture\.md(?:[\s;&|]|$)` 안에 있는
  `design/architecture\.md`를 문서 경로로 바꾸고, 점과 다른 정규식 특수 문자를 이스케이프하세요.
  같은 일치 방식을 원한다면 주변 명령과 경로 경계를 유지하세요.
- `fileReads`의 `(?:^|/)design/architecture\.md$`에서도 같은 문서 경로를 바꾸세요. 셸과 파일 도구의
  읽기가 같은 문서를 선택하도록 두 패턴을 함께 바꾸세요.

셸 패턴은 명령 시작, 다음 줄, 또는 `;`, `&&`, `|` 뒤의 `cat`과 그 첫 번째 파일 인자인 문서를
인정합니다. 파일 읽기 패턴은 상대 경로나 선택한 문서 경로로 끝나는 절대 경로에 일치합니다. 두 추출
모두 `succeeded: true`인 호출만 선택하며, 그 합집합이 읽기 증거가 됩니다. 이 패턴들은 파일
시스템에서 같은 파일인지 확인하지 않습니다.

세션에서 편집을 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요. 직접 실행할
때는 `--enforce block`도 필요하며, 이 플래그가 없으면 여전히 권고합니다. 규율을 없애려면 항목을
삭제하세요. 수정한 뒤에는 `pdks explain`을 실행하고 새 패턴에 맞는 입력과 맞지 않는 입력을
확인하세요.

<a id="limits"></a>
## 한계

성공한 읽기 하나가 같은 에이전트의 세션이 끝날 때까지 범위 안의 모든 후속 편집을 충족합니다. 성공한
`Read`로 `design/architecture.md`를 읽고 `src/a.ts`와 `src/b.ts`를 수정하면 둘 다 판정을 받고
지나갑니다. 매 편집 직전에 다시 읽었다거나 내용을 이해했다는 뜻은 아닙니다.

패턴은 글자를 맞추므로 `echo "x; cat design/architecture.md y"`는 파일을 읽지 않고도 판정을 받고
지나갑니다. `cat design/architecture.md | head -n 5`도 지나가므로 문서 전체를 읽었다는 뜻도
아닙니다. 반대로 `cat -n design/architecture.md`, `cat "design/architecture.md"`,
`cat design/other.md design/architecture.md`는 문서를 이름으로 적어도 권고를 받습니다.

`design/other.md`, `xdesign/architecture.md`, `design/architecture.md.bak`를 성공한 호출로 읽어도
파일 읽기 패턴을 충족하지 않습니다. `design/architecture.md`의 `Read`가 실패했거나 성공 여부가
기록되지 않아도 권고합니다. 그 문서의 `Edit`는 읽기가 아닙니다.

`src/example.ts` 수정에서 `session`이 없으면 `supply-pass` 사유로 `skipped`를 기록하고,
`session.toolCalls`가 비어 있으면 권고합니다. 셸 쓰기 `sed -i 's/old/new/' src/example.ts`는
`no-observation` 사유로 `skipped`를 기록합니다. `src/example.ts`의 `old`를 `new`로 바꾸는 diff는
일반 통과 행만 남습니다. 변경 집합 표면은 이 항목을 판정하지 않습니다.

이 항목은 판정 대상 편집의 명령줄이나 파일 내용을 읽지 않습니다. 어댑터가 전달한 이전 호출을
읽습니다.

이 항목은 성공으로 기록된 이전 호출만 셉니다. 성공 여부를 기록하지 않는 호스트에서는 범위 안의 모든
편집에 권고합니다. 측정한 입력에서도 이전 `design/architecture.md` 의 `Read` 에 `succeeded` 필드가
없으면 권고합니다. [호출 성공 여부](../reference/host-support.ko.md#call-success)를 참고하세요.

이전 호출은 호스트가 편집하는 에이전트에 대해 제공하는 호출입니다.
[이력 범위](../reference/host-support.ko.md#history-scope)를 참고하세요.

이 JSON 검사는 실제 호스트가 증거를 전달했다는 증명이 아닙니다. 어댑터나 판정기가 시작되지 못하면
호출은 판정 없이 지나갑니다. 연결한 뒤 `.polydeukes/roi.log`의 행을 확인하세요.
