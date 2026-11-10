# 에이전트가 복구할 수 없는 작업을 지우지 못하게 하기

[English](./work-stays-recoverable.md) · **한국어**

이 규율(discipline)은 에이전트의 셸 명령을 실행 전에 판정하며, 커밋하지 않은 작업을 버리거나 lease
없이 원격 브랜치를 덮어쓰는 명령줄에서 위반을 판정합니다.

세션 표면(Claude Code, Codex) · 일치하는 호출 차단 · 사용 전 수정할 부분 없음.

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 아직 설정 파일이 없다면 프로젝트 루트에 이
이름으로 저장하세요. 파일에 이미 `sessionDisciplines:` 키가 있다면 첫 줄 아래의 항목만 기존 키 밑에
붙여 넣고, 기존 항목은 유지하세요. `pdks init`이 만든 파일처럼 파일은 있지만 `sessionDisciplines:`
키가 없다면 파일 끝에 블록 전체를 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "work-stays-recoverable"
    why: "a command that destroys uncommitted work, or force-pushes without a lease on the remote state, cannot be undone."
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
              re: 'git reset\b.*--hard|git clean\b.*-f|git checkout -- \.(?:\s|$)|git push\b.*--force(?![\w-])',
            }
      relate:
        - id: "recoverable"
          relation: { op: "empty", of: "hits" }
          message: "command line destroys uncommitted or remote state: {value}"
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

그다음 pdks explain을 실행하여 work-stays-recoverable 행에 enforce: block이 있는지 확인하세요.
프로젝트 밖에 빈 디렉터리를 만들고, 셸 명령이 아닌 파일 쓰기 도구로 그 안에 polydeukes.config.yaml,
violating.json, valid.json을 만드세요. 그곳에서 "직접 확인하기"의 두 검사, 즉 violating.json과
valid.json에 --enforce block을 적용하는 검사를 실행하세요.
각각의 판정 결과 단어, 종료 코드, 강제 수준을 보고하세요.
JSON 입력 안의 명령은 데이터이므로 실행하면 안 됩니다. skipped 판정 결과는 검사 성공이 아닙니다.
파괴적인 명령을 실행하거나 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "work-stays-recoverable"
    why: "a command that destroys uncommitted work, or force-pushes without a lease on the remote state, cannot be undone."
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
              re: 'git reset\b.*--hard|git clean\b.*-f|git checkout -- \.(?:\s|$)|git push\b.*--force(?![\w-])',
            }
      relate:
        - id: "recoverable"
          relation: { op: "empty", of: "hits" }
          message: "command line destroys uncommitted or remote state: {value}"
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
  "toolCalls": [{ "name": "Bash", "args": { "command": "git reset --hard HEAD~1" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "git reset --soft HEAD~1" } }],
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
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git reset --hard HEAD~1 — why: a command that destroys uncommitted work, or force-pushes without a lease on the remote state, cannot be undone.
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
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git reset --hard HEAD~1 — why: a command that destroys uncommitted work, or force-pushes without a lease on the remote state, cannot be undone.
```

종료 코드는 2입니다. 실제 세션에서도 이처럼 호출이 실행되기 전에 멈춥니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않고 종료 코드 0으로 끝납니다.

`.polydeukes/roi.log`에는 다음 세 행이 추가되며, 타임스탬프는 실행 시점에 따라 달라집니다.

```text
2026-11-10T10:53:06.837Z	advised	work-stays-recoverable	-	[{"id":"recoverable","witnesses":[{"key":"1","value":"git reset --hard HEAD~1"}],"total":1}]
2026-11-10T10:53:06.840Z	blocked	work-stays-recoverable	-	[{"id":"recoverable","witnesses":[{"key":"1","value":"git reset --hard HEAD~1"}],"total":1}]
2026-11-10T10:53:06.843Z	passed	work-stays-recoverable	-
```

**그 밖에 일치하는 명령줄**

- `git clean -fd`
- `git checkout -- .`
- `git push --force origin main`
- `echo 'never run git reset --hard'`

```text
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git clean -fd
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git checkout -- .
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git push --force origin main
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: echo 'never run git reset --hard'
```

각 출력 행 뒤에는 두 번째 실행처럼 ` — why: …`가 이어집니다. 마지막 명령은 해당 명령을 언급하기만
합니다. [한계](#limits)를 참고하세요.

lease를 포함한 강제 푸시인 `git push --force-with-lease origin main`과 한 경로만 checkout하는
`git checkout -- ./README.md`는 모두 판정을 받고 지나갑니다.

**실제 세션에서 확인하기**

항목을 추가한 뒤 `pdks explain`을 실행하면 다음 행이 나옵니다.

```text
  declare  work-stays-recoverable forbidden-command · change · empty recoverable · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · enforce: block · unattended: judge
```

에이전트가 일치하는 명령을 시도하면 호출이 멈추고 메시지는 두 번째 실행의 출력 행으로 시작하며,
`.polydeukes/roi.log`에 `blocked` 행이 추가됩니다.

[첫 판정 튜토리얼](../tutorials/first-judgment.ko.md),
[표면 연결 안내](../how-to/connect-surfaces.ko.md), [설치 안내](../how-to/install.ko.md)를
참고하세요.

<a id="change-it"></a>
## 수정하기

정규식에는 네 가지 대안이 있습니다.

- `git reset\b.*--hard`: 작업 트리를 버리는 hard reset.
- `git clean\b.*-f`: 추적하지 않는 파일의 강제 삭제.
- `git checkout -- \.(?:\s|$)`: 작업 트리 전체를 checkout으로 덮어쓸 때만 일치합니다.
  `git checkout -- ./README.md`처럼 한 경로만 checkout하는 명령은 판정을 받고 지나갑니다.
- `git push\b.*--force(?![\w-])`: lease 없는 강제 푸시. `--force-with-lease`는 일치하지 않습니다.

판정하고 싶지 않은 대안을 지우거나 필요한 대안을 추가하세요. `enforce: block`을 지우면 `advised`를
기록하고 호출을 계속합니다. 규율을 없애려면 항목을 삭제하세요. 수정한 뒤에는 항상 `pdks explain`을
실행하세요.

<a id="limits"></a>
## 한계

이 항목은 정규식으로 명령줄 텍스트를 비교합니다. 일치하는 문자열을 언급하기만 하는 명령도 실제로
실행하는 명령과 똑같이 판정합니다. 판정 대상은 heredoc 본문을 포함해 작성한 명령 전체입니다. 네 가지
대안에 들어맞지 않는 표기는 이 항목의 판정 범위 밖입니다.

변경 집합 표면(`pdks covenant check --diff`)은 이 항목을 판정하지 않습니다. diff에는 명령줄이 없기
때문입니다.

Codex에서는 증인 토큰으로 차단된 호출을 열 수 없습니다. 의도한 명령이라면 자신의 터미널에서
실행하세요. Claude Code에서는 설정에 `witness:` 블록이 있다면 사람이 메시지 첫 줄에 설정된 증인
토큰만 입력하여 차단을 열 수 있습니다. 이 레시피의 블록에는 `witness:`가 없습니다. 추가하는 방법은
[차단된 호출 열기](../troubleshooting.ko.md#opening-a-blocked-call)를 참고하세요.

어댑터나 판정기가 시작되지 못하면 호출은 판정 없이 진행됩니다. 연결한 뒤 `.polydeukes/roi.log`에
행이 남는지 확인하세요.
