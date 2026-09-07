# `pdks covenant check`

[English](./covenant-check.md) · **한국어**

`pdks covenant check`는 설치된 패키지로 커밋 표면의 판정을 실행합니다. 작업 디렉터리에서
설정을 읽고 **stdin**에서 관측 하나를 받아, 세션 훅에서도 사용하는 판정 본체에 전달합니다.
저장소를 열지 않고 `git`을 부르지도 않습니다. 관측은 호출자가 만들고, 이 명령은 그것을
판정해 종료 코드로 답합니다.

<a id="covenant-check-syntax"></a>
## 구문

```sh
pdks covenant check [--diff] [--enforce advise|block]
```

`--diff`가 없으면 stdin은 약속(covenant) 입력 IR입니다. `@polydeukes/core`가 정의하는 JSON
문서(`toolCalls` · `subagentSpawns` · `userMessages`)입니다. `--diff`를 주면 stdin은 unified
diff이고, 명령이 먼저 그것을 IR로 번역합니다. `--enforce`는 이 실행의 관측자 자세이며
기본값은 `advise`입니다. 기본값에서는 모든 위반이 행으로 기록되고 종료 코드 0입니다. `--enforce block`을
주면 보호 경로 위반과 `enforce: block` 항목의 위반이 종료 코드 2가 됩니다. 플래그는 각각 한
번씩, 순서는 무관합니다. 그 밖의 인자는 사용법 오류입니다. stdin은 EOF까지 읽습니다.

<a id="covenant-check-boundaries"></a>
## 관측 경계

이 명령은 stdin이 담은 것만 판정합니다. 어떤 diff를 파이프로 넘기느냐가 관측을 정합니다.

| 파이프 | 관측 집합 |
|---|---|
| `git diff --cached \| pdks covenant check --diff` | 스테이징한 변경. pre-commit 형태 |
| `git diff HEAD \| pdks covenant check --diff` | HEAD 대비 작업 트리 |
| `git diff <base>..<head> \| pdks covenant check --diff` | 두 ref 사이의 변경 집합(`...`는 merge-base 기준) |
| `pdks covenant check < input.json` | 호출자가 만든 IR 그대로 |

diff 형식은 VCS 중립입니다. git · jj · hg · 손으로 쓴 `diff -u`가 모두 같은 형식을 냅니다.

<a id="diff-translation"></a>
## diff가 IR이 되는 방식

파일 블록 하나가 `toolCall` 하나가 되며 입력 순서를 지킵니다. 도구 이름은 생성·수정이
`staged-write`, 삭제가 `staged-delete`입니다. `args.file_path`는 저장소 기준 상대 경로이며
`a/` 또는 `b/` 접두 한 단계를 벗기고 따옴표 경로는 이스케이프를 풉니다.

| diff 블록 | 증거 |
|---|---|
| `--- /dev/null` → `+++ b/P` | `create`, `post` = 모든 `+` 줄 |
| `--- a/P` → `+++ /dev/null` | `delete`, `pre` = 모든 `-` 줄 |
| `--- a/P` → `+++ b/P`, hunk 있음 | `modify`, `pre` = `-` 줄, `post` = `+` 줄 |
| 같은 경로, hunk 없음(모드 변경) | `pre`와 `post`가 빈 `modify` |
| `rename from O` / `rename to N` | `staged-delete` O, 그다음 hunk 줄을 `modify` 증거로 담은 `staged-write` N |
| `Binary files … differ` / `GIT binary patch` | 경로만. 증거가 없으므로 경로 판정만 적용 |

**수정의 `pre`와 `post`는 hunk 줄이지 파일 전체가 아닙니다.** 문맥 줄과
`\ No newline at end of file` 표시는 버립니다. 이 저장소가 배포하는 규율 가운데 `pre`·`post`를
읽는 것은 모두 줄 단위로 키를 뽑아 비교하므로 파일 전체로 판정한 것과 같은 판정이 나옵니다.
파일의 전체 텍스트가 필요한 선언은 그 파일을 `source`로 지정하고, 그것은 아래의 세계 축에서
읽습니다. 생성과 삭제는 전체 텍스트를 담습니다.

**세계 축은 작업 트리입니다.** 선언이 `source`로 지정한 파일은 작업 디렉터리의 디스크에서
읽습니다. index도 ref도 아닙니다. index와 디스크가 다르면(부분 스테이징) 판정되는 텍스트는
디스크의 것입니다. 변경 집합(`world.changes`)은 증거를 지닌 toolCall들의 경로 목록입니다.

**주체는 없습니다.** diff는 작성자를 증명하지 못하므로 번역된 IR에는 `actor` 키가 없습니다.
주체 범위의 규율은 이 표면에서 건너뜁니다.

<a id="covenant-check-results"></a>
## 결과와 종료 코드

