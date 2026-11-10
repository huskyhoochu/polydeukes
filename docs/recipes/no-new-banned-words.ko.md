# 기존 표현을 모두 고치지 않고 금지 낱말의 새 사용 감지하기

[English](./no-new-banned-words.md) · **한국어**

프로젝트가 소스와 테스트에서 피할 낱말을 정해 두었을 때 적용합니다. 이 규율(discipline)은 낱말별로
파일 안에서 첫 일치 낱말의 줄 수가 늘어나면 권고합니다. 기존에 일치하던 줄은 그 파일에 남겨 둘 수
있으며, 각 줄에서 목록의 낱말 중 처음 일치하는 낱말만 키가 됩니다.

세션 표면과 변경 집합 표면 · 기본 강제 수준은 권고 · 소스 경로와 낱말 목록을 바꾸세요.

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 설정이 없다면 프로젝트 루트에 저장하세요. 이미
`disciplines:` 키가 있으면 그 아래 항목만 추가하고 기존 항목을 유지하세요. 파일은 있지만 키가 없다면
블록 전체를 끝에 추가하세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "no-new-banned-words"
    why: "new uses of the selected words make project terminology inconsistent; existing matching lines may remain."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ["^(src|tests)/"]
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '\b(blacklist|whitelist)\b' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '\b(blacklist|whitelist)\b' }
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
기존 설정에서는 기존 키 밑에 항목만 추가하고 같은 키를 두 번 만들지 마세요.
다른 모든 항목, 보호 경로, 증인 설정을 유지하세요. 같은 id가 있으면 알리고 멈추세요.
설정 파일이 보호되어 있다면 정확한 패치를 보여 주고 사람이 적용하도록 요청하세요.
보호를 우회하지 마세요.
"바꾸기"에서 설명하는 값을 이 프로젝트에 맞추세요.
낱말 목록과 폴더가 주어지지 않았다면 사람에게 물어보세요.

pdks explain을 실행하여 no-new-banned-words 행을 확인하세요.
이 항목의 기본 강제 수준은 권고이므로 행에 enforce: block이 없어야 합니다.
프로젝트 밖에 빈 디렉터리를 만들고 파일 쓰기 도구로 이 설정과 "직접 확인하기"의
violating.json, valid.json을 저장하세요. 그곳에서 JSON 검사 세 번을 실행하세요.
violating.json은 강제 수준 플래그 없이 한 번, --enforce block으로 한 번 실행하고,
valid.json도 --enforce block으로 실행하세요.
각각의 판정 결과 단어, 종료 코드, 강제 수준과 이 항목의 기록 행을 보고하세요.
skipped 판정 결과는 검사 성공이 아닙니다. JSON은 입력 데이터이며 그 안의 셸 명령은 실행하지 마세요.
프로젝트에서 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "no-new-banned-words"
    why: "new uses of the selected words make project terminology inconsistent; existing matching lines may remain."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ["^(src|tests)/"]
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '\b(blacklist|whitelist)\b' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '\b(blacklist|whitelist)\b' }
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

빈 디렉터리에 위 YAML을 `polydeukes.config.yaml`로 저장하고 다음 두 입력을 저장하세요.
`pdks covenant check`는 JSON을 판정하며 편집을 실행하지 않습니다.

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
        "pre": "",
        "post": "blacklist\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
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
        "file_path": "src/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/example.ts",
        "pre": "blacklist\nold\n",
        "post": "blacklist\nnew\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  }
}
```

`fileChange`는 어댑터가 관측한 편집입니다. `kind`는 작업 종류, `path`는 파일 경로, `pre`와 `post`는
편집 전후 내용이며, `tools` 객체는 편집 도구와 셸 도구, 명령 인자를 지정하고 실제 세션에서는
어댑터가 제공합니다.

먼저 강제 수준 플래그 없이 실행합니다.

```sh
pdks covenant check < violating.json
```

표준 오류 출력:

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds blacklist: blacklist — why: new uses of the selected words make project terminology inconsistent; existing matching lines may remain.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 편집에 대해 권고합니다.

이번에는 세션과 같은 강제 수준으로 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds blacklist: blacklist — why: new uses of the selected words make project terminology inconsistent; existing matching lines may remain.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. `--enforce block`만으로 권고 항목이 차단으로 바뀌지는 않습니다. 어댑터도 이
실행 강제 수준을 사용합니다.

정상 입력을 검사합니다.

```sh
pdks covenant check --enforce block < valid.json
```

아무것도 출력하지 않고 종료 코드 0으로 끝납니다. `.polydeukes/roi.log`에 다음 세 행이 추가되며
타임스탬프는 실행 시점에 따라 달라집니다.

```text
2026-11-10T15:39:12.996Z	advised	no-new-banned-words	src/example.ts	[{"id":"nothing-added","witnesses":[{"key":"blacklist","value":"blacklist"}],"total":1}]
2026-11-10T15:39:12.999Z	advised	no-new-banned-words	src/example.ts	[{"id":"nothing-added","witnesses":[{"key":"blacklist","value":"blacklist"}],"total":1}]
2026-11-10T15:39:13.002Z	passed	no-new-banned-words	src/example.ts
```

그 밖에 권고하는 입력은 다음과 같습니다. `blacklist` 또는 `whitelist`가 든 `src/example.ts` 만들기,
`blacklist` 한 줄을 두 줄로 늘리기, 빈 `tests/example.ts`에 `blacklist` 추가하기,
`src/a/b/example.ts`의 `ok`를 `blacklist`로 바꾸기입니다. 모두 종료 코드는 0이며 첫 진단 행은 다음과
같이 시작합니다.

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds blacklist: blacklist
discipline 'no-new-banned-words' broken on src/example.ts: adds whitelist: whitelist
discipline 'no-new-banned-words' broken on tests/example.ts: adds blacklist: blacklist
discipline 'no-new-banned-words' broken on src/a/b/example.ts: adds blacklist: blacklist
```

