# `@polydeukes/sdk-ts`

[English](sdk-ts.md) · **한국어**

Promise를 반환하는 네 동사가 별도로 설치한 `pdks` 실행 파일을 호출합니다. SDK는 호출자의 입력을
보내고 약속(covenant)의 판정 결과나 기억(memory) 결과를 값으로 돌려줍니다. 판정, 설정, 텔레메트리,
색인은 CLI가 맡습니다.

<a id="ownership"></a>
## 담당하는 기능

| 동사             | 명령                                | 결과                   |
| ---------------- | ----------------------------------- | ---------------------- |
| `checkCovenant`  | `pdks covenant check`               | `CheckCovenantVerdict` |
| `checkChangeSet` | `pdks covenant check --diff`        | `CheckCovenantVerdict` |
| `memoryIngest`   | `pdks memory ingest`                | `MemoryIngestOutcome`  |
| `memorySearch`   | `pdks memory search <query> --json` | `MemorySearchOutcome`  |

네 동사는 실행 파일 선택과 바이트 단위 프로세스 통신을 공유합니다. 루트는 호출자의 현재 디렉터리
기준으로 절대화되어 자식의 cwd가 됩니다. 명시한 `executable`도 이름만 적었더라도 호출자의 cwd
기준으로 해석하며 symlink 경로 표기를 보존합니다. 미지정이면 `PATH`의 절대 디렉터리에서 실행할 수
있는 일반 파일 `pdks`를 처음 선택합니다. 빈 항목과 상대 항목은 건너뜁니다. 선택한 실행 파일이
실패하면 다른 후보를 재시도하지 않고 실패 값을 돌려줍니다.

<a id="install"></a>
## 설치

```sh
pnpm add @polydeukes/sdk-ts
```

