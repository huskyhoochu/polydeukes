# `pdks-codex`

[English](./README.md) · **한국어**

Rust 호스트 어댑터는 Codex를 `pdks` 약속(covenant) 판정기(judge)에 연결합니다. `init`은 어댑터를
등록하고 `hook`은 제안된 호출을 판정하며 세션의 도구 호출 이력을 기록합니다.

<a id="install"></a>
## 설치

`cargo install --locked pdks-codex`는 crates.io의 소스로 실행 파일을 빌드하며, 릴리스를 테스트한
의존성 버전(crate에 포함된 `Cargo.lock`)을 사용합니다. `cargo binstall pdks-codex`는
`aarch64-apple-darwin`, `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`에서 다음 문단의
Release 압축 파일을 내려받으며, 다른 대상에서는 소스 빌드로 전환합니다.

```sh
cargo install --locked pdks-codex
cargo binstall pdks-codex
```

각 [GitHub Release](https://github.com/huskyhoochu/polydeukes/releases)는
`pdks-codex-<target>-v<version>.tar.gz`를 제공합니다. 지원 대상은 `aarch64-apple-darwin`,
`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`입니다. 압축 파일에는 같은 이름의 디렉터리
하나가 있으며 실행 파일과 `LICENSE`가 들어 있습니다. 압축을 풀고 실행 파일을 `PATH`에 둡니다.

또는 [저장소](https://github.com/huskyhoochu/polydeukes)를 복제한 뒤 루트에서 빌드합니다:

```sh
cargo build --release -p pdks-codex
```

빌드한 실행 파일은 `target/release/pdks-codex`입니다.

<a id="commands"></a>
## 명령

`pdks-codex`와 `pdks`를 모두 `PATH`에 두고 프로젝트 루트에서 init을 실행합니다.

```sh
pdks-codex init
```

- `init`은 `pdks init`을 실행하고 `.codex/hooks.json`에 `PreToolUse`, `PostToolUse`, and
  `SessionEnd` 이벤트를 등록하며 `.codex/hooks.json`와 `.codex/config.toml`을 `protectedPaths`에
  추가합니다.
- `hook --project-root <absolute-path> --pdks <absolute-path>`는 stdin에서 호스트 이벤트를 읽습니다.
  두 경로는 절대 경로여야 하며 플래그는 이 순서로 써야 합니다.

같은 명령을 `pdks codex init`, `pdks codex hook ...`으로 실행할 수 있습니다. 공통 초기 설정은
[`pdks init`](../../docs/reference/cli/init.ko.md#init-common)을 참고하세요.
[세션 연결 안내](../../docs/how-to/connect-surfaces.ko.md#codex)는 호스트 설정을 설명하며, 그 문서의
통합 CLI 어댑터 명령은 다른 등록 형식을 씁니다.

<a id="registration"></a>
## 등록

등록은 프로젝트 루트, 어댑터 실행 파일, `PATH`에서 찾은 `pdks`의 절대 경로를 고정합니다.
`onFailure`와 `|| exit 2`는 포함하지 않습니다. 어댑터를 시작할 수 없으면 호스트는 메시지 없이 호출을
진행합니다. 어댑터는 시작했지만 판정기를 시작할 수 없으면 `pdks` 설치 안내와 함께 호출을 진행합니다.

`hook`은 `apply_patch`와 `Bash` 호출을 변환합니다. `PostToolUse`는 `.polydeukes/codex-sessions/`에
도구 호출 이력을 기록하고 `SessionEnd`는 이를 삭제합니다. 변경된 정의는 Codex `/hooks`에서
승인합니다. 현재 프롬프트는 인간 증거를 제공하지 않습니다.

<a id="license"></a>
## 라이선스

MIT. [LICENSE](./LICENSE)를 참고하세요.
