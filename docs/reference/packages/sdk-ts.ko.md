# `@polydeukes/sdk-ts`

[English](sdk-ts.md) · **한국어**

> **TypeScript에서 판정기를 호출합니다.** `checkCovenant`에 약속(covenant) 입력 IR을
> 전달하면 `pdks covenant check`의 판정 결과를 값으로 반환합니다.
>
> 베타입니다. `polydeukes` · `@polydeukes/core`와 함께 설치하며, 둘 다 이 패키지의
> `peerDependencies`입니다.

<a id="ownership"></a>
## 담당하는 기능

판정받는 프로젝트에서 `polydeukes`를 찾고, 실행 파일의 표준 입력으로 IR을 전달한 뒤
자식 프로세스의 종료 코드를 판정 결과로 변환합니다. 실제 판정은 자식 프로세스가 수행합니다.

| 단위 | 하는 일 |
|---|---|
| `checkCovenant` | 판정받는 프로젝트에서 `pdks covenant check`를 스폰하고 판정 결과를 돌려줍니다 |
| 우산 패키지 찾기 | `repoRoot`의 설치 그래프에서 `polydeukes`를 찾아 `pdks` 실행 파일을 읽습니다 |
| 판정 결과 변환 | 종료 코드 `0`은 `upheld`, `2`는 `blocked`, 그 밖은 모두 `unjudged`입니다 |

텔레메트리는 자식 프로세스가 판정 중에 기록합니다. SDK는 중복 행을 추가하지 않습니다.

<a id="install"></a>
## 설치

```sh
pnpm add @polydeukes/sdk-ts polydeukes @polydeukes/core
```

별도의 초기화 명령은 필요하지 않습니다. 우산 패키지가 SDK가 스폰할 판정기를 공급하고, 코어가
호출자가 채우는 `CovenantInput` 타입을 공급합니다.

<a id="동사"></a>
<a id="verb"></a>
## `checkCovenant`

이 패키지는 ESM 전용입니다(`"type": "module"`, `import` 조건만 있고 `require`는 없음).
호출하는 파일이 `.mjs`이거나 그 `package.json`이 `"type": "module"`을 선언해야 합니다.

```ts
import { checkCovenant } from '@polydeukes/sdk-ts';

const verdict = await checkCovenant({
  repoRoot: '/path/to/the/project',
  input: {
    toolCalls: [
      {
        name: 'writeFile',
        args: { path: 'src/index.ts', content: 'export const answer = 42;\n' },
        fileChange: {
          kind: 'modify',
          path: 'src/index.ts',
          pre: 'export const answer = 41;\n',
          post: 'export const answer = 42;\n',
        },
      },
    ],
    subagentSpawns: [],
    userMessages: [],
    tools: { mutating: ['writeFile', 'rm'], shell: ['exec'], commandArgs: ['command'] },
  },
});
```

IR은 호출자의 것입니다. 이 패키지는 IR을 읽지도 채우지도 않습니다. `session`도 `actor`도
자기 명부도 더하지 않으며, 위의 `tools` 값도 호출자 자신의 도구 이름입니다. `subagentSpawns`와
`userMessages`는 필수 배열이므로 둘 다 없는 호출자는 빈 배열을 보냅니다. `world` 키는 판정기가
거부합니다. 러너가 세계를 디스크의 프로젝트에서 읽으며, 클라이언트가 세계를 고르면 무엇을
판정할지를 고르는 것이 되기 때문입니다.

<a id="spec"></a>
## 스펙

```ts
type CheckCovenantSpec = {
  repoRoot: string;
  input: CovenantInput;
  enforce?: 'advise' | 'block';
  spawn?: (spec: CheckCovenantSpawnSpec) => Promise<{ status: number | null; stderr: string }>;
};

type CheckCovenantSpawnSpec = { command: string; args: string[]; cwd: string; stdin: string };
```

| 필드 | 무엇인가 |
|---|---|
| `repoRoot` | 판정받는 프로젝트입니다. 설정 발견, 세계 축, 자식의 cwd, 우산 패키지를 찾는 설치 그래프가 모두 여기 걸립니다 |
| `input` | 호출자 자신의 IR이며 자식의 표준 입력으로 원문 그대로 갑니다 |
| `enforce` | 실행 전체에 대한 관측자의 기본 자세입니다. **적지 않으면 `block`입니다** |
| `spawn` | 자식 프로세스 실행 함수를 지정합니다. 생략하면 현재 프로세스의 Node.js 실행 파일을 사용합니다 |

