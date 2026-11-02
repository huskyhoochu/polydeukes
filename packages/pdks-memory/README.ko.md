# `pdks-memory`

[English](./README.md) · **한국어**

Rust 기억(memory) 확장은 `pdks-memory`가 `PATH`에 있으면 `pdks memory ...`로 실행됩니다. 매번
마크다운 파일에서 답을 계산하며 색인 파일을 유지하지 않습니다.

<a id="install"></a>
## 설치

`cargo install --locked pdks-memory`는 crates.io의 소스로 실행 파일을 빌드하며, 릴리스를 테스트한
의존성 버전(crate에 포함된 `Cargo.lock`)을 사용합니다. `cargo binstall pdks-memory`는
`aarch64-apple-darwin`과 `x86_64-unknown-linux-musl`에서 다음 문단의 Release 압축 파일을 내려받으며,
다른 대상에서는 소스 빌드로 전환합니다.

```sh
cargo install --locked pdks-memory
cargo binstall pdks-memory
```

각 [GitHub Release](https://github.com/huskyhoochu/polydeukes/releases)는
`pdks-memory-<target>-v<version>.tar.gz`를 제공합니다. 지원 대상은 `aarch64-apple-darwin`과
`x86_64-unknown-linux-musl`입니다. 압축 파일에는 같은 이름의 디렉터리 하나가 있으며 실행 파일과
`LICENSE`, `GARU-LICENSE`, `EN-KO-LICENSE`가 들어 있습니다. 압축을 풀고 실행 파일을 `PATH`에 둡니다.

또는 [저장소](https://github.com/huskyhoochu/polydeukes)를 복제한 뒤 루트에서 빌드합니다:

```sh
cargo build --release -p pdks-memory
```

빌드한 실행 파일은 `target/release/pdks-memory`입니다.

<a id="commands"></a>
## 명령

프로젝트 루트에서 실행합니다. 실행 파일은 설정의 `memory` 키와 `memory.include`, `memory.exclude`가
선택한 마크다운 파일을 읽습니다.

- [`search <query…>`](../../docs/reference/cli/memory.ko.md#search)는 일치하는 절의 순위를 매깁니다.
  `--limit <n>`은 결과 수 상한을 정합니다(기본값 20).
- [`show <id>`](../../docs/reference/cli/memory.ko.md#show)는 문서나 절을 출력합니다.
- [`obligations <key>`](../../docs/reference/cli/memory.ko.md#obligations)는 키에 해당하는 의무를
  나열합니다.
- [`supersession <doc>`](../../docs/reference/cli/memory.ko.md#supersession)은 대체 관계를
  나열합니다.
- [`lint`](../../docs/reference/cli/memory.ko.md#lint)는 링크 위반을 보고합니다.
- [`stats`](../../docs/reference/cli/memory.ko.md#stats)는 문서 집합의 개수를 보고합니다.
- [`usage`](../../docs/reference/cli/memory.ko.md#usage)는 기억 접근 로그를 요약합니다.

각 명령 앞에 `pdks memory`를 붙이며 모두 `--json`을 받습니다. 예시:

```sh
pdks memory search configuration --limit 5 --json
```

`search`, `show`, `obligations`는 `.polydeukes/memory-log.jsonl`에 기록을 추가합니다. 연결된 참조
문서는 TypeScript 패키지의 색인 기반 구현도 설명합니다. 이 실행 파일은 명령마다 마크다운을 새로
읽습니다.

<a id="third-party-data"></a>
## 제삼자 데이터

실행 파일에는 garu 한국어 형태소 분석기가 내장됩니다. `src/garu/`의 소스는 `ongjin/garu`에서
가져오며 [models/GARU-LICENSE](./models/GARU-LICENSE)의 MIT 라이선스가 해당 코드와 내장 모델
`models/garu-base.gmdl`에 적용됩니다.

Wiktionary에서 파생한 영한 사전 `models/en-ko.tsv`도 내장합니다.
[models/EN-KO-LICENSE](./models/EN-KO-LICENSE)는 CC BY-SA 4.0 라이선스와 저작자 표시를 명시하며, 이
라이선스는 `models/en-ko.tsv`에만 적용됩니다.

<a id="license"></a>
## 라이선스

MIT. [LICENSE](./LICENSE)를 참고하세요.
