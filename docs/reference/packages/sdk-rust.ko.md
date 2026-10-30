# `polydeukes-sdk` (Rust)

[English](sdk-rust.md) · **한국어**

<a id="ownership"></a>
## 이 crate가 맡는 일

네 블로킹 동사 `check_covenant`, `check_change_set`, `memory_ingest`, `memory_search`가 별도로
설치한 `pdks`를 실행합니다. 약속(covenant) 판정, 설정, 텔레메트리, 기억(memory) 색인은 CLI가
맡습니다. crate는 호출자가 만든 입력을 보내고 결과를 값으로 돌려줍니다.

모든 동사는 실행 파일 선택기와 프로세스 실행기를 공유합니다. 루트는 호출자의 cwd 기준으로 절대화되어
자식의 cwd가 됩니다. 명시한 `executable`은 이름만 적었더라도 호출자의 cwd 기준 파일 경로이며 symlink
경로 표기를 보존합니다. 미지정이면 `PATH`의 절대 디렉터리에서 실행할 수 있는 일반 파일 `pdks`를 처음
선택합니다. 빈 항목과 상대 항목은 건너뛰며, 선택한 파일이 실패해도 다른 후보를 실행하지 않습니다.

<a id="install"></a>
## 설치

```sh
cargo add polydeukes-sdk
```

[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases)에서 Linux x64 또는 macOS
arm64용 단일 실행 파일 `pdks`를 설치하고 실행 권한을 줍니다. `executable`에 경로를 적거나 `PATH`에
`pdks`라는 이름으로 둡니다. crate는 그 파일을 직접 실행하므로 Node나 npm 설치가 필요하지 않습니다.
기억 동사에는 기억 기능을 제공하는 CLI가 필요하며 의존성, 설정, 색인이 없으면 `Unavailable`이
됩니다.

<a id="verb"></a>
## `check_covenant`

```rust
use polydeukes_sdk::{
    check_covenant, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, FileChange, ToolCall, Tools,
};
use std::{path::Path, time::Duration};

let input = CovenantInput {
    tool_calls: vec![ToolCall {
        name: "writeFile".into(),
        args: Default::default(),
        file_change: Some(FileChange::Create {
            path: "src/index.ts".into(),
            post: "export const answer = 42;\n".into(),
        }),
    }],
    subagent_spawns: vec![],
    user_messages: vec![],
    tools: Some(Tools {
        mutating: vec!["writeFile".into()],
        shell: vec!["exec".into()],
        command_args: vec!["command".into()],
    }),
    actor: None,
    session: None,
};
let verdict = check_covenant(CheckCovenantSpec {
    repo_root: Path::new("/path/to/project"),
    input: &input,
    enforce: None,
    config_layer: None,
    telemetry_path: None,
    executable: Some(Path::new("/opt/tools/pdks")),
    timeout: Some(Duration::from_secs(2)),
    spawn: None,
});
match verdict {
    CheckCovenantVerdict::Upheld { .. } => { /* 이곳에서 제안한 작업을 실행합니다. */ }
    CheckCovenantVerdict::Blocked { reason } | CheckCovenantVerdict::Unjudged { reason } => {
        eprintln!("{reason}");
    }
}
```

호스트가 호출마다 증거를 제공합니다. `FileChange::Create`에는 `path`, `post`, `Modify`에는 `path`,
`pre`, `post`, `Delete`에는 `path`와 선택 `pre`가 있습니다. 없는 증거는 없는 채로 보내며 SDK는
actor, session, 도구 목록을 더하지 않습니다. `CovenantInput`과 구성 타입은 core의 입력 스키마에서
생성합니다. 입력에 없는 `world`는 CLI가 공급합니다.

<a id="spec"></a>
## spec

| 필드                            | `CheckCovenantSpec`                                   | `CheckChangeSetSpec`  |
| ------------------------------- | ----------------------------------------------------- | --------------------- |
| `repo_root: &Path`              | 프로젝트 루트와 자식 cwd                              | 같음                  |
| `input: &CovenantInput`         | 호출자가 만든 IR                                      | `diff: &str`으로 대체 |
| `enforce: Option<Enforce>`      | `None`은 `Enforce::Block`                             | 같음                  |
| `config_layer: Option<&Path>`   | `--config-layer`, 상대 경로는 자식 cwd 기준           | 같음                  |
| `telemetry_path: Option<&Path>` | `--telemetry-path`, 상대 경로는 자식 cwd 기준         | 같음                  |
| `executable: Option<&Path>`     | `PATH`보다 먼저 선택할 실행 파일                      | 같음                  |
| `timeout: Option<Duration>`     | `None`이면 기한 없음                                  | 같음                  |
| `spawn`                         | 선택 `&dyn Fn(SpawnSpec) -> io::Result<SpawnOutcome>` | 같음                  |

`MemoryIngestSpec`은 `root: &Path`, `executable`, `timeout`, `spawn`을 받습니다.
`MemorySearchSpec`은 여기에 `query: &str`, `limit: Option<NonZeroU32>`를 받으며 `None`이면 CLI의
기본값을 씁니다. 기억 명령에는 강제 수준, config-layer, telemetry 플래그를 보내지 않습니다.

timeout은 스폰 뒤 통신을 잽니다. stdin 쓰기와 두 출력 파이프 비우기를 포함하고, 직접 자식이 끝난 뒤
후손이 파이프를 잡은 시간에도 적용됩니다. 0은 스폰 뒤 만료됩니다. 만료되면 직접 자식을 종료·회수하고
파이프 수집을 끝냅니다. 후손은 호스트가 관리합니다. 실행 파일 해석, 직렬화, OS 스폰 지연은 기한 전에
일어납니다. 주입한 spawn은 받은 기한을 집행하고 만료 시 `io::ErrorKind::TimedOut`을 반환해야 합니다.

