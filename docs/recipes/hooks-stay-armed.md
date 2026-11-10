# Stop an agent from skipping your Git commit hook

**English** · [한국어](./hooks-stay-armed.ko.md)

This applies when your repository has a commit hook. This discipline checks an agent's command line
for Git's commit-hook skip options and hook-location setting before the command runs.

Session surface · reads the command text · blocks matching calls · requires an installed commit hook
· no values to change. Host support: [shell commands](../reference/host-support.md#shell-commands).

The block below is a complete `polydeukes.config.yaml`; if you have no configuration yet, save it as
that file in the project root. If the file already has a `sessionDisciplines:` key, paste only the
entry (everything below the first line) under the existing key and keep the existing entries. If the
file exists but has no `sessionDisciplines:` key, as with the file `pdks init` writes, append the
whole block to the end of the file.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "hooks-stay-armed"
    why: "a repository with a commit hook relies on that hook running; skipping it or changing its location can omit the checks."
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
              re: 'git\b[^|;&]*\bcommit\b[^|;&]*\s(--no-verify\b|-[a-zA-Z]*n)|(?i:core\.hooksPath)',
            }
      relate:
        - id: "hook-runs"
          relation: { op: "empty", of: "hits" }
          message: "command line skips or changes a commit hook: {value}"
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

Then run pdks explain and confirm a line for hooks-stay-armed with enforce: block.
Create an empty directory outside the project and use the file-writing tool, not shell commands,
to create polydeukes.config.yaml, violating.json and valid.json there. Run the two checks from
"Try it" there: the violating.json and valid.json checks with --enforce block.
Report the verdict word, exit code and enforcement setting for each.
Confirm the rows for hooks-stay-armed in .polydeukes/roi.log.
The commands inside the JSON inputs are data and must not be run. A skipped verdict is not a
successful check. Do not run destructive commands, commit, or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "hooks-stay-armed"
    why: "a repository with a commit hook relies on that hook running; skipping it or changing its location can omit the checks."
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
              re: 'git\b[^|;&]*\bcommit\b[^|;&]*\s(--no-verify\b|-[a-zA-Z]*n)|(?i:core\.hooksPath)',
            }
      relate:
        - id: "hook-runs"
          relation: { op: "empty", of: "hits" }
          message: "command line skips or changes a commit hook: {value}"
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
  "toolCalls": [{ "name": "Bash", "args": { "command": "git commit --no-verify -m example" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "git commit -m example" } }],
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
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit --no-verify -m example — why: a repository with a commit hook relies on that hook running; skipping it or changing its location can omit the checks.
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
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit --no-verify -m example — why: a repository with a commit hook relies on that hook running; skipping it or changing its location can omit the checks.
```

Exit code: 2. This is what a session sees: the call is stopped before it runs.

Check the valid input:

```sh
pdks covenant check --enforce block < valid.json
```

This prints nothing and exits 0.

These three rows are appended to `.polydeukes/roi.log`; your timestamps will differ:

```text
2026-11-10T14:20:38.338Z	advised	hooks-stay-armed	-	[{"id":"hook-runs","witnesses":[{"key":"1","value":"git commit --no-verify -m example"}],"total":1}]
2026-11-10T14:20:38.341Z	blocked	hooks-stay-armed	-	[{"id":"hook-runs","witnesses":[{"key":"1","value":"git commit --no-verify -m example"}],"total":1}]
2026-11-10T14:20:38.344Z	passed	hooks-stay-armed	-
```

**Other command lines it matches**

- `git commit -anm example`
- `git config core.hooksPath .nohooks`
- `git config core.hookspath .nohooks`
- `git -c core.hooksPath=/dev/null commit -m example`
- `echo 'git commit --no-verify'`
- `git commit -n -m example`

A heredoc body is read too. The same body under an unquoted delimiter (`cat <<EOF`) also blocks with
the same diagnostic line.

```text
cat <<'EOF'
git commit --no-verify
EOF
```

```text
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit -anm example
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit --no-verify
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git config core.hooksPath .nohooks
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git config core.hookspath .nohooks
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git -c core.hooksPath=/dev/null commit -m example
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: echo 'git commit --no-verify'
discipline 'hooks-stay-armed' broken on -: command line skips or changes a commit hook: git commit -n -m example
```

Each diagnostic continues with ` — why: …` as in run 2. These inputs block at exit 2.

`git commit --no-gpg-sign -m example`, `git push --no-verify`, and
`git commit -m example && git log -n 1` pass. Disabling commit signing is not a commit-hook skip.
Creating `notes.txt` with the text `git commit --no-verify -m example`, or submitting a diff that
changes `old` to `new` in that file, exits 0 with a generic `passed covenant-check` row; neither
judges this entry.

**In a real session**

After adding the entry, `pdks explain` shows:

```text
  declare  hooks-stay-armed  forbidden-command · change · empty hook-runs · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · enforce: block · unattended: judge
