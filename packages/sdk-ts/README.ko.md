# `@polydeukes/sdk-ts`

[English](./README.md) · **한국어**

네 TypeScript 동사가 호출자가 만든 입력을 단일 실행 파일 `pdks`에 보내고 결과를 값으로 돌려줍니다.
약속(covenant) 판정, 설정, 텔레메트리, 기억(memory) 색인은 CLI가 맡습니다.

```sh
pnpm add @polydeukes/sdk-ts
```

SDK 호스트에는 Node >=26가 필요합니다.
[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases)에서 플랫폼에 맞는 단일 실행
파일 `pdks`를 설치하고 실행 권한을 준 뒤 `executable`이나 `PATH`의 절대 디렉터리로 선택합니다. 기존
npm 설치는 CLI를 선택하지 않으며 SDK는 실행 파일을 직접 실행합니다. `@polydeukes/core`와
`polydeukes`에 대한 런타임·peer 의존성이 필요하지 않습니다. 전송 타입은 SDK에 포함됩니다.

<a id="overview"></a>
## 개요

- `checkCovenant(CheckCovenantSpec)`은 `CovenantInput`을 UTF-8 JSON으로 보냅니다.
- `checkChangeSet(CheckChangeSetSpec)`은 unified diff를 그대로 보냅니다.
- 둘 다 `CheckCovenantVerdict`인 `upheld`, `blocked`, `unjudged`를 반환합니다.
- `memoryIngest(MemoryIngestSpec)`은 `MemoryIngestOutcome`인 `ingested`, `unavailable`을 반환합니다.
- `memorySearch(MemorySearchSpec)`은 `MemorySearchOutcome`인 순위가 있는 `MemorySearchResult` 목록의
  `found`, `empty`, `unavailable`을 반환합니다.
- 네 동사는 `executable`, `timeoutMs`, `spawn: Spawn`을 받고 `SpawnSpec`, `SpawnOutcome`으로
  바이트를 전송합니다.

명시한 실행 파일과 루트는 호출자의 cwd 기준이며 symlink 경로 표기를 보존합니다. 미지정이면 `PATH`의
절대 디렉터리에서 실행할 수 있는 파일 `pdks`를 처음 선택하고 실패해도 다른 후보를 재시도하지
않습니다. `timeoutMs`는 유한한 0 이상 밀리초이고 미지정이면 기한이 없으며 0은 스폰 뒤 만료됩니다.
기한은 후손이 잡은 파이프를 포함한 통신에 적용됩니다. 만료 시 직접 자식을 종료·회수하고 파이프를
닫으며 후손은 종료하지 않습니다.

<a id="examples"></a>
## 예제

```ts
import { checkCovenant, type CovenantInput } from '@polydeukes/sdk-ts';

const input: CovenantInput = {
  toolCalls: [
    {
      name: 'writeFile',
      fileChange: { kind: 'create', path: 'src/index.ts', post: 'export const answer = 42;\n' },
    },
  ],
  subagentSpawns: [],
  userMessages: [],
  tools: { mutating: ['writeFile'], shell: [], commandArgs: [] },
};
const verdict = await checkCovenant({
  repoRoot: process.cwd(),
  input,
  executable: '/opt/tools/pdks',
  timeoutMs: 2000,
});
if (verdict.verdict !== 'upheld') throw new Error(verdict.reason);
// 이곳에서 제안한 작업을 실행합니다.
```

작업은 `upheld`일 때만 실행합니다. status `0`은 `upheld`, `2`는 `blocked`, 나머지 상태, 시그널, 실행
실패는 `unjudged`입니다. 강제 수준 기본값은 `block`입니다. `checkChangeSet`은 `input` 대신 `diff`를
받고, `a/`, `b/` 뒤의 경로는 `repoRoot` 기준입니다.

기억 spec은 `root`를 받고 검색에는 `query`와 선택 양의 안전 정수 `limit`을 더합니다. 유효한 빈 검색
응답만 `empty`입니다. 기억 기능 부재, 잘못된 응답, 실행 실패는 `unavailable`입니다.

전환 시 입력 타입을 core 대신 이 SDK에서 import합니다. 사용자 프로세스 구현은 기존 `SpawnSpec`을
쓰고 stdin, stdout, stderr를 `Uint8Array`로 전달하며 `timeoutMs`를 직접 집행합니다. 검색을 엄격히
해석할 수 있도록 stdout 바이트를 보존합니다.

<a id="see-also"></a>
## 같이 보기

- [전체 API, 기억 예제, 전환](../../docs/reference/packages/sdk-ts.ko.md)
- [Rust SDK](../../docs/reference/packages/sdk-rust.ko.md)