**`enforce`의 기본값은 `block`입니다.** 이것은 표면의 강제 수준이지 항목의 것이 아닙니다.
보호 경로와 `enforce: block`을 단 항목이 호출을 멈추고, 나머지 위반은 종료 코드 0에
`advised`로 기록됩니다. 항목 자신의 강제 수준은 다른 표면에서와 같이 느슨한 쪽이 이기도록
조합됩니다. `@polydeukes/adapter-claude-code`, `@polydeukes/adapter-grok`,
`@polydeukes/adapter-codex`도 같은 수준으로 판정기를 스폰합니다.

기본 스폰은 파일 서술자를 하나도 상속하지 않습니다. 호출자가 자기 서술자를 갖지 않을 수 있고,
상속한 stdout이 닫혀 있으면 자식이 답하기 전에 EPIPE로 죽기 때문입니다. stderr는 모아서
돌려주고, 판정기가 stdout에는 판정 결과를 쓰지 않으므로 stdout은 흘려보내고 버립니다.

<a id="verdicts"></a>
## 판정 결과 셋

```ts
type CheckCovenantVerdict =
  | { verdict: 'upheld'; advisories: string }
  | { verdict: 'blocked'; reason: string }
  | { verdict: 'unjudged'; reason: string };
```

| 판정 결과 | 자식의 상태 | 호출자에게 뜻하는 것 |
|---|---|---|
| `upheld` | `0` | 호출이 판정을 받았고 아무것도 막지 않았습니다. `advisories`는 자식의 stderr 원문이며 그 실행이 낸 권고 줄을 싣습니다. 진행하면 됩니다 |
| `blocked` | `2` | 호출이 판정을 받았고 무언가 막았습니다. `reason`은 자식의 stderr 원문입니다. 진행하지 않습니다 |
| `unjudged` | 그 밖의 상태이거나 우산 패키지가 없음 | 판정이 일어나지 않았습니다. `reason`이 어느 쪽인지 말합니다. 이것을 통과로 읽으면 판정기가 설치되지 않은 프로젝트에서 모든 호출이 지나갑니다 |

SDK는 `blocked.reason`과 `upheld.advisories`를 데이터로 반환합니다. 소비자는 이 내용을
모델에게 전달하거나 이슈 또는 로그에 기록할 수 있습니다. SDK는 별도의 증인 인자를 받지 않습니다.
무인 루프에서 결과를 처리하는 방법은
[규율 작성하기](../../how-to/write-disciplines.ko.md#posture)를 참고하세요.

<a id="failure"></a>
## 실패 예제

프로젝트에 `polydeukes`가 설치돼 있지 않으면 `checkCovenant`는 `unjudged`를 반환합니다.

```ts
const verdict = await checkCovenant({ repoRoot: '/tmp/project-without-polydeukes', input });

// {
//   verdict: 'unjudged',
//   reason: 'no polydeukes in the install graph of /tmp/project-without-polydeukes:
//            install it to have this input judged',
// }
```

자식 프로세스는 돌지 않고 텔레메트리 로그에도 아무것도 더해지지 않습니다. 행은 판정이
일어나는 자리에 쓰이는데, 판정이 일어나지 않았기 때문입니다.

<a id="limits"></a>
## 선언된 한계

- **IR은 호출자가 만듭니다.** 도구 명부와 변경 전 상태와 봉투는 호스트가 아는 사실이므로,
  그것을 아는 소비자가 채웁니다. 이 패키지는 그중 무엇도 공급하지 않습니다.
- **SDK가 여는 것은 세션 표면뿐입니다.** 입력이 표준 입력의 IR로 가고, 그것이 이 실행을 세션
  표면 판정으로 만듭니다. 끝난 변경 집합을 가진 호출자는 대신 셸에서
  `pdks covenant check --diff`에 통합 diff를 파이프합니다.
- **여기서는 텔레메트리 행을 쓰지 않습니다.** 행은 모두 자식이 씁니다.
- **`unjudged`는 통과가 아닙니다.** 판정기가 답하지 않았다는 사실을 기록하며, 판정기가 없는
  프로젝트에서 무엇을 허용할지는 소비자가 정합니다.

<a id="see-also"></a>
## 함께 보기

- [`pdks covenant check`](../cli/covenant-check.ko.md)
- [`polydeukes`](polydeukes.ko.md)
- [`@polydeukes/core`](core.ko.md)
- [설정 참조](../configuration/index.ko.md)
