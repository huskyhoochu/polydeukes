# 영어 문서와 한국어 문서가 함께 바뀌는지 확인하기

[English](./docs-stay-bilingual.md) · **한국어**

이 규율(discipline)은 여러분의 프로젝트가 `manual/start.md`와 `manual/start.ko.md`처럼 영어와 한국어
Markdown 문서를 쌍으로 관리할 때 적용합니다. 같은 변경 집합에 두 경로가 있는지 확인합니다.

변경 집합 표면 전용 · 기본 강제 수준은 권고 · 폴더와 언어 접미사를 바꾸세요.

아래 블록은 완전한 `polydeukes.config.yaml`입니다. 설정이 없다면 프로젝트 루트에 저장하세요. 이미
`disciplines:`가 있다면 그 키 아래에 항목만 추가하고 기존 항목은 유지하세요. 파일은 있지만 그 키가
없다면 블록 전체를 덧붙이세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "docs-stay-bilingual"
    why: "paired documents should be updated together; this checks only that both paths occur in the change set."
    declare:
      mechanism: "companion"
      scope: { source: "target.path", include: ['^manual/.*\.md$'] }
      extract:
        en:
          - { op: "source", of: "target.path" }
          - { op: "keyByPattern", re: '^(.+?)(?<!\.ko)\.md$' }
        ko:
          - { op: "source", of: "target.path" }
          - { op: "keyByPattern", re: '^(.+)\.ko\.md$' }
        enChanged:
          - { op: "source", of: "changes" }
          - { op: "items" }
          - { op: "keyByPattern", re: '^(.+?)(?<!\.ko)\.md$' }
        koChanged:
          - { op: "source", of: "changes" }
          - { op: "items" }
          - { op: "keyByPattern", re: '^(.+)\.ko\.md$' }
      relate:
        - id: "ko-follows"
          relation: { op: "implies", of: "en", requires: "koChanged" }
          message: "{value} changed without {key}.ko.md"
        - id: "en-follows"
          relation: { op: "implies", of: "ko", requires: "enChanged" }
          message: "{value} changed without {key}.md"
```

<a id="agent-prompt"></a>
## 에이전트에게 설정 맡기기

프로젝트에서 사용하는 Claude Code나 Codex에 다음 프롬프트를 붙여 넣으세요.

````text
아래 항목을 이 프로젝트의 polydeukes.config.yaml에 있는 disciplines: 밑에 추가하세요.
기존 목록 키를 쓰고 같은 키를 두 번 만들지 마세요. 다른 항목, 보호 경로, 증인 설정은 유지하세요.
같은 id가 이미 있으면 알리고 멈추세요.
이 세션에서 설정이 보호되어 있다면 정확한 패치를 보여 주고 사람이 적용하도록 요청하세요.
보호를 우회하지 마세요.
"바꿔 쓰기"에서 설명하는 값을 이 프로젝트에 맞추세요. pdks explain을 실행하고
docs-stay-bilingual 행을 확인하세요. 권고 항목이므로 enforce: block이 표시되면 안 됩니다.
프로젝트 밖의 빈 임시 디렉터리에서 예제 설정 그대로 "직접 확인하기"의 Git 절차를 재현하세요.
임시 저장소의 기준 파일만 그곳에 커밋하세요. 판정 결과, 종료 코드, 강제 수준을 보고하세요.
skipped 판정 결과는 검사 성공이 아닙니다. 프로젝트에서 커밋하거나 푸시하지 마세요.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "docs-stay-bilingual"
    why: "paired documents should be updated together; this checks only that both paths occur in the change set."
    declare:
      mechanism: "companion"
      scope: { source: "target.path", include: ['^manual/.*\.md$'] }
      extract:
        en:
          - { op: "source", of: "target.path" }
          - { op: "keyByPattern", re: '^(.+?)(?<!\.ko)\.md$' }
        ko:
          - { op: "source", of: "target.path" }
          - { op: "keyByPattern", re: '^(.+)\.ko\.md$' }
        enChanged:
          - { op: "source", of: "changes" }
          - { op: "items" }
          - { op: "keyByPattern", re: '^(.+?)(?<!\.ko)\.md$' }
        koChanged:
          - { op: "source", of: "changes" }
          - { op: "items" }
          - { op: "keyByPattern", re: '^(.+)\.ko\.md$' }
      relate:
        - id: "ko-follows"
          relation: { op: "implies", of: "en", requires: "koChanged" }
          message: "{value} changed without {key}.ko.md"
        - id: "en-follows"
          relation: { op: "implies", of: "ko", requires: "enChanged" }
          message: "{value} changed without {key}.md"
```
````

