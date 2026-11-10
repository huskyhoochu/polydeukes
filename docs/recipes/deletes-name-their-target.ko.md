# 에이전트가 rm으로 디렉터리 전체를 지우지 못하게 하기

[English](./deletes-name-their-target.md) · **한국어**

이 규율(discipline)은 에이전트의 Unix 셸 명령을 실행 전에 판정하며, rm의 대상이 나열된 광범위한
표기와 일치하면 위반을 판정합니다. 루트, 홈, 현재 또는 상위 디렉터리와 디렉터리 안의 모든 항목을
가리키는 표기입니다.

세션 표면 · 명령 텍스트를 읽음 · 일치하는 호출 차단 · Unix 셸 명령줄 텍스트 · 사용 전 수정할 값
없음. 호스트 지원: [셸 명령](../reference/host-support.ko.md#shell-commands).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 아직 설정 파일이 없다면 프로젝트 루트에 이
이름으로 저장하세요. 파일에 이미 `sessionDisciplines:` 키가 있다면 첫 줄 아래의 항목만 기존 키 밑에
붙여 넣고, 기존 항목은 유지하세요. `pdks init`이 만든 파일처럼 파일은 있지만 `sessionDisciplines:`
키가 없다면 파일 끝에 블록 전체를 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "deletes-name-their-target"
    why: "deleting the root, home, current or parent directory, or every entry in a directory, can remove unrelated work."
    enforce: block
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '(?:^|[;&|(\x60\x22\x27]|\$\()\s*(?:(?:sudo|exec|nohup|env|xargs|command|time)\s+(?:-\S+\s+)*)*rm\s+(?:[^\s;&|]+\s+)*?(?:/|/\*|~|~/|~/\*|\$\{?HOME\}?/?\*?|\.|\./|\./\*|\.\.|\.\./|\*)(?=\s|$|[;&|)\x22\x27])',
            }
      relate:
        - id: "none-wholesale"
          relation: { op: "empty", of: "hits" }
          message: "command line deletes a broad target: {value}"
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

그다음 pdks explain을 실행하여 deletes-name-their-target 행에 enforce: block이 있는지 확인하세요.
프로젝트 밖에 빈 디렉터리를 만들고, 셸 명령이 아닌 파일 쓰기 도구로 그 안에 polydeukes.config.yaml,
violating.json, valid.json을 만드세요. 그곳에서 "직접 확인하기"의 두 검사, 즉 violating.json과
valid.json에 --enforce block을 적용하는 검사를 실행하세요.
각각의 판정 결과 단어, 종료 코드, 강제 수준을 보고하세요.
.polydeukes/roi.log에서 deletes-name-their-target의 행을 확인하세요.
JSON 입력 안의 명령은 데이터이므로 실행하면 안 됩니다. skipped 판정 결과는 검사 성공이 아닙니다.
파괴적인 명령을 실행하거나 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "deletes-name-their-target"
    why: "deleting the root, home, current or parent directory, or every entry in a directory, can remove unrelated work."
    enforce: block
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '(?:^|[;&|(\x60\x22\x27]|\$\()\s*(?:(?:sudo|exec|nohup|env|xargs|command|time)\s+(?:-\S+\s+)*)*rm\s+(?:[^\s;&|]+\s+)*?(?:/|/\*|~|~/|~/\*|\$\{?HOME\}?/?\*?|\.|\./|\./\*|\.\.|\.\./|\*)(?=\s|$|[;&|)\x22\x27])',
            }
      relate:
        - id: "none-wholesale"
          relation: { op: "empty", of: "hits" }
          message: "command line deletes a broad target: {value}"
```
````

<a id="try-it"></a>
## 직접 확인하기

파괴적인 명령을 실행하지 않고 판정을 확인할 수 있습니다. `pdks covenant check`는 표준 입력으로 호출
하나를 JSON으로 받아 판정합니다. JSON 안의 명령은 실행하지 않습니다.

빈 디렉터리에 이 페이지 맨 위의 YAML 블록을 `polydeukes.config.yaml`로 저장한 뒤, 다음 두 입력을
저장하세요.

`violating.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "rm -rf /" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "rm -rf build/cache" } }],
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
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf / — why: deleting the root, home, current or parent directory, or every entry in a directory, can remove unrelated work.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 직접 실행할 때는 `--enforce block`을 지정해야 차단하며, 그렇지 않으면 판정기는
권고합니다. 에이전트 어댑터는 강제 수준을 `block`으로 실행합니다.

