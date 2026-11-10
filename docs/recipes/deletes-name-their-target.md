# Stop an agent from deleting a whole directory with rm

**English** · [한국어](./deletes-name-their-target.ko.md)

This discipline judges an agent's Unix shell command before it runs and breaks on the listed broad
target spellings for rm: the root, home, current or parent directory, or every entry in a directory.

Session surface (Claude Code, Codex) · blocks matching calls · Unix shell command text · no values
to change.

The block below is a complete `polydeukes.config.yaml`; if you have no configuration yet, save it as
that file in the project root. If the file already has a `sessionDisciplines:` key, paste only the
entry (everything below the first line) under the existing key and keep the existing entries. If the
file exists but has no `sessionDisciplines:` key, as with the file `pdks init` writes, append the
whole block to the end of the file.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "deletes-name-their-target"
    why: "deleting the root, home, current or parent directory, or every entry in a directory, can remove unrelated work."
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
              re: '(?:^|[;&|(\x60\x22\x27]|\$\()\s*(?:(?:sudo|exec|nohup|env|xargs|command|time)\s+(?:-\S+\s+)*)*rm\s+(?:[^\s;&|]+\s+)*?(?:/|/\*|~|~/|~/\*|\$\{?HOME\}?/?\*?|\.|\./|\./\*|\.\.|\.\./|\*)(?=\s|$|[;&|)\x22\x27])',
            }
      relate:
        - id: "none-wholesale"
          relation: { op: "empty", of: "hits" }
          message: "command line deletes a broad target: {value}"
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

