# pnpm 밖에서 한 의존성 변경 감지하기

[English](./pnpm-only.md) · **한국어**

이 규율은 여러분의 프로젝트가 pnpm을 사용할 때 적용합니다. 이 규율(discipline)은 에이전트의 셸
명령을 실행 전에 판정하며, 나열된 npm 명령과 인식하는 위치의 yarn 호출에 권고합니다.

세션 표면(Claude Code, Codex) · 일치하는 호출에 권고 · pnpm을 사용하는 프로젝트가 전제 · 그
프로젝트에서는 사용 전 수정할 부분 없음.

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 아직 설정 파일이 없다면 프로젝트 루트에 이
이름으로 저장하세요. 파일에 이미 `sessionDisciplines:` 키가 있다면 첫 줄 아래의 항목만 기존 키 밑에
붙여 넣고, 기존 항목은 유지하세요. `pdks init`이 만든 파일처럼 파일은 있지만 `sessionDisciplines:`
키가 없다면 파일 끝에 블록 전체를 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "pnpm-only"
    why: "this project uses pnpm; another package manager can leave dependency files inconsistent."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '\bnpm (install|i|ci|add|uninstall|remove|rm|update|up|link|publish)\b|(^|[;&|(]\s*)yarn\b',
            }
      relate:
        - id: "no-npm-mutation"
          relation: { op: "empty", of: "hits" }
          message: "command line uses a package manager outside pnpm: {value}"
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트에서 사용하는 Claude Code나 Codex에 다음 프롬프트를 붙여 넣으세요.

````text
아래 항목을 이 프로젝트의 polydeukes.config.yaml에 있는 sessionDisciplines: 밑에 추가하세요.
블록에는 목록 키와 그 아래 항목이 함께 있습니다. 기존 설정에서는 기존 키 밑에 항목만 추가하고,
같은 키를 두 번 만들지 마세요. 다른 모든 항목, 보호 경로, 증인 설정을 유지하세요.
같은 id의 항목이 이미 있으면 그 사실을 알리고 멈추세요.

이 세션에서 설정 파일이 보호되어 있다면 정확한 패치를 보여 주고 사람이 적용하도록 요청하세요.
보호를 우회하지 마세요.

그다음 pdks explain을 실행하여 pnpm-only 행을 확인하세요.
이 항목은 enforce를 생략하여 권고합니다. enforce: block이 표시되면 안 됩니다.
프로젝트 밖에 빈 디렉터리를 만들고, 셸 명령이 아닌 파일 쓰기 도구로 그 안에 polydeukes.config.yaml,
violating.json, valid.json을 만드세요. 그곳에서 "직접 확인하기"의 세 검사를 실행하세요.
violating.json을 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 검사하고,
valid.json을 --enforce block으로 검사하세요. 각각의 판정 결과 단어, 종료 코드, 강제 수준을 보고하세요.
JSON 입력 안의 명령은 데이터이므로 실행하면 안 됩니다. skipped 판정 결과는 검사 성공이 아닙니다.
JSON 안의 명령을 실행하거나 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "pnpm-only"
    why: "this project uses pnpm; another package manager can leave dependency files inconsistent."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '\bnpm (install|i|ci|add|uninstall|remove|rm|update|up|link|publish)\b|(^|[;&|(]\s*)yarn\b',
            }
      relate:
        - id: "no-npm-mutation"
          relation: { op: "empty", of: "hits" }
          message: "command line uses a package manager outside pnpm: {value}"
```
````

<a id="try-it"></a>
## 직접 확인하기

명령을 실행하지 않고 판정을 확인할 수 있습니다. `pdks covenant check`는 표준 입력으로 호출 하나를
JSON으로 받아 판정합니다. JSON 안의 명령은 실행하지 않습니다.

빈 디렉터리에 이 페이지 맨 위의 YAML 블록을 `polydeukes.config.yaml`로 저장한 뒤, 다음 두 입력을
저장하세요.

`violating.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "npm install example" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "pnpm install" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`tools` 객체는 어떤 도구 이름이 셸 호출인지, 어떤 인자에 명령이 들어 있는지 판정기에 알려 줍니다. 이
객체가 없으면 해당 호출을 셸 명령으로 읽지 않아 이 규율을 판정하지 않습니다. 실제 세션에서는
어댑터가 이 객체를 제공합니다.