```

When the agent attempts a matching command, the call is stopped and the message begins with the line
from run 2; a `blocked` row is appended to `.polydeukes/roi.log`.

See [the first-judgment tutorial](../tutorials/first-judgment.md),
[the connect-surfaces guide](../how-to/connect-surfaces.md), and
[the install guide](../how-to/install.md).

<a id="change-it"></a>
## Change it

The regular expression has three alternatives:

- `--no-verify\b` after `git` and `commit`: the long commit-hook skip option.
- `-[a-zA-Z]*n` in the same position: a short-option token after a space containing `n`, such as
  `-n` or `-anm`. `git commit -uno -m example` also blocks even though `-uno` is not a hook skip; a
  commit message containing such a token matches too.
- `(?i:core\.hooksPath)`: any mention of the hook-location setting in any letter case, including a
  configuration command or a per-command override. Git reads configuration keys without regard to
  case.

The skip-option alternatives stop at `|`, `;`, or `&`, so options of a later command do not match.

Remove either skip-option alternative and its separating `|` inside the parentheses to stop judging
that form. Remove `|(?i:core\.hooksPath)` to stop judging the location setting. Nothing needs
changing before use. For hook-tool options, see
[judging the off-switch](../how-to/git-hooks.md#judge-the-off-switch).

Remove `enforce: block` to record `advised` and let the call proceed. Delete the entry to remove the
discipline. After any change, run `pdks explain`.

<a id="limits"></a>
## Limits

This entry matches command-line text with a regular expression. `echo 'git commit --no-verify'`
blocks even though it only prints an example. The `cat <<'EOF'` command shown above blocks too: its
heredoc body contains `git commit --no-verify`. A commit message containing a short-option token
with `n` after a space also matches. `git commit -uno -m example` blocks even though `-uno` is not a
hook skip.

The skip-option alternatives do not read past `|`, `;`, or `&`. A skip option after one of those
characters within the same commit command, for example after a commit message containing `;`, is not
matched.

`git push --no-verify` passes: this entry checks the commit skip options.
`git config core.hooksPath .nohooks` and `git -c core.hooksPath=/dev/null commit -m example` block;
the pattern also matches a read-only query or a legitimate configuration containing
`core.hooksPath`. It is not a Git argument parser: text between `git` and `commit` can match. It
does not establish that a hook exists or which checks it runs.

The change-set surface (`pdks covenant check --diff`) does not judge this entry because a diff
carries no command line.

A blocked call can be opened with the witness token only where the host supplies human evidence; see
[human evidence](../reference/host-support.md#human-evidence). Otherwise run the command from your
own terminal. If the configuration has a `witness:` block, a human can open a block by typing the
configured witness token alone on the first line of a message. The block in this recipe does not
include one; to add it, see [opening a blocked call](../troubleshooting.md#opening-a-blocked-call).

The adapter must observe the call through a configured shell tool. Other host tools are not
automatically covered. The JSON examples exercise the judge, not host delivery. Without the `tools`
mapping, the call yields only a generic fallback pass, not a judgment of this entry.

If the adapter or the judge cannot start, the call proceeds unjudged. Confirm a row in
`.polydeukes/roi.log` after wiring.
