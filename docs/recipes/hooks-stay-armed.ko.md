# 에이전트가 Git 커밋 훅을 건너뛰지 못하게 하기

[English](./hooks-stay-armed.md) · **한국어**

저장소에 커밋 훅이 있을 때 적용하는 규율(discipline)입니다. 에이전트의 명령을 실행하기 전에
명령줄에서 Git의 커밋 훅 건너뛰기 옵션과 훅 위치 설정을 확인합니다.

세션 표면 · 명령 텍스트를 읽음 · 일치하는 호출 차단 · 설치된 커밋 훅 필요 · 사용 전 수정할 값 없음.
호스트 지원: [셸 명령](../reference/host-support.ko.md#shell-commands).

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 아직 설정 파일이 없다면 프로젝트 루트에 이
이름으로 저장하세요. 파일에 이미 `sessionDisciplines:` 키가 있다면 첫 줄 아래의 항목만 기존 키 밑에
붙여 넣고, 기존 항목은 유지하세요. `pdks init`이 만든 파일처럼 파일은 있지만 `sessionDisciplines:`
키가 없다면 파일 끝에 블록 전체를 추가하세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "hooks-stay-armed"
    why: "a repository with a commit hook relies on that hook running; skipping it or changing its location can omit the checks."
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
              re: 'git\b[^|;&]*\bcommit\b[^|;&]*\s(--no-verify\b|-[a-zA-Z]*n)|(?i:core\.hooksPath)',
            }
      relate:
        - id: "hook-runs"
          relation: { op: "empty", of: "hits" }
          message: "command line skips or changes a commit hook: {value}"
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

그다음 pdks explain을 실행하여 hooks-stay-armed 행에 enforce: block이 있는지 확인하세요.
프로젝트 밖에 빈 디렉터리를 만들고, 셸 명령이 아닌 파일 쓰기 도구로 그 안에 polydeukes.config.yaml,
violating.json, valid.json을 만드세요. 그곳에서 "직접 확인하기"의 두 검사, 즉 violating.json과
valid.json에 --enforce block을 적용하는 검사를 실행하세요.
각각의 판정 결과 단어, 종료 코드, 강제 수준을 보고하세요.
.polydeukes/roi.log에서 hooks-stay-armed의 행을 확인하세요.
JSON 입력 안의 명령은 데이터이므로 실행하면 안 됩니다. skipped 판정 결과는 검사 성공이 아닙니다.
파괴적인 명령을 실행하거나 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "hooks-stay-armed"
    why: "a repository with a commit hook relies on that hook running; skipping it or changing its location can omit the checks."
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
              re: 'git\b[^|;&]*\bcommit\b[^|;&]*\s(--no-verify\b|-[a-zA-Z]*n)|(?i:core\.hooksPath)',
            }
      relate:
        - id: "hook-runs"
          relation: { op: "empty", of: "hits" }
          message: "command line skips or changes a commit hook: {value}"
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
  "toolCalls": [{ "name": "Bash", "args": { "command": "git commit --no-verify -m example" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "git commit -m example" } }],
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
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit --no-verify -m example — why: a repository with a commit hook relies on that hook running; skipping it or changing its location can omit the checks.
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
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit --no-verify -m example — why: a repository with a commit hook relies on that hook running; skipping it or changing its location can omit the checks.
```

종료 코드는 2입니다. 실제 세션에서도 이처럼 호출이 실행되기 전에 멈춥니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않고 종료 코드 0으로 끝납니다.

`.polydeukes/roi.log`에는 다음 세 행이 추가되며, 타임스탬프는 실행 시점에 따라 달라집니다.

```text
2026-11-10T14:20:38.338Z	advised	hooks-stay-armed	-	[{"id":"hook-runs","witnesses":[{"key":"1","value":"git commit --no-verify -m example"}],"total":1}]
2026-11-10T14:20:38.341Z	blocked	hooks-stay-armed	-	[{"id":"hook-runs","witnesses":[{"key":"1","value":"git commit --no-verify -m example"}],"total":1}]
2026-11-10T14:20:38.344Z	passed	hooks-stay-armed	-
```

**그 밖에 일치하는 명령줄**

- `git commit -anm example`
- `git config core.hooksPath .nohooks`
- `git config core.hookspath .nohooks`
- `git -c core.hooksPath=/dev/null commit -m example`
- `echo 'git commit --no-verify'`
- `git commit -n -m example`

heredoc 본문도 읽습니다. 같은 본문에서 구분자를 따옴표 없이 쓰는 `cat <<EOF`도 같은 진단 행으로
차단됩니다.

```text
cat <<'EOF'
git commit --no-verify
EOF
```

```text
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit -anm example
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit --no-verify
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git config core.hooksPath .nohooks
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git config core.hookspath .nohooks
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git -c core.hooksPath=/dev/null commit -m example
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: echo 'git commit --no-verify'
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit -n -m example
```

각 진단 뒤에는 두 번째 실행처럼 ` — why: …`가 이어집니다. 이 입력들은 종료 코드 2로 차단됩니다.

`git commit --no-gpg-sign -m example`, `git push --no-verify`,
`git commit -m example && git log -n 1`은 판정을 받고 지나갑니다. 커밋 서명을 끄는 것은 커밋 훅을
건너뛰는 동작이 아닙니다. `git commit --no-verify -m example`을 내용으로 `notes.txt`를 생성하거나,
그 파일에서 `old`를 `new`로 바꾸는 diff를 제출하면 종료 코드 0과 일반 `passed covenant-check` 행이
남습니다. 두 입력 모두 이 항목을 판정하지 않습니다.

**실제 세션에서 확인하기**

항목을 추가한 뒤 `pdks explain`을 실행하면 다음 행이 나옵니다.

```text
  declare  hooks-stay-armed  forbidden-command · change · empty hook-runs · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · enforce: block · unattended: judge
