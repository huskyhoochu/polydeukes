# `@polydeukes/covenant`

[English](./README.md) · **한국어**

`covenant` 패키지는 판정기를 구현합니다. 우산 패키지에서 사용하는 컴파일, 판정 분배,
실행기, 메타 약속(covenant), 증인 API를 제공합니다.

<a id="overview"></a>
## 개요

공개 계약 심볼은 다음과 같습니다.

- `compileDeclaration`
- `compileDisciplineRegistrations`
- `dispatchCovenants`
- `runCovenant`
- `selfModRegistration`
- `shellModRegistration`
- `transcriptModRegistration`
- `ttlWitness`
- `planSources`
- `supplySources`
- `CovenantRegistration`
- `RunCovenantSpec`
- `RunCovenantVerdict`

<a id="examples"></a>
## 예제

```ts
import { runCovenant, ttlWitness } from '@polydeukes/covenant';

const witness = ttlWitness({ token: 'covenant witness', ttlMs: 60_000 });
const verdict = await runCovenant({
  body: async () => ({ exitCode: 0 }),
  label: 'demo',
  telemetryPath: '.polydeukes/roi.log',
  witness,
});
```

<a id="see-also"></a>
## 같이 보기

- [`@polydeukes/covenant` 패키지 레퍼런스](../../docs/reference/packages/covenant.ko.md)
- [`설정 레퍼런스`](../../docs/reference/configuration/index.ko.md#disciplines)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.ko.md)
