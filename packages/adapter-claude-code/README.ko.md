# `@polydeukes/adapter-claude-code`

[English](./README.md) · **한국어**

이 어댑터는 Claude Code PreToolUse 페이로드를 약속(covenant) 입력 IR로 변환합니다.
우산 패키지가 세션 표면에 주입할 읽기 함수를 만드는 팩터리도 제공합니다.

<a id="overview"></a>
## 개요

공개 계약 심볼은 다음과 같습니다.

- `runAdapterPath`
- `sessionSourceReader`
- `sessionChannelReader`
- `transcriptPathFromPayload`
- `transcriptFromJsonlFile`
- `COMMAND_ARGS`
- `MUTATING_TOOLS`
- `SHELL_TOOLS`

<a id="examples"></a>
## 예제

```ts
import { runAdapterPath } from '@polydeukes/adapter-claude-code';

const outcome = await runAdapterPath({
  rawPayload: '{}',
  telemetryPath: '.polydeukes/roi.log',
  dispatch: async () => ({ exitCode: 0, results: [] }),
});
```

<a id="see-also"></a>
## 같이 보기

- [`@polydeukes/adapter-claude-code` 패키지
레퍼런스](../../docs/reference/packages/adapter-claude-code.ko.md)
- [`polydeukes/claude-code`](../../docs/reference/packages/polydeukes.ko.md#polydeukes-entry-points)
- [`@polydeukes/covenant`](../../docs/reference/packages/covenant.ko.md)
