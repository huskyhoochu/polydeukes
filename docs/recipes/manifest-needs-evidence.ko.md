# package.json을 수정하기 전에 레지스트리를 조회했는지 확인하기

[English](./manifest-needs-evidence.md) · **한국어**

이 규율은 여러분의 프로젝트가 npm 레지스트리에서 의존성을 가져오고 루트의 `package.json`을
매니페스트로 사용할 때 적용합니다. 이 규율(discipline)은 수정 전에 성공한 `npm view` 호출이 세션
이력에 있는지 확인합니다. 기본 강제 수준은 권고이므로 조회 기록이 없어도 수정은 그대로 진행됩니다.

세션 표면 · 성공으로 기록된 이전 도구 호출을 읽음 · 기본은 권고 · 매니페스트가 루트에 없을 때만
매니페스트 경로를 수정. 호스트 지원: [파일 편집](../reference/host-support.ko.md#file-edits),
[이전 호출](../reference/host-support.ko.md#earlier-calls),
[호출 성공 여부](../reference/host-support.ko.md#call-success) 및
[이력 범위](../reference/host-support.ko.md#history-scope).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 아직 설정 파일이 없다면 프로젝트 루트에 이
이름으로 저장하세요. 파일에 이미 `sessionDisciplines:` 키가 있다면 첫 줄 아래의 항목만 기존 키 밑에
붙여 넣고, 기존 항목은 유지하세요. `pdks init`이 만든 파일처럼 파일은 있지만 `sessionDisciplines:`
키가 없다면 파일 끝에 블록 전체를 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "manifest-needs-evidence"
    why: "a dependency edit should follow a registry lookup rather than rely on remembered versions."
    declare:
      mechanism: "precedent"
      scope: { source: "target.path", include: ['^package\.json$'] }
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        npmView:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\bnpm view ' }
      relate:
        - id: "npm-view"
          relation: { op: "nonEmpty", of: "npmView" }
          message: "no successful npm view precedes this manifest edit"
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

루트 package.json이면 경로를 유지하고, 다른 위치라면 매니페스트 경로를 맞추세요.
그다음 pdks explain을 실행하여 manifest-needs-evidence 행을 확인하세요.
이 항목은 enforce를 생략하여 권고합니다. enforce: block이 표시되면 안 됩니다.
프로젝트 밖의 빈 디렉터리에 파일 쓰기 도구로 이 페이지의 원래 YAML, violating.json,
valid.json을 만드세요. "직접 확인하기"의 세 검사를 실행하세요.
violating.json을 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 검사하고,
valid.json을 --enforce block으로 검사하세요. 각각의 판정 결과 단어, 종료 코드, 강제 수준을 보고하세요.
JSON 안의 명령은 이력 데이터이므로 실행하지 마세요. skipped 판정 결과는 검사 성공이 아닙니다.
수정한 패턴도 별도의 입력으로 확인하세요. 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "manifest-needs-evidence"
    why: "a dependency edit should follow a registry lookup rather than rely on remembered versions."
    declare:
      mechanism: "precedent"
      scope: { source: "target.path", include: ['^package\.json$'] }
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        npmView:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\bnpm view ' }
      relate:
        - id: "npm-view"
          relation: { op: "nonEmpty", of: "npmView" }
          message: "no successful npm view precedes this manifest edit"
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
        "file_path": "package.json"
      },
      "fileChange": {
        "kind": "modify",
        "path": "package.json",
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
        "file_path": "package.json"
      },
      "fileChange": {
        "kind": "modify",
        "path": "package.json",
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
          "command": "npm view example version"
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
discipline 'manifest-needs-evidence' broken on package.json: no successful npm view precedes this manifest edit — why: a dependency edit should follow a registry lookup rather than rely on remembered versions.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 기본 강제 수준이 권고이므로 수정은 그대로 진행됩니다.

이번에는 세션과 같은 강제 수준으로 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'manifest-needs-evidence' broken on package.json: no successful npm view precedes this manifest edit — why: a dependency edit should follow a registry lookup rather than rely on remembered versions.
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
2026-11-10T17:27:39.038Z	unattributed	baseline	/tmp/recipe/.polydeukes/baseline.json
2026-11-10T17:27:39.038Z	advised	manifest-needs-evidence	package.json	[{"id":"npm-view","witnesses":[{"key":"npmView","value":null}],"total":1}]
2026-11-10T17:27:39.043Z	advised	manifest-needs-evidence	package.json	[{"id":"npm-view","witnesses":[{"key":"npmView","value":null}],"total":1}]
2026-11-10T17:27:39.047Z	passed	manifest-needs-evidence	package.json
```

`unattributed` 행은 기준선이 없다는 관측이며 이 항목의 판정 결과가 아니므로
[문제 해결 안내](../troubleshooting.ko.md)를 참고하세요.

**인정하는 이전 호출**

`package.json`을 수정할 때 아래 `Bash` 호출 각각이 이전 이력에 `succeeded: true`로 있으면 `passed`를
기록하고 아무것도 출력하지 않으며 종료 코드는 0입니다.

- `npm view example version`입니다.
- `npx npm view left-pad version`입니다.
- 조회를 언급하기만 하는 `echo 'npm view x'`입니다.
- 조회가 실패해도 명령 전체는 성공한 `npm view no-such-package-xyz version || true`입니다.

성공한 `npm view is-odd version` 뒤에 `package.json`에서 `left-pad`를 `1.2.0`에서 `1.3.0`으로 바꾸는
편집도 판정을 받고 지나갑니다. 이 항목은 패키지 이름을 비교하지 않습니다. 성공한
`npm view example version` 하나로 같은 에이전트의 세션에서 후속 `package.json` 편집 두 건도 모두
지나갑니다.

**인정하지 않는 이전 호출**

같은 `package.json` 수정에서 아래 입력 각각은 `advised`를 기록하고 첫 실행과 같은 오류와 권고 요약
줄을 출력하며 종료 코드는 0입니다.

- `pnpm view example version`, `npm info example version`, `npm show example version` 또는
  `npm v left-pad version`을 실행한 성공한 `Bash` 호출입니다.
- `view` 뒤에 아무것도 없는 `npm view`를 실행한 성공한 `Bash` 호출입니다.
- `npm`과 `view` 사이에 공백이 두 개인 `npm  view left-pad version`을 실행한 성공한 `Bash`
  호출입니다.
- `succeeded`가 `false`이거나 없는 `npm view example version`의 `Bash` 호출입니다.
- `Bash` 대신 `args.command: "npm view example version"`을 담은 성공한 `Task` 호출입니다.

이력이 비어 있으면 `test` 스크립트만 `node a.js`에서 `node b.js`로 바꾸는 편집도 같은 출력으로
권고하며 종료 코드는 0입니다. `{"dependencies":{"left-pad":"1.3.0"}}` 내용으로 `package.json`을
만드는 입력도 같습니다.

빈 이력에서 `settings.json`, `packages/a/package.json`, `pnpm-lock.yaml`의 `old\n`을 `new\n`으로
바꾸는 편집은 범위 밖입니다. 각각 아무것도 출력하지 않으며 종료 코드는 0입니다. 이 항목의 판정 결과
대신 해당 경로에 대한 `passed covenant-check`를 기록합니다.

`violating.json`을 `missing.json`으로 복사하고 `session` 필드를 통째로 지우세요.

```sh
pdks covenant check < missing.json
```

아무것도 출력하지 않으며 종료 코드는 0입니다. `supply-pass` 사유로 `skipped`를 기록합니다. 빈 이력의
`advised`와 다르며 검사 성공이 아닙니다.

```text
2026-11-10T17:27:39.053Z	skipped	manifest-needs-evidence	package.json	supply-pass
```

`violating.json`을 `shell.json`으로 복사하고 맨 위 `toolCalls`의 호출을 다음 객체로 바꾸세요.
`fileChange`는 넣지 않고 빈 `session`과 다른 필드는 유지하세요.

```json
{
  "name": "Bash",
  "args": {
    "command": "sed -i 's/1.2.0/1.3.0/' package.json"
  }
}
```

```sh
pdks covenant check < shell.json
```

`sed -i 's/1.2.0/1.3.0/' package.json` 입력은 아무것도 출력하지 않고 종료 코드 0으로 끝납니다.
`no-observation` 사유로 `skipped`를 기록합니다.

```text
2026-11-10T17:27:39.056Z	skipped	manifest-needs-evidence	package.json	no-observation
```

`shell.json`의 명령을 `npm install left-pad@1.3.0` 또는 `pnpm add left-pad`로 바꾸고 같은 검사를
실행하세요. 각각 아무것도 출력하지 않고 종료 코드 0으로 끝나며 경로가 `-`인
`passed covenant-check`만 기록합니다. 이 패키지 관리자 쓰기는 위에서 측정한 `sed -i` 입력과 달리 이
항목의 행을 남기지 않습니다.

다음 내용을 `change.diff`로 저장하세요.

```diff
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{}
+{"name":"example"}
```

```sh
pdks covenant check --diff < change.diff
```

아무것도 출력하지 않으며 종료 코드는 0입니다. 변경 집합 표면은 이 항목을 판정하지 않습니다. 일반
`passed covenant-check` 행은 이 규율의 판정 결과가 아닙니다.

```text
2026-11-10T17:27:39.060Z	passed	covenant-check	package.json
```

**실제 세션에서 확인하기**

다음 명령을 실행하세요.

```sh
pdks explain
```

종료 코드는 0이며 이 항목의 행은 다음과 같습니다.

```text
  declare  manifest-needs-evidence precedent · history · nonEmpty npm-view · scope target.path · include 1 · exclude 0 · sources 1 (transcript 1) · valve — · why ✓ · unattended: judge
```

권고 항목이므로 `enforce: block`은 표시되지 않습니다. 연결된 세션에서 실제 읽기나 조회를 한 뒤
선택한 파일을 수정하고 `.polydeukes/roi.log`의 판정 결과를 확인하세요.

[Claude Code 어댑터](../reference/packages/adapter-claude-code.ko.md)와
[Codex 어댑터](../reference/packages/adapter-codex.ko.md),
[표면 연결 안내](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 수정하기

루트 매니페스트라면 `scope.include: ['^package\.json$']`를 그대로 두세요. 다른 위치에 있다면 이 패턴
하나를 프로젝트 기준 상대 경로로 바꾸고, 시작과 끝 앵커를 유지하며 점을 이스케이프하세요. 경로는
`scope.include`에만 있으므로 두 번째로 바꿀 매니페스트 경로는 없습니다.

`npmView` 추출은 성공한 `Bash` 호출을 골라 `args.command`를 읽고 `\bnpm view `에 일치하는 글자를
찾습니다. `npm` 앞에는 낱말 경계가 있고, `npm`과 `view` 사이 및 `view` 뒤에는 리터럴 공백 하나가
있습니다. 패키지나 반환된 버전이 아니라 명령 글자가 일치하는지 확인합니다. 다른 레지스트리나
클라이언트에는 다른 선언과 별도로 측정한 입력이 필요합니다.

관련된 [pnpm 레시피](./pnpm-only.ko.md)는 어떤 도구가 의존성을 바꾸는지 확인합니다.

세션에서 편집을 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요. 직접 실행할
때는 `--enforce block`도 필요하며, 이 플래그가 없으면 여전히 권고합니다. 규율을 없애려면 항목을
삭제하세요. 수정한 뒤에는 `pdks explain`을 실행하고 새 패턴에 맞는 입력과 맞지 않는 입력을
확인하세요.

<a id="limits"></a>
## 한계

이 항목은 파일 도구로 한 편집을 판정합니다. 매니페스트를 다시 쓰는 패키지 관리자 명령은 이 항목이
판정하지 않으며, `npm install left-pad@1.3.0`과 `pnpm add left-pad`는 각각 아무것도 출력하지 않고
종료 코드 0으로 끝나며 경로가 `-`인 `passed covenant-check`만 기록하고 이 항목의 행은 남기지
않습니다.

이 항목은 성공으로 기록된 이전 호출만 셉니다. 성공 여부를 기록하지 않는 호스트에서는 범위 안의 모든
편집에 권고합니다. 측정한 입력에서도 이전 `npm view example version` 호출에 `succeeded` 필드가
없으면 권고합니다. [호출 성공 여부](../reference/host-support.ko.md#call-success)를 참고하세요.

이전 호출은 호스트가 편집하는 에이전트에 대해 제공하는 호출입니다.
[이력 범위](../reference/host-support.ko.md#history-scope)를 참고하세요.

조회 하나가 같은 에이전트의 세션이 끝날 때까지 모든 후속 매니페스트 편집을 충족합니다. 성공한
`npm view example version` 하나로 후속 `package.json` 편집 두 건이 모두 판정을 받고 지나갑니다.
최신성, 반환된 버전, 패키지 존재 여부는 확인하지 않습니다. `npm view is-odd version` 뒤에 `left-pad`
버전을 바꾸어도 조회한 패키지와 수정한 패키지를 비교하지 않아 지나갑니다.

패턴은 글자를 맞춥니다. `echo 'npm view x'`는 레지스트리를 조회하지 않고도 판정을 받고 지나갑니다.
`npm view no-such-package-xyz version || true`도 명령 전체가 성공하여 `succeeded: true`이면
지나갑니다. 실패했거나 성공 여부가 기록되지 않은 `npm view example version`은 권고를 받습니다.

이 항목은 판정 대상 편집의 명령줄이나 파일 내용을 읽지 않습니다. 이력이 비어 있으면 `test`
스크립트만 `node a.js`에서 `node b.js`로 바꾸어도 권고하며, `left-pad` 의존성을 담은
`package.json`을 만들어도 같습니다. `packages/a/package.json`과 `pnpm-lock.yaml`은 루트 매니페스트
범위 밖입니다.

`package.json` 수정에서 `session`이 없으면 `supply-pass` 사유로 `skipped`를 기록하고,
`session.toolCalls`가 비어 있으면 권고합니다. 셸 쓰기 `sed -i 's/1.2.0/1.3.0/' package.json`은
`no-observation` 사유로 `skipped`를 기록합니다. `package.json`의 `{}`를 `{"name":"example"}`로
바꾸는 diff는 일반 통과 행만 남습니다. 변경 집합 표면은 이 항목을 판정하지 않습니다.

이 JSON 검사는 실제 호스트가 증거를 전달했다는 증명이 아닙니다. 어댑터나 판정기가 시작되지 못하면
호출은 판정 없이 지나갑니다. 연결한 뒤 `.polydeukes/roi.log`의 행을 확인하세요.
