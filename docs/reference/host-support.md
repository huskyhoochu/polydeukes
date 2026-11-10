# Host support

**English** · [한국어](./host-support.ko.md)

This is the only page that says which host supplies which evidence. Other pages link here.

Versions measured: Claude Code 2.1.321, Codex 0.167.0.

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
The main session sees the main session's calls and each subagent sees only its own
</td>
<td>
One history per session
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
Supported
</td>
<td>
Not supplied; prompts are not human evidence
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
were read. Adapter source: read from the adapter's source and its test cases, not run in a live
session.

| Capability                        | Claude Code    | Codex          |
| --------------------------------- | -------------- | -------------- |
| [file edits](#file-edits)         | live session   | live session   |
| [file deletions](#file-deletions) | adapter source | live session   |
| [shell commands](#shell-commands) | live session   | live session   |
| [earlier calls](#earlier-calls)   | live session   | live session   |
| [call success](#call-success)     | live session   | live session   |
| [history scope](#history-scope)   | adapter source | adapter source |
| [actor](#actor)                   | live session   | adapter source |
| [human evidence](#human-evidence) | adapter source | adapter source |

A cell changes only after a live session of that host is measured again.

See the [Claude Code adapter](./packages/adapter-claude-code.md),
[Codex adapter](./packages/adapter-codex.md), and
[connect-surfaces guide](../how-to/connect-surfaces.md).
