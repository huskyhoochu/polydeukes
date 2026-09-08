# `polydeukes`

[English](./README.md) · **한국어**

Polydeukes는 우산 패키지입니다. 이 패키지 하나에 `pdks` 실행 파일, 판정기,
두 표면의 조립 루트, 세션 표면 실행기 서브패스, 동봉 스키마가 모두 포함돼 있습니다.

<a id="overview"></a>
## 개요

공개 계약 진입점은 다음과 같습니다.

- `pdks` / `polydeukes` — 실행 파일
- `polydeukes/schema.json`

CLI 명령은 다음과 같습니다.

- `pdks covenant check`
- `pdks init`
- `pdks-grok init` (`@polydeukes/adapter-grok`가 제공)
- `pdks explain`
- `pdks docs [topic]`

<a id="public-symbols"></a>
## 공개 심볼

없습니다. 이 패키지는 TypeScript 진입점을 공개하지 않습니다. `import 'polydeukes'`는
`ERR_PACKAGE_PATH_NOT_EXPORTED`로 실패하고, 사용자가 닿는 것은 `pdks` 실행 파일과 동봉된
스키마입니다. 표면은 판정기에 표준 입력으로 입력을 넘기고 종료 코드를 읽습니다. 에이전트
어댑터의 훅이 하는 일이 바로 그것입니다. 이 패키지를 peer 의존으로 선언하고 import 없이
실행 파일을 스폰합니다.

<a id="see-also"></a>
## 같이 보기

- [`polydeukes` 패키지 레퍼런스](../../docs/reference/packages/polydeukes.ko.md)
- [`설정 레퍼런스`](../../docs/reference/configuration/index.ko.md)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.ko.md)
- [`pdks init`](../../docs/reference/cli/init.ko.md)
- [`pdks explain`](../../docs/reference/cli/explain.ko.md)
