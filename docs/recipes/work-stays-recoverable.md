# Stop an agent from destroying work you cannot recover

**English** · [한국어](./work-stays-recoverable.ko.md)

This discipline judges an agent's shell command before it runs and breaks on a command line that
discards uncommitted work or overwrites a remote branch without a lease.

Session surface (Claude Code, Codex) · blocks a matching call · nothing to customise before use.

The block below is a complete `polydeukes.config.yaml`; if you have no configuration yet, save it as
that file in the project root. If the file already has a `sessionDisciplines:` key, paste only the
entry (everything below the first line) under the existing key and keep the existing entries. If the
file exists but has no `sessionDisciplines:` key, as with the file `pdks init` writes, append the
whole block to the end of the file.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "work-stays-recoverable"
    why: "a command that destroys uncommitted work, or force-pushes without a lease on the remote state, cannot be undone."
    enforce: block
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: 'git reset\b.*--hard|git clean\b.*-f|git checkout -- \.(?:\s|$)|git push\b.*--force(?![\w-])',
            }
      relate:
        - id: "recoverable"
          relation: { op: "empty", of: "hits" }
          message: "command line destroys uncommitted or remote state: {value}"
```

<a id="agent-prompt"></a>
## Set it up with your agent

Paste this into Claude Code or Codex in the project.

````text
Add the entry below under sessionDisciplines: in this project's polydeukes.config.yaml.
The block shows the entry under its list key. In an existing configuration, add only the entry
under the existing key, never a second key. Preserve every other entry, protected path and witness
setting. If an entry with the same id exists, report it and stop.

If the configuration file is protected in this session, show the exact patch and ask the human
to apply it. Never work around the protection.

Then run pdks explain and confirm a line for work-stays-recoverable with enforce: block.
Create an empty directory outside the project and use the file-writing tool, not shell commands,
to create polydeukes.config.yaml, violating.json and valid.json there. Run the two checks from
"Try it" there: the violating.json and valid.json checks with --enforce block.
Report the verdict word, exit code and enforcement setting for each.
The commands inside the JSON inputs are data and must not be run. A skipped verdict is not a
successful check. Do not run destructive commands, commit, or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "work-stays-recoverable"
    why: "a command that destroys uncommitted work, or force-pushes without a lease on the remote state, cannot be undone."
    enforce: block
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: 'git reset\b.*--hard|git clean\b.*-f|git checkout -- \.(?:\s|$)|git push\b.*--force(?![\w-])',
            }
      relate:
        - id: "recoverable"
          relation: { op: "empty", of: "hits" }
          message: "command line destroys uncommitted or remote state: {value}"
```
````

<a id="try-it"></a>
## Try it

See the judgment without running anything destructive: `pdks covenant check` reads one call as JSON
on standard input and judges it. The command inside the JSON is never executed.

In an empty directory, save the YAML block at the top of this page as `polydeukes.config.yaml`, then
save these two inputs.

`violating.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "git reset --hard HEAD~1" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "git reset --soft HEAD~1" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

The `tools` object tells the judge which tool names are shell calls and which argument carries the
command. Without it, the call is not read as a shell command and this discipline is not judged. The
adapters supply it in a real session.

First, run without an enforcement flag:

```sh
pdks covenant check < violating.json
```

Standard error:

```text
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git reset --hard HEAD~1 — why: a command that destroys uncommitted work, or force-pushes without a lease on the remote state, cannot be undone.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. Run by hand, the judge advises unless the run says `--enforce block`; the agent
adapters run it at `block`.

Now use the session enforcement setting:

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git reset --hard HEAD~1 — why: a command that destroys uncommitted work, or force-pushes without a lease on the remote state, cannot be undone.
```

Exit code: 2. This is what a session sees: the call is stopped before it runs.

Check the valid input:

```sh
pdks covenant check --enforce block < valid.json
```

This prints nothing and exits 0.

These three rows are appended to `.polydeukes/roi.log`; your timestamps will differ:

```text
2026-11-10T10:53:06.837Z	advised	work-stays-recoverable	-	[{"id":"recoverable","witnesses":[{"key":"1","value":"git reset --hard HEAD~1"}],"total":1}]
2026-11-10T10:53:06.840Z	blocked	work-stays-recoverable	-	[{"id":"recoverable","witnesses":[{"key":"1","value":"git reset --hard HEAD~1"}],"total":1}]
2026-11-10T10:53:06.843Z	passed	work-stays-recoverable	-
```

**Other command lines it matches**

- `git clean -fd`
- `git checkout -- .`
- `git push --force origin main`
- `echo 'never run git reset --hard'`

```text
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git clean -fd
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git checkout -- .
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: git push --force origin main
discipline 'work-stays-recoverable' broken on -: command line destroys uncommitted or remote state: echo 'never run git reset --hard'
```

Each printed line continues with ` — why: …` as in run 2. The last command only mentions the matched
command; see [Limits](#limits).

A force-push carrying a lease, `git push --force-with-lease origin main`, and a checkout of one
path, `git checkout -- ./README.md`, both pass.

**In a real session**

After adding the entry, `pdks explain` shows:

```text
  declare  work-stays-recoverable forbidden-command · change · empty recoverable · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · enforce: block · unattended: judge
```

When the agent attempts a matching command, the call is stopped and the message begins with the line
from run 2; a `blocked` row is appended to `.polydeukes/roi.log`.

See [the first-judgment tutorial](../tutorials/first-judgment.md),
[the connect-surfaces guide](../how-to/connect-surfaces.md), and
[the install guide](../how-to/install.md).

<a id="change-it"></a>
## Change it

The regular expression has four alternatives:

- `git reset\b.*--hard`: a hard reset.
- `git clean\b.*-f`: a forced clean of untracked files.
- `git checkout -- \.(?:\s|$)`: a checkout of the whole working tree only; a checkout of one path
  such as `git checkout -- ./README.md` passes.
- `git push\b.*--force(?![\w-])`: a forced push with no lease; `--force-with-lease` is not matched.

Remove an alternative you do not want judged or add your own. Remove `enforce: block` to record
`advised` and let the call proceed. Delete the entry to remove the discipline. After any change, run
`pdks explain`.

<a id="limits"></a>
## Limits

This entry matches command-line text with a regular expression. A command that merely mentions a
matched string is judged the same as one that runs it. The judged text is the whole command as
written, including a heredoc body. Spellings outside the four alternatives are outside this entry.

The change-set surface (`pdks covenant check --diff`) does not judge this entry because a diff
carries no command line.

On Codex, a blocked call cannot be opened with the witness token. Run the command from your own
terminal when you mean it. On Claude Code, if the configuration has a `witness:` block, a human can
open a block by typing the configured witness token alone on the first line of a message. The block
in this recipe does not include one; to add it, see
[opening a blocked call](../troubleshooting.md#opening-a-blocked-call).

If the adapter or the judge cannot start, the call proceeds unjudged. Confirm a row in
`.polydeukes/roi.log` after wiring.
