# 표면 연결하기

[English](../how-to/connect-surfaces.md) · **한국어**

> 작업에 맞는 표면을 고릅니다. Claude Code와 Grok, Codex는 세션 표면을 배선하고, git은 변경 집합
> 표면을 배선합니다.

두 표면은 같은 설정 어휘를 쓰지만 판정 시점이 다릅니다. AI 파트너가 편집할 때는 세션 표면을, 변경을
이력으로 기록하기 전에는 변경 집합 표면을 사용합니다.

등록한 프로젝트의 git worktree 안에서 일어나는 쓰기는 파일의 절대 경로로, 등록한 프로젝트의 설정에
따라 판정합니다. 보호 항목은 그대로 일치하지만, 프로젝트 기준 `target.path` 정규식으로 범위를 정한
규율은 적용되지 않습니다. 판정 행은 등록한 프로젝트의 telemetry에 남습니다.

<a id="claude-code"></a>
## Claude Code 세션 표면

```sh
pdks adapter claude-code init
```

설치한 단일 실행 파일을 프로젝트 루트에서 실행합니다. 별도 Node·npm·어댑터 설치가 필요하지 않습니다.
현재 실행 파일과 프로젝트 루트의 절대 경로를 등록하며 다른 handler와 설정을 보존합니다. 위치가
바뀌면 다시 실행하세요.

프로젝트를 다시 열고 실제 호출의 telemetry를 확인하세요. `origin.kind: human`으로 확인한 사람
메시지만 증인(witness) 밸브에 쓰입니다.

[등록 상세](../reference/cli/init.ko.md#init-claude-code)

<a id="grok"></a>
## Grok 세션 표면

```sh
pdks adapter grok init
```

설치한 단일 실행 파일을 프로젝트 루트에서 실행합니다. 별도 Node·npm·어댑터 설치가 필요하지 않습니다.
현재 실행 파일과 프로젝트 루트의 절대 경로를 등록하며 다른 handler와 설정을 보존합니다. 위치가
바뀌면 다시 실행하세요.

프로젝트 신뢰를 승인하고 Hooks 탭을 다시 불러오세요. Grok 자체 등록이 필요합니다.
`GROK_WORKSPACE_ROOT`가 있는 Grok 실행에서는 Claude 호환 callback을 건너뛰어 중복 판정을 피합니다.
현재 세션 기록·사람 출처가 없어 증인 밸브를 열 수 없으므로 보호 변경은 사용자 터미널에서 수행하세요.

[등록 상세](../reference/cli/init.ko.md#init-grok)

<a id="codex"></a>
## Codex 세션 표면

```sh
pdks adapter codex init
```

설치한 단일 실행 파일을 프로젝트 루트에서 실행합니다. 별도 Node·npm·어댑터 설치가 필요하지 않습니다.
현재 실행 파일과 프로젝트 루트의 절대 경로를 등록하며 다른 handler와 설정을 보존합니다. 위치가
바뀌면 다시 실행하세요.

`/hooks`에서 정의를 승인하세요. Code Mode 관측은 버전에 따라 달라지므로 실제 중첩 호출로 확인합니다.
대화 기록 파일은 읽지 않으며 현재 prompt는 사람 출처를 증명하지 않습니다. 보호 변경은 사용자
터미널에서 수행하세요.

[등록 상세](../reference/cli/init.ko.md#init-codex)

<a id="change-set-surface"></a>
## 변경 집합 표면

스테이징한 변경을 이력으로 기록하기 전에 Git에서 판정하려면 이 표면을 사용합니다.

1. 프로젝트 루트에 `polydeukes.config.yaml`을 만듭니다.
2. pre-commit 훅을 추가합니다.
3. 필요할 때는 `git diff HEAD | pdks covenant check --diff`를 직접 돌려 같은 판정을 봅니다.

lefthook 예시는 다음과 같습니다. `git diff`의 플래그는 판정기가 받는 것을 고정합니다. 색 코드 없음,
외부 diff 드라이버 없음, textconv 변환 없음, 번역기가 벗기는 `a/`·`b/` 접두입니다. 사용자의 git
설정이 관측을 바꾸지 못합니다(CLI 레퍼런스 참고).

```yaml
pre-commit:
  commands:
    covenant:
      priority: 1
      run: git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

husky 예시는 다음과 같습니다.

```sh
# .husky/pre-commit
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

일반 git 훅으로 연결해도 됩니다.

```sh
#!/bin/sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

일반 훅은 `.git/hooks/pre-commit`으로 저장한 뒤 `chmod +x .git/hooks/pre-commit`으로 실행 권한을
줍니다. 기존 훅이 있다면 덮어쓰지 말고 호출을 추가하세요. lefthook은 패키지 관리자로 설치하고 YAML을
저장한 뒤 훅 설치 명령을 실행합니다. husky는 git이 찾을 수 있도록 husky 설치기로
`.husky/pre-commit`을 저장하세요.

판정기는 종료 코드 0, 2, 3(입력을 읽지 못함) 중 하나만 내고 사람에게 묻지 않습니다. 기본값에서는
`protectedPaths` 위반을 포함한 이 표면의 모든 위반이 stderr에 진단 한 줄을 남기고 행으로 기록되며
종료 코드 0입니다. 스테이징된 관문 파일 변경은 이미 세션 표면에서 판정을 받았거나 사람이 직접 한
것이고, 이 표면에는 사람이 답할 밸브가 없기 때문입니다. `protectedPaths` 위반이나 `enforce: block`
항목의 위반을 종료 코드 2로 받으려면 명령에 `--enforce block`을 붙입니다. 커밋을 멈출지는 훅 배선이
정합니다. 위 예시는 종료 코드를 그대로 따릅니다. 조립 실패는 언제나 종료 코드 2입니다.

<a id="witness-and-recovery"></a>
## 증인과 복구

사람 출처를 증명하는 Claude 세션에서는 설정된 토큰을 메시지 첫 줄에 단독으로 보낸 뒤 의도한 변경을
재시도할 수 있습니다. 증인 밸브는 차단 결과 뒤에 확인하며 TTL 안에서만 적용됩니다. 현재 Codex·Grok
prompt는 이 출처를 증명하지 못하므로 사용자 터미널에서 보호 변경을 수행하세요. 변경 집합 표면에는
증인 프롬프트가 없으며 훅이 exit code에 따라 커밋을 처리합니다.

실행 파일 부재·신뢰 미승인·비활성 훅은 증인으로 복구하지 못합니다. 경로와 호스트 승인을 고친 뒤 실제
호출·telemetry를 다시 확인하세요.

<a id="what-to-check"></a>
## 배선한 뒤 확인할 것

- `pdks explain`은 각 표면이 어떤 등록을 조립했는지 보여 줍니다.
- `.polydeukes/roi.log`는 표면이 남긴 행을 기록합니다.
- `git diff HEAD | pdks covenant check --diff`는 작업 뒤에 쓰기 좋은 즉시 확인 명령입니다.
- `git diff <base>..<head> | pdks covenant check --diff`는 PR 전에 쓰기 좋은 형태입니다.