<a id="change-set"></a>
## `check_change_set`

`check_change_set(CheckChangeSetSpec { ... })`은 `input` 대신 `diff`를 받아
`pdks covenant check --diff --enforce <level>`을 실행합니다. UTF-8 diff와 줄바꿈을 보존합니다. `a/`,
`b/` 뒤의 경로는 `repo_root` 기준입니다. git의 생산 형식은 다음처럼 고정합니다.

```sh
git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ HEAD
```

추적하지 않은 파일은 `git add -N`을 해야 나타납니다. 두 약속 동사는 변경 집합 명령을 포함해 모두
차단 강제 수준이 기본값입니다. crate는 git을 실행하지 않습니다.

<a id="verdicts"></a>
## 세 가지 판정 결과

`CheckCovenantVerdict`는 `Upheld { advisories: String }`, `Blocked { reason: String }`,
`Unjudged { reason: String }`입니다. status `0`은 `Upheld`, `2`는 `Blocked`, 나머지 status와
시그널은 `Unjudged`입니다. 실행 파일 해석, 직렬화, 실행, 기한 실패도 `Unjudged`입니다. 제안한 작업은
`Upheld`일 때만 실행합니다. stderr를 근거로 status `2`를 재분류하지 않습니다.

유효한 stderr는 공백과 함께 보존하고, 잘못된 UTF-8은 대체 디코딩합니다. `advisories`와 비정상 종료
응답은 stderr를 제공하며, stderr가 없으면 필요한 경우 상태 설명을 만듭니다. 약속 stdout은 비우지만
판정 결과를 정하지 않습니다. CLI가 텔레메트리를 쓰며 `telemetry_path`로 목적지를 고릅니다.

<a id="memory"></a>
## `memory_ingest`와 `memory_search`

```rust
use polydeukes_sdk::{memory_search, MemorySearchOutcome, MemorySearchSpec};
use std::{num::NonZeroU32, path::Path};

let result = memory_search(MemorySearchSpec {
    root: Path::new("/path/to/project"),
    query: "session report",
    limit: NonZeroU32::new(5),
    executable: Some(Path::new("/opt/tools/pdks")),
    timeout: None,
    spawn: None,
});
match result {
    MemorySearchOutcome::Found { hits } => { /* 순위가 있는 결과를 사용합니다. */ }
    MemorySearchOutcome::Empty => { /* 검색은 성공했고 일치하는 절이 없습니다. */ }
    MemorySearchOutcome::Unavailable { reason } => { /* 검색 실패를 알립니다. */ }
}
```

`memory_ingest`는 `pdks memory ingest`를 실행하고 status `0`일 때만 `MemoryIngestOutcome::Ingested`,
그 밖에는 `Unavailable { reason }`을 반환합니다. ingest stdout은 무시합니다. `memory_search`는
query를 인자 하나로 `pdks memory search <query> --json`에 전달하고 limit이 있으면 `--limit <n>`을
더합니다. 두 기억 명령의 stdin은 빈 바이트입니다.

검색 성공에는 문자열 `ingestedAt`과 배열 `results`가 있는 엄격한 UTF-8 JSON이 필요합니다. 각 hit에는
문자열 `id`, `conceptId`, `docTitle`, `sectionTitle`, `status`, 불리언 `stale`, 문자열 배열
`supersededBy`, `trust`(`human-reviewed`, `machine-verified`, `unverified`), `matchPath`(`and`,
`or`, `like`)가 필요합니다. 객체의 추가 필드는 허용합니다. 생성된 Rust 필드는 snake case인
`concept_id`, `doc_title`, `section_title`, `match_path`, `superseded_by`입니다. `Found { hits }`는
CLI 순위를 보존하고 비어 있지 않습니다. 유효한 빈 results 배열만 `Empty`이고, 잘못된 JSON, UTF-8,
필드, 열거형과 실행 실패는 `Unavailable`입니다.

<a id="migration"></a>
## 프로세스 경계와 전환

npm 탐색에 의존하던 소비자는 단일 실행 파일 `pdks`를 설치하고 `executable` 또는 `PATH`의 절대
디렉터리로 선택합니다. 기존 npm 설치는 CLI를 선택하지 않습니다. 사용자 spawn은 문자열 대신 바이트를
주고받습니다.

```rust
pub struct SpawnSpec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: std::path::PathBuf,
    pub stdin: Vec<u8>,
    pub timeout: Option<std::time::Duration>,
}
pub struct SpawnOutcome {
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}
```

status `None`은 시그널 종료입니다. SDK가 해석할 때까지 출력 바이트를 보존합니다. 검색 stdout을 손실
치환하면 잘못된 UTF-8을 감추게 됩니다. 네 동사는 이 경계를 공유합니다. 일반 I/O 오류는 실패 값이
되지만 호스트 종료와 Rust panic은 잡지 않습니다.

<a id="limits"></a>
## 선언된 한계

API는 블로킹이며 비동기 호스트는 블로킹 작업에서 실행합니다. crate는 CLI 버전을 협상하지 않습니다.
입력 스키마와 기억 열거형을 이해하는 CLI를 선택합니다. 생성한 전송 타입은 비어 있지 않은 shell
목록에 명령 인자 이름이 필요하다는 등의 의미 제약을 모두 표현하지 못하며 CLI가 검사합니다. 기억
검색은 작업 허가가 아닙니다.

<a id="see-also"></a>
## 함께 보기

- [TypeScript SDK](sdk-ts.ko.md)
- [Python SDK](sdk-python.ko.md)
- [`pdks covenant check`](../cli/covenant-check.ko.md)
- [`pdks memory`](../cli/memory.ko.md)
