# 폴리데우케스 설치하기

[English](./installation.md) · **한국어**

> 알파 단계입니다. 이 가이드는 오늘 출하된 설치 경로만 다루고, 여기 적힌 모든 내용은
> 발행된 패키지의 실측 동작입니다.

devDependency 하나, 표면마다 명령 하나면 됩니다. 설치하는 것은 우산(umbrella) 패키지
`polydeukes` 하나뿐입니다. 코어·판정기·어댑터를 자기 의존성으로 안고 오며, CLI는
`pdks`(`polydeukes`의 별칭)입니다.

**표면 둘이 출하되고, 각각 다른 상황을 위한 것입니다. 프로젝트가 개발되는 방식에 맞는
쪽을 고르세요.** Claude Code에서 AI 파트너와 함께 만드는 프로젝트는 **세션 표면**을
배선합니다. 모든 편집 도구 호출과 셸 명령을 선언되는 순간 판정하는 PreToolUse 훅입니다.
혼자 개발하는 프로젝트는 **커밋 표면**을 배선합니다. staged diff를 판정하는 pre-commit
훅이라, 스스로 선언한 규율(discipline)이 작업이 이력이 되는 순간에 적용됩니다. 두 표면은
같은 설정 어휘를 강제하지만 서로 다른 상황에 답하므로, 한 프로젝트에 둘을 함께 배선할
일반적인 이유는 없습니다.

## 전제 조건

- **Node.js 24 이상** — 발행된 전 패키지의 engines 하한입니다.
- **패키지 관리자** — pnpm과 npm 모두 동작합니다. 아래 예시는 pnpm을 씁니다.
- **Claude Code** — 세션 표면에만 필요합니다. 커밋 표면에는 AI 도구가 전혀 필요 없고,
  git과 pre-commit 훅을 돌릴 수단이면 됩니다.

## 설치

```sh
pnpm add -D polydeukes
```

(`npm install --save-dev polydeukes`도 같습니다.)

일회성 `npx` 실행이 아니라 실제 프로젝트 의존성이어야 합니다. 두 표면 모두 프로젝트에
설치된 패키지에서 판정기를 불러옵니다.

## 세션 표면, AI 파트너와 개발할 때

프로젝트 루트에서 실행합니다.

```sh
pnpm exec pdks init claude-code
```

이 명령은 호출된 디렉터리에 설치하며, **어떤 파일도 쓰기 전에** 그 자리에서
`polydeukes` 패키지가 해소되는지 먼저 증명합니다. 해소되지 않으면(설치 단계를 건너뛴
경우 등) 설치 명령을 출력하고 파일 0개 생성 상태로 exit 2로 끝납니다. 반쯤 배선된
트리는 만들지 않습니다.

생성물은 넷이고, 이미 있는 것은 절대 덮어쓰지 않습니다. 있는 것은 보고하고
지킵니다 — 훅과 설정은 그대로 두고, settings 파일은 병합하며, `.gitignore`에는 덧붙이기만
하므로 재실행은 언제나 안전합니다.

| 생성물 | 무엇인가 |
|---|---|
| `.claude/hooks/covenant-pretooluse.mjs` | 훅입니다. 설치된 패키지에서 판정기를 불러오는 얇은 위임자라, 패키지를 올리면 판정기가 올라가고 이 파일은 바뀌지 않습니다. |
| `.claude/settings.json` | 편집 도구와 셸 호출에 대한 PreToolUse 등록입니다. **교체가 아니라 병합**이라 기존 훅과 권한 설정은 그대로 남습니다. |
| `polydeukes.config.yaml` | 출발 보호 정책입니다. 자리표시자 `languages` 블록, 최소 `protectedPaths` 목록, 증인(witness) 블록이 실려 있고, 항목마다 왜 있는지 파일 안 주석이 설명합니다. |
| `.gitignore` | `.polydeukes/` 무시 규칙을 주석 줄과 함께 덧붙입니다. 텔레메트리는 로컬 관측 데이터라 이력에 들어가지 않습니다. |

## `languages` 첫 편집

설치기는 여러분의 스택을 알 수 없으므로, 생성 설정에는 자리표시자 언어 프로필이
실립니다.

```yaml
languages:
  placeholder:
    productionGlob: 'src/**'
    testCmd: 'echo "set a verification command for {scope}"'
```

키를 실제 언어 이름으로 바꾸고, `productionGlob`을 프로덕션 소스로, `testCmd`를 실제
검증 명령으로 채우세요. (커밋 표면 경로에서는 아래 설정을 직접 쓰면서 이 블록도 함께
씁니다.) 자리표시자는 생성된 그대로 유효하고 아직 어떤 판정 경로도 이 값을 읽지
않으므로, 편집을 기다리는 동안 잘못된 판정을 만들 수는 없습니다. 다만 `languages`는
스키마의 유일한 필수 블록이라, 지우거나 비우면 설정이 무효가 되고 무효 설정은 모든
호출을 차단합니다. 지우지 말고 고치세요.

## 커밋 표면, 혼자 개발할 때

이 경로는 자기 커밋에 자기 규율을 적용하기 위한 것입니다. AI 도구는 관여하지 않습니다.
오늘은 설치기가 없어 배선은 작은 수동 단계 둘입니다.

**먼저 설정입니다.** 프로젝트 루트에 `polydeukes.config.yaml`을 만드세요. 이 경로에는
생성기가 없으므로 첫 줄부터 여러분의 파일입니다.