각 행 뒤에는 앞과 같은 ` — why: …`와 권고 요약이 이어집니다. 다음 `src/example.ts` 편집은 출력 없이
종료 코드 0으로 지나갑니다. `blacklist`를 유지하고 다음 줄의 `old`만 `new`로 바꾸기, `ok`를
`Blacklist`로 바꾸기, `old`를 `blacklisted`로 바꾸기, `blacklist`를 `blacklist blacklist`나
`blacklist whitelist`로 바꾸기, `blacklist`가 든 파일 삭제하기입니다. 빈 `notes.txt`에 `blacklist`를
추가하면 범위 밖이므로 이 항목의 판정 결과 대신 `passed covenant-check`가 기록됩니다.

`src/example.ts`에서 `deny = blacklist + whitelist`를 `deny = whitelist`로 바꾸세요. 목록의 낱말을
더하지 않았어도 `advised`를 기록하며 종료 코드는 0입니다. 첫 진단 행은 다음과 같이 시작하고 앞과
같은 ` — why: …`가 이어집니다.

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds whitelist: deny = whitelist
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

`src/example.ts`의 `ok`를 다음 세 줄로 바꾸면 출력 없이 종료 코드 0으로 지나갑니다.

```text
const ip_blacklist = 1;
const ipBlacklist = 2;
BLACKLIST
```

`fileChange` 없이 `echo blacklist > src/example.ts`를 담은 Bash 호출은 출력 없이 종료 코드 0으로
끝나지만 이 항목에 `skipped`와 `no-observation`을 기록합니다. 관측한 파일 내용이 없기 때문입니다.

**변경 집합 표면에서**

같은 임시 디렉터리에서 Bash로 계속합니다. 로컬 Git 기준 커밋을 만든 뒤 추적 중인 파일을 바꿉니다.

```sh
git init -q
git config user.name 'Recipe Reader'
git config user.email reader@example.com
mkdir -p src
printf 'old\n' > src/example.ts
git add src/example.ts
git commit -qm baseline
printf 'blacklist\n' > src/example.ts
```

고정된 diff 플래그로 `HEAD`와 작업 트리를 비교해 판정합니다.

```sh
set -o pipefail
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD |
  pdks covenant check --diff
```

표준 오류 출력:

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds blacklist: blacklist — why: new uses of the selected words make project terminology inconsistent; existing matching lines may remain.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 추가된 행은 다음과 같습니다.

```text
2026-11-10T15:39:13.064Z	advised	no-new-banned-words	src/example.ts	[{"id":"nothing-added","witnesses":[{"key":"blacklist","value":"blacklist"}],"total":1}]
```

추적하지 않는 새 파일은 인덱스에 추가하기 전까지 `git diff`에 나타나지 않습니다. 세션에서 셸 쓰기의
내용을 관측하지 못했더라도 변경 집합 표면은 그 결과로 만든 diff를 판정합니다.

**실제 세션에서 확인하기**

`pdks explain`을 실행하면 세션 항목 행은 다음과 같습니다.

