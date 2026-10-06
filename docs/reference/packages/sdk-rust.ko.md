# `polydeukes-sdk` (Rust)

[English](sdk-rust.md) · **한국어**

> **Rust에서 판정기를 호출합니다.** 약속(covenant) 입력을 `check_covenant`에, unified diff를
> `check_change_set`에 넘기면 `pdks covenant check`의 판정 결과를 값으로 받습니다.
>
> 베타입니다. crates.io에 `polydeukes-sdk`로 출판되어 있습니다. 판정받는 프로젝트는 npm에서
> `polydeukes`를 설치해야 하고, `PATH`에 `node`가 있어야 합니다.

<a id="ownership"></a>
## 이 crate가 맡는 일

이 crate는 판정받는 프로젝트에서 `polydeukes`를 찾고, 그 bin을 `node`로 실행하면서 입력을
stdin에 넣고, 자식 프로세스의 exit status를 판정 결과로 바꿉니다. 판정은 자식 프로세스가
합니다. 그래서 같은 규율(discipline)을 Rust에서 판정하든 Node에서 판정하든 판정 결과가 같습니다.

| 단위 | 하는 일 |
|---|---|
| `check_covenant` | 판정받는 프로젝트에서 `pdks covenant check`를 실행하고 판정 결과를 돌려줍니다 |
| `check_change_set` | 끝난 변경 집합에 대해 같은 일을 합니다. diff를 stdin에 넣고 `pdks covenant check --diff`를 실행합니다 |
| `CovenantInput`과 그 구성 타입 | `@polydeukes/core/covenant-input.schema.json`에서 생성한 입력 타입입니다 |
| 우산 탐색 | Node와 같이 `repo_root`에서 위로 올라가며 가장 가까운 `node_modules/polydeukes` 디렉터리를 찾고, 그 매니페스트의 `bin.pdks`를 읽습니다 |
| 판정 결과 변환 | exit `0`은 `Upheld`, exit `2`는 `Blocked`, 나머지는 모두 `Unjudged`입니다 |

텔레메트리 행은 판정하는 자식 프로세스가 씁니다. 이 crate는 행을 따로 쓰지 않습니다.

<a id="install"></a>
## 설치

```sh
cargo add polydeukes-sdk
```

판정받는 프로젝트에서는 다음을 실행합니다.

```sh
pnpm add -D polydeukes
pnpm exec pdks init
```

<a id="verb"></a>
## `check_covenant`

```rust
use polydeukes_sdk::{
    check_covenant, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, FileChange, ToolCall,
    Tools,
};
use std::path::Path;

let mut args = serde_json::Map::new();
args.insert("path".into(), "src/index.ts".into());

let input = CovenantInput {
    tool_calls: vec![ToolCall {
        name: "writeFile".into(),
        args,
        file_change: Some(FileChange::Create {
            path: "src/index.ts".into(),
            post: "export const answer = 42;\n".into(),
        }),
    }],
    subagent_spawns: vec![],
    user_messages: vec![],
    tools: Some(Tools {
        mutating: vec!["writeFile".into(), "rm".into()],
        shell: vec!["exec".into()],
        command_args: vec!["command".into()],
    }),
    actor: None,
    session: None,
};

let verdict = check_covenant(CheckCovenantSpec {
    repo_root: Path::new("/path/to/the/project"),
    input: &input,
    enforce: None,
    config_layer: None,
    telemetry_path: None,
    spawn: None,
});

match verdict {
    CheckCovenantVerdict::Upheld { advisories } => { /* 진행 */ }
    CheckCovenantVerdict::Blocked { reason } => { /* 진행하지 않음 */ }
    CheckCovenantVerdict::Unjudged { reason } => { /* 판정이 일어나지 않음 */ }
}
```

이 호출은 자식 프로세스가 끝날 때까지 블로킹합니다. 비동기 호스트는 이 호출을
`tokio::task::spawn_blocking` 같은 블로킹 스레드에서 실행합니다.

