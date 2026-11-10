# head나 tail로 잘린 테스트·검색 출력 감지하기

[English](./output-is-read-whole.md) · **한국어**

이 규율(discipline)은 에이전트의 셸 명령을 실행 전에 판정하며, 나열된 테스트·검색·Git·빌드 명령의
출력을 head나 tail에 직접 파이프로 넘기는 명령줄에 권고합니다.

세션 표면(Claude Code, Codex) · 일치하는 호출에 권고 · 사용하는 도구에 맞게 검사·검색 명령 목록을
확인하고 수정.

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 아직 설정 파일이 없다면 프로젝트 루트에 이
이름으로 저장하세요. 파일에 이미 `sessionDisciplines:` 키가 있다면 첫 줄 아래의 항목만 기존 키 밑에
붙여 넣고, 기존 항목은 유지하세요. `pdks init`이 만든 파일처럼 파일은 있지만 `sessionDisciplines:`
키가 없다면 파일 끝에 블록 전체를 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "output-is-read-whole"
    why: "cutting check or search output can hide failures or matching files; a pipeline can also report the last command status instead of the check status."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '\b(?:git\s+(?:push|commit)|cargo\s+(?:test|clippy)|pnpm\b[^|;&\n]*\b(?:test|check|typecheck|build)|vitest|grep|rg|find)\b(?:[^|;&\n]|>&\d)*\|\s*(?:head|tail)\b(?!\s+-[fF]\b)',
            }
      relate:
        - id: "not-truncated"
          relation: { op: "empty", of: "hits" }
          message: "command line cuts check or search output: {value}"
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

그다음 pdks explain을 실행하여 output-is-read-whole 행을 확인하세요.
이 항목은 enforce를 생략하여 권고합니다. enforce: block이 표시되면 안 됩니다.
프로젝트 밖에 빈 디렉터리를 만들고, 셸 명령이 아닌 파일 쓰기 도구로 그 안에 polydeukes.config.yaml,
violating.json, valid.json을 만드세요. 그곳에서 "직접 확인하기"의 세 검사를 실행하세요.
violating.json을 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 검사하고,
valid.json을 --enforce block으로 검사하세요. 각각의 판정 결과 단어, 종료 코드, 강제 수준을 보고하세요.
JSON 입력 안의 명령은 데이터이므로 실행하면 안 됩니다. skipped 판정 결과는 검사 성공이 아닙니다.
JSON 안의 명령을 실행하거나 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "output-is-read-whole"
    why: "cutting check or search output can hide failures or matching files; a pipeline can also report the last command status instead of the check status."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '\b(?:git\s+(?:push|commit)|cargo\s+(?:test|clippy)|pnpm\b[^|;&\n]*\b(?:test|check|typecheck|build)|vitest|grep|rg|find)\b(?:[^|;&\n]|>&\d)*\|\s*(?:head|tail)\b(?!\s+-[fF]\b)',
            }
      relate:
        - id: "not-truncated"
          relation: { op: "empty", of: "hits" }
          message: "command line cuts check or search output: {value}"
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
  "toolCalls": [{ "name": "Bash", "args": { "command": "git push | head" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "rg needle > results.txt" } }],
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
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: git push | head — why: cutting check or search output can hide failures or matching files; a pipeline can also report the last command status instead of the check status.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 이 항목의 기본 강제 수준은 권고이므로 명령 실행을 허용합니다.

이번에는 세션과 같은 강제 수준으로 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: git push | head — why: cutting check or search output can hide failures or matching files; a pipeline can also report the last command status instead of the check status.
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
2026-11-10T14:20:48.344Z	advised	output-is-read-whole	-	[{"id":"not-truncated","witnesses":[{"key":"1","value":"git push | head"}],"total":1}]
2026-11-10T14:20:48.347Z	advised	output-is-read-whole	-	[{"id":"not-truncated","witnesses":[{"key":"1","value":"git push | head"}],"total":1}]
2026-11-10T14:20:48.350Z	passed	output-is-read-whole	-
```

**그 밖에 일치하는 명령줄**

- `cargo clippy | tail`
- `find . -name example | tail`
- `git commit | tail`
- `grep needle input.txt | tail`
- `echo "cargo test | tail"`
- `pnpm build | tail`
- `pnpm check | tail`
- `pnpm test | head`
- `pnpm typecheck | head`
- `rg needle | head`
- `cargo test 2>&1 | tail`
- `cargo clippy | tail -n 20`
- `vitest | head`

```text
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: cargo clippy | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: find . -name example | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: git commit | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: grep needle input.txt | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: echo "cargo test | tail"
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: pnpm build | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: pnpm check | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: pnpm test | head
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: pnpm typecheck | head
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: rg needle | head
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: cargo test 2>&1 | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: cargo clippy | tail -n 20
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: vitest | head
```

각 출력 행 뒤에는 앞의 실행처럼 ` — why: …`와 권고 요약 줄이 이어집니다. 이 호출들은 `advised`를
기록하고 종료 코드 0으로 끝납니다.

`cargo test | tail -f`, `cargo test | tail -F`, `ls | head`, `rg needle > results.txt`는 판정을 받고
지나갑니다. 출력을 파일에 저장하면 나중에 읽을 수 있습니다. 출력을 내는 명령의 종료 코드를 보존하고
파일을 읽으세요. 이 항목은 그 후속 행동을 확인하지 않습니다.

빈 내용에서 `git push | head`을 새 내용으로 하여 `notes.txt`를 만드는 `Edit` 호출은 명령줄에 범위를
둔 이 항목을 호출하지 않습니다. `notes.txt`의 `old`를 `new`로 바꾸는 diff도 이 항목을 호출하지
않습니다. 둘 다 종료 코드 0으로 끝나며, 이 항목의 판정 결과 대신 `notes.txt`에 대한
`passed covenant-check` 행을 기록합니다.

**실제 세션에서 확인하기**

항목을 추가한 뒤 `pdks explain`을 실행하면 다음 행이 나옵니다.

```text
  declare  output-is-read-whole forbidden-command · change · empty not-truncated · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