```

에이전트가 일치하는 명령을 시도하면 호출이 멈추고 메시지는 두 번째 실행의 출력 행으로 시작하며,
`.polydeukes/roi.log`에 `blocked` 행이 추가됩니다.

[첫 판정 튜토리얼](../tutorials/first-judgment.ko.md),
[표면 연결 안내](../how-to/connect-surfaces.ko.md), [설치 안내](../how-to/install.ko.md)를
참고하세요.

<a id="change-it"></a>
## 수정하기

정규식에는 세 가지 대안이 있습니다.

- `git`과 `commit` 뒤의 `--no-verify\b`: 커밋 훅을 건너뛰는 긴 옵션입니다.
- 같은 위치의 `-[a-zA-Z]*n`: 공백 뒤에 오는 `n`을 포함한 짧은 옵션 토큰으로, `-n`이나 `-anm` 등이
  일치합니다. `git commit -uno -m example`도 `-uno`가 훅 건너뛰기 옵션이 아닌데도 차단됩니다. 커밋
  메시지에 이런 토큰이 들어 있어도 일치합니다.
- `(?i:core\.hooksPath)`: 대소문자와 관계없이 설정 명령이나 명령별 재정의를 포함하여 훅 위치 설정을
  언급하는 문자열입니다. Git은 설정 키의 대소문자를 구분하지 않습니다.

건너뛰기 옵션 대안은 `|`, `;`, `&`에서 멈추므로 뒤에 오는 다른 명령의 옵션은 일치하지 않습니다.

건너뛰기 옵션 하나를 판정하지 않으려면 괄호 안에서 해당 대안과 구분자 `|`를 지우세요. 위치 설정을
판정하지 않으려면 `|(?i:core\.hooksPath)`를 지우세요. 사용 전에 바꿀 값은 없습니다. 훅 도구의 옵션은
[훅을 끄는 명령 판정하기](../how-to/git-hooks.ko.md#judge-the-off-switch)를 참고하세요.

`enforce: block`을 지우면 `advised`를 기록하고 호출을 계속합니다. 규율을 없애려면 항목을 삭제하세요.
수정한 뒤에는 항상 `pdks explain`을 실행하세요.

<a id="limits"></a>
## 한계

이 항목은 정규식으로 명령줄 텍스트를 비교합니다. `echo 'git commit --no-verify'`는 예시를 출력하기만
해도 차단됩니다. 위의 `cat <<'EOF'` 명령도 heredoc 본문에 `git commit --no-verify`가 들어 있어
차단됩니다. 커밋 메시지에 공백 뒤의 `n`을 포함한 짧은 옵션 토큰이 들어 있어도 일치합니다.
`git commit -uno -m example`은 `-uno`가 훅 건너뛰기 옵션이 아닌데도 차단됩니다.

건너뛰기 옵션 대안은 `|`, `;`, `&`를 지나서 읽지 않습니다. 같은 커밋 명령 안에서도 이 문자 뒤의
건너뛰기 옵션은 일치하지 않습니다. 예를 들어 커밋 메시지에 `;`가 있고 그 뒤에 옵션이 오는
경우입니다.

`git push --no-verify`는 판정을 받고 지나갑니다. 이 항목은 커밋의 건너뛰기 옵션을 확인합니다.
`git config core.hooksPath .nohooks`와 `git -c core.hooksPath=/dev/null commit -m example`은
차단되며, `core.hooksPath`가 들어 있는 읽기 전용 조회나 정당한 설정도 일치합니다. Git 인자 파서가
아니므로 `git`과 `commit` 사이에 다른 텍스트가 있어도 일치할 수 있습니다. 훅의 존재 여부나 훅이
실행하는 검사는 확인하지 않습니다.

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
