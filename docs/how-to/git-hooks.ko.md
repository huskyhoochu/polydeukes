# git에서 변경 집합 판정 실행하기

[English](./git-hooks.md) · **한국어**

변경 집합 표면은 완성된 diff를 판정합니다. 직접 실행하거나 CI 또는 커밋 훅에서 실행할 수 있습니다.
이 페이지는 명령줄과 훅 도구 네 가지의 설정 방법을 설명합니다.

<a id="contract"></a>
## 계약

```sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

이 명령은 작업 디렉터리의 `polydeukes.config.yaml`을 읽으며, git을 직접 호출하거나 사람에게 묻지
않습니다. 파일은 프로젝트 루트에 있어야 합니다. [프로젝트 설정하기](./configure-project.ko.md)를
참고하세요. 설정 파일 없이 측정했을 때 명령은
`covenant check failed closed: no Polydeukes config found`로 시작하는 줄을 출력하고 종료 코드 2를
냈습니다. 따라서 파일이 생기기 전에 연결한 훅은 모든 커밋을 막습니다.

종료 코드 0은 실행을 마쳤다는 뜻이며, 기본값에서는 모든 약속(covenant) 위반을 `advised`로
기록합니다. `--enforce block`에서 종료 코드 2는 보호 경로나 `enforce: block` 항목의 위반을 뜻합니다.
설정을 읽어 들이지 못해도 종료 코드 2입니다. 종료 코드 3은 입력을 읽지 못해 아무것도 판정하지
않았다는 뜻입니다. 명령을 실행하고 0이 아닌 종료 코드에서 멈추는 도구라면 이 판정을 실행할 수
있습니다.

판정기는 stdin으로 들어온 것만 봅니다. `git diff` 자체가 실패하면 아무것도 들어오지 않습니다. 빈
diff에는 판정할 것이 없으므로 명령은 종료 코드 0을 냅니다. 존재하지 않는 기준 ref로 측정했을 때
파이프라인은 bash에서 종료 코드 0을 냈고, 앞에 `set -o pipefail;`을 붙이면 git 자체의 종료 코드인
128을 냈습니다. 셸이 지원한다면 파이프라인 앞에 `set -o pipefail;`을 붙여 git의 실패가 해당 단계를
실패시키도록 하세요. [훅 없이 실행하기](#without-a-hook)의 기준 브랜치 비교 예제가 이 형식입니다.

`git diff` 플래그는 색상, 외부 diff, textconv, 경로 접두 설정을 고정합니다.
[생산자 고정하기](../reference/cli/covenant-check.ko.md#pin-the-producer)를 참고하세요. 판정 결과
행은 `.polydeukes/roi.log`에 덧붙입니다.

이 페이지에 인용한 결과는 깨끗한 Linux x64 컨테이너에서 배포된 판정기를 실행해 얻었습니다.
`protectedPaths`에 있는 경로의 변경을 스테이징했을 때 위 명령은 종료 코드 0으로 커밋을 만들고
`advised` 행 하나를 기록했습니다. stderr에는 `staged-write would modify protected path` 뒤에 경로가
붙은 줄과 권고 요약 한 줄이 나왔습니다. `--enforce block`을 붙이면 `pdks`가 종료 코드 2를 내어 훅이
실패했고, 커밋을 만들지 않고 `blocked` 행 하나를 기록했습니다. 보호하지 않은 파일만 스테이징하고
`--enforce block`으로 실행하면 종료 코드 0과 `passed` 행 하나를 남겼습니다.

<a id="without-a-hook"></a>
## 훅 없이 실행하기

이 판정에는 훅이 필요하지 않습니다. 차단을 켜고 스테이징한 변경을 판정합니다.

```sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff --enforce block
```

작업 트리를 `HEAD`와 비교해 판정합니다.

```sh
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff
```

추적 중인 보호 파일을 변경하고 스테이징하지 않은 상태에서 측정했을 때 종료 코드 0을 내고 `advised`
행 하나를 기록했습니다. `git diff HEAD`는 추적하지 않는 파일을 나열하지 않으므로 아직 추가하지 않은
새 파일은 이 명령줄의 판정 대상이 아닙니다.

CI에서 또는 풀 리퀘스트 전에 브랜치를 기준 브랜치와 비교해 판정합니다.

```sh
set -o pipefail; git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ main...HEAD | pdks covenant check --diff --enforce block
```

측정에서 브랜치가 보호 경로를 변경했을 때는 종료 코드 2를, 기준 ref가 없을 때는 128을 냈습니다. CI
체크아웃에서 기준 브랜치를 가져오지 않으면 보통 두 번째 경우를 만나므로 이 단계 전에 기준 브랜치를
가져오세요. CI에서는 일반 셸 단계로 실행하며, 종료 코드가 0이 아니면 단계가 실패합니다.

<a id="tools"></a>
## 훅 도구

아래 각 도구 절은 추가할 설정, 해당 도구의 훅을 끄는 방법과 그 패턴을 설명합니다. git 자체 옵션과
패턴을 사용하는 규율은 도구 절 다음에 설명합니다.

<a id="plain-hook"></a>
### 순수 git 훅

**설정하기.** git 2.55.0으로 측정했습니다. 다음 내용을 `.git/hooks/pre-commit`으로 저장합니다.

```sh
#!/bin/sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

