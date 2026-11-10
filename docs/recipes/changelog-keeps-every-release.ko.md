# 변경 이력의 릴리스 제목을 모두 유지하기

[English](./changelog-keeps-every-release.md) · **한국어**

프로젝트의 CHANGELOG.md가 `## 1.2.3` 또는 `## [1.2.3]` 형식의 릴리스 제목을 쓸 때 적용합니다. 이
규율(discipline)은 일치하는 제목 줄이 사라지거나 바뀌면 권고합니다.

세션 표면과 변경 집합 표면 · 기본 강제 수준은 권고 · 형식이 다르면 변경 이력 경로와 두 제목 패턴을
바꾸세요.

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 설정이 없다면 프로젝트 루트에 저장하세요. 이미
`disciplines:` 키가 있으면 그 아래 항목만 추가하고 기존 항목을 유지하세요. 파일은 있지만 키가 없다면
블록 전체를 끝에 추가하세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "changelog-keeps-every-release"
    why: "published release headings must remain available when a changelog is edited."
    declare:
      mechanism: "one-way-marker"
      scope: { source: "target.path", include: ['^CHANGELOG\.md$'] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '^(## \[?\d+\.\d+\.\d+)' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '^(## \[?\d+\.\d+\.\d+)' }
      relate:
        - id: "release-kept"
          relation: { op: "subset", of: "before", in: "after" }
          message: "release heading removed: {value}"
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
프로젝트의 변경 이력이 제시한 형식과 다르면 "바꾸기"에서 설명하는 대로 경로와 제목 패턴을 맞추세요.