이번에는 세션과 같은 강제 수준으로 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf / — why: deleting the root, home, current or parent directory, or every entry in a directory, can remove unrelated work.
```

종료 코드는 2입니다. 실제 세션에서도 이처럼 호출이 실행되기 전에 멈춥니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않고 종료 코드 0으로 끝납니다.

`.polydeukes/roi.log`에는 다음 세 행이 추가되며, 타임스탬프는 실행 시점에 따라 달라집니다.

```text
2026-11-10T14:20:38.381Z	advised	deletes-name-their-target	-	[{"id":"none-wholesale","witnesses":[{"key":"1","value":"rm -rf /"}],"total":1}]
2026-11-10T14:20:38.384Z	blocked	deletes-name-their-target	-	[{"id":"none-wholesale","witnesses":[{"key":"1","value":"rm -rf /"}],"total":1}]
2026-11-10T14:20:38.387Z	passed	deletes-name-their-target	-
```

**그 밖에 일치하는 명령줄**

- `true; rm -rf *`
- ``echo `rm -rf * ` ``
- `rm -rf .`
- `rm -rf ./*`
- `rm -rf ${HOME}/*`
- `rm -rf ~`
- `rm -rf ~/*`
- `rm -rf ~/`
- `rm -rf $HOME`
- `echo 'rm -rf *'`
- `rm -rf ..`
- `rm -rf /*`
- `rm -rf *`
- `sudo rm -rf *`

```text
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: true; rm -rf *
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: echo `rm -rf * `
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf .
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ./*
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ${HOME}/*
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ~
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ~/*
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ~/
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf $HOME
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: echo 'rm -rf *'
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ..
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf /*
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf *
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: sudo rm -rf *
```

각 진단 뒤에는 두 번째 실행처럼 ` — why: …`가 이어집니다. 이 입력들은 종료 코드 2로 차단됩니다.

`rm -rf ./build`, `rm build.log && git add .`, `env FOO=1 rm -rf ~`도 판정을 받고 지나갑니다.
``echo `rm -rf *` `` 입력은 종료 코드 0으로 끝나며 `passed deletes-name-their-target`과 사유가
`no-observation`인 `skipped shell-unjudgeable`을 기록합니다. `rm -rf /`를 내용으로 `notes.txt`를
생성하거나, 그 파일에서 `old`를 `new`로 바꾸는 diff를 제출하면 종료 코드 0과 일반
`passed covenant-check` 행이 남습니다. 두 입력 모두 이 항목을 판정하지 않습니다.

**실제 세션에서 확인하기**

항목을 추가한 뒤 `pdks explain`을 실행하면 다음 행이 나옵니다.

```text
  declare  deletes-name-their-target forbidden-command · change · empty none-wholesale · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · enforce: block · unattended: judge
```

에이전트가 일치하는 명령을 시도하면 호출이 멈추고 메시지는 두 번째 실행의 출력 행으로 시작하며,
`.polydeukes/roi.log`에 `blocked` 행이 추가됩니다.

[첫 판정 튜토리얼](../tutorials/first-judgment.ko.md),
[표면 연결 안내](../how-to/connect-surfaces.ko.md), [설치 안내](../how-to/install.ko.md)를
참고하세요.

<a id="change-it"></a>
## 수정하기

대상 대안은 다음과 같습니다.

- `/`와 `/*`: 루트 디렉터리 또는 그 안의 모든 항목.
- `~`, `~/`, `~/*`: 홈 디렉터리 또는 그 안의 모든 항목.
- `$HOME`과 `${HOME}`에 선택적으로 슬래시와 별표를 붙인 표기: 홈 변수 표기.
- `.`, `./`, `./*`: 현재 디렉터리 또는 그 안의 모든 항목.
- `..`와 `../`: 상위 디렉터리.
- `*`: 현재 디렉터리에서 glob에 일치하는 모든 항목.

명령은 줄 시작이나 구분자, 여는 괄호, 따옴표, 역따옴표, `$(` 뒤에 올 수 있습니다. 인식하는 접두
명령은 `sudo`, `exec`, `nohup`, `env`, `xargs`, `command`, `time`이며 선택적으로 플래그를 붙일 수
있습니다. 인자를 건너뛰는 부분인 `rm\s+(?:[^\s;&|]+\s+)*?`는 대상 앞의 인자에 `;`, `&`, `|`가 없을
때만 허용하므로 뒤에 오는 다른 명령까지 읽지 않습니다. 끝 경계는 공백, 줄 끝, 구분자, 닫는 괄호,
따옴표를 허용하지만 닫는 역따옴표는 허용하지 않습니다.

특정 표기를 판정하지 않으려면 대상 그룹에서 해당 대안과 구분자 `|`를 지우세요. 접두 명령의 표기를
좁히려면 접두 그룹에서 해당 대안을 지우세요. 경로를 바꿀 필요는 없습니다. 패턴을 좁히거나 넓힐
때마다 일치하는 입력과 지나가는 입력을 다시 확인하세요.

`enforce: block`을 지우면 `advised`를 기록하고 호출을 계속합니다. 규율을 없애려면 항목을 삭제하세요.
수정한 뒤에는 항상 `pdks explain`을 실행하세요.

<a id="limits"></a>
## 한계

이 항목은 명령줄 텍스트의 대상 표기를 확인합니다. 실제로 어떤 파일에 닿는지, 삭제가 성공하는지는
확인하지 않습니다. `rm -rf build/cache`와 `rm -rf ./build`는 내용이 아무리 중요해도 판정을 받고
지나갑니다. 모든 디렉터리 삭제를 막지는 않습니다. `echo 'rm -rf *'`는 따옴표 안의 언급도 차단합니다.
heredoc 본문을 포함해 작성한 명령 전체를 읽습니다.

``echo `rm -rf *` ``는 이 항목의 판정을 받고 지나가며 사유가 `no-observation`인
`skipped shell-unjudgeable`도 기록합니다. ``echo `rm -rf * ` ``처럼 닫는 역따옴표 앞에 공백을 넣으면
일치합니다. 모든 명령 치환 표기를 다루는 패턴은 아닙니다.

접두 부분은 `env` 뒤의 플래그만 건너뛰고 변수 대입은 건너뛰지 않으므로 `env FOO=1 rm -rf ~`는 판정을
받고 지나갑니다.

`rm -rf *`, `rm -rf /*`, `rm -rf ./*`, `rm -rf ~/*`, `rm -rf $HOME`, `rm -rf ${HOME}/*`,
`true; rm -rf *`, `sudo rm -rf *`, ``echo `rm -rf * ` ``는 `blocked deletes-name-their-target`과
사유가 `no-observation`인 `skipped shell-unjudgeable`을 함께 기록합니다. 명령줄 텍스트 규율은
일치했지만 별도의 셸 분석은 변경 대상을 관측하지 못한 것입니다. skipped 행이 차단을 취소하지는
않습니다.

변경 집합 표면(`pdks covenant check --diff`)은 이 항목을 판정하지 않습니다. diff에는 명령줄이 없기
때문입니다.

호스트가 사람 증거를 제공할 때만 증인 토큰으로 차단된 호출을 열 수 있습니다.
[사람 증거](../reference/host-support.ko.md#human-evidence)를 참고하세요. 그렇지 않으면 자신의
터미널에서 명령을 실행하세요. 설정에 `witness:` 블록이 있으면 사람이 메시지 첫 줄에 설정된 증인
토큰만 입력하여 차단을 열 수 있습니다. 이 레시피의 블록에는 `witness:` 가 없습니다. 추가하는 방법은
[차단된 호출 열기](../troubleshooting.ko.md#opening-a-blocked-call)를 참고하세요.

어댑터가 설정된 셸 도구를 통해 호출을 관측해야 합니다. 다른 호스트 도구까지 자동으로 판정하지는
않습니다. JSON 예시는 판정기를 실행하며 호스트의 전달 여부를 증명하지 않습니다. `tools` 매핑이
없으면 이 항목의 판정 대신 일반 대체 passed 행만 남습니다.

어댑터나 판정기가 시작되지 못하면 호출은 판정 없이 진행됩니다. 연결한 뒤 `.polydeukes/roi.log`에
행이 남는지 확인하세요.
