# `@polydeukes/adapter-grok`

[English](./README.md) · **한국어**

이 어댑터는 Grok 세션 표면의 설치 단위입니다. Grok PreToolUse 페이로드를 약속(covenant) 입력
IR로 변환하고, 판정기를 스폰하며, 프로젝트에 세션 표면을 등록하는 `pdks-grok` 실행 파일을
제공합니다.

`polydeukes`와 함께 설치합니다. `polydeukes`는 이 패키지의 `peerDependency`입니다.

```sh
npm install --save-dev polydeukes @polydeukes/adapter-grok
npx pdks-grok init
```

이 어댑터와 `@polydeukes/adapter-claude-code`를 한 프로젝트에 함께 설치하면 호출마다
판정기가 두 번 실행될 수 있습니다.

<a id="overview"></a>
## 개요

공개 계약 심볼은 다음과 같습니다.

- `runHook`
- `COMMAND_ARGS`
- `MUTATING_TOOLS`
- `SHELL_TOOLS`

<a id="examples"></a>
## 예제

```ts
import { runHook } from '@polydeukes/adapter-grok';

// 표준 입력에서 페이로드를 읽어 repoRoot에서 `pdks covenant check --enforce block`을 스폰하고
// 그 자식 프로세스의 종료 코드를 돌려줍니다. 생성된 훅 위임자가 부르는 함수입니다.
const { exitCode } = runHook({ repoRoot: process.cwd() });
```

<a id="see-also"></a>
## 같이 보기

- [`@polydeukes/adapter-grok` 패키지
레퍼런스](../../docs/reference/packages/adapter-grok.ko.md)
- [판정기(`covenant` 모듈)](../../docs/reference/packages/polydeukes.ko.md#covenant-module)
