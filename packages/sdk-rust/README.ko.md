# `polydeukes-sdk`

[English](./README.md) · **한국어**

이 crate는 Rust에서 약속(covenant) 입력이나, unified diff로 된 끝난 변경 집합을 Polydeukes
판정기에 넘깁니다. 판정받는 프로젝트에 설치된 `polydeukes`를 찾고, `node`로 `pdks covenant check`를
실행하면서 입력이나 diff를 stdin에 넣고, 판정 결과를 값으로 돌려줍니다. 판정 로직은 여기에 없고, 텔레메트리 행도 여기서 쓰지 않습니다.
행은 자식 프로세스가 씁니다.

```sh
cargo add polydeukes-sdk
```

판정받는 프로젝트는 npm에서 `polydeukes`를 설치해야 하고(`pnpm add -D polydeukes`), `PATH`에
`node`가 있어야 합니다.

<a id="overview"></a>
## 개요

공개 항목은 다음과 같습니다.

- `check_covenant`와 `check_change_set`
- `CheckCovenantSpec`과 `CheckChangeSetSpec`
- `CheckCovenantVerdict`
- `Enforce`
- `SpawnSpec`과 `SpawnOutcome`
- `CovenantInput`과 그 구성 타입. `@polydeukes/core/covenant-input.schema.json`에서 생성합니다

<a id="examples"></a>
## 예시

```rust
use polydeukes_sdk::{check_covenant, CheckCovenantSpec, CheckCovenantVerdict, CovenantInput, ToolCall};
use std::path::Path;

let input = CovenantInput {
    tool_calls: vec![ToolCall { name: "exec".into(), args: Default::default(), file_change: None }],
    subagent_spawns: vec![],
    user_messages: vec![],
    tools: None,
    actor: None,
    session: None,
};

// repo_root에서 `node <bin> covenant check --enforce block`을 실행하고 입력을 stdin에 넣습니다.
let verdict = check_covenant(CheckCovenantSpec {
    repo_root: Path::new("."),
    input: &input,
    enforce: None,
    config_layer: None,
    telemetry_path: None,
    spawn: None,
});

if let CheckCovenantVerdict::Blocked { reason } = verdict {
    // `reason`은 판정기의 stderr 원문입니다. 어디로 보낼지는 호출자가 정합니다.
    eprintln!("{reason}");
}
```

이 호출은 판정기가 끝날 때까지 블로킹합니다. 비동기 호스트는 `tokio::task::spawn_blocking`으로
실행합니다. `enforce`의 기본값은 `Block`입니다. 판정 결과는 `Upheld`, `Blocked`, `Unjudged`
셋입니다. `Unjudged`는 `polydeukes`가 설치되지 않은 프로젝트, 스폰 실패, 판정 결과가 아닌 자식
status를 모두 포함합니다.

`check_change_set`은 `input` 대신 `diff`를 받고 `pdks covenant check --diff`를 실행합니다. diff의
경로는 `git diff`가 출력하는 것처럼 `a/`·`b/` 뒤에 `repo_root` 기준으로 적힙니다. 돌려주는 판정
결과는 같은 셋입니다.

<a id="see-also"></a>
## 함께 보기

- [`polydeukes-sdk` 레퍼런스](https://github.com/huskyhoochu/polydeukes/blob/main/docs/reference/packages/sdk-rust.ko.md)
- [TypeScript SDK `@polydeukes/sdk-ts`](https://github.com/huskyhoochu/polydeukes/blob/main/docs/reference/packages/sdk-ts.ko.md)
