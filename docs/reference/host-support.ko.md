# 호스트 지원

[English](./host-support.md) · **한국어**

어느 호스트가 어떤 증거를 제공하는지는 이 페이지에만 적습니다. 다른 페이지는 여기를 링크합니다.

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
주 세션에는 주 세션의 호출만 보이며 각 서브에이전트에는 자신의 호출만 보임.
실제 측정: 서브에이전트의 <code>cat</code>은 주 세션의 이력에 없었으며, <code>cat</code>을 실행한
뒤 편집한 서브에이전트는 해당 <code>cat</code>이 포함된 이력으로 판정받았음.
</td>
<td>
주 세션에는 주 세션의 호출만 보이며 각 서브에이전트에는 자신의 호출만 보임.
실제 측정: 주 세션의 편집에는 서브에이전트의 <code>cat</code>이 보이지 않았으며, 서브에이전트
자신의 <code>cat</code>은 자신의 편집을 판정할 때 사용하는 이력에 포함되었음.
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
지원: 사람이 입력한 메시지가 <code>origin.kind: human</code>으로 기록되었고 재시도한 보호 대상
편집은 <code>witnessed</code>였음; <code>claude -p</code> 메시지는 origin 없이 기록되었으며
그 첫 줄의 토큰으로 증인 밸브가 열리지 않았음
</td>
<td>
제공하지 않음: 대화형 세션에서 메시지 첫 줄에 입력한 토큰으로 증인 밸브가 열리지 않았으며
보호 대상 편집은 <code>blocked</code>로 남았음
</td>
<td>
차단된 호출은 차단된 채로 남습니다. 자신의 터미널에서 명령을 실행하세요.
</td>
</tr>
</tbody>
</table>

<a id="confirmation"></a>
## 각 셀의 확인 근거

실제 세션: 해당 호스트의 실제 세션을 실행하고 어댑터 출력이나 판정기의 기록을 읽었습니다.

근거 뒤의 숫자는 해당 세션을 실행한 호스트의 버전입니다.

| 기능                            | Claude Code         | Codex               |
| ------------------------------- | ------------------- | ------------------- |
| [파일 편집](#file-edits)        | 실제 세션 · 2.1.321 | 실제 세션 · 0.167.0 |
| [파일 삭제](#file-deletions)    | 실제 세션 · 2.1.325 | 실제 세션 · 0.167.0 |
| [셸 명령](#shell-commands)      | 실제 세션 · 2.1.321 | 실제 세션 · 0.167.0 |
| [이전 호출](#earlier-calls)     | 실제 세션 · 2.1.321 | 실제 세션 · 0.167.0 |
| [호출 성공 여부](#call-success) | 실제 세션 · 2.1.321 | 실제 세션 · 0.167.0 |
| [이력 범위](#history-scope)     | 실제 세션 · 2.1.325 | 실제 세션 · 0.167.2 |
| [행위자](#actor)                | 실제 세션 · 2.1.325 | 실제 세션 · 0.167.2 |
| [사람 증거](#human-evidence)    | 실제 세션 · 2.1.325 | 실제 세션 · 0.167.2 |

셀은 해당 호스트의 실제 세션을 다시 측정한 뒤에만 바뀝니다.

[Claude Code 어댑터](./packages/adapter-claude-code.ko.md),
[Codex 어댑터](./packages/adapter-codex.ko.md), [표면 연결 안내](../how-to/connect-surfaces.ko.md)
를 참고하세요.
