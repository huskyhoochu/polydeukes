# 구현 담당 서브에이전트의 테스트 수정 감지하기

[English](./tests-are-the-writers.md) · **한국어**

이 규율(discipline)은 여러분의 프로젝트가 테스트 작성과 구현을 서로 다른 서브에이전트에 맡기고, 구현
담당 서브에이전트의 유형 이름을 고정해서 사용할 때 적용합니다. `implementer`가 `tests/` 아래에서
관측된 파일 변경을 하면 권고합니다. 기본 설정에서는 편집이 그대로 진행됩니다.

세션 표면 · 행위자를 읽음 · 기본 강제 수준: 권고 · 수정할 값: 테스트 경로 패턴과 서브에이전트 이름.
호스트 지원: [파일 편집](../reference/host-support.ko.md#file-edits) 및
[행위자](../reference/host-support.ko.md#actor).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 아직 설정 파일이 없다면 프로젝트 루트에 이
이름으로 저장하세요. 파일에 이미 `sessionDisciplines:` 키가 있다면 첫 줄 아래의 항목만 기존 키 밑에
붙여 넣고, 기존 항목은 유지하세요. `pdks init`이 만든 파일처럼 파일은 있지만 `sessionDisciplines:`
키가 없다면 파일 끝에 블록 전체를 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "tests-are-the-writers"
    why: "the implementer should satisfy the existing tests without changing those tests."
    declare:
      mechanism: "producer-owned"
      scope: { source: "target.path", include: ["^tests/"] }
      supply: { actor: "pass" }
      extract:
        implementer:
          - { op: "source", of: "actor" }
          - { op: "select", path: "agentType" }
          - { op: "matches", re: "^implementer$" }
      relate:
        - id: "not-the-implementer"
          relation: { op: "empty", of: "implementer" }
          message: "the implementer subagent wrote a test file"
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트에서 사용하는 Claude Code나 Codex에 다음 프롬프트를 붙여 넣으세요.

````text
아래 항목을 이 프로젝트의 polydeukes.config.yaml에 있는 sessionDisciplines: 밑에 추가하세요.
블록에는 목록 키와 그 아래 항목이 함께 있습니다. 기존 설정에서는 기존 키 밑에 항목만 추가하고,
같은 키를 두 번 만들지 마세요. 다른 모든 항목, 보호 경로, 증인 설정을 유지하세요.
같은 id의 항목이 이미 있으면 그 사실을 알리고 멈추세요.

테스트 경로 패턴과 정확한 구현 담당 agentType 이름을 프로젝트에 맞게 바꾸세요.
프롬프트에 적은 역할이 아니라 호스트가 제공하는 이름을 사용하세요.
이 세션에서 설정 파일이 보호되어 있다면 정확한 패치를 보여 주고 사람이 적용하도록 요청하세요.
보호를 우회하지 마세요.

pdks explain을 실행하여 tests-are-the-writers 행을 확인하세요.
이 항목은 enforce를 생략하여 권고합니다. enforce: block이 표시되면 안 됩니다.
프로젝트 밖에 빈 디렉터리를 만들고 파일 쓰기 도구로 원본 예제 YAML과 violating.json,
valid.json을 저장하세요. "직접 확인하기"의 세 검사를 실행하세요. violating.json을 강제 수준
플래그 없이 한 번, --enforce block으로 한 번 검사하고 valid.json을 --enforce block으로 검사하세요.
각각의 판정 결과 단어, 종료 코드, 강제 수준을 보고하세요. skipped는 검사 성공이 아닙니다.
이 입력은 판정 방식을 보여 줄 뿐 호스트가 행위자를 관측했다는 증거는 아닙니다.
JSON 안의 명령을 실행하거나 실제 테스트 파일을 수정하거나 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "tests-are-the-writers"
    why: "the implementer should satisfy the existing tests without changing those tests."
    declare:
      mechanism: "producer-owned"
      scope: { source: "target.path", include: ["^tests/"] }
      supply: { actor: "pass" }
      extract:
        implementer:
          - { op: "source", of: "actor" }
          - { op: "select", path: "agentType" }
          - { op: "matches", re: "^implementer$" }
      relate:
        - id: "not-the-implementer"
          relation: { op: "empty", of: "implementer" }
          message: "the implementer subagent wrote a test file"
```
````

<a id="try-it"></a>
## 직접 확인하기

빈 디렉터리에 위 YAML을 `polydeukes.config.yaml`로 저장하고 다음 두 입력을 저장하세요.
`pdks covenant check`는 JSON을 판정하며, 입력에 적힌 파일 편집은 실행하지 않습니다.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "tests/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "tests/example.ts",
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
  "actor": {
    "agentType": "implementer"
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
        "file_path": "tests/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "tests/example.ts",
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
  "actor": {
    "agentType": "test-writer"
  }
}
```

`actor`는 편집하는 주체의 증거이며 실제 세션에서는 어댑터가 채웁니다. 손으로 쓴 입력은 항목의 판정
방식을 보여 주며, 호스트가 그 행위자를 관측했다는 증거는 아닙니다.

`tools` 객체는 파일 변경 도구와 셸 도구의 이름, 명령 인자의 이름을 판정기에 알려 줍니다. 실제
세션에서는 어댑터가 이 객체도 제공합니다.

먼저 강제 수준 플래그 없이 실행합니다.

```sh
pdks covenant check < violating.json
```

표준 오류 출력:

```text
discipline 'tests-are-the-writers' broken on tests/example.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. `advised`를 기록하며 편집은 그대로 진행됩니다.

이번에는 세션과 같은 강제 수준으로 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'tests-are-the-writers' broken on tests/example.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. `--enforce block`만으로 권고 항목을 차단으로 올릴 수 없습니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않고 종료 코드 0으로 끝납니다.

`.polydeukes/roi.log`에는 다음 세 행이 추가되며 타임스탬프는 실행 시점에 따라 달라집니다.

```text
2026-11-10T17:20:12.534Z	advised	tests-are-the-writers	tests/example.ts	[{"id":"not-the-implementer","witnesses":[{"key":"0","value":"implementer"}],"total":1}]
2026-11-10T17:20:12.538Z	advised	tests-are-the-writers	tests/example.ts	[{"id":"not-the-implementer","witnesses":[{"key":"0","value":"implementer"}],"total":1}]
2026-11-10T17:20:12.540Z	passed	tests-are-the-writers	tests/example.ts
```

**다른 행위자와 파일 변경**

같은 `tests/example.ts`의 `old`를 `new`로 바꾸는 편집에서 `actor`가 `{}`인 주 세션, `agentType`이
`test-writer`, `tdd-implementer`, `Implementer`, `implementer2` 또는 빈 문자열인 입력은 모두
`passed`를 기록합니다. 아무것도 출력하지 않고 종료 코드 0으로 끝납니다.

`implementer`가 `tests/unit/a.test.ts`의 `old`를 `new`로 바꾸거나, `tests/new.test.ts`를 `new`
내용으로 생성하거나, `old` 내용의 `tests/old.test.ts`를 삭제하면 각각 권고합니다. 각 입력의 표준
오류 출력은 다음과 같습니다.

```text
discipline 'tests-are-the-writers' broken on tests/unit/a.test.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

```text
discipline 'tests-are-the-writers' broken on tests/new.test.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

```text
discipline 'tests-are-the-writers' broken on tests/old.test.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

각 입력은 `advised`를 기록하며 종료 코드는 0입니다. 삭제 입력은 어댑터가 보고하는 `kind: delete`인
파일 변경이며, 셸 삭제가 아닙니다.

`violating.json` 에서 `actor` 필드 전체를 지운 입력은 아무것도 출력하지 않고 종료 코드 0으로 끝나며,
`tests/example.ts` 에 `skipped tests-are-the-writers` 와 사유 `supply-pass` 를 기록합니다.
[행위자](../reference/host-support.ko.md#actor)를 참고하세요. 이는 `passed` 가 아니며 `{}` 로
대신하면 안 됩니다.

`implementer`가 `src/example.ts`, `packages/a/tests/x.ts`, `src/a.test.ts`의 `old`를 `new`로 바꾸는
입력은 범위 밖입니다. 각각 아무것도 출력하지 않고 종료 코드 0으로 끝나며, 해당 경로에
`passed covenant-check`를 기록합니다. 이 항목의 판정 결과가 아닙니다.

셸 쓰기 `sed -i 's/old/new/' tests/example.ts`는 다음 입력을 `shell.json`으로 저장하여 확인하세요.

```json
{
  "toolCalls": [
    {
      "name": "Bash",
      "args": {
        "command": "sed -i 's/old/new/' tests/example.ts"
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
  "actor": {
    "agentType": "implementer"
  }
}
```

```sh
pdks covenant check < shell.json
```

`implementer`의 `sed -i 's/old/new/' tests/example.ts` 호출은 아무것도 출력하지 않고 종료 코드 0으로
끝납니다. 명령 자체는 실행하지 않습니다. 추가되는 행은 다음과 같습니다.

```text
2026-11-10T17:20:12.576Z	skipped	tests-are-the-writers	tests/example.ts	no-observation
```

`shell.json`의 명령을 `rm tests/example.ts`로 바꾸고 같은 검사를 실행하세요. 이 `implementer`의 셸
삭제는 아무것도 출력하지 않고 종료 코드 0으로 끝나며 경로가 `-`인 `passed covenant-check`만
기록합니다. 위에서 측정한 `sed -i` 입력과 달리 이 항목의 행을 남기지 않습니다.

다음 내용을 `change.diff`로 저장하세요.

```diff
--- a/tests/example.ts
+++ b/tests/example.ts
@@ -1 +1 @@
-old
+new
```

```sh
pdks covenant check --diff < change.diff
```

아무것도 출력하지 않고 종료 코드 0으로 끝납니다. 변경 집합 표면은 이 세션 전용 항목을 판정하지
않으며 다음 행을 기록합니다.

```text
2026-11-10T17:20:12.569Z	passed	covenant-check	tests/example.ts
```

**실제 세션에서 확인하기**

항목을 추가한 뒤 다음 명령을 실행하세요.

```sh
pdks explain
```

이 항목의 출력 행은 다음과 같습니다.

```text
  declare  tests-are-the-writers producer-owned · actor · empty not-the-implementer · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

권고 항목이므로 `enforce: block` 이 표시되지 않습니다. 호스트의 서브에이전트 정의에서 구현 담당
서브에이전트 이름을 가져와 이름 패턴에 쓰세요. 세션을 연결한 뒤 그 서브에이전트가 테스트 경로 아래의
임시 파일을 수정하게 하고 `.polydeukes/roi.log` 에서 이 항목의 `advised` 행을 찾으세요. `passed`
행은 행위자를 보여 주지 않아 잘못된 이름을 알아낼 수 없으며, 측정한 입력에서 `tdd-implementer` 는
판정을 받고 지나갑니다.

[Claude Code 어댑터](../reference/packages/adapter-claude-code.ko.md),
[Codex 어댑터](../reference/packages/adapter-codex.ko.md),
[표면 연결 안내](../how-to/connect-surfaces.ko.md)를 참고하세요.

<a id="change-it"></a>
## 수정하기

두 패턴을 프로젝트에 맞게 바꾸세요.

- `scope.include`의 `^tests/`는 루트의 `tests/`로 시작하는 경로를 고릅니다. 중첩 경로도 포함합니다.
  테스트 위치가 다르면 이 패턴을 바꾸세요.
- `extract.implementer`의 `^implementer$`는 `agentType` 전체를 대소문자를 구분하여 맞춥니다. `^`와
  `$`를 유지하고 호스트가 제공하는 구현 담당 서브에이전트 이름으로 바꾸세요. 모델 이름이나
  프롬프트에 적은 역할을 쓰지 마세요. 설명인 `why`와 `message`도 새 이름에 맞게 고치세요.

세션에서 편집을 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요. 직접 실행할
때는 `--enforce block`도 필요하며, 이 플래그가 없으면 여전히 권고합니다. 규율을 없애려면 항목을
삭제하세요. 수정한 뒤에는 `pdks explain`을 실행하고 새 경로와 이름으로 일치하는 입력과 지나가는
입력을 모두 확인하세요.

<a id="limits"></a>
## 한계

이 항목은 편집 경로로 범위를 고르고 `actor.agentType`을 읽습니다. 판정하는 편집의 파일 내용이나
명령줄을 읽지 않습니다. `tests/unit/a.test.ts` 수정과 `tests/new.test.ts` 생성, `tests/old.test.ts`
삭제가 어댑터에서 파일 변경으로 보고되면 모두 `implementer`에게 권고합니다. 삭제 입력에는
`kind: delete`가 있습니다. 셸 삭제 `rm tests/example.ts`는 아무것도 출력하지 않고 종료 코드 0으로
끝나며 경로가 `-`인 `passed covenant-check`만 기록하고 이 항목의 행은 남기지 않습니다.

테스트를 한 작성자에게만 맡기는 설정이 아니라, 특정 이름 하나의 편집을 감지하는 설정입니다.
`tests/example.ts`를 수정하는 주 세션(`actor: {}`)과 `test-writer`, `tdd-implementer`,
`Implementer`, `implementer2`, 빈 `agentType`은 모두 판정을 받고 지나갑니다.

`actor` 가 없는 편집은 `supply-pass` 사유로 `skipped` 를 기록하며, 통과가 아닙니다.
[행위자](../reference/host-support.ko.md#actor)를 참고하세요. 프롬프트에 적은 역할은 행위자 증거가
아닙니다.

표시한 경로 패턴에서 `packages/a/tests/x.ts`, `src/a.test.ts`, `src/example.ts` 편집은 범위
밖입니다. `implementer`의 셸 쓰기 `sed -i 's/old/new/' tests/example.ts`는 관측한 파일 변경이 없어
`no-observation` 사유로 `skipped`를 기록합니다. 변경 집합 표면의 `tests/example.ts` diff는 이 항목을
판정하지 않습니다. `passed covenant-check` 행은 이 규율의 판정 결과가 아닙니다.

손으로 쓴 JSON은 호스트의 증거 전달을 입증하지 않습니다. 어댑터나 판정기가 시작되지 못하면 호출은
판정 없이 지나갑니다. 연결 뒤 실제 호출의 기록을 확인하세요.
