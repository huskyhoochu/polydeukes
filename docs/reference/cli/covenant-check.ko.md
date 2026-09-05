# `pdks covenant check`

[English](./covenant-check.md) · **한국어**

`pdks covenant check`는 설치된 패키지로 커밋 표면의 판정을 실행합니다. 작업 디렉터리에서
설정을 읽고 저장소의 변경을 관측해 약속(covenant) 입력 IR로 변환합니다.
이 입력을 세션 훅에서도 사용하는 판정 본체에 전달합니다.

<a id="covenant-check-syntax"></a>
## 구문

```sh
pdks covenant check
pdks covenant check --worktree
pdks covenant check --range <base>..<head>
pdks covenant check --range <base>...<head>
```

기본 형식은 스테이징한 변경을, `--worktree`는 작업 트리의 변경을 판정합니다.
`--range`는 두 참조 사이의 변경을 비교하며, `...` 형식은 두 참조의 공통 조상인
병합 기준점(merge-base)부터 비교합니다.

<a id="covenant-check-boundaries"></a>
## 관측 경계

이 명령은 무엇을 관측하는지 분명히 나눕니다.

| 형식 | 관측 집합 | `pre` → `post` | 메모 |
|---|---|---|---|
| `pdks covenant check` | staged 변경만 | HEAD blob → staged blob | pre-commit 관문입니다. |
| `pdks covenant check --worktree` | 작업 트리 변경 | HEAD blob → 디스크의 바이트 | 무시되지 않은 미추적 파일을 포함합니다. |
| `pdks covenant check --range <base>..<head>` | 두 ref 사이의 변경 집합 | base blob → head blob | ref를 해소할 수 없으면 실패합니다. |
| `pdks covenant check --range <base>...<head>` | 두 ref의 merge-base 읽기 | merge-base blob → head blob | ref의 공통 조상을 씁니다. |

`--worktree`에는 무시 대상이 아닌 미추적 파일도 포함됩니다. 추적하지 않는 파일이
무시 대상이면 관측하지 않습니다. 이미 추적 중인 파일은 나중에 `.gitignore` 패턴에
해당하더라도 계속 관측합니다.
`--worktree`와 `--range`는 진단용이므로 증인 토큰을
묻지 않습니다.

<a id="worktree"></a>
## `--worktree`로 작업 트리 검사

유효한 Polydeukes 설정이 있는 git 저장소에서 `pdks covenant check --worktree`를 실행합니다.
HEAD와 현재 디스크의 바이트를 비교하며 스테이징한 내용과 비교하지 않습니다. 추적하지
않더라도 무시 대상이 아닌 파일은 추가로 포함하고, 디스크에서 사라진 추적 파일은 삭제로
포함합니다. 첫 커밋 전에는 존재하는 추적 파일과 무시 대상이 아닌 미추적 파일에 `pre` 값이
없습니다.

커밋을 만들거나 증인 토큰을 묻지는 않습니다. 설정된 강제 수준은 그대로 적용하므로
exit 0에 권고나 미판정이 포함될 수 있고, 증언되지 않은 차단이나 조립 실패는 exit 2입니다.
관측한 변경이 없다는 결과는 다른 파일이나 세션의 대화 기록까지 판정했다는 증거가 아닙니다.
판정의 텔레메트리를 기록하므로 `pdks docs`처럼 읽기만 하는 조회 명령은 아닙니다.

<a id="covenant-check-results"></a>
## 결과와 종료 코드

| 상황 | 결과 |
|---|---|
| covenant를 깨지 않음 | 종료 `0` |
| `enforce: advise` 아래의 위반 | 종료 `0`, stderr와 텔레메트리에 `advised` 한 줄 |
| 증인 블록이 설정된 상태에서 `enforce: block`인 staged 위반 | `/dev/tty`로 한 번 묻습니다. 토큰이 맞으면 차단을 열고, 답이 없거나 틀리면 종료 `2` |
| 증인 블록이 없는 상태에서 `enforce: block`인 staged 위반 | 묻지 않고 종료 `2` |
| `enforce: block`인 위반이 `--worktree`나 `--range`에서 발생 | 묻지 않고 종료 `2` |
| 관측 집합이 비어 있음 | 종료 `0` |
| 플래그 구문이 잘못됨 | stderr에 usage 줄, 종료 `2` |
| 설정이 없거나 둘 이상이거나 무효 | 종료 `2` |
| range를 해소할 수 없거나 merge-base가 없음 | 종료 `2` |
| 판정 본체를 적재할 수 없음 | 종료 `2` |

항목의 기본값은 `advise`이며 `adapters.git.enforce: block`만으로 승격되지는 않습니다.
표면이 `block`일 때 보호 경로 위반과 명시적으로 `enforce: block`인 항목이 차단될 수
있습니다. 증인 프롬프트에는 토큰 설정과 접근 가능한 터미널도 필요합니다.

`exit 0`은 정상 판정, 권고, 미판정 또는 관측한 변경이 없는 경우일 수 있습니다.
`exit 2`는 판정 불가로 작업을 차단했거나, 위반에 따른 차단이 증언으로 허용되지 않았다는 뜻입니다.

<a id="covenant-check-examples"></a>
## 예제

```sh
pdks covenant check
pdks covenant check --worktree
pdks covenant check --range main..HEAD
pdks covenant check --range main...feature
```

```ts
import { runCovenantCheck } from 'polydeukes';

const result = await runCovenantCheck({ repoRoot: process.cwd() });
// result는 { exitCode: 0 | 2 }
```

<a id="covenant-check-see-also"></a>
## 같이 보기

- [`pdks explain`](./explain.ko.md)
- [`@polydeukes/adapter-git`](../packages/adapter-git.ko.md)
- [`@polydeukes/covenant`](../packages/covenant.ko.md)
- [`설정 레퍼런스`](../configuration/index.ko.md#adapters-git)