먼저 강제 수준 플래그 없이 실행합니다.

```sh
pdks covenant check < violating.json
```

표준 오류 출력:

```text
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm install example — why: this project uses pnpm; another package manager can leave dependency files inconsistent.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 이 항목의 기본 강제 수준은 권고이므로 명령 실행을 허용합니다.

이번에는 세션과 같은 강제 수준으로 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm install example — why: this project uses pnpm; another package manager can leave dependency files inconsistent.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 항목은 여전히 권고합니다. `--enforce block`만으로 권고 항목을 차단으로 올릴 수
없습니다. 에이전트 어댑터도 이 실행 강제 수준을 사용합니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않고 종료 코드 0으로 끝납니다.

`.polydeukes/roi.log`에는 다음 세 행이 추가되며, 타임스탬프는 실행 시점에 따라 달라집니다.

```text
2026-11-10T14:20:48.404Z	advised	pnpm-only	-	[{"id":"no-npm-mutation","witnesses":[{"key":"1","value":"npm install example"}],"total":1}]
2026-11-10T14:20:48.407Z	advised	pnpm-only	-	[{"id":"no-npm-mutation","witnesses":[{"key":"1","value":"npm install example"}],"total":1}]
2026-11-10T14:20:48.409Z	passed	pnpm-only	-
```

**그 밖에 일치하는 명령줄**

- `echo "npm install example"`
- `npm ci example`
- `npm i example`
- `npm link example`
- `npm publish example`
- `npm uninstall example`
- `npm update example`
- `true && yarn install`
- `(yarn install)`
- `yarn info example`

```text
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: echo "npm install example"
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm ci example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm i example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm link example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm publish example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm uninstall example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm update example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: true && yarn install
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: (yarn install)
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: yarn info example
```

각 출력 행 뒤에는 앞의 실행처럼 ` — why: …`와 권고 요약 줄이 이어집니다. 이 호출들은 `advised`를
기록하고 종료 코드 0으로 끝납니다.

`pnpm install`, `npm view example version`, `npm info example`, `echo yarn install`은 판정을 받고
지나갑니다. 레지스트리 조회를 확인하려면 `valid.json`을 `lookup.json`으로 복사하고 command 값을
`npm view example version`으로 바꾸세요.

```sh
pdks covenant check --enforce block < lookup.json
```

아무것도 출력하지 않고 종료 코드 0으로 끝납니다. 다음 행이 추가됩니다.

```text
2026-11-10T14:20:48.412Z	passed	pnpm-only	-
```

괄호 안의 명령을 확인하려면 `violating.json`을 `subshell.json`으로 복사하고 command 값을
`(yarn install)`로 바꾸세요.

```sh
pdks covenant check --enforce block < subshell.json
```

표준 오류 출력:

```text
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: (yarn install) — why: this project uses pnpm; another package manager can leave dependency files inconsistent.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 두 행이 추가됩니다.

```text
2026-11-10T14:20:48.414Z	advised	pnpm-only	-	[{"id":"no-npm-mutation","witnesses":[{"key":"1","value":"(yarn install)"}],"total":1}]
2026-11-10T14:20:48.414Z	skipped	shell-unjudgeable	-	no-observation
```

명령줄 글자를 읽는 규율은 권고하고, 셸 분석은 `no-observation` 사유의 `skipped shell-unjudgeable`
행도 기록합니다. 이 생략은 권고를 취소하지 않으며 셸 명령 전체가 판정되었다는 뜻도 아닙니다.

빈 내용에서 `npm install example`을 새 내용으로 하여 `notes.txt`를 만드는 `Edit` 호출은 명령줄에
범위를 둔 이 항목을 호출하지 않습니다. `notes.txt`의 `old`를 `new`로 바꾸는 diff도 이 항목을
호출하지 않습니다. 둘 다 종료 코드 0으로 끝나며, 이 항목의 판정 결과 대신 `notes.txt`에 대한
`passed covenant-check` 행을 기록합니다.

