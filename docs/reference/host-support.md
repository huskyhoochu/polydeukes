# Host support

**English** · [한국어](./host-support.ko.md)

This is the only page that says which host supplies which evidence. Other pages link here.

<a id="capabilities"></a>
## Capabilities

<table>
<thead>
<tr>
<th>Capability</th>
<th>Claude Code</th>
<th>Codex</th>
<th>What an entry records without it</th>
</tr>
</thead>
<tbody>
<tr>
<td>
<a id="file-edits"></a>
An edit made with the host's file tools is judged with its before and after content
</td>
<td>
Supported
</td>
<td>
Supported: a file added with <code>apply_patch</code> was judged
</td>
<td>
—
</td>
</tr>
<tr>
<td>
<a id="file-deletions"></a>
A file deletion is reported as a file change
</td>
<td>
Not supplied: the host has no file tool that deletes; a deletion is a shell command
</td>
<td>
Supported: a <code>Delete File</code> patch was judged
</td>
<td>
A shell <code>rm &lt;path&gt;</code> leaves no row for an entry scoped to that path.
</td>
</tr>
<tr>
<td>
<a id="shell-commands"></a>
The text of a shell command is judged before it runs
</td>
<td>
Supported
</td>
<td>
Supported
</td>
<td>
—
</td>
</tr>
<tr>
<td>
<a id="earlier-calls"></a>
Earlier tool calls of the session are supplied (<code>session.toolCalls</code>)
</td>
<td>
Supported
</td>
<td>
Supported: three shell calls were recorded
</td>
<td>
The entry is recorded <code>skipped</code> with <code>supply-pass</code>.
</td>
</tr>
<tr>
<td>
<a id="call-success"></a>
Each earlier call carries whether it succeeded (<code>succeeded</code>)
</td>
<td>
Supported: entries that count only successful calls record <code>passed</code>
</td>
<td>
Not supplied: a successful <code>cat</code> and a failing <code>false</code> were both recorded
without the field
</td>
<td>
An entry that counts only successful earlier calls finds none and breaks on every call in scope.
</td>
</tr>
<tr>
<td>
<a id="history-scope"></a>
Whose earlier calls an edit is judged against
</td>
<td>
The main session sees the main session's calls and each subagent sees only its own.
Measured: a subagent's <code>cat</code> was absent from the main session's history; a subagent
that ran <code>cat</code> and then edited was judged with that <code>cat</code> in its history.
</td>
<td>
The main session sees the main session's calls and each subagent sees only its own.
Measured: the main session's edit did not see the subagent's <code>cat</code>; a subagent's own
<code>cat</code> was in the history of its own edit.
</td>
<td>
—
</td>
</tr>
<tr>
<td>
<a id="actor"></a>
Which agent makes the call (<code>actor.agentType</code>; <code>{}</code> for the main session)
</td>
<td>
Supported: a subagent's type name was recorded as the witness of an advised row
</td>
<td>
Not supplied
</td>
<td>
The entry is recorded <code>skipped</code> with <code>supply-pass</code>.
</td>
</tr>
<tr>
<td>
<a id="human-evidence"></a>
Human messages that can open a blocked call with the witness token
</td>
<td>
Supported: a message the person typed was recorded with <code>origin.kind: human</code> and the
retried protected edit was <code>witnessed</code>; a <code>claude -p</code> message was recorded
without an origin, and the token on its first line did not open the valve
</td>
<td>
Not supplied: the token typed as the first line of a message in an interactive session did not
open the valve; the protected edit stayed <code>blocked</code>
</td>
<td>
A blocked call stays blocked; run the command from your own terminal.
</td>
</tr>
</tbody>
</table>

<a id="confirmation"></a>
## How each cell was confirmed

Live session: a real session of that host was run and the adapter's output or the judge's records
were read.

The number after the basis is the host version that session ran.

| Capability                        | Claude Code            | Codex                  |
| --------------------------------- | ---------------------- | ---------------------- |
| [file edits](#file-edits)         | live session · 2.1.321 | live session · 0.167.0 |
| [file deletions](#file-deletions) | live session · 2.1.325 | live session · 0.167.0 |
| [shell commands](#shell-commands) | live session · 2.1.321 | live session · 0.167.0 |
| [earlier calls](#earlier-calls)   | live session · 2.1.321 | live session · 0.167.0 |
| [call success](#call-success)     | live session · 2.1.321 | live session · 0.167.0 |
| [history scope](#history-scope)   | live session · 2.1.325 | live session · 0.167.2 |
| [actor](#actor)                   | live session · 2.1.325 | live session · 0.167.2 |
| [human evidence](#human-evidence) | live session · 2.1.325 | live session · 0.167.2 |

A cell changes only after a live session of that host is measured again.

See the [Claude Code adapter](./packages/adapter-claude-code.md),
[Codex adapter](./packages/adapter-codex.md), and
[connect-surfaces guide](../how-to/connect-surfaces.md).
