# `polydeukes`

[English](./README.md) · **한국어**

Polydeukes는 우산 패키지입니다. 이 패키지 하나에 `pdks` 실행 파일, 설정 로더,
커밋 표면 실행기, 세션 표면 실행기 서브패스, 동봉 스키마가 모두 포함돼 있습니다.

<a id="overview"></a>
## 개요

공개 계약 심볼과 진입점은 다음과 같습니다.

- `loadConfig`
- `runCovenantCheck`
- `ResolvedConfig`
- `polydeukes/claude-code` → `runClaudeCodeHook`
- `polydeukes/schema.json`
- `pdks covenant check`
- `pdks init claude-code`
- `pdks init grok`
- `pdks explain`
- `pdks docs [topic]`

<a id="public-symbols"></a>
## 공개 심볼

```ts
import { loadConfig, runCovenantCheck } from 'polydeukes';
import { runClaudeCodeHook } from 'polydeukes/claude-code';
```

```ts
function loadConfig(spec: { rootDir: string }): {
  config: import('@polydeukes/core').ResolvedConfig;
  configPath: string;
};

function runCovenantCheck(spec: {
  repoRoot: string;
  telemetryPath?: string;
  covenantDist?: string;
  ttyPrompt?: (prompt: string) => string | null;
  domain?: unknown;
}): Promise<{ exitCode: 0 | 2 }>;
```

<a id="see-also"></a>
## 같이 보기

- [`polydeukes` 패키지 레퍼런스](../../docs/reference/packages/polydeukes.ko.md)
- [`설정 레퍼런스`](../../docs/reference/configuration/index.ko.md)
- [`pdks covenant check`](../../docs/reference/cli/covenant-check.ko.md)
- [`pdks init`](../../docs/reference/cli/init.ko.md)
- [`pdks explain`](../../docs/reference/cli/explain.ko.md)