**실제 세션에서 확인하기**

항목을 추가한 뒤 `pdks explain`을 실행하면 다음 행이 나옵니다.

```text
  declare  pnpm-only         forbidden-command · change · empty no-npm-mutation · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

이 항목은 권고하므로 출력 행에 `enforce: block`이 없습니다. 에이전트가 일치하는 명령을 시도하면 권고
메시지와 함께 호출이 계속되고 `.polydeukes/roi.log`에 `advised` 행이 추가됩니다.

[첫 판정 튜토리얼](../tutorials/first-judgment.ko.md),
[표면 연결 안내](../how-to/connect-surfaces.ko.md), [설치 안내](../how-to/install.ko.md)를
참고하세요.

<a id="change-it"></a>
## 수정하기

정규식에는 두 가지 대안이 있습니다.

- `\bnpm (install|i|ci|add|uninstall|remove|rm|update|up|link|publish)\b`: npm의 `install`, `i`,
  `ci`, `add`, `uninstall`, `remove`, `rm`, `update`, `up`, `link`, `publish`. `npm` 뒤에는 리터럴
  공백 하나가 옵니다.
- `(^|[;&|(]\s*)yarn\b`: 줄의 시작 또는 `;`, `&`, `|`, `(` 뒤에 오는 `yarn`. 구분 문자 뒤에는 공백이
  올 수 있으며 읽기 전용 하위 명령도 일치합니다.

npm 표기 하나를 허용하려면 해당 동사와 인접한 `|`를 지우세요. yarn을 판정하지 않으려면 yarn 대안
전체와 구분하는 `|`를 지우고, yarn만 판정하려면 npm 대안 전체를 지우세요. pnpm 전용 설정이므로 다른
패키지 관리자를 쓰려면 id, why, message와 명령 대안을 함께 바꾸고 새 입력을 확인하세요.

세션에서 일치하는 호출을 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요.
직접 실행할 때는 `--enforce block`도 필요하며, 이 플래그가 없으면 여전히 권고합니다. 규율을 없애려면
항목을 삭제하세요. 수정한 뒤에는 항상 `pdks explain`을 실행하세요.

<a id="limits"></a>
## 한계

이 항목은 정규식으로 명령줄 글자를 맞춥니다. `echo "npm install example"`은 설치를 언급하기만 해도
권고를 받습니다. `npm view example version`과 `npm info example`은 판정을 받고 지나가지만, 읽기
전용인 `yarn info example`은 권고를 받습니다. yarn 대안은 관리자 이름만으로 일치하기 때문입니다.

yarn의 위치도 중요합니다. `true && yarn install`과 `(yarn install)`은 일치하지만
`echo yarn install`은 판정을 받고 지나갑니다. `(yarn install)`은 `advised pnpm-only`와
`skipped shell-unjudgeable`을 함께 기록합니다. 명령줄 글자의 일치가 셸의 모든 효과를 판정했다는 뜻은
아닙니다.

npm 대안에는 나열된 동사와 공백 표기가 필요하고, yarn 대안에는 지정된 위치가 필요합니다. 다른 표기와
다른 패키지 관리자는 범위 밖입니다. 이 항목은 잠금 파일을 검사하거나, 설치된 패키지 관리자를
감지하거나, 의존성이 실제로 바뀌었는지 확인하지 않습니다.

변경 집합 표면(`pdks covenant check --diff`)은 명령줄이 없는 diff를 받으므로 이 항목을 판정하지
않습니다. 앞의 `notes.txt` 편집과 diff 사례에서 보듯 `passed covenant-check` 행은 이 규율의 판정
결과가 아닙니다.

어댑터가 설정된 셸 도구의 호출로 관측해야 하며, 다른 호스트 도구를 자동으로 같은 것으로 보지는
않습니다. 이 JSON 검사는 판정기의 동작을 보여 주며 실제 호스트가 호출을 전달한다는 증거는 아닙니다.
어댑터나 판정기가 시작되지 못하면 호출은 판정 없이 지나갑니다. 연결한 뒤 `.polydeukes/roi.log`의
행을 확인하세요.
