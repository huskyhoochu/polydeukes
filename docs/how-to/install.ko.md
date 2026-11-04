# 폴리데우케스 설치

**[English](./install.md)** · 한국어

먼저 판정기 `pdks`를 설치하고 필요한 확장을 선택합니다. 에이전트 연결 없이도 Git diff를 판정할 수
있습니다. Claude Code, Codex, 프로젝트 기억(memory)은 각각 별도 실행 파일입니다.

<a id="choose"></a>
## 설치 경로 선택

| 경로       | 선택할 때                                   | 실행되는 것                                                              |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| Homebrew   | brew로 명령줄 도구를 관리할 때              | 미리 빌드한 Rust 실행 파일                                               |
| crates.io  | Rust 도구 모음이 있을 때                    | 로컬에서 빌드한 실행 파일; cargo-binstall은 릴리스 압축본을 받을 수 있음 |
| npm / pnpm | 프로젝트별 개발 의존성으로 버전을 관리할 때 | Node 실행기가 패키지의 Rust 실행 파일을 선택                             |
| PyPI       | uv 또는 Python 환경으로 도구를 관리할 때    | 플랫폼 wheel이 Rust 실행 파일을 설치                                     |

미리 빌드한 릴리스는 macOS arm64, Linux x64, Linux arm64를 지원합니다. 네 경로 중 익숙한 하나를
선택하세요. 네이티브 실행 파일은 Node 없이 동작합니다. npm 실행기는 Node가 필요하고 TypeScript SDK는
Node 24 이상, 소스 설치는 Rust 1.89 이상이 필요합니다.

<a id="homebrew"></a>
## Homebrew

```sh
brew install huskyhoochu/polydeukes/pdks
```

필요한 확장을 추가합니다.

```sh
brew install huskyhoochu/polydeukes/pdks-claude-code
brew install huskyhoochu/polydeukes/pdks-codex
brew install huskyhoochu/polydeukes/pdks-memory
```

확장 formula는 판정기에 의존합니다. 설치만으로 프로젝트 훅이 등록되지는 않습니다.

<a id="cargo"></a>
## crates.io

```sh
cargo install --locked pdks
cargo install --locked pdks-claude-code
cargo install --locked pdks-codex
cargo install --locked pdks-memory
```

각 줄은 실행 파일 하나를 설치하며 뒤의 세 줄은 선택 사항입니다. Cargo의 bin 디렉터리를 PATH에
넣습니다. cargo-binstall을 사용한다면 `cargo binstall pdks`로 대상 릴리스 압축본을 받을 수 있습니다.
확장 이름도 같은 명령으로 설치합니다. 다른 대상에서는 소스 빌드로 대체할 수 있습니다.

<a id="npm"></a>
## npm 또는 pnpm

프로젝트 루트에서 실행합니다.

```sh
npm install --save-dev polydeukes
npm install --save-dev @polydeukes/adapter-claude-code
npm install --save-dev @polydeukes/adapter-codex
npm install --save-dev @polydeukes/memory
```

같은 패키지 이름에 `pnpm add -D`를 써도 됩니다. 사용하는 확장을 선택하고 잠금 파일을 커밋하세요. 이
안내의 `pdks` 대신 `npx --no-install pdks` 또는 `pnpm exec pdks`를 사용합니다. 호스트 등록은
`npx --no-install pdks-claude-code init` 또는 `pnpm exec pdks-claude-code init`입니다. 로컬 설치는
패키지 관리자의 명령으로 실행하며, 일반 셸의 PATH에 자동으로 나타나지는 않습니다.

로컬 npm/pnpm 등록은 설치된 플랫폼 실행 파일을 가리킵니다. 프로젝트를 옮기거나 설치 경로를 바꾸면
init을 다시 실행합니다. 훅을 실행하는 환경에는 해당 개발 의존성을 유지하세요.

<a id="pypi"></a>
## PyPI

```sh
uv tool install polydeukes
uv tool install polydeukes-claude-code
uv tool install polydeukes-codex
uv tool install polydeukes-memory
```

각 확장을 별도 도구로 설치합니다. 도구의 bin 디렉터리가 PATH에 없다면 `uv tool update-shell`을
실행하고 새 셸을 여세요. 활성화한 가상 환경에서 같은 이름을 pip로 설치해도 됩니다. 등록된 훅이 그
환경의 경로를 계속 사용할 수 있어야 합니다. Python SDK는 별도 패키지 `polydeukes-sdk`입니다.

<a id="verify"></a>
## 에이전트를 연결하기 전에 확인

```sh
pdks --version
pdks docs
```

두 명령은 프로젝트 설정 없이 실행됩니다. 셸이 `pdks`를 찾지 못하면 설치 경로의 bin 디렉터리나 위의
npm/pnpm 실행 명령을 확인합니다. 확장을 찾지 못하면 해당 확장을 설치하고 그 디렉터리도 PATH에 있는지
확인하세요.

[첫 판정](../tutorials/first-judgment.ko.md)을 실행한 뒤
[호스트 또는 Git을 연결](./connect-surfaces.ko.md)하세요. 기존 설치를 사용 중이라면
[이행 안내](./migrate-to-rust.ko.md)에 따라 훅 등록을 교체합니다.

<a id="releases"></a>
## 릴리스 압축본과 업그레이드

[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases)는
`<실행 파일>-<대상>-v<버전>.tar.gz`도 제공합니다. 대상은 `aarch64-apple-darwin`,
`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`입니다. 압축을 풀어 실행 파일을 PATH에 놓고
라이선스 파일을 보관하세요. 압축본 하나에는 실행 파일 하나가 있습니다.

설치한 패키지 관리자로 업그레이드합니다. 이후 `pdks --version`, 프로젝트의 `pdks explain`, 실제
호스트 호출의 `.polydeukes/roi.log` 기록을 확인하세요. 설치된 `pdks docs`는 그 실행 파일을 빌드할
때의 문서이며 웹사이트는 더 최신 릴리스를 설명할 수 있습니다.
