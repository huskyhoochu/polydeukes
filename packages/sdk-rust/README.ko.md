# `polydeukes-sdk`

[English](./README.md) · **한국어**

네 블로킹 Rust 동사가 단일 실행 파일 `pdks`를 실행하고 결과를 값으로 돌려줍니다.
약속(covenant) 판정, 설정, 텔레메트리, 기억(memory) 색인은 CLI가 맡습니다.

```sh
cargo add polydeukes-sdk
```

[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases)에서 Linux x64 또는 macOS arm64용
단일 실행 파일 `pdks`를 설치하고 실행 권한을 준 뒤 `executable`이나 `PATH`의 절대 디렉터리로 선택합니다.
crate는 그 파일을 직접 실행하므로 Node와 npm 설치가 필요하지 않습니다.

<a id="overview"></a>
## 개요

- `check_covenant(CheckCovenantSpec)`은 생성한 `CovenantInput`을 UTF-8 JSON으로 보냅니다.
- `check_change_set(CheckChangeSetSpec)`은 unified diff를 그대로 보냅니다.
- 둘 다 `CheckCovenantVerdict`인 `Upheld`, `Blocked`, `Unjudged`를 반환합니다.
- `memory_ingest(MemoryIngestSpec)`은 `MemoryIngestOutcome`인 `Ingested`, `Unavailable`을 반환합니다.
- `memory_search(MemorySearchSpec)`은 `MemorySearchOutcome`인 순위가 있는 `Found`, `Empty`,
  `Unavailable`을 반환합니다.
- 네 동사는 `executable`, `timeout`, `spawn`을 받고 `SpawnSpec`, `SpawnOutcome`의 stdin, stdout,
  stderr에 `Vec<u8>`을 씁니다.

루트와 명시한 실행 파일은 호출자의 cwd 기준이며 실행 파일의 symlink 경로 표기를 보존합니다.
미지정이면 `PATH`의 절대 디렉터리에서 실행할 수 있는 파일 `pdks`를 처음 선택하고 빈 항목과 상대
항목은 건너뜁니다. 선택한 파일이 실패해도 다른 후보를 재시도하지 않습니다.
`timeout: Option<Duration>`은 자식 종료 뒤 후손이 잡은 파이프를 포함해 스폰 뒤 통신에 적용됩니다.
`None`이면 기한이 없고 0은 스폰 뒤 만료됩니다. 만료 시 직접 자식을 종료·회수하고 호출자의
파이프 수집 대기를 끝냅니다. 분리된 읽기 스레드는 파이프가 닫히면 끝나며
후손은 종료하지 않습니다.

<a id="examples"></a>
## 예시

```rust
use polydeukes_sdk::{check_covenant, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput};
use std::{path::Path, time::Duration};

let input = CovenantInput {
    tool_calls: vec![], subagent_spawns: vec![], user_messages: vec![],
    tools: None, actor: None, session: None,
};
let verdict = check_covenant(CheckCovenantSpec {
    repo_root: Path::new("."), input: &input, enforce: None,
    config_layer: None, telemetry_path: None,
    executable: Some(Path::new("/opt/tools/pdks")),
    timeout: Some(Duration::from_secs(2)), spawn: None,
});
match verdict {
    CheckCovenantVerdict::Upheld { .. } => { /* 이곳에서 제안한 작업을 실행합니다. */ }
    CheckCovenantVerdict::Blocked { reason } | CheckCovenantVerdict::Unjudged { reason } => {
        eprintln!("{reason}");
    }
}
```

작업은 `Upheld`일 때만 실행합니다. status `0`은 `Upheld`, `2`는 `Blocked`, 나머지 상태, 시그널,
실행 실패는 `Unjudged`입니다. 강제 수준 기본값은 `Enforce::Block`입니다. `check_change_set`은
`input` 대신 `diff`를 받고 `a/`, `b/` 뒤의 경로는 `repo_root` 기준입니다. API는 블로킹이며 비동기
호스트는 블로킹 작업에서 실행합니다.

기억 spec은 `root`를 받고 검색에는 `query`, 선택 `limit: NonZeroU32`를 더합니다. 유효한 빈 검색
응답만 `Empty`입니다. 기억 기능 부재, 잘못된 응답, 실행 실패는 `Unavailable`이며 검색 결과는 CLI
순위를 보존합니다.

전환 시 npm 탐색 의존을 단일 실행 파일로 바꿉니다. 사용자 spawn은 세 스트림 모두 문자열 대신
`Vec<u8>`을 쓰고, 검색을 엄격히 해석할 수 있도록 stdout 바이트를 보존하며, 받은 timeout을 집행해
만료 시 `io::ErrorKind::TimedOut`을 반환합니다.

<a id="see-also"></a>
## 함께 보기

- [전체 API, 증거, 전환](../../docs/reference/packages/sdk-rust.ko.md)
- [TypeScript SDK](../../docs/reference/packages/sdk-ts.ko.md)
