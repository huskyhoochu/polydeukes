# 표면 연결하기

[English](../how-to/connect-surfaces.md) · **한국어**

> 작업에 맞는 표면을 고릅니다. Claude Code와 Grok는 세션 표면을 배선하고, git은 커밋 표면을 배선합니다.

두 표면은 같은 설정 어휘를 쓰지만 판정 시점이 다릅니다. AI 파트너가 편집할 때는 세션 표면을,
변경을 이력으로 기록하기 전에는 커밋 표면을 사용합니다.

<a id="claude-code"></a>
## Claude Code 세션 표면

Claude Code에서 AI 파트너와 함께 개발할 때 씁니다.

1. 패키지를 프로젝트 의존성으로 설치합니다. `pnpm add -D polydeukes`. 일회성 `npx` 실행만으로는
   부족합니다. 두 표면 모두 프로젝트에 설치된 패키지에서 판정기를 불러옵니다.
2. 프로젝트를 배선합니다. `pnpm exec pdks init claude-code`.
3. 생성된 훅, 병합된 설정, 초기 설정 파일, 문서 안내와 `discipline-draft` 스킬을 확인합니다.
4. 훅이 바뀌면 프로젝트를 다시 엽니다. 생성된 훅은 패키지에 판정을 위임하므로 패키지를
   갱신할 때 훅 파일까지 다시 쓸 필요는 없습니다.

설치기는 `.claude/settings.json`을 덮어쓰지 않고 병합합니다. 기존 훅과 권한은 보존합니다.
`.claude/rules/polydeukes.md`에는 웹 검색 대신 설치된 `pdks docs`를 조회하도록 안내하고,
`.claude/skills/discipline-draft/SKILL.md`에는 문제를 선언이나 초안으로 등록하는 절차를
제공합니다.

<a id="grok"></a>
## Grok 세션 표면

Grok에서 개발할 때 씁니다.

1. 패키지를 프로젝트 의존성으로 설치합니다. `pnpm add -D polydeukes`.
2. 프로젝트를 배선합니다. `pnpm exec pdks init grok`.
3. 설치가 끝나면 Hooks 탭을 다시 불러오거나 새 세션을 엽니다.

Grok 프로젝트에는 `.grok/hooks/` 아래에 훅 JSON 파일이 생깁니다. Claude 훅이 이미 있으면
Grok의 `command`도 그 파일을 가리킵니다. `.claude/settings.json`도 있다면 같은 `command`를
등록한 Claude 항목에 맞춰 Grok의 `matcher`를 설정합니다. 두 값이 모두 같아야 Grok가 중복 등록을
하나로 처리해 판정기를 두 번 실행하지 않기 때문입니다.
새 등록의 제한 시간은 60초입니다. Grok 호스트의 기본값은 5초이며, 훅 실행이 시간 초과로
끝나면 해당 호출을 차단하지 않습니다(fail-open).

Grok는 세션 증인 밸브에 필요한 Claude 형식의 인간 메시지를 공급하지 않습니다. 대화 기록은
Claude JSONL이 아니라 ACP `updates.jsonl`입니다.
의도한 편집이 차단되면 자신의 터미널에서 수행하세요. 커밋 표면의 증인 프롬프트는 해당
커밋에만 적용되며, 차단된 Grok 도구 호출을 허용하지는 않습니다.

<a id="commit-surface"></a>
## 커밋 표면

스테이징한 변경을 이력으로 기록하기 전에 Git에서 판정하려면 이 표면을 사용합니다.

1. 프로젝트 루트에 `polydeukes.config.yaml`을 만듭니다.
2. pre-commit 훅을 추가합니다.
3. 필요할 때는 `pnpm exec pdks covenant check`를 직접 돌려 같은 판정을 봅니다.

lefthook 예시는 다음과 같습니다.

```yaml
pre-commit:
  commands:
    covenant:
      priority: 1
      interactive: true
      run: ./node_modules/.bin/pdks covenant check
```

husky 예시는 다음과 같습니다.

```sh
# .husky/pre-commit
./node_modules/.bin/pdks covenant check
```

일반 git 훅으로 연결해도 됩니다.

```sh
#!/bin/sh
./node_modules/.bin/pdks covenant check
```

일반 훅은 `.git/hooks/pre-commit`으로 저장한 뒤 `chmod +x .git/hooks/pre-commit`으로
실행 권한을 줍니다. 기존 훅이 있다면 덮어쓰지 말고 호출을 추가하세요. lefthook은 패키지
관리자로 설치하고 YAML을 저장한 뒤 훅 설치 명령을 실행합니다. husky는 git이 찾을 수 있도록
husky 설치기로 `.husky/pre-commit`을 저장하세요.

`adapters.git.enforce: advise`이면 위반을 `advised`로 기록하고 stderr에 알린 뒤 커밋을
허용합니다. `block`이면 보호 경로 위반과 `enforce: block`으로 지정한 항목의 위반을
차단할 수 있습니다. 일반 항목의 기본값은 여전히 `advise`이며 표면 설정이 이를 승격하지
않습니다. 증인이 설정돼 있고 터미널에 연결된 경우, 스테이징 검사에서 `/dev/tty` 프롬프트를
제공합니다. `--worktree`와 `--range`는 프롬프트 없이 보고합니다. 조립 실패는 어느 강제
수준에서도 종료 코드 2를 반환합니다.

<a id="witness-and-recovery"></a>
## 증인과 회복

증인 토큰은 두 표면에서 같은 뜻이지만 전달 방식은 다릅니다.

- 세션 표면에서는 대화 메시지 첫 줄에 토큰만 단독으로 넣습니다.
- 커밋 표면에서는 TTY 프롬프트에 전체 토큰을 입력합니다.

밸브는 판정 결과가 차단일 때 확인합니다. 의도한 편집 전에 토큰을 입력해도 되며, 먼저
실패하는 요청을 보낼 필요는 없습니다. 정상 판정은 바꾸지 않고, 현재 Grok 대화 기록
형식에서는 세션 밸브를 사용할 수 없습니다.

Grok가 훅을 아직 읽지 못했다면 Hooks 탭을 다시 불러오거나 새 세션을 여세요. 판정기를 적재할 수 없다면 패키지를 다시 설치하거나 워크스페이스를 다시 빌드한 뒤
시도하세요.

<a id="what-to-check"></a>
## 배선한 뒤 확인할 것

- `pdks explain`은 각 표면이 어떤 등록을 조립했는지 보여 줍니다.
- `.polydeukes/roi.log`는 표면이 남긴 행을 기록합니다.
- `pdks covenant check --worktree`는 작업 뒤에 쓰기 좋은 즉시 확인 명령입니다.
- `pdks covenant check --range <base>..<head>`는 PR 전에 쓰기 좋은 형태입니다.
