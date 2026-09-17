# `@polydeukes/adapter-codex`

[English](./README.md) · **한국어**

이 어댑터는 Codex 세션 표면의 설치 단위입니다. 안정된 Codex 생명주기 증거를 기록하고,
`PreToolUse` 페이로드를 약속(covenant) 입력 IR로 변환하고, 판정기를 스폰하며, 프로젝트에
세션 표면을 등록하는 `pdks-codex` 실행 파일을 제공합니다.

`polydeukes`와 함께 설치합니다. `polydeukes`는 이 패키지의 `peerDependency`입니다.

```sh
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-codex
npx pdks-codex init
```

등록 파일을 쓰는 것으로 설치가 끝나지 않습니다. Codex는 훅 정의의 해시로 신뢰를 기록하므로,
`/hooks`에서 승인하기 전까지 생성된 훅은 건너뛰어집니다. `init`을 다시 실행해도 같은 명령
문자열을 쓰는 이유가 이것입니다. 문자열이 바뀌면 다시 승인해야 합니다.

이 어댑터를 `@polydeukes/adapter-claude-code`나 `@polydeukes/adapter-grok`과 한 프로젝트에
함께 설치하면 호출마다 판정기가 두 번 실행될 수 있습니다.

<a id="overview"></a>
## 개요

Codex는 훅에 도달하는 모든 파일 편집을 `apply_patch`라는 이름 하나로 정규화하고, 그 입력은
파일 인자가 아니라 패치 텍스트 자체입니다. 이 어댑터는 그 텍스트를 해석해 패치가 건드리는 파일마다 IR
원소 하나를 싣습니다. 그래서 여러 파일에 걸친 패치는 파일별로 판정되고 전체가 함께
차단됩니다. `Edit`과 `Write`는 matcher 별칭일 뿐 호스트가 도구 이름으로 보내지 않으므로,
명부에는 `apply_patch`와 `Bash`가 들어갑니다.

생성된 위임자 하나가 이벤트 넷을 받습니다. `UserPromptSubmit`은 시각을 붙인 사람 메시지를,
`PostToolUse`는 도구 이름과 객체 모양 입력을 추가합니다. `PreToolUse`는 그 증거를 `session`에
싣고, `SessionEnd`는 세션 파일을 지웁니다. 증거는 `.polydeukes/codex-sessions/` 아래에
SHA-256 이름으로 저장되며, 원본 세션 ID는 경로가 되지 않습니다.

공개 계약 심볼은 다음과 같습니다.

- `runHook`
- `COMMAND_ARGS`
- `MUTATING_TOOLS`
- `SHELL_TOOLS`

<a id="examples"></a>
## 예시

```ts
import { runHook } from '@polydeukes/adapter-codex';

// 페이로드를 stdin에서 읽고, repoRoot에서 `pdks covenant check --enforce block`을 스폰한 뒤
// 그 자식 프로세스의 종료 코드를 돌려줍니다. 생성된 훅 위임자가 호출하는 것이 이 함수입니다.
const { exitCode } = runHook({ repoRoot: process.cwd() });
```

<a id="limits"></a>
## 이 표면이 관측하지 못하는 것

첫째는 실제 측정으로 확인한 사항이고 나머지는 호스트 문서가 밝힌 사항입니다. 어떤 어댑터도
이 범위를 좁힐 수 없습니다.

- Code Mode의 `exec` 호출과 그 JavaScript 안에 중첩된 `tools.apply_patch` · `tools.exec_command`
  호출은 codex-cli 0.154에서 `PreToolUse`에 도달하지 않습니다
  ([openai/codex#23411](https://github.com/openai/codex/issues/23411),
  [#38850](https://github.com/openai/codex/issues/38850)). 승인된 훅이 `/hooks`에 Active로
  표시되더라도 그 표면은 관측하지 못합니다.
- 무엇을 판정하는지는 matcher가 아니라 명부가 정합니다. 이 어댑터는 `apply_patch`와 `Bash`만
  번역하고, 그 밖의 이름(Code Mode 이름, MCP 도구, `write_stdin`)은 판정기를 띄우기 전에
  exit 2로 거부합니다. 따라서 `.codex/hooks.json`의 matcher를 그런 이름까지 넓히면 그 아래의
  모든 호출이 판정 대신 차단되고, 그 편집은 신뢰 해시를 바꾸므로 `/hooks`에서 다시 승인하기
  전까지 훅이 건너뛰어집니다.
- `write_stdin`은 이미 `PreToolUse`를 통과한 unified-exec 세션에 입력을 보내며, 그때 다시
  판정되지 않습니다.
- 웹 검색 같은 호스트 제공 도구는 로컬 함수 도구 훅 경로를 지나지 않습니다.
- 페이로드가 지목하는 대화 기록은 안정된 인터페이스가 아니므로, 어떤 판정도 그것을 읽지
  않습니다. 세션 증거는 등록된 생명주기 이벤트에서만 옵니다. `UserPromptSubmit` 증거가
  없거나 저장되지 못하면 증인 재시도로 차단을 풀 수 없으므로, 복구 메시지가 안내하는 사용자
  터미널을 사용합니다.

<a id="see-also"></a>
## 함께 보기

- [`@polydeukes/adapter-codex` 패키지
레퍼런스](../../docs/reference/packages/adapter-codex.md)
- [판정기(`covenant` 모듈)](../../docs/reference/packages/polydeukes.md#covenant-module)
