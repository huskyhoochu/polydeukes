# 호스트 지원

[English](./host-support.md) · **한국어**

어느 호스트가 어떤 증거를 제공하는지는 이 페이지에만 적습니다. 다른 페이지는 여기를 링크합니다.

측정한 버전: Claude Code 2.1.321, Codex 0.167.0.

<a id="capabilities"></a>
## 기능

<table>
<thead>
<tr>
<th>기능</th>
<th>Claude Code</th>
<th>Codex</th>
<th>증거가 없을 때 항목이 기록하는 결과</th>
</tr>
</thead>
<tbody>
<tr>
<td>
<a id="file-edits"></a>
호스트의 파일 도구로 한 편집을 변경 전후 내용으로 판정
</td>
<td>
지원
</td>
<td>
지원: <code>apply_patch</code>로 추가한 파일을 판정함
</td>
<td>
—
</td>
</tr>
<tr>
<td>
<a id="file-deletions"></a>
파일 삭제를 파일 변경으로 보고
</td>
<td>
제공하지 않음: 호스트에 삭제용 파일 도구가 없으며 삭제는 셸 명령임
</td>
<td>
지원: <code>Delete File</code> 패치를 판정함
</td>
<td>
셸 <code>rm &lt;path&gt;</code>는 해당 경로를 범위로 삼는 항목의 행을 남기지 않습니다.
</td>
</tr>
<tr>
<td>
<a id="shell-commands"></a>
셸 명령을 실행하기 전에 명령 텍스트를 판정
</td>
<td>
지원
</td>
<td>
지원
</td>
<td>
—
</td>
</tr>
<tr>
<td>
<a id="earlier-calls"></a>
세션의 이전 도구 호출 제공 (<code>session.toolCalls</code>)
</td>
<td>
지원
</td>
<td>
지원: 셸 호출 세 개를 기록함
</td>
<td>
항목에 <code>skipped</code>와 <code>supply-pass</code>를 기록합니다.
</td>
</tr>
<tr>
<td>
<a id="call-success"></a>
각 이전 호출의 성공 여부 제공 (<code>succeeded</code>)
</td>
<td>
지원: 성공한 호출만 세는 항목이 <code>passed</code>를 기록함
</td>
<td>
제공하지 않음: 성공한 <code>cat</code>과 실패한 <code>false</code> 모두 이 필드 없이 기록됨
</td>
<td>
성공한 이전 호출만 세는 항목은 해당 호출을 찾지 못해 범위 안의 모든 호출에서 위반합니다.
</td>
</tr>
<tr>
<td>
<a id="history-scope"></a>
편집을 판정할 때 사용하는 이전 호출의 주체
</td>
<td>
주 세션에는 주 세션의 호출만 보이며 각 서브에이전트에는 자신의 호출만 보임
</td>
<td>
세션마다 하나의 이력
</td>
<td>
—
</td>
</tr>
<tr>
<td>
<a id="actor"></a>
호출하는 에이전트 (<code>actor.agentType</code>; 주 세션은 <code>{}</code>)
</td>
<td>
지원: 서브에이전트 유형 이름을 권고 행의 증거로 기록함
</td>
<td>
제공하지 않음
</td>
<td>
항목에 <code>skipped</code>와 <code>supply-pass</code>를 기록합니다.
</td>
</tr>
<tr>
<td>
<a id="human-evidence"></a>
증인 토큰으로 차단된 호출을 열 수 있는 사람의 메시지
</td>
<td>
지원
</td>
<td>
제공하지 않음; 프롬프트는 사람 증거가 아님
</td>
<td>
차단된 호출은 차단된 채로 남습니다. 자신의 터미널에서 명령을 실행하세요.
</td>
</tr>
</tbody>
</table>

<a id="confirmation"></a>
## 각 셀의 확인 근거

실제 세션: 해당 호스트의 실제 세션을 실행하고 어댑터 출력이나 판정기의 기록을 읽었습니다. 어댑터
소스: 실제 세션에서 실행하지 않고 어댑터 소스와 테스트 사례를 읽었습니다.

| 기능                            | Claude Code | Codex       |
| ------------------------------- | ----------- | ----------- |
| [파일 편집](#file-edits)        | 실제 세션   | 실제 세션   |
| [파일 삭제](#file-deletions)    | 어댑터 소스 | 실제 세션   |
| [셸 명령](#shell-commands)      | 실제 세션   | 실제 세션   |
| [이전 호출](#earlier-calls)     | 실제 세션   | 실제 세션   |
| [호출 성공 여부](#call-success) | 실제 세션   | 실제 세션   |
| [이력 범위](#history-scope)     | 어댑터 소스 | 어댑터 소스 |
| [행위자](#actor)                | 실제 세션   | 어댑터 소스 |
| [사람 증거](#human-evidence)    | 어댑터 소스 | 어댑터 소스 |

셀은 해당 호스트의 실제 세션을 다시 측정한 뒤에만 바뀝니다.

[Claude Code 어댑터](./packages/adapter-claude-code.ko.md),
[Codex 어댑터](./packages/adapter-codex.ko.md), [표면 연결 안내](../how-to/connect-surfaces.ko.md)
를 참고하세요.
