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

번역에 실패하면 어댑터는 JSON `reason`을 `pdks covenant check --input-failure`에 보냅니다.
그 프로세스가 원래 거부 사유를 한 번 출력하고 `blocked covenant-check` 행 하나를 기록합니다.
훅은 stdout을 비우고 종료 코드 2로 호출을 거부합니다.

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
// 통과하면 0, 거부하면 2를 돌려줍니다. 생성된 훅 위임자가 이 함수를 호출합니다.
const { exitCode } = runHook({ repoRoot: process.cwd() });
```

<a id="code-mode-coverage"></a>
## Code Mode의 버전별 관측 범위

Code Mode의 훅 관측 범위는 CLI 버전에 따라 달라집니다. 2026-10-13 macOS/zsh에서
codex-cli **0.162.1**을 측정할 때는 개발 중인 `code_mode`와 `code_mode_only` 옵션을
명시적으로 켰습니다. 세션 두 개에서 workspace 0.19.0 패키지와 기존에 승인된 훅을 사용해
중첩 호출 세 개를 측정했습니다. `tools.exec_command`, 일반 파일의 동일 내용
`tools.apply_patch`, 보호 설정의 동일 내용 `tools.apply_patch`입니다. 셸 호출은 `Bash`
경로로, 패치는 `apply_patch` 경로로 판정됐습니다. 앞의 두 호출은 판정 행을 남겼고,
보호 패치는 실행 전에 `PreToolUse`에서 거부돼 `blocked self-mod`로 기록됐습니다.

로컬 **0.156.1** 측정에서도 중첩 셸 호출이 관측되고 보호 패치가 차단됐습니다.
**0.154.0** 측정에서는 바깥 `exec`와 중첩 호출 모두 관측되지 않았습니다
([원본 보고와 버전별 후속](https://github.com/huskyhoochu/polydeukes/issues/64)).
바깥 `exec`는 어댑터의 도구 명부 밖에 있으며, 이후 측정도 바깥 `exec`의 훅 페이로드를
확인한 것은 아닙니다. [호스트의 훅 문서](https://learn.chatgpt.com/docs/hooks)는 중첩된
Code Mode 호출에 훅 결정이 적용된다고 설명합니다.

훅을 승인한 뒤 설치된 호스트에서 `.polydeukes/roi.log`의 실제 판정을 확인하세요.
`/hooks`의 Active 표시만으로 관측 범위를 보장하지 않습니다. `pdks-codex init`은
버전별 관측 범위와 확인 방법을 `note:` 줄로 안내합니다.

<a id="limits"></a>
## 이 표면이 관측하지 못하는 것

어댑터의 명부와 호스트의 도구 경로가 다음 한계를 정합니다.

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
