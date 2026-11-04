# `pdks-claude-code`

[English](./README.md) · **한국어**

Rust 호스트 어댑터는 Claude Code를 `pdks` 약속(covenant) 판정기(judge)에 연결합니다. `init`은
어댑터를 등록하고 `hook`은 호스트 이벤트를 변환해 `pdks covenant check`를 실행합니다.

Homebrew·crates.io·npm·PyPI의 [설치 안내](../../docs/how-to/install.ko.md)에서 경로를 선택하세요.
[문서
홈](../../docs/README.ko.md)은
설치 이후의 학습 순서를 안내합니다.

<a id="install"></a>
## 설치

`cargo install --locked pdks-claude-code`는 crates.io의 소스로 실행 파일을 빌드하며, 릴리스를
테스트한 의존성 버전(crate에 포함된 `Cargo.lock`)을 사용합니다. `cargo binstall pdks-claude-code`는
`aarch64-apple-darwin`, `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`에서 다음 문단의
Release 압축 파일을 내려받으며, 다른 대상에서는 소스 빌드로 전환합니다.

```sh
cargo install --locked pdks-claude-code
```

각 [GitHub Release](https://github.com/huskyhoochu/polydeukes/releases)는
`pdks-claude-code-<target>-v<version>.tar.gz`를 제공합니다. 지원 대상은 `aarch64-apple-darwin`,
`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`입니다. 압축 파일에는 같은 이름의 디렉터리
하나가 있으며 실행 파일과 `LICENSE`가 들어 있습니다. 압축을 풀고 실행 파일을 `PATH`에 둡니다.

또는 [저장소](https://github.com/huskyhoochu/polydeukes)를 복제한 뒤 루트에서 빌드합니다:

```sh
cargo build --release -p pdks-claude-code
```

빌드한 실행 파일은 `target/release/pdks-claude-code`입니다.

<a id="commands"></a>
## 명령

`pdks-claude-code`와 `pdks`를 모두 `PATH`에 두고 프로젝트 루트에서 init을 실행합니다.

```sh
pdks-claude-code init
```

- `init`은 `pdks init`을 실행하고 `.claude/settings.json`에 `PreToolUse` 이벤트를 등록하며
  `.claude/settings.json`와 `.claude/settings.local.json`을 `protectedPaths`에 추가합니다. 또한
  `.claude/rules/polydeukes.md`와 `.claude/skills/discipline-draft/SKILL.md`를 각각 해당 파일이 아직
  없을 때만 작성합니다.
- `hook --project-root <absolute-path> --pdks <absolute-path>`는 stdin에서 호스트 이벤트를 읽습니다.
  두 경로는 절대 경로여야 하며 플래그는 이 순서로 써야 합니다.

같은 명령을 `pdks claude-code init`, `pdks claude-code hook ...`으로 실행할 수 있습니다. 공통 초기
설정은
[`pdks
init`](../../docs/reference/cli/init.ko.md#init-common)을
참고하세요.
[세션 연결
안내](../../docs/how-to/connect-surfaces.ko.md#claude-code)는
호스트 설정을 설명합니다.

<a id="registration"></a>
## 등록

등록은 프로젝트 루트, 어댑터 실행 파일, `PATH`에서 찾은 `pdks`의 절대 경로를 고정합니다.
`onFailure`와 `|| exit 2`는 포함하지 않습니다. 어댑터를 시작할 수 없으면 호스트는 메시지 없이 호출을
진행합니다. 어댑터는 시작했지만 판정기를 시작할 수 없으면 `pdks` 설치 안내와 함께 호출을 진행합니다.

`hook`은 제안된 도구 호출과 대화 기록(transcript) 증거를 판정기의 입력 IR로 변환합니다.

<a id="license"></a>
## 라이선스

MIT. [LICENSE](./LICENSE)를 참고하세요.