Then run pdks explain and confirm a line for deletes-name-their-target with enforce: block.
Create an empty directory outside the project and use the file-writing tool, not shell commands,
to create polydeukes.config.yaml, violating.json and valid.json there. Run the two checks from
"Try it" there: the violating.json and valid.json checks with --enforce block.
Report the verdict word, exit code and enforcement setting for each.
Confirm the rows for deletes-name-their-target in .polydeukes/roi.log.
The commands inside the JSON inputs are data and must not be run. A skipped verdict is not a
successful check. Do not run destructive commands, commit, or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "deletes-name-their-target"
    why: "deleting the root, home, current or parent directory, or every entry in a directory, can remove unrelated work."
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
              re: '(?:^|[;&|(\x60\x22\x27]|\$\()\s*(?:(?:sudo|exec|nohup|env|xargs|command|time)\s+(?:-\S+\s+)*)*rm\s+(?:[^\s;&|]+\s+)*?(?:/|/\*|~|~/|~/\*|\$\{?HOME\}?/?\*?|\.|\./|\./\*|\.\.|\.\./|\*)(?=\s|$|[;&|)\x22\x27])',
            }
      relate:
        - id: "none-wholesale"
          relation: { op: "empty", of: "hits" }
          message: "command line deletes a broad target: {value}"
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
  "toolCalls": [{ "name": "Bash", "args": { "command": "rm -rf /" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "rm -rf build/cache" } }],
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
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf / — why: deleting the root, home, current or parent directory, or every entry in a directory, can remove unrelated work.
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
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf / — why: deleting the root, home, current or parent directory, or every entry in a directory, can remove unrelated work.
```

Exit code: 2. This is what a session sees: the call is stopped before it runs.

Check the valid input:

```sh
pdks covenant check --enforce block < valid.json
```

This prints nothing and exits 0.

These three rows are appended to `.polydeukes/roi.log`; your timestamps will differ:

```text
2026-11-10T14:20:38.381Z	advised	deletes-name-their-target	-	[{"id":"none-wholesale","witnesses":[{"key":"1","value":"rm -rf /"}],"total":1}]
2026-11-10T14:20:38.384Z	blocked	deletes-name-their-target	-	[{"id":"none-wholesale","witnesses":[{"key":"1","value":"rm -rf /"}],"total":1}]
2026-11-10T14:20:38.387Z	passed	deletes-name-their-target	-
```

**Other command lines it matches**

- `true; rm -rf *`
- ``echo `rm -rf * ` ``
- `rm -rf .`
- `rm -rf ./*`
- `rm -rf ${HOME}/*`
- `rm -rf ~`
- `rm -rf ~/*`
- `rm -rf ~/`
- `rm -rf $HOME`
- `echo 'rm -rf *'`
- `rm -rf ..`
- `rm -rf /*`
- `rm -rf *`
- `sudo rm -rf *`

```text
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: true; rm -rf *
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: echo `rm -rf * `
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf .
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ./*
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ${HOME}/*
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ~
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ~/*
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ~/
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf $HOME
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: echo 'rm -rf *'
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf ..
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf /*
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: rm -rf *
discipline 'deletes-name-their-target' broken on -: command line deletes a broad target: sudo rm -rf *
```

Each diagnostic continues with ` — why: …` as in run 2. These inputs block at exit 2.

`rm -rf ./build`, `rm build.log && git add .`, and `env FOO=1 rm -rf ~` also pass. The input
``echo `rm -rf *` `` exits 0 with `passed deletes-name-their-target` and `skipped shell-unjudgeable`
with reason `no-observation`. Creating `notes.txt` with the text `rm -rf /`, or submitting a diff
that changes `old` to `new` in that file, exits 0 with a generic `passed covenant-check` row;
neither judges this entry.

**In a real session**

After adding the entry, `pdks explain` shows:

```text
  declare  deletes-name-their-target forbidden-command · change · empty none-wholesale · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · enforce: block · unattended: judge
```

When the agent attempts a matching command, the call is stopped and the message begins with the line
from run 2; a `blocked` row is appended to `.polydeukes/roi.log`.

See [the first-judgment tutorial](../tutorials/first-judgment.md),
[the connect-surfaces guide](../how-to/connect-surfaces.md), and
[the install guide](../how-to/install.md).

<a id="change-it"></a>
## Change it

The target alternatives are:

- `/` and `/*`: the root directory or every entry in it.
- `~`, `~/` and `~/*`: the home directory or every entry in it.
- `$HOME` and `${HOME}`, with an optional slash and star: home-variable spellings.
- `.`, `./` and `./*`: the current directory or every entry in it.
- `..` and `../`: the parent directory.
- `*`: every entry matched by the glob in the current directory.

The command can start a line or follow a separator, opening parenthesis, quote, backtick or `$(`.
The recognized prefixes are `sudo`, `exec`, `nohup`, `env`, `xargs`, `command` and `time`, with
optional flags. The argument-skipping part `rm\s+(?:[^\s;&|]+\s+)*?` allows arguments before the
target only when they contain no `;`, `&`, or `|`, so it does not read into the next command. The
ending boundary accepts whitespace, end of line, separators, a closing parenthesis or quotes; it
does not accept a closing backtick.

Remove a target alternative and its separating `|` from the target group to stop judging that
spelling. Remove a prefix alternative from the prefix group to narrow those spellings. No path
substitution is required. Recheck matching and passing inputs whenever you narrow or extend the
pattern.

Remove `enforce: block` to record `advised` and let the call proceed. Delete the entry to remove the
discipline. After any change, run `pdks explain`.

<a id="limits"></a>
## Limits

This entry checks target spellings in command-line text, not which files are reached or whether
removal succeeds. `rm -rf build/cache` and `rm -rf ./build` pass however valuable their contents. It
does not prevent all directory deletion. `echo 'rm -rf *'` blocks a quoted mention. The whole
command as written, including heredoc bodies, is read.

``echo `rm -rf *` `` passes this entry and records `skipped shell-unjudgeable` with
`no-observation`. Adding a space before the closing backtick, as in ``echo `rm -rf * ` ``, makes it
match. This pattern does not cover every command substitution.

`env FOO=1 rm -rf ~` passes because the prefix part skips only flags after `env`, not assignments.

`rm -rf *`, `rm -rf /*`, `rm -rf ./*`, `rm -rf ~/*`, `rm -rf $HOME`, `rm -rf ${HOME}/*`,
`true; rm -rf *`, `sudo rm -rf *`, and ``echo `rm -rf * ` `` record both
`blocked deletes-name-their-target` and `skipped shell-unjudgeable` with `no-observation`. The
command-text discipline matched; the separate shell analysis could not observe the mutation targets.
The skipped row does not cancel the block.

The change-set surface (`pdks covenant check --diff`) does not judge this entry because a diff
carries no command line.

On Codex, a blocked call cannot be opened with the witness token. Run the command from your own
terminal when you mean it. On Claude Code, if the configuration has a `witness:` block, a human can
open a block by typing the configured witness token alone on the first line of a message. The block
in this recipe does not include one; to add it, see
[opening a blocked call](../troubleshooting.md#opening-a-blocked-call).

The adapter must observe the call through a configured shell tool. Other host tools are not
automatically covered. The JSON examples exercise the judge, not host delivery. Without the `tools`
mapping, the call yields only a generic fallback pass, not a judgment of this entry.

If the adapter or the judge cannot start, the call proceeds unjudged. Confirm a row in
`.polydeukes/roi.log` after wiring.