| 상황 | 결과 |
|---|---|
| 약속(covenant) 위반 없음 | exit `0`. 어느 등록에도 라우팅되지 않은 toolCall은 `covenant-check` 라벨의 `passed` 행 하나를 남깁니다 |
| 규율 항목 위반(기본 `advise`) | exit `0`, `advised` 행 하나, stderr에 `why`와 권고 요약 한 줄 |
| 보호 경로 위반 또는 `enforce: block` 항목 위반, 기본 자세 | exit `0`, `advised` 행 하나. 이 표면에는 사람이 답할 밸브가 없고, 스테이징된 관문 파일 변경은 이미 세션 표면에서 판정을 받은 것입니다 |
| 같은 위반, `--enforce block` | exit `2`, `blocked` 행 하나 |
| `--diff`에 0바이트 stdin | exit `0`, 행 없음. 스테이징이 없으면 판정할 것도 없습니다 |
| `--diff` 없이 0바이트 stdin | exit `2`. 빈 페이로드는 IR이 아닙니다 |
| JSON 파싱 실패 · 객체가 아님 · `toolCalls` 배열 부재 | exit `2`, `covenant-check`의 `blocked` 행 하나 |
| IR이 자체 `world` 키를 담은 경우 | exit `2`. 세계 축은 이 명령이 채웁니다 |
| 병합 diff(`diff --cc`) · 짝이 맞지 않는 `---`/`+++` · 미지의 hunk 줄 | exit `2`, `covenant-check`의 `blocked` 행 하나 |
| 다른 인자 | exit `2`, stderr에 사용법 줄. stdin은 읽지 않습니다 |
| 설정 부재 · 중복 · 무효 | exit `2` |
| 판정 본체 로드 실패 | exit `2` |

자세는 설정이 아니라 명령줄에 있고, 프롬프트는 없습니다. 이 명령은 성공 또는 실패를 답하고,
커밋을 진행할지는 이 명령을 스폰한 훅이 정합니다. 행은 판정만 기록하고, 커밋이 진행됐는지는
기록하지 않습니다. 배선이 종료 코드를 무시해 커밋이 진행됐더라도 `blocked` 행은 그대로 남습니다.

<a id="covenant-check-examples"></a>
## 예제

```sh
git diff --cached | pdks covenant check --diff                    # pre-commit, 기록만
git diff --cached | pdks covenant check --diff --enforce block    # pre-commit, 위반을 거부
git diff HEAD | pdks covenant check --diff                        # 작업 뒤
git diff main...HEAD | pdks covenant check --diff                 # PR 전
pdks covenant check < input.json                                   # 다른 프로그램이 만든 IR
```

<a id="pin-the-producer"></a>
## 생산자를 고정하기

관측은 이 패키지 밖의 프로세스가 만들고, git 자체의 설정이 그 텍스트를 바꿀 수 있습니다.
판정되는 텍스트가 스테이징한 텍스트이도록 훅에는 다음 플래그를 씁니다.

| 플래그 | 막는 것 |
|---|---|
| `--no-color` | `color.ui=always`는 모든 줄을 이스케이프 코드로 감쌉니다. 번역기가 블록을 인식하지 못해 exit 2로 fail-closed됩니다 |
| `--no-ext-diff` / `--no-textconv` | `diff.external`이나 `.gitattributes`의 textconv 드라이버는 디스크 어디에도 없는 텍스트를 내고, 규율은 그 텍스트를 판정하게 됩니다 |
| `--src-prefix=a/ --dst-prefix=b/` | `diff.mnemonicPrefix`는 `c/`·`i/`·`w/`를 찍습니다. 번역기는 정확히 `a/`와 `b/`만 벗기므로 다른 접두는 판정 경로에 남습니다 |

생산자가 도중에 죽으면 stdin은 0바이트가 되고, 그것은 빈 관측이라 exit 0입니다. 셸이
지원하면 파이프 앞에 `set -o pipefail;`을 두어 git의 실패를 훅의 실패로 만듭니다.

모든 판정을 기록하고 판정 불가일 때만 커밋을 멈추는 lefthook 명령입니다.

```yaml
pre-commit:
  commands:
    covenant:
      run: git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | ./node_modules/.bin/pdks covenant check --diff
```

보호 경로 위반에도 커밋을 멈추려면 그 줄에 `--enforce block`을 덧붙입니다.

```ts
import { runCovenantCheck } from 'polydeukes';

const result = await runCovenantCheck({ repoRoot: process.cwd(), input });
// input은 약속(covenant) 입력 IR, result는 { exitCode: 0 | 2 }
```

<a id="covenant-check-see-also"></a>
## 같이 보기

- [`pdks explain`](./explain.ko.md)
- [`@polydeukes/core`](../packages/core.ko.md)
- [`@polydeukes/covenant`](../packages/covenant.ko.md)
- [설정 레퍼런스](../configuration/index.ko.md)