SDK 호스트에는 Node >=24가 필요합니다.
[GitHub Releases](https://github.com/huskyhoochu/polydeukes/releases)에서 플랫폼에 맞는 단일 실행
파일 `pdks`를 설치하고 실행 권한을 준 다음, 경로를 지정하거나 `PATH`에 `pdks`라는 이름으로 둡니다.
지원 실행 플랫폼은 Linux x64와 macOS arm64입니다. SDK는 npm 설치를 탐색하거나 별도 Node 자식을
띄우지 않고 그 파일을 직접 실행합니다. `@polydeukes/core`와 `polydeukes`에 대한 런타임·peer 의존성이
없습니다. 생성한 전송 타입은 패키지에 포함됩니다.

기억 동사에는 기억 기능을 제공하는 CLI가 필요합니다. 기억 의존성, 설정, 색인이 없으면
`unavailable`로 돌아옵니다.

<a id="동사"></a>

<a id="verb"></a>
## `checkCovenant`

```ts
import { checkCovenant, type CovenantInput } from '@polydeukes/sdk-ts';

const input: CovenantInput = {
  toolCalls: [
    {
      name: 'writeFile',
      args: { path: 'src/index.ts' },
      fileChange: {
        kind: 'create',
        path: 'src/index.ts',
        post: 'export const answer = 42;\n',
      },
    },
  ],
  subagentSpawns: [],
  userMessages: [],
  tools: { mutating: ['writeFile'], shell: ['exec'], commandArgs: ['command'] },
};
const verdict = await checkCovenant({
  repoRoot: '/path/to/project',
  input,
  executable: '/opt/tools/pdks',
  timeoutMs: 2000,
});
if (verdict.verdict !== 'upheld') throw new Error(verdict.reason);
// upheld 판정 결과를 받은 뒤 이곳에서 제안한 작업을 실행합니다.
```

호스트가 도구 호출마다 증거를 제공합니다. `fileChange`는 `create`(`path`, `post`), `modify`(`path`,
`pre`, `post`), `delete`(`path`, 선택 `pre`) 중 하나입니다. `fileChange`가 없으면 그 호출에는 입증된
파일 변경이 없으며 다른 호출의 증거가 대신하지 않습니다. SDK는 입력을 UTF-8 JSON으로 그대로 보내고
actor, session, 도구 목록을 합성하지 않습니다. `CovenantInput`에는 `world` 필드가 없고, CLI가
프로젝트에서 그 축을 공급합니다.

<a id="spec"></a>
## 스펙

| 필드                            | `CheckCovenantSpec`                                  | `CheckChangeSetSpec`    |
| ------------------------------- | ---------------------------------------------------- | ----------------------- |
| `repoRoot: string`              | 프로젝트 루트와 자식 cwd                             | 같음                    |
| `input: CovenantInput`          | 호출자가 만든 필수 IR                                | `diff: string`으로 대체 |
| `enforce?: 'advise' \| 'block'` | 기본값 `block`                                       | 같음                    |
| `configLayer?: string`          | `--config-layer`로 전달, 상대 경로는 자식 cwd 기준   | 같음                    |
| `telemetryPath?: string`        | `--telemetry-path`로 전달, 상대 경로는 자식 cwd 기준 | 같음                    |
| `executable?: string`           | `PATH`보다 먼저 선택할 실행 파일                     | 같음                    |
| `timeoutMs?: number`            | 유한한 0 이상 밀리초, 미지정이면 기한 없음           | 같음                    |
| `spawn?: Spawn`                 | 주입할 프로세스 경계                                 | 같음                    |

`MemoryIngestSpec`은 `root: string`과 `executable`, `timeoutMs`, `spawn`을 받습니다.
`MemorySearchSpec`은 여기에 `query: string`과 선택 `limit: number`를 받습니다. limit은 양의 안전
정수여야 합니다. 잘못된 limit과 기한은 스폰 전에 실패 값이 됩니다. 기억 명령에는 강제 수준,
config-layer, telemetry 플래그를 보내지 않습니다.

통신 기한은 프로세스가 생성된 뒤 시작합니다. stdin 쓰기와 두 출력 파이프 수집을 포함하고, 직접
자식이 먼저 끝난 뒤 후손이 파이프를 잡고 있는 시간에도 적용됩니다. 0은 스폰 직후 만료됩니다. 만료 시
직접 자식을 종료·회수하고 파이프를 닫으며 후손은 종료하지 않습니다. 실행 파일 해석, 직렬화, OS 스폰
지연은 기한 전에 일어납니다. 주입한 spawn은 직접 기한을 집행해야 합니다.

<a id="verdicts"></a>
## 판정 결과 셋

```ts
type CheckCovenantVerdict =
  | { verdict: 'upheld'; advisories: string }
  | { verdict: 'blocked'; reason: string }
  | { verdict: 'unjudged'; reason: string };
```

status `0`은 `upheld`, `2`는 `blocked`, 나머지 status와 시그널은 `unjudged`입니다. 실행 파일 해석,
직렬화, 스폰, 기한 실패도 `unjudged`입니다. 제안한 작업은 `upheld`일 때만 실행합니다. SDK는 stderr를
근거로 status `2`를 재해석하지 않습니다. 순환 참조, BigInt, 유한하지 않은 JSON 수치는 직렬화에
실패합니다.

유효한 stderr 텍스트는 공백을 포함해 보존하고, 잘못된 UTF-8은 대체 디코딩합니다. `advisories`와 차단
응답의 `reason`은 자식의 stderr입니다. 다른 비정상 종료 상태는 stderr가 있으면 이를 쓰고, 없으면
상태 설명을 씁니다. 약속 stdout은 비우지만 판정 결과를 정하지 않습니다. 텔레메트리 행은 CLI가 쓰며
`telemetryPath`로 목적지를 고릅니다.

<a id="change-set"></a>
## `checkChangeSet`

```ts
import { checkChangeSet } from '@polydeukes/sdk-ts';

const verdict = await checkChangeSet({
  repoRoot: '/path/to/project',
  diff,
  executable: '/opt/tools/pdks',
});
if (verdict.verdict !== 'upheld') throw new Error(verdict.reason);
```

diff는 줄바꿈을 보존한 UTF-8로 stdin에 들어갑니다. `a/`와 `b/` 뒤의 경로는 `repoRoot` 기준입니다.
SDK는 git을 실행하지 않습니다. 생산 명령의 형식은 다음처럼 고정합니다.

```sh
git diff --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ HEAD
```

추적하지 않은 파일은 `git add -N`을 해야 나타납니다. SDK의 강제 수준 기본값은 변경 집합 명령을
포함한 두 약속 동사에서 모두 `block`입니다.

<a id="memory"></a>
## `memoryIngest`와 `memorySearch`

```ts
import { memoryIngest, memorySearch } from '@polydeukes/sdk-ts';

const shared = { root: '/path/to/project', executable: '/opt/tools/pdks', timeoutMs: 2000 };
const ingest = await memoryIngest(shared);
if (ingest.outcome === 'unavailable') throw new Error(ingest.reason);
const result = await memorySearch({ ...shared, query: 'session report', limit: 5 });
switch (result.outcome) {
  case 'found':
    console.log(result.hits);
    break;
  case 'empty':
    console.log('일치하는 절 없음');
    break;
  case 'unavailable':
    throw new Error(result.reason);
}
```

`MemoryIngestOutcome`은 `{ outcome: 'ingested' }` 또는
`{ outcome: 'unavailable'; reason: string }`입니다. ingest는 status `0`에서만 성공하며 stdout은
무시합니다. `MemorySearchOutcome`은 비어 있지 않은 `hits` 목록을 가진 `found`, `empty`, 또는
`reason`이 있는 `unavailable`입니다. 검색은 query를 인자 하나로, limit을 `--limit <n>`으로
전달합니다. 기억 stdin은 빈 바이트입니다.

성공한 검색 stdout은 `ingestedAt: string`과 `results`가 있는 엄격한 UTF-8 JSON이어야 합니다. 각
결과에는 `id`, `conceptId`, `docTitle`, `sectionTitle`, `status`(문자열), `stale`(불리언),
`supersededBy`(문자열 배열), `trust`(`human-reviewed`, `machine-verified`, `unverified`),
`matchPath`(`and`, `or`, `like`)가 필요합니다. 객체의 추가 필드는 허용합니다. `MemorySearchResult`는
core의 기억 출력 스키마에서 생성합니다. 순위를 보존하며 유효한 빈 `results` 배열만 `empty`입니다.
잘못된 응답과 실행 실패는 `unavailable`입니다.

<a id="failure"></a>
## 실패와 전환

실행 파일을 쓸 수 없으면 약속 명령은 `unjudged`, 기억 명령은 `unavailable`을 반환합니다. 위 예제처럼
각 갈래를 명시적으로 처리합니다.

npm peer를 설치하던 소비자는 단일 실행 파일 `pdks`를 설치하고 `executable`이나 `PATH`의 절대
디렉터리로 선택합니다. `@polydeukes/core`의 입력 타입 import를 `@polydeukes/sdk-ts`로 옮깁니다. 기존
`CheckCovenantSpawnSpec`은 `SpawnSpec`이 됩니다. 프로세스 경계는 네 동사를 처리하고 stdin, stdout,
stderr를 바이트로 전달합니다.

```ts
type SpawnSpec = {
  command: string;
  args: string[];
  cwd: string;
  stdin: Uint8Array;
  timeoutMs?: number;
};
type SpawnOutcome = { status: number | null; stdout: Uint8Array; stderr: Uint8Array };
type Spawn = (spec: SpawnSpec) => Promise<SpawnOutcome>;
```

stderr는 대체 디코딩하되 stdout은 검색을 해석할 때까지 바이트로 보존합니다. 이름이 `TimeoutError`인
주입 `Error`는 기한 실패 갈래가 되고, 그 밖의 예외도 실패 값이 됩니다.

<a id="limits"></a>
## 선언된 한계

SDK는 CLI 버전을 협상하지 않습니다. SDK가 요구하는 입력 스키마와 기억 열거형을 이해하는 CLI를
사용합니다. 생성한 TypeScript 타입은 전송 형태를 나타내며, shell 목록이 비어 있지 않으면 명령 인자
이름이 필요하다는 의미 제약은 CLI가 검사합니다. 선택한 강제 수준이 작업을 허용하면 `upheld`에도
stderr 조언이 있을 수 있습니다. 기억 결과는 검색 결과이며 작업 허가가 아닙니다.

<a id="see-also"></a>
## 함께 보기

- [Rust SDK](sdk-rust.ko.md)
- [Python SDK](sdk-python.ko.md)
- [`pdks covenant check`](../cli/covenant-check.ko.md)
- [`pdks memory`](../cli/memory.ko.md)