입력은 호출자가 만듭니다. 이 crate는 입력을 직렬화해 그대로 보내고, `session`이나 `actor`,
자기 도구 목록을 덧붙이지 않습니다. `CovenantInput`에는 `world` 필드가 없습니다. 실행기가
디스크의 프로젝트에서 world를 읽고, `world`를 실은 입력은 거부하기 때문입니다.

<a id="spec"></a>
## spec

```rust
pub struct CheckCovenantSpec<'a> {
    pub repo_root: &'a Path,
    pub input: &'a CovenantInput,
    pub enforce: Option<Enforce>,
    pub config_layer: Option<&'a Path>,
    pub telemetry_path: Option<&'a Path>,
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> std::io::Result<SpawnOutcome>>,
}

pub enum Enforce { Advise, Block }
pub struct SpawnSpec { pub command: String, pub args: Vec<String>, pub cwd: PathBuf, pub stdin: String }
pub struct SpawnOutcome { pub status: Option<i32>, pub stderr: String }
```

| 필드 | 의미 |
|---|---|
| `repo_root` | 판정받는 프로젝트입니다. 설정을 찾는 곳, world 축, 자식의 cwd, 우산 탐색을 시작하는 디렉터리입니다. 상대 경로는 현재 디렉터리 기준입니다 |
| `input` | 호출자의 입력이고, 직렬화되어 자식의 stdin으로 갑니다 |
| `enforce` | 실행 전체에 적용되는 관측자의 기본 자세입니다. **`None`은 `Block`입니다** |
| `config_layer` | 프로젝트 설정과 함께 판정되는 [설정 층](../configuration/index.ko.md#config-layer)이고, `--config-layer`로 전달됩니다. 상대 경로는 `repo_root` 기준입니다 |
| `telemetry_path` | 이번 실행의 행을 덧붙일 파일이고, `--telemetry-path`로 전달됩니다. 상대 경로는 자식의 cwd인 `repo_root` 기준입니다 |
| `spawn` | 주입하는 스폰 이음매입니다. `None`이면 `PATH`의 `node`를 실행합니다. 시그널로 끝난 자식의 `SpawnOutcome::status`는 `None`입니다 |

**`enforce`의 기본값은 `Block`입니다.** `@polydeukes/sdk-ts`와 같습니다. 보호 경로와
`enforce: block`을 단 항목이 호출을 막고, 그 밖의 위반은 exit 0의 `advised`로 기록됩니다.

기본 스폰은 표준 스트림 셋을 모두 파이프로 연결하고 아무것도 물려주지 않습니다. stderr는 모아서
돌려주고, stdout은 읽어서 버립니다. 판정기는 stdout에 판정 결과를 쓰지 않습니다.

<a id="change-set"></a>
## `check_change_set`

`check_change_set`은 호출 하나가 아니라 끝난 변경 집합을 판정합니다. `repo_root`에서
`pdks covenant check --diff --enforce <level>`을 실행하면서 unified diff를 stdin에 넣고,
`check_covenant`와 같은 우산 탐색 · 스폰 · status 매핑을 거쳐 같은 세 가지 판정 결과를 돌려줍니다.

```rust
use polydeukes_sdk::{check_change_set, CheckChangeSetSpec};

let verdict = check_change_set(CheckChangeSetSpec {
    repo_root: Path::new("/path/to/the/project"),
    diff: &git_diff_output, // a/ b/ 형식을 지키는 `git diff`는 아래 참고
    enforce: None,
    config_layer: None,
    telemetry_path: None,
    spawn: None,
});
```

```rust
pub struct CheckChangeSetSpec<'a> {
    pub repo_root: &'a Path,
    pub diff: &'a str,
    pub enforce: Option<Enforce>,
    pub config_layer: Option<&'a Path>,
    pub telemetry_path: Option<&'a Path>,
    pub spawn: Option<&'a dyn Fn(SpawnSpec) -> std::io::Result<SpawnOutcome>>,
}
```

`diff`는 그대로 자식의 stdin으로 갑니다. 경로는 `repo_root`가 최상위인 저장소에서 `git diff`가
출력하는 것처럼 `a/`·`b/` 뒤에 `repo_root` 기준으로 적힙니다. 이 crate는 `git`을 실행하지 않고 텍스트도
검사하지 않습니다. 사용자의 git 설정은 이 형식을 바꿀 수 있습니다. `diff.mnemonicPrefix`는 `c/`와
`w/`를 쓰고, `color.diff = always`는 이스케이프 코드를 더하고, `diff.external`은 출력을 통째로
바꿉니다. 변환이 접두를 벗기지 못한 경로는 어느 보호 항목에도 라우팅되지 않습니다. 명령줄에서 형식을
고정하세요.

```sh
git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ HEAD
```

`git diff`는 `git add -N`으로 표시하기 전까지 추적되지 않은 파일을 빠뜨립니다.

나머지 필드의 의미는 `check_covenant`와 같고, `enforce`의 기본값도 `Block`입니다.
`--diff`의 기본값이 `advise`인 CLI와는 다릅니다.

<a id="verdicts"></a>
## 세 가지 판정 결과

```rust
pub enum CheckCovenantVerdict {
    Upheld { advisories: String },
    Blocked { reason: String },
    Unjudged { reason: String },
}
```

| 판정 결과 | 자식 status | 호출자에게 주는 의미 |
|---|---|---|
| `Upheld` | `0` | 판정을 받았고 막은 것이 없습니다. `advisories`는 자식의 stderr 원문입니다 |
| `Blocked` | `2` | 판정을 받았고 무언가가 막았습니다. `reason`은 자식의 stderr 원문입니다 |
| `Unjudged` | 그 밖의 값, 시그널, 스폰 실패, 우산 없음 | 판정이 일어나지 않았습니다. `reason`이 그 이유를 말합니다. 이것을 통과로 읽으면 설치되지 않은 판정기가 모든 호출을 통과시키게 됩니다 |

두 동사 모두 `Result`가 아니라 판정 결과를 돌려줍니다. 모든 실패는 `Unjudged`로 돌아옵니다.

`reason`과 `advisories`는 사람이 읽는 텍스트입니다. 한 실행이 판정한 경로와 규율을 값으로 읽으려면
`telemetry_path`를 주고, 그 행을 [`pdks covenant check`](../cli/covenant-check.ko.md#reading-rows)의
설명대로 읽습니다. 변경 집합은 실행마다 새 파일을, 세션 입력은 세션 전체에 파일 하나를 씁니다. 판정
결과는 여전히 exit status가 정합니다.

<a id="limits"></a>
## 선언된 한계

- **API는 블로킹입니다.** 비동기 호스트는 이 호출을 블로킹 작업으로 감쌉니다.
- **`node`는 `PATH`에서 찾습니다.** `node`가 없는 호스트는 스폰 오류를 담은 `Unjudged`를 받습니다.
- **이 crate는 우산의 버전을 확인하지 않습니다.** 설치된 우산이 파싱하지 못하는 입력은
  `Unjudged`가 아니라 `Blocked`(exit 2, 실패 시 차단)로 돌아옵니다. crate의 버전과 프로젝트의
  `polydeukes` 버전을 같은 minor 릴리스로 맞춰 두세요.
- **`shell`이 비어 있지 않은데 `command_args`가 빈 도구 목록은 실행기가 거부합니다**(`Blocked`).
  스키마는 이 조합을 금지하지만, 생성된 `Tools` 타입은 그 제약을 표현하지 못합니다.
- **`Unjudged`는 통과가 아닙니다.** 판정기가 없는 프로젝트에 무엇을 허용할지는 소비자가 정합니다.

<a id="see-also"></a>
## 함께 보기

- [`@polydeukes/sdk-ts`](sdk-ts.ko.md)
- [`pdks covenant check`](../cli/covenant-check.ko.md)
- [`@polydeukes/core`](core.ko.md#consumer-contract)