```text
  declare  no-new-banned-words added-only · change · empty nothing-added · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

이 행에는 `enforce: block`이 없습니다. 어댑터를 연결한 뒤 이 항목의 `advised` 또는 `passed` 행을
확인하세요.

[표면 연결 안내](../how-to/connect-surfaces.ko.md)와
[훅 없이 실행하기](../how-to/git-hooks.ko.md#without-a-hook)를 참고하세요.

<a id="change-it"></a>
## 바꾸기

`scope.include`의 `^(src|tests)/`에서 `src`와 `tests`를 프로젝트의 소스 폴더로 바꾸세요. 접두 패턴은
하위 디렉터리도 포함합니다. `before`와 `after` 양쪽의 `blacklist|whitelist`를 바꾸고 두 패턴을 같게
유지하세요. 캡처 그룹, 낱말 경계 `\b`, `count: true`를 유지하고 선택한 낱말의 정규식 문장 부호는
이스케이프하세요. 대소문자를 구분합니다. 식별자 안의 낱말도 선택하려면 양쪽 패턴에서 `\b` 경계를
없애세요. 대소문자를 구분하지 않으려면 `(?i)`를 추가하세요. 필요에 따라 둘 다 바꾼 뒤 일치하는
입력과 통과하는 입력을 다시 확인하세요.

세션에서 편집을 차단하려면 항목의 `why`와 같은 들여쓰기로 `enforce: block`을 추가하세요. 직접 실행할
때는 `--enforce block`도 필요하며, 없으면 계속 권고합니다. 규율을 없애려면 항목을 삭제하세요. 수정한
뒤에는 `pdks explain`을 실행하세요.

<a id="limits"></a>
## 한계

줄마다 첫 일치만 셉니다. `blacklist`를 `blacklist blacklist`나 `blacklist whitelist`로 바꾸면
지나가지만 별도의 `blacklist` 줄을 더하면 권고합니다. 모든 출현 횟수가 아니라 첫 일치 낱말별 줄 수를
세므로 주변 글자가 바뀌어도 수가 늘지 않으면 지나갈 수 있습니다. `deny = blacklist + whitelist`를
`deny = whitelist`로 바꾸면 키가 `blacklist`에서 `whitelist`로 바뀝니다. 목록의 낱말을 더하지
않았어도 `adds whitelist: deny = whitelist`로 권고합니다.

비교는 파일별로 합니다. 기존에 일치하던 줄을 남겨 둘 수 있다는 약속은 그 줄이 같은 파일에 있을 때만
성립합니다. `blacklist` 줄을 범위 안의 다른 파일이나 새 파일로 옮기면 받는 파일에 권고합니다. 앞의
새 파일 입력도 같은 이유로 권고합니다.

낱말은 대소문자를 구분하므로 `ok`를 `Blacklist`로 바꾸면 지나갑니다. 낱말 경계 때문에 `old`를
`blacklisted`로 바꾸어도 지나갑니다. 밑줄(`_`)과 글자는 낱말 문자입니다. 낱말 경계와 대소문자 구분
때문에 `const ip_blacklist = 1;`, `const ipBlacklist = 2;`, `BLACKLIST`를 더해도 지나갑니다.
`src/a/b/example.ts`는 `src/example.ts`처럼 범위 안이며 `tests/` 아래도 같은 접두 동작을 따릅니다.
`notes.txt`는 범위 밖입니다. 파일 생성은 변경 전을 빈 내용으로 보충하므로 새 `blacklist` 줄에
권고하고, 파일 삭제는 변경 후를 빈 내용으로 보충하므로 지나갑니다.

세션 입력은 제공된 파일 전체의 전후 내용을 비교합니다. diff 입력은 지운 줄과 더한 줄을 비교하므로
앞의 `old`를 `blacklist`로 바꾼 diff는 권고합니다. 파일 전체를 재구성하지 않으며 글자 이동의 결과는
diff가 어떤 줄을 짝지었는지에 따라 달라질 수 있습니다.

셸 쓰기 `echo blacklist > src/example.ts`는 세션 표면에서 `skipped`와 `no-observation`을 기록합니다.
변경 집합 표면은 diff가 만들어지면 그 결과를 판정합니다. 행위자 신원이나 대화 기록은 필요하지
않습니다.

어댑터가 지원하는 편집 도구를 통해 파일 내용을 실제로 관측해야 하며, 다른 호스트 도구를 자동으로
같은 것으로 보지는 않습니다. 이 JSON 검사는 판정기의 동작을 보여 주며 실제 호스트의 전달을 증명하지
않습니다. 어댑터나 판정기가 시작되지 못하면 호출은 판정 없이 지나갑니다. 연결한 뒤
`.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
