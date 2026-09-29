# `@polydeukes/sdk-ts`

[English](./README.md) · **한국어**

이 패키지는 TypeScript에서 약속(covenant) 입력 IR이나 통합 diff를 판정기에 건넵니다. 판정받는 프로젝트의
`polydeukes` 설치를 찾고, 입력을 표준 입력에 넣어 `pdks covenant check`를 스폰하며, 판정
결과를 값으로 돌려줍니다. 판정 코드는 여기에 없고 텔레메트리 행도 여기서 쓰지 않습니다. 행은
자식 프로세스가 씁니다.

`polydeukes` · `@polydeukes/core`와 함께 설치합니다. 둘 다 이 패키지의
`peerDependencies`입니다.

```sh
pnpm add @polydeukes/sdk-ts polydeukes @polydeukes/core
```

실행 파일도 설치 단계도 없습니다.

<a id="overview"></a>
## 개요

공개 계약 심볼은 다음과 같습니다.

- `checkCovenant`
- `CheckCovenantSpec`
- `CheckCovenantSpawnSpec`
- `CheckCovenantVerdict`
- `checkChangeSet`
- `CheckChangeSetSpec`

<a id="examples"></a>
## 예제

```ts
import { checkCovenant } from '@polydeukes/sdk-ts';

// repoRoot에서 IR을 표준 입력에 넣어 `pdks covenant check --enforce block`을 스폰합니다.
// IR은 호출자의 것이며 이 패키지는 거기에 아무것도 더하지 않습니다.
const verdict = await checkCovenant({
  repoRoot: process.cwd(),
  input: {
    toolCalls: [{ name: 'writeFile', args: { path: 'src/index.ts' } }],
    subagentSpawns: [],
    userMessages: [],
    tools: { mutating: ['writeFile', 'rm'], shell: ['exec'], commandArgs: ['command'] },
  },
});

if (verdict.verdict === 'blocked') {
  // `reason`은 판정기 자신의 stderr입니다. 그 텍스트를 어디에 둘지는 호출자가 정합니다.
  console.error(verdict.reason);
}
```

`checkChangeSet`은 호출 하나가 아니라 끝난 변경 집합을 판정합니다. 통합 diff를 표준 입력에
넣어 `pdks covenant check --diff`를 스폰하고, 같은 판정 결과를 돌려줍니다.

```ts
import { checkChangeSet } from '@polydeukes/sdk-ts';

// diff는 호출자의 것이며 경로는 repoRoot 기준입니다. `git diff HEAD`(새 파일이 보이도록
// `git add -N .` 뒤)든 같은 형식의 다른 생산자든 됩니다.
const verdict = await checkChangeSet({ repoRoot: process.cwd(), diff });
```

두 동사 모두 `enforce`의 기본값은 `block`입니다. 판정 결과는 `upheld` · `blocked` · `unjudged` 셋이고,
`unjudged`는 `polydeukes`가 설치되지 않은 프로젝트와 판정 결과가 아닌 모든 자식 상태를
포괄합니다.

<a id="see-also"></a>
## 같이 보기

- [`@polydeukes/sdk-ts` 패키지 레퍼런스](../../docs/reference/packages/sdk-ts.ko.md)
- [판정기(`covenant` 모듈)](../../docs/reference/packages/polydeukes.ko.md#covenant-module)
