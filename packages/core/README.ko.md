# `@polydeukes/core`

[English](./README.md) · **한국어**

`core` 패키지는 공통 어휘를 정의합니다. 판정기와 어댑터가 함께 쓰는 약속(covenant)
프로토콜, 설정 검증, 텔레메트리 도우미, 공유 타입을 제공합니다.

<a id="overview"></a>
## 개요

공개 계약 심볼은 다음과 같습니다.

- `defineConfig`
- `parseInput`
- `verdictToExitCode`
- `normalizeProtectedPaths`
- `appendRecordFailOpen`
- `readRecords`
- `noopTranscript`
- `ResolvedConfig`
- `CovenantInput`
- `CovenantVerdict`
- `EXIT_UPHOLD`
- `EXIT_BREAK_NON_BLOCKING`
- `EXIT_BREAK_BLOCKING`

<a id="examples"></a>
## 예제

```ts
import { defineConfig, parseInput } from '@polydeukes/core';

const config = defineConfig({
  languages: {
    typescript: {
      productionGlob: 'packages/*/src/**/*.ts',
      testCmd: 'pnpm --filter {scope} test',
    },
  },
});

const payload = parseInput('{"toolCalls":[],"subagentSpawns":[],"userMessages":[]}');
```

<a id="see-also"></a>
## 같이 보기

- [`@polydeukes/core` 패키지 레퍼런스](../../docs/reference/packages/core.ko.md)
- [`설정 레퍼런스`](../../docs/reference/configuration/index.ko.md)
- [`@polydeukes/covenant`](../../docs/reference/packages/covenant.ko.md)