<a id="try-it"></a>
## 직접 확인하기

빈 임시 디렉터리에 위 YAML을 `polydeukes.config.yaml`로 저장하세요.

임시 Git 저장소를 만들고 기준 문서 둘을 커밋한 뒤 영어 문서만 편집하세요.

```sh
git init -q
git config user.name Recipe
git config user.email recipe@example.invalid
mkdir -p manual
printf 'old\n' > manual/start.md
printf 'old\n' > manual/start.ko.md
git add manual/start.md manual/start.ko.md
git commit -qm baseline
printf 'new\n' > manual/start.md
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff
```

```text
discipline 'docs-stay-bilingual' broken on manual/start.md: manual/start.md changed without manual/start.ko.md — why: paired documents should be updated together; this checks only that both paths occur in the change set.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. 짝이 없으므로 `advised`를 기록합니다.

```sh
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff --enforce block
```

```text
discipline 'docs-stay-bilingual' broken on manual/start.md: manual/start.md changed without manual/start.ko.md — why: paired documents should be updated together; this checks only that both paths occur in the change set.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

종료 코드는 0입니다. `--enforce block`만으로 권고 항목을 차단으로 올리지 않습니다. 이제 짝 문서를
바꾸세요.

```sh
printf 'new\n' > manual/start.ko.md
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff
```

출력 없이 종료 코드 0으로 끝납니다. `.polydeukes/roi.log`에 다음 행이 추가되며 타임스탬프는
달라집니다.

```text
2026-11-10T15:38:55.948Z	advised	docs-stay-bilingual	manual/start.md	[{"id":"ko-follows","witnesses":[{"key":"manual/start","value":"manual/start.md"}],"total":1}]
2026-11-10T15:38:55.953Z	advised	docs-stay-bilingual	manual/start.md	[{"id":"ko-follows","witnesses":[{"key":"manual/start","value":"manual/start.md"}],"total":1}]
2026-11-10T15:38:55.960Z	passed	docs-stay-bilingual	manual/start.ko.md
2026-11-10T15:38:55.960Z	passed	docs-stay-bilingual	manual/start.md
```

**다른 변경 집합**

아래 각 입력에서 이름 붙인 문서는 `old`에서 `new`로 바뀝니다. 모두 권고하며 종료 코드는 0입니다. 첫
줄은 다음과 같습니다.

`manual/start.ko.md`만 바뀝니다.

```text
discipline 'docs-stay-bilingual' broken on manual/start.ko.md: manual/start.ko.md changed without manual/start.md
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

한국어 짝이 없는 `manual/README.md`만 바뀝니다.

```text
discipline 'docs-stay-bilingual' broken on manual/README.md: manual/README.md changed without manual/README.ko.md
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

`manual/start.md`와 `manual/other.ko.md`가 함께 바뀝니다.

```text
discipline 'docs-stay-bilingual' broken on manual/start.md: manual/start.md changed without manual/start.ko.md
discipline 'docs-stay-bilingual' broken on manual/other.ko.md: manual/other.ko.md changed without manual/other.md
covenant advisory: 2 verdict(s) recorded as advised, not blocked
```

진단 줄에는 위와 같은 ` — why: …`가 이어집니다.

`manual/guide/intro.md`와 `manual/guide/intro.ko.md`를 모두 `old`에서 `new`로 바꾸면 통과합니다.
각각 `new`를 담은 `manual/new.md`와 `manual/new.ko.md`를 추가해도 diff에 두 추가가 모두 있으면
통과합니다. 추적되지 않는 새 파일은 인덱스에 추가하기 전까지 `git diff`에 나타나지 않습니다.
`notes.md`를 `old`에서 `new`로 바꾸는 diff는 범위 밖이므로 `passed covenant-check`를 기록합니다. 이
입력들은 표준 오류 출력 없이 종료 코드 0으로 끝납니다.

`manual/start.md`를 `kind: "modify"`, `pre: "old\n"`, `post: "new\n"`으로 편집하는 `Edit` 호출은
표준 오류 출력 없이 종료 코드 0으로 끝나며 `skipped docs-stay-bilingual`과 `no-observation`을
기록합니다. 세션 편집 한 건에는 완성된 변경 집합이 없습니다.

