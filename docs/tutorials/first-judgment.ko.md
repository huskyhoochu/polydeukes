# 설치하고 첫 판정 확인하기

[English](./first-judgment.md) · **한국어**

빈 예제 프로젝트에서 보호된 쓰기와 일반 쓰기의 판정 결과를 확인합니다. 설치한 단일 `pdks`를 PATH에
두세요. 별도 Node·npm은 필요하지 않습니다. 실제 세션 관측에는 Claude Code가 필요하지만 아래 직접
확인 명령에는 필요하지 않습니다.

<a id="claude-code"></a>

## 클로드 코드 연동 설치와 첫 쓰기 요청 검사

기존에 보호 중인 프로젝트 밖에서, 자신의 터미널로 다음 명령을 실행합니다.

```sh
mkdir pdks-example
cd pdks-example
git init
pdks adapter claude-code init
```

설치기는 초기 설정·`.claude/settings.json` 등록·문서 안내·`discipline-draft` 스킬·telemetry ignore
항목을 만듭니다. 기존 설정과 다른 handler를 보존합니다. 아래 명령으로 설정 파일 쓰기를 관측해
봅니다.

```sh
printf '%s\n' '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":".claude/settings.json","content":"{}"}}' \
  | pdks adapter claude-code hook --project-root "$PWD"
printf 'exit=%s\n' "$?"
tail -n 5 .polydeukes/roi.log
```

예상 결과는 `exit=2`입니다. stderr에는 보호 경로를 지목한 메시지가 나오고, 로그에는 `blocked` 행이
남습니다. 이 명령은 판정만 요청하며 **실제로 파일을 쓰지 않습니다**. 설정 파일은 그대로이므로 되돌릴
변경도 없습니다.

이번에는 보호 목록 밖의 경로로 같은 검사를 합니다.

```sh
printf '%s\n' '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"example.txt","content":"hello"}}' \
  | pdks adapter claude-code hook --project-root "$PWD"
printf 'exit=%s\n' "$?"
tail -n 5 .polydeukes/roi.log
```

초기 설정에서는 `exit=0`과 `passed` 행이 나와야 합니다. 이 명령도 파일을 쓰지는 않습니다. 설치된
판정기로 차단할 요청과 허용할 요청을 각각 확인한 것입니다.

실제 도구 호출에 훅을 적용하려면 이 프로젝트에서 Claude Code를 엽니다. 일반 텍스트 파일을 만들도록
요청한 뒤 `.polydeukes/roi.log`에 새 행이 생기는지 확인합니다. 앞의 직접 호출 검사만으로는 특정
호스트 세션이 훅 등록을 읽었다고 판단할 수 없습니다.

**처음 설정을 바꾸기 전에 확인하세요.** 로더는 발견한 설정 파일을 자동으로 보호합니다.
`protectedPaths`에 파일명이 없어도 같습니다. 세션에서 의도적으로 편집하려면 `witness.token`을 읽고,
사람이 직접 메시지 첫 줄에 그 토큰만 입력합니다. 초기 토큰은 `pdks witness`이며 유효 시간은
10분입니다. 증인(witness) 밸브는 판정기가 차단한 결과에만 적용됩니다. 에이전트가 사람을 대신해
메시지를 공급할 수는 없습니다. 자신의 터미널에서 의도한 설정 변경을 직접 수행해도 됩니다.

패키지나 설정을 읽지 못해 검사가 실패하면 자신의 터미널에서 지목된 파일을 고치거나 패키지를 다시
설치합니다. 밸브를 조립하는 단계에 이르기 전에 발생한 오류는 증인으로 해결할 수 없습니다.
[설정 오류](../troubleshooting.ko.md#invalid-config)와
[판정기 로드 실패](../troubleshooting.ko.md#judge-cannot-be-loaded)를 참고하세요.

<a id="next-step"></a>

## 실제 프로젝트에 적용하기

- [프로젝트 설정](../how-to/configure-project.ko.md)에서 위반을 권고로 둘지 차단할지 정합니다.
- Grok, Codex, git pre-commit 훅은 [관측 표면 연결](../how-to/connect-surfaces.ko.md)을 참고합니다.
- [규율 작성](../how-to/write-disciplines.ko.md) 예제를 실행하고, 권고 결과를 확인한 뒤 차단 여부를
  결정합니다.

종료 코드만으로 모든 관측 결과를 알 수는 없습니다. `advised`나 `skipped`가 있어도 exit 0일 수
있습니다. 진단 메시지와 [판정 결과 어휘](../troubleshooting.ko.md#reading-verdict)를 함께
확인하세요.