그런 다음 `chmod +x .git/hooks/pre-commit`을 실행합니다. 훅 파일이 이미 있으면 파일을 교체하지 말고
명령줄을 추가하고, 그 종료 코드가 훅의 종료 코드가 되게 하세요. 셸 스크립트는 마지막 명령의 코드로
종료합니다. `--enforce block`을 붙인 명령줄 뒤에 다른 명령을 둔 측정에서는 판정이 종료 코드 2를
냈어도 커밋이 만들어졌습니다. 명령줄 끝에 `|| exit $?`를 붙이자 커밋이 멈췄습니다.
`… | pdks covenant check --diff --enforce block || exit $?` 형식입니다. `.git/hooks`는 버전 관리
대상이 아니므로 복제본마다 파일이 필요합니다.

**끄기.** 순수 훅에는 자체 옵션이 없으며, [git 자체 옵션](#judge-the-off-switch)이 적용됩니다.

<a id="lefthook"></a>
### lefthook

**설정하기.** `npm install --save-dev lefthook`으로 설치한 lefthook 2.2.2로 측정했습니다.
`lefthook.yml`에 다음 내용을 추가합니다.

```yaml
pre-commit:
  commands:
    covenant:
      run: git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

그런 다음 `npx lefthook install`을 실행합니다.

**끄기.** 측정한 각 사례에서 커밋은 만들어졌고 행은 기록되지 않았습니다.

- `git commit` 앞에 `LEFTHOOK=0` 또는 `LEFTHOOK=false`를 붙입니다.
- `npx lefthook uninstall`을 실행하면 설치된 훅 파일을 지웁니다.
- [git 자체 옵션](#judge-the-off-switch)도 적용됩니다.

**끄는 명령 판정하기.** [훅을 끄는 명령 판정하기](#judge-the-off-switch)의 규율에 있는 `re`에 이
패턴을 `|`로 이어 붙입니다.

```text
LEFTHOOK=(0|false)\b|lefthook\s+uninstall
```

측정에서 일치한 명령:

- `LEFTHOOK=0 git commit -m "msg"`
- `LEFTHOOK=false git commit -m "msg"`
- `export LEFTHOOK=0`
- `npx lefthook uninstall`

측정에서 일치하지 않은 명령:

- `git commit -m "msg"`
- `npx lefthook install`
- `LEFTHOOK=1 git commit -m "msg"`

<a id="husky"></a>
### husky

**설정하기.** `npm install --save-dev husky`로 설치한 husky 9.1.7로 측정했습니다. 먼저
`npx husky init`을 실행합니다. 이 명령은 `npm test`가 들어 있는 `.husky/pre-commit`을 쓰고,
`core.hooksPath`를 `.husky/_`로 설정하며, `package.json`에 `prepare` 스크립트를 추가합니다. 그런
다음 `.husky/pre-commit`의 내용을 교체합니다.

```sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

**끄기.** 측정한 훅 끄기 방법입니다.

- `git commit` 앞에 `HUSKY=0`을 붙입니다.
- [git 자체 옵션](#judge-the-off-switch)도 적용됩니다.

**끄는 명령 판정하기.** [훅을 끄는 명령 판정하기](#judge-the-off-switch)의 규율에 있는 `re`에 이
패턴을 `|`로 이어 붙입니다.

```text
HUSKY=0\b
```

측정에서 일치한 명령:

- `HUSKY=0 git commit -m "msg"`
- `export HUSKY=0`

측정에서 일치하지 않은 명령:

- `git commit -m "msg"`
- `HUSKY=1 git commit -m "msg"`

<a id="pre-commit"></a>
### pre-commit

**설정하기.** `uv tool install pre-commit`으로 설치한 pre-commit 4.7.0으로 측정했습니다.
`.pre-commit-config.yaml`에 다음 내용을 추가합니다.

```yaml
repos:
  - repo: local
    hooks:
      - id: covenant
        name: pdks covenant check
        entry: sh -c 'git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff'
        language: system
        pass_filenames: false
        always_run: true
```

그런 다음 `pre-commit install`을 실행합니다. pre-commit은 훅이 성공하면 출력을 숨기므로 기본
자세에서는 `advised` 행이 기록되어도 권고 문구가 화면에 나오지 않습니다. 훅에 `verbose: true`를
추가하자 문구가 보였습니다.

**끄기.** 측정한 훅 끄기 방법입니다.

- `git commit` 앞에 `SKIP=covenant`를 붙입니다. 값은 훅의 `id`입니다.
- `pre-commit uninstall`을 실행합니다.
- [git 자체 옵션](#judge-the-off-switch)도 적용됩니다.

**끄는 명령 판정하기.** [훅을 끄는 명령 판정하기](#judge-the-off-switch)의 규율에 있는 `re`에 이
패턴을 `|`로 이어 붙입니다.

```text
\bSKIP=|pre-commit\s+uninstall
```

측정에서 일치한 명령:

- `SKIP=covenant git commit -m "msg"`
- `pre-commit uninstall`

측정에서 일치하지 않은 명령:

- `git commit -m "msg"`
- `pre-commit install`
- `pre-commit run --all-files`

<a id="judge-the-off-switch"></a>
## 훅을 끄는 명령 판정하기

자신의 터미널에서 훅을 끄는 것은 독자의 선택입니다. 에이전트가 같은 명령을 실행할 때는 세션
규율(discipline)로 기록하거나 차단할 수 있습니다.

다음은 git 자체의 옵션이며 이 페이지의 모든 도구에 적용됩니다. 측정한 각 사례에서 커밋은 만들어졌고
행은 기록되지 않았습니다.

- `git commit --no-verify`
- 짧은 형식인 `git commit -n`
- 다른 곳을 가리키는 `core.hooksPath`: `git -c core.hooksPath=<dir> commit` 또는
  `git config core.hooksPath <dir>`

git 자체 옵션에는 다음 패턴을 사용합니다.

```text
git\b.*\bcommit\b.*\s(--no-verify\b|-[a-zA-Z]*n)|core\.hooksPath
```

```yaml
sessionDisciplines:
  - id: "hooks-stay-on"
    why: "a command that turns the commit hook off skips the change-set check."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: 'git\b.*\bcommit\b.*\s(--no-verify\b|-[a-zA-Z]*n)|core\.hooksPath',
            }
      relate:
        - { id: "hook-runs", relation: { op: "empty", of: "hits" }, message: "{value}" }
```

이는 세션 규율이므로 변경 집합 판정이 아니라 에이전트의 셸 명령을 관측하는 곳(Claude Code 또는
Codex)에서 판정합니다. `enforce: block`이 없으면 일치를 `advised`로 기록하고 명령을 계속 실행합니다.
항목 문법은 [설정 참조](../reference/configuration/index.ko.md)를 참고하세요.

측정에서 일치한 명령:

- `git commit --no-verify -m "msg"`
- `git commit -n -m "msg"`
- `git commit -nm "msg"`
- `git commit -anm "msg"`
- `git -c core.hooksPath=/dev/null commit -m "msg"`
- `git config core.hooksPath .nohooks`

측정에서 일치하지 않은 명령:

- `git commit -m "msg"`
- `git commit -am "msg"`
- `git commit --amend --no-edit`
- `git commit --dry-run`
- `git clean -n`

패턴은 명령줄을 텍스트로 읽으므로 커밋 메시지에 이런 표기가 들어 있어도 일치합니다.

도구 자체의 옵션도 판정하려면 위 도구 절의 패턴을 같은 `re`에 `|`로 이어 붙입니다.

<a id="other-tools"></a>
## 다른 도구

여기에 없는 도구도 방법은 같습니다. 그 도구가 커밋 전에 명령을 실행하는 곳에 [계약](#contract)의
명령줄을 넣고, 0이 아닌 종료 코드에서 멈추도록 합니다. 판정기에는 특정 훅 도구에 종속된 부분이
없습니다.

<a id="see-also"></a>
## 같이 보기

- [`pdks covenant check`](../reference/cli/covenant-check.ko.md)
- [설정 참조](../reference/configuration/index.ko.md)
- [표면 연결하기](./connect-surfaces.ko.md)