같은 `tools` 객체로 `echo changed > manual/start.md`를 담은 `Bash` 호출을 JSON으로 제출하면 출력
없이 종료 코드 0으로 끝나며 다음을 기록합니다.

```text
2026-11-10T15:38:55.964Z	skipped	docs-stay-bilingual	manual/start.md	no-observation
```

**등록 확인하기**

`pdks explain`을 실행하세요(종료 코드 0). 항목의 행은 다음과 같습니다.

```text
  declare  docs-stay-bilingual companion · change · implies ko-follows, en-follows · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓
```

세션 절에는 다음이 표시됩니다.

```text
  skip     docs-stay-bilingual reads changes — judged on the change-set surface
```

권고 항목이므로 행에 `enforce: block`이 없습니다. diff 생성과 파이프라인 실패 처리는
[Git
검사](../how-to/git-hooks.ko.md#without-a-hook)를
참고하세요.

<a id="change-it"></a>
## 바꿔 쓰기

`scope.include`의 `^manual/.*\.md$`에서 `manual/`을 모든 문서에 짝이 있는 폴더로 바꾸세요. `.ko`
대신 `.ja` 같은 접미사를 쓰려면 `keyByPattern.re` 네 곳을 모두 바꾸세요.

- `en`과 `enChanged`: 두 곳의 부정형 후방 탐색 `(?<!\.ko)`를 `(?<!\.ja)`로 바꾸세요.
- `ko`와 `koChanged`: 두 곳의 `\.ko\.md$`를 `\.ja\.md$`로 바꾸세요.

메시지 둘도 확인하세요. `ko-follows.message`는 새 짝 접미사인 `{key}.ja.md`를 가리켜야 합니다.
`en-follows.message`는 접미사 없는 짝인 `{key}.md`를 계속 가리켜야 합니다. 접미사 없는 파일명 형식도
바꾼다면 그 메시지와 해당 패턴 둘을 함께 바꾸세요. `{value}`와 `{key}`는 치환 자리로 유지하세요.

`manual/README.md`처럼 짝이 없는 파일은 쌍을 갖춘 더 좁은 폴더를 선택하거나 `scope` 안의 `include`
옆에 `exclude: ['^manual/README\.md$']`를 추가해 제외하세요.

항목에 `why`와 같은 들여쓰기로 `enforce: block`을 추가하세요. 앞의 짝 없는 `manual/start.md` 변경을
`--enforce block`과 함께 `--diff`로 실행하면 종료 코드 2로 끝나며 `blocked`를 기록합니다. 그
플래그가 없으면 여전히 권고합니다. 이 항목은 완성된 변경 집합을 읽으므로 세션 편집은 어느 경우든
`skipped`와 `no-observation`을 기록합니다. 규율을 없애려면 항목을 삭제하세요. 바꾼 뒤에는
`pdks explain`을 실행하세요.

<a id="limits"></a>
## 한계

같은 변경 집합에 두 경로가 있는지만 검사합니다. `manual/start.md`와 `manual/start.ko.md`를 모두
`old`에서 `new`로 바꾸면 통과하지만 번역 품질이나 의미의 일치를 확인하지는 않습니다. 대신
`manual/other.ko.md`를 바꾸면 짝이 없는 두 경로 모두에 권고합니다.

짝이 없는 `manual/README.md`는 바뀔 때마다 권고합니다. 모든 문서가 쌍을 이루는 폴더로 범위를
좁히거나 `exclude` 패턴을 추가하세요. `manual/guide/intro.md`와 `manual/guide/intro.ko.md` 같은 중첩
경로의 쌍, `manual/new.md`와 `manual/new.ko.md` 같은 새 쌍도 두 경로가 있으면 통과합니다. 추적되지
않는 새 파일은 인덱스에 추가하기 전까지 `git diff`에 없습니다.

`manual/start.md`를 `old`에서 `new`로 바꾸는 세션 `Edit`은 완성된 변경 집합을 제공하지 않으므로
`skipped`와 `no-observation`을 기록합니다.

`echo changed > manual/start.md` 같은 셸 쓰기는 세션 표면에서 `skipped`와 `no-observation`을
기록합니다. diff를 생성하면 변경 집합 표면이 그 결과를 판정합니다.

이 검사들은 판정기를 확인하며 실제 호스트의 전달을 입증하지는 않습니다. 어댑터나 판정기가 시작되지
못하면 호출은 판정 없이 진행됩니다. 세션을 연결한 뒤 `.polydeukes/roi.log`에 예상한 행이 있는지
확인하세요.
