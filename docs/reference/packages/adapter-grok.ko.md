# `@polydeukes/adapter-grok`

[English](adapter-grok.md) · **한국어**

> **Grok의 설치 단위**입니다. PreToolUse 페이로드가 약속(covenant) 입력 IR이 되고,
> 판정기가 읽는 파일 변경 증거가 함께 실립니다. 세션 표면을 프로젝트에 설치하는 것도 이
> 패키지가 합니다.
>
> 알파입니다. `polydeukes`와 함께 설치하며, `polydeukes`는 이 패키지의 `peerDependency`입니다.

<a id="ownership"></a>
## 담당하는 기능

Grok의 입력을 공통 형식으로 번역합니다. 에이전트와 도구의 구체적인 이름은 이 패키지에서
처리하고 코어에는 넣지 않습니다.

| 단위 | 하는 일 |
|---|---|
| `pdks-grok` 실행 파일 | 하위 명령 하나 `pdks-grok init`으로 프로젝트에 세션 표면을 등록합니다 |
| `runHook` | PreToolUse 페이로드 하나를 입력 IR로 바꾸고 판정기를 스폰합니다 |
| 페이로드 상향 번역 | 원본 PreToolUse 페이로드가 `CovenantInput`이 됩니다 |
| 예상 변경 후 상태 | 쓰기나 치환이 적용되면 파일이 무엇을 담을지 디스크를 건드리지 않고 계산합니다 |
| 파일 변경 증거 | 디스크의 변경 전 상태와 예상 변경 후 상태를 짝지어 변경 증거를 만듭니다 |

생성된 훅 위임자가 불러오는 것이 `runHook({ repoRoot })`입니다. `tools` 명부를 실은 입력 IR을
만든 뒤 — `session`과 `actor` 키는 없습니다 — `repoRoot`에서
`pdks covenant check --enforce block`을 스폰하고 그 자식 프로세스의 종료 코드를 그대로
돌려줍니다. 판정은 그 자식 프로세스가 하며, 이 패키지에는 판정 코드가 없습니다.

**이 패키지는 텔레메트리 행을 쓰지 않습니다.** 스폰 전에 실패하면 그 사실을 한 줄로 만들어
`pdks`의 표준 입력으로 보내고, `pdks`가 fail-closed 행을 기록합니다. 호출 하나에 행 하나는
그대로입니다. 판정기를 불러오지도 않습니다. `polydeukes`와 `@polydeukes/core` 모두
`peerDependencies`이므로 어휘와 판정기를 공유할 뿐 사본을 따로 설치하지 않습니다.

이 어댑터가 IR에 실는 명부는 Grok 원어입니다. `write`와 `search_replace`는 파일을 바꾸고,
`run_terminal_command`는 셸 한 줄을 실습니다.

<a id="consumer-contract"></a>
## 소비자가 닿는 곳

프로젝트 루트에서 두 줄이면 Grok 세션 표면이 설치됩니다.

```sh
npm install --save-dev polydeukes @polydeukes/adapter-grok
npx pdks-grok init
```

`pdks-grok init`은 프로젝트에서 `polydeukes`를 찾고, 에이전트와 무관한 초기 파일을 위해
`pdks init`을 스폰한 뒤, Grok 산출물 둘을 덮어쓰지 않고 씁니다. 다시 실행하면 이미 있는
산출물은 `skipped`로 보고하고 내용을 바꾸지 않습니다. 산출물 목록은
[`pdks init`](../cli/init.ko.md#init-grok)에 있습니다.

이 어댑터와 `@polydeukes/adapter-claude-code`를 한 프로젝트에 함께 설치하면 호출마다
판정기가 두 번 실행될 수 있습니다.

- **생성된 훅**은 이 패키지의 `runHook`을 불러옵니다. 패키지를 올리면 실행되는 코드가
  올라가고, 훅 파일 자체는 바뀌지 않습니다.

자체 설정 네임스페이스는 없습니다.

<a id="limits"></a>
## 선언된 한계

- **자식 프로세스의 쓰기는 관측 밖입니다.** 이 표면은 *선언된 도구 호출*을 판정합니다. 파일을
  쓰는 프로세스를 띄우는 명령은 그 명령 줄로 판정되며, 자식이 한 일로 판정되지 않습니다.
- **증거는 변경 후 상태를 계산할 수 있을 때만 있습니다.** `write`와 `search_replace`가 하나를
  만듭니다. 치환이 한 번도 맞지 않거나, `replace_all` 없이 두 번 이상 맞으면 증거가 없습니다.
  호스트 도구가 그 호출을 거부하기 때문입니다.
- **증거 없는 호출은 보수적으로 판정합니다.** 증명된 대상이 없으므로 호출 인자에 보호 경로가
  언급됐는지 대조합니다.
- **대화 기록(transcript) 통로가 없습니다.** IR은 `session`과 `actor`를 생략합니다. Grok의
  ACP 대화 기록은 세션 증인(witness) 밸브가 필요로 하는 인간 메시지 증거를 공급하지 않습니다.
  의도한 편집이 차단되면 본인 터미널에서 수행하세요.
- **`polydeukes`를 찾지 못하면 행이 남지 않습니다.** 프로젝트에서 우산 패키지를 찾지 못하면
  스폰할 프로세스도, 기록할 로그 경로도 없습니다. 훅은 stderr에 한 줄을 남기고 종료 코드
  `2`를 내며 텔레메트리 로그에는 아무것도 추가되지 않습니다. 스폰 전 실패 가운데 이 경우만
  그렇고, 나머지는 모두 `pdks`에 도달해 행을 남깁니다.