pdks explain을 실행하여 changelog-keeps-every-release 행을 확인하세요.
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
  - id: "changelog-keeps-every-release"
    why: "published release headings must remain available when a changelog is edited."
    declare:
      mechanism: "one-way-marker"
      scope: { source: "target.path", include: ['^CHANGELOG\.md$'] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '^(## \[?\d+\.\d+\.\d+)' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '^(## \[?\d+\.\d+\.\d+)' }
      relate:
        - id: "release-kept"
          relation: { op: "subset", of: "before", in: "after" }
          message: "release heading removed: {value}"
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
        "file_path": "CHANGELOG.md"
      },
      "fileChange": {
        "kind": "modify",
        "path": "CHANGELOG.md",
        "pre": "## 1.2.3\n",
        "post": ""
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
        "file_path": "CHANGELOG.md"
      },
      "fileChange": {
        "kind": "modify",
        "path": "CHANGELOG.md",
        "pre": "## 1.2.3\nold\n",
        "post": "## 1.2.3\nnew\n"
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
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3 — why: published release headings must remain available when a changelog is edited.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 편집에 대해 권고합니다.

이번에는 세션과 같은 강제 수준으로 실행합니다.

```sh
pdks covenant check --enforce block < violating.json
```

표준 오류 출력:

```text
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3 — why: published release headings must remain available when a changelog is edited.
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
2026-11-10T15:39:13.068Z	advised	changelog-keeps-every-release	CHANGELOG.md	[{"id":"release-kept","witnesses":[{"key":"## 1.2.3","value":"## 1.2.3"}],"total":1}]
2026-11-10T15:39:13.071Z	advised	changelog-keeps-every-release	CHANGELOG.md	[{"id":"release-kept","witnesses":[{"key":"## 1.2.3","value":"## 1.2.3"}],"total":1}]
2026-11-10T15:39:13.074Z	passed	changelog-keeps-every-release	CHANGELOG.md
```

`## 1.2.3`이 든 `CHANGELOG.md` 삭제도 권고합니다. 다음처럼 제목이 둘인 내용에서 첫 제목과 그 본문만
남기면 지운 `## 1.2.3`만 진단에 나옵니다.

```text
## 1.2.4

- b

## 1.2.3

- a
```

아래 링크 제목이나 사전 릴리스 제목을 지워도 권고합니다. 제목의 날짜만 바꾸어도 권고하며
`fileChange`에 다음 전후 값을 넣어 확인할 수 있습니다.

```json
{
  "pre": "## 1.2.3 (2025-01-01)\n",
  "post": "## 1.2.3 (2025-01-02)\n"
}
```

이 입력들의 종료 코드는 모두 0이며 첫 진단 행은 다음과 같이 시작합니다.

```text
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## [1.2.3](https://example.com/releases/1.2.3)
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3-rc.1
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3 (2025-01-01)
```

각 행 뒤에는 앞과 같은 ` — why: …`와 권고 요약이 이어집니다. 다음 입력은 출력 없이 종료 코드 0으로
지나갑니다. `## 1.2.3`이 든 `CHANGELOG.md` 만들기, `## 1.2.3`을 유지하며 앞에 `## 1.2.4` 추가하기,
본문의 `old`만 `new`로 바꾸기, `## 1.2.3 `의 끝 공백 없애기, `## Unreleased`나 `## v1.2.3`
삭제하기입니다. `notes.md`에서 `## 1.2.3`을 지우면 범위 밖이므로 `passed covenant-check`가
기록됩니다. `## 1.2.3`을 문맥으로 유지하고 본문의 `old`를 `new`로 바꾸는 diff도 지나갑니다.

`fileChange` 없이 `echo example > CHANGELOG.md`를 담은 Bash 호출은 출력 없이 종료 코드 0으로
끝나지만 이 항목에 `skipped`와 `no-observation`을 기록합니다. 관측한 파일 내용이 없기 때문입니다.

**변경 집합 표면에서**

같은 임시 디렉터리에서 Bash로 계속합니다. 로컬 Git 기준 커밋을 만든 뒤 추적 중인 파일을 바꿉니다.

```sh
git init -q
git config user.name 'Recipe Reader'
git config user.email reader@example.com
printf '## 1.2.3\n' > CHANGELOG.md
git add CHANGELOG.md
git commit -qm baseline
: > CHANGELOG.md
```

고정된 diff 플래그로 `HEAD`와 작업 트리를 비교해 판정합니다.

```sh
set -o pipefail
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD |
  pdks covenant check --diff
```

표준 오류 출력:

```text
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3 — why: published release headings must remain available when a changelog is edited.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 추가된 행은 다음과 같습니다.

```text
2026-11-10T15:39:13.138Z	advised	changelog-keeps-every-release	CHANGELOG.md	[{"id":"release-kept","witnesses":[{"key":"## 1.2.3","value":"## 1.2.3"}],"total":1}]
```

추적하지 않는 새 파일은 인덱스에 추가하기 전까지 `git diff`에 나타나지 않습니다. 세션에서 셸 쓰기의
내용을 관측하지 못했더라도 변경 집합 표면은 그 결과로 만든 diff를 판정합니다.

**실제 세션에서 확인하기**

`pdks explain`을 실행하면 세션 항목 행은 다음과 같습니다.

```text
  declare  changelog-keeps-every-release one-way-marker · change · subset release-kept · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

이 행에는 `enforce: block`이 없습니다. 어댑터를 연결한 뒤 이 항목의 `advised` 또는 `passed` 행을
확인하세요.

[표면 연결 안내](../how-to/connect-surfaces.ko.md)와
[훅 없이 실행하기](../how-to/git-hooks.ko.md#without-a-hook)를 참고하세요.

<a id="change-it"></a>
## 바꾸기

변경 이력 위치가 다르면 `scope.include`의 `^CHANGELOG\.md$`를 바꾸되 시작과 끝 표시, 점의
이스케이프를 유지하세요. 제목 형식이 다르면 `before`와 `after` 양쪽의 `^(## \[?\d+\.\d+\.\d+)`를
바꾸고 두 패턴을 같게 유지하세요. 첫 캡처는 증인의 키가 되지만 관계는 그 키만이 아니라 보존된 제목
줄 전체를 비교합니다. 제시한 경로와 제목 형식이라면 값을 바꿀 필요가 없습니다.

세션에서 편집을 차단하려면 항목의 `why`와 같은 들여쓰기로 `enforce: block`을 추가하세요. 직접 실행할
때는 `--enforce block`도 필요하며, 없으면 계속 권고합니다. 규율을 없애려면 항목을 삭제하세요. 수정한
뒤에는 `pdks explain`을 실행하세요.

<a id="limits"></a>
## 한계

제목 줄 전체를 비교합니다. 직접 확인하기의 날짜만 바꾼 입력은 버전이 같아도 권고하며 링크나 문장
부호 변경도 비교하는 값을 바꿉니다. 줄은 양끝 공백을 제거하여 비교하므로 `## 1.2.3 `의 끝 공백만
없애면 지나갑니다.

`## 1.2.3-rc.1`은 선택되므로 지우면 권고합니다. `## Unreleased`와 `## v1.2.3`은 선택되지 않아 지워도
지나갑니다. `## 1.2.4`와 `## 1.2.3` 중 뒤의 제목만 지우면 그 제목만 진단에 나옵니다. 본문의 `old`만
`new`로 바꾸면 지나갑니다. 릴리스 순서, 버전의 유효성, 본문 내용과 같은 제목의 출현 횟수는 검사하지
않습니다.

`## 1.2.3`이 든 `CHANGELOG.md`를 만들면 변경 전을 빈 내용으로 보충하므로 지나가고, 삭제하면
권고합니다. `notes.md`에서 같은 제목을 지우는 것은 범위 밖입니다. diff 판정은 변경 이력 전체가
아니라 선택된 삭제 줄과 추가 줄을 비교합니다. 제목 삭제 diff는 권고하고 본문만 바꾼 diff는
지나갑니다.

셸 쓰기 `echo example > CHANGELOG.md`는 세션 표면에서 `skipped`와 `no-observation`을 기록합니다.
변경 집합 표면은 diff가 만들어지면 그 결과를 판정합니다. 행위자 신원이나 대화 기록은 필요하지
않습니다.

어댑터가 지원하는 편집 도구를 통해 파일 내용을 실제로 관측해야 하며, 다른 호스트 도구를 자동으로
같은 것으로 보지는 않습니다. 이 JSON 검사는 판정기의 동작을 보여 주며 실제 호스트의 전달을 증명하지
않습니다. 어댑터나 판정기가 시작되지 못하면 호출은 판정 없이 지나갑니다. 연결한 뒤
`.polydeukes/roi.log`에서 이 항목의 행을 확인하세요.