```yaml
languages:
  typescript:
    productionGlob: 'src/**'
    testCmd: 'pnpm test'

# 커밋 시점에 판정됩니다. 이 경로의 스테이징된 변경은 사람이 직접
# 증인 프롬프트에 답할 때까지 커밋을 멈춥니다.
protectedPaths:
  - 'db/migrations'

witness:
  token: 'pdks witness'
  ttlMinutes: 10
```

`.gitignore`에도 `.polydeukes/`를 추가하세요. 텔레메트리는 로컬 관측 데이터입니다.

**다음은 훅입니다.** 명령 하나가 지금 스테이징된 것을 판정해 약속(covenant)이 깨졌으면
exit 2로 끝납니다.

```sh
pnpm exec pdks covenant check
```

이것을 pre-commit 훅으로 등록하세요. **lefthook**이라면 이렇게 합니다.

```yaml
# lefthook.yml
pre-commit:
  commands:
    covenant:
      priority: 1
      interactive: true   # 증인 프롬프트가 가려지지 않게 합니다. 아래 참조
      run: ./node_modules/.bin/pdks covenant check
```

**husky**라면 이렇게 합니다.

```sh
# .husky/pre-commit
./node_modules/.bin/pdks covenant check
```

맨 **`.git/hooks`**라면 실행 권한을 주고 이렇게 합니다.

```sh
#!/bin/sh
# .git/hooks/pre-commit
./node_modules/.bin/pdks covenant check
```

이 표면에서 알아둘 것이 셋 있습니다.

- **밸브는 TTY 프롬프트입니다.** 기본 수위 `block`에서는 보호 대상 변경을 스테이징한
  커밋이 프롬프트에서 멈추고, 터미널 앞의 사람만 답할 수 있습니다. 훅 러너가 그
  프롬프트를 삼키지 않게 설정하세요(lefthook은 `interactive: true`가 필요합니다).
- **이 표면에서 판정하는 규율 가족은 둘입니다.** staged diff는 파일 변경만 싣고 다른
  것은 싣지 않으므로, 보호 목록과 델타족·경로족(`forbid`·`immutable`)은 온전히
  판정합니다. 명령족(`forbidCommand`) 항목은 staged diff에 읽을 명령줄이 없어 이 표면에
  조립되지 않고, 맥락족(`requirePrecedent`) 항목은 `skipped`로 기록됩니다. 이 둘은 AI
  파트너의 세션이 판정될 수 있는 곳에 선언하세요.
- **커밋 표면은 자기만의 가산 범위를 가집니다.** 자유롭게 편집해도 되지만 이력으로
  승격될 때는 판정된 관문을 지나야 하는 경로는, 공유 목록 위에 얹혀 판정되는 어댑터
  네임스페이스에 둡니다.

  ```yaml
  adapters:
    git:
      protectedPaths:
        - 'src/policy'
  ```

## 증인 밸브

두 표면 모두 같은 밸브를 자기 상황의 철자로 싣습니다. 밸브는 판정 **뒤**에 있어 실제로
차단된 판정만 증언으로 열 수 있고, 모든 허용은 `witnessed`로 기록되며 조용히 지나가는
법이 없습니다.

```yaml
witness:
  token: 'pdks witness'
  ttlMinutes: 10
```

- **세션 표면** — 사람이 토큰을 대화 메시지 첫 줄에 단독으로 입력하면 창이
  `ttlMinutes` 동안 유지되고, 끝나면 차단이 저절로 재개됩니다. 에이전트는 자기 밸브를
  열 수 없습니다. 사람이 쓴 메시지만 인정됩니다.
- **커밋 표면** — 차단된 커밋이 TTY 프롬프트를 띄우고, 거기에 전체 토큰을 입력하면 그
  커밋 하나가 열립니다.

토큰과 창은 원하는 대로 바꾸세요. 토큰은 비밀이 아닙니다. 방어의 근거는 비밀성이 아니라
출처 증명입니다. **블록은 지우지 마세요.** 세션 표면에서는 생성된 보호 목록이
`.claude/hooks`를 덮고 있어서, 밸브가 없으면 첫 차단이 곧 프로젝트 정지가 되고 사람이
자기 터미널에서 설정을 고칠 때까지 풀리지 않습니다.

## 판정이 살아 있는지 확인

배선한 표면에서 한 번 증명하고, 텔레메트리를 읽으세요.

- **세션 표면** — 에이전트에게 보호 경로인 `.claude/hooks/covenant-pretooluse.mjs`에 한
  줄을 덧붙여 보라고 시키세요. 그 호출은 차단으로 돌아와야 합니다.
- **커밋 표면** — 보호 목록의 경로에 편집을 스테이징하고 `git commit`을 실행하세요.
  증인 프롬프트에서 멈춰야 합니다(답하거나 Ctrl-C로 중단하세요).

```sh
cat .polydeukes/roi.log
```

모든 판정이 정확히 한 행을 남깁니다. `passed`·`blocked`·`witnessed`·`advised`·`skipped`
다섯 가지이고, 방금 일으킨 차단이 마지막 행입니다. 한 번 차단하는 것을 지켜본 관문은
배선이 확인된 관문입니다.

다음 갈 곳은 둘입니다. 모든 필드와 규율(discipline) 작성법은
[설정 레퍼런스](./configuration.ko.md)에, 무언가 차단됐는데 이유를 모르겠을 때는
[문제 해결](./troubleshooting.ko.md)에 있습니다.