이 항목은 권고하므로 출력 행에 `enforce: block`이 없습니다. 에이전트가 일치하는 명령을 시도하면 권고
메시지와 함께 호출이 계속되고 `.polydeukes/roi.log`에 `advised` 행이 추가됩니다.

[첫 판정 튜토리얼](../tutorials/first-judgment.ko.md),
[표면 연결 안내](../how-to/connect-surfaces.ko.md), [설치 안내](../how-to/install.ko.md)를
참고하세요.

<a id="change-it"></a>
## 수정하기

출력을 내는 명령의 대안은 다음과 같습니다.

- `git\s+(?:push|commit)`: `git push`와 `git commit`.
- `cargo\s+(?:test|clippy)`: `cargo test`와 `cargo clippy`.
- `pnpm\b[^|;&\n]*\b(?:test|check|typecheck|build)`: 중간 인자를 허용하는 pnpm의 `test`, `check`,
  `typecheck`, `build`.
- `vitest`, `grep`, `rg`, `find`: 각 이름의 명령.

다음 부분은 같은 줄에서 직접 이어지는 파이프를 요구하며, `>&\d`는 그 앞의 `2>&1` 같은 리디렉션도
허용합니다. `(?:head|tail)`은 두 출력 명령 중 하나를 고릅니다. `(?!\s+-[fF]\b)`는 바로 뒤의 `-f`
또는 `-F` 옵션을 제외합니다. 앞의 tail 입력 두 개가 판정을 받고 지나가는 이유입니다.

해당 명령을 판정하지 않으려면 출력을 내는 명령의 대안과 인접한 `|`를 지우거나, 내부 그룹에서 동사
하나를 지우세요. 출력 명령 하나만 남기려면 `head`나 `tail`과 인접한 `|`를 지우세요. 사용하는 도구의
표기를 추가하고, 수정할 때마다 일치하는 입력과 지나가는 입력을 모두 확인하세요.

세션에서 일치하는 호출을 차단하려면 `why`와 같은 들여쓰기로 항목에 `enforce: block`을 추가하세요.
직접 실행할 때는 `--enforce block`도 필요하며, 이 플래그가 없으면 여전히 권고합니다. 규율을 없애려면
항목을 삭제하세요. 수정한 뒤에는 항상 `pdks explain`을 실행하세요.

<a id="limits"></a>
## 한계

이 항목은 정규식으로 명령줄 글자를 맞춥니다. `echo "cargo test | tail"`은 파이프를 언급하기만 해도
권고를 받습니다. `cargo test 2>&1 | tail`도 리디렉션을 포함하여 일치합니다. 출력, 종료 코드,
에이전트가 이후에 읽는 내용은 검사하지 않습니다.

나열된 명령이 한 줄에서 직접 파이프로 이어지는 표기만 다룹니다. `cargo test | tail -f`와
`cargo test | tail -F`, 목록 밖의 명령인 `ls | head`는 판정을 받고 지나갑니다. 중간 필터가 `grep`,
`rg`, `find`이면 그 자체가 나열된 출력 명령이므로 `cargo test 2>&1 | grep FAIL | head`는 권고를
받습니다(종료 코드 0). `cargo test | sort | head`처럼 목록 밖의 필터는 판정을 받고 지나갑니다. 여러
줄에 걸친 파이프나 다른 출력 자르기 명령은 이 패턴의 범위 밖입니다. `rg needle > results.txt` 입력이
지나간다고 파일을 읽었다는 뜻은 아닙니다.

변경 집합 표면(`pdks covenant check --diff`)은 명령줄이 없는 diff를 받으므로 이 항목을 판정하지
않습니다. 앞의 `notes.txt` 편집과 diff 입력에서 보듯 `passed covenant-check` 행은 이 규율의 판정
결과가 아닙니다.

어댑터가 설정된 셸 도구의 호출로 관측해야 하며, 다른 호스트 도구를 자동으로 같은 것으로 보지는
않습니다. 이 JSON 검사는 판정기의 동작을 보여 주며 실제 호스트가 호출을 전달한다는 증거는 아닙니다.
어댑터나 판정기가 시작되지 못하면 호출은 판정 없이 지나갑니다. 연결한 뒤 `.polydeukes/roi.log`의
행을 확인하세요.
