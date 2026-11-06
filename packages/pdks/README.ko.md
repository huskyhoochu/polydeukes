# `pdks`

[English](./README.md) · **한국어**

Rust 실행 파일 `pdks`는 약속(covenant) 판정기(judge)이며 `covenant check`, `init`, `explain`,
`docs`를 제공합니다. `PATH`의 `pdks-<name>` 실행 파일도 `pdks <name>`으로 실행합니다.

Homebrew·crates.io·npm·PyPI의 [설치 안내](../../docs/how-to/install.ko.md)에서 경로를 선택하세요.
[문서
홈](../../docs/README.ko.md)은
설치 이후의 학습 순서를 안내합니다.

<a id="install"></a>
## 설치

`cargo install --locked pdks`는 crates.io의 소스로 실행 파일을 빌드하며, 릴리스를 테스트한 의존성
버전(crate에 포함된 `Cargo.lock`)을 사용합니다. `cargo binstall pdks`는 `aarch64-apple-darwin`,
`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`에서 다음 문단의 Release 압축 파일을
내려받으며, 다른 대상에서는 소스 빌드로 전환합니다.

```sh
cargo install --locked pdks
```

각 [GitHub Release](https://github.com/huskyhoochu/polydeukes/releases)는
`pdks-<target>-v<version>.tar.gz`를 제공합니다. 지원 대상은 `aarch64-apple-darwin`,
`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`입니다. 압축 파일에는 같은 이름의 디렉터리
하나가 있으며 실행 파일과 `LICENSE`가 들어 있습니다. 압축을 풀고 실행 파일을 `PATH`에 둡니다.

또는 [저장소](https://github.com/huskyhoochu/polydeukes)를 복제한 뒤 루트에서 빌드합니다:

```sh
cargo build --release -p pdks
```

빌드한 실행 파일은 `target/release/pdks`입니다.

<a id="commands"></a>
## 명령

- [`pdks covenant check`](../../docs/reference/cli/covenant-check.ko.md)는 stdin의 입력 IR을
  판정하며 `--diff`를 쓰면 unified diff를 판정합니다. `--input-failure`는 입력 생성 실패를 받습니다.
  두 플래그 중 최대 하나만 선택합니다. 선택 플래그는 `--enforce advise|block` (기본값 `advise`),
  `--unattended`, `--config-layer <path>`, `--telemetry-path <path>`입니다.
- [`pdks init`](../../docs/reference/cli/init.ko.md#init-common)은 프로젝트 설정을 만들고 텔레메트리
  디렉터리를 `.gitignore`에 추가합니다.
- [`pdks explain`](../../docs/reference/cli/explain.ko.md)은 조립 단계의 등록 목록을 출력합니다.
- [`pdks docs`](../../docs/reference/cli/docs.ko.md)는 내장 문서를 읽습니다. 형식은
  `pdks docs [topic]`, `pdks docs search <query>`, `pdks docs show <document-id>`입니다. 주제에는
  `--lang en|ko`, search에는 `--lang en|ko`, `--limit N`, `--json`, show에는 `--lang en|ko`,
  `--section <section-id>`, `--json`을 쓸 수 있습니다.
- `pdks --version`은 실행 파일의 버전을 출력합니다.
- `pdks <name> [args...]`는 `PATH`의 `pdks-<name>`을 실행하며 나머지 인자를 전달하고 표준
  입력·출력·오류를 상속합니다. 확장 이름은 ASCII 영문자, 숫자, `_`, `-`만 포함하며 `-`로 시작하거나
  내장 명령의 이름과 같을 수 없습니다.

프로젝트 명령은 프로젝트 루트에서 실행합니다. 설정은
[프로젝트 안내](../../docs/how-to/configure-project.ko.md)를 참고하세요.

<a id="license"></a>
## 라이선스

MIT. [LICENSE](./LICENSE)를 참고하세요.
