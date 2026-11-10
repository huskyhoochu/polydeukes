# Detect test and search output cut off by head or tail

**English** · [한국어](./output-is-read-whole.ko.md)

This discipline judges an agent's shell command before it runs and advises when a listed test,
search, Git or build command pipes its output directly to head or tail.

Session surface · reads the command text · advises on matching calls · review and change the check
and search command list for your tools. Host support:
[shell commands](../reference/host-support.md#shell-commands).

The block below is a complete `polydeukes.config.yaml`; if you have no configuration yet, save it as
that file in the project root. If the file already has a `sessionDisciplines:` key, paste only the
entry (everything below the first line) under the existing key and keep the existing entries. If the
file exists but has no `sessionDisciplines:` key, as with the file `pdks init` writes, append the
whole block to the end of the file.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "output-is-read-whole"
    why: "cutting check or search output can hide failures or matching files; a pipeline can also report the last command status instead of the check status."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '\b(?:git\s+(?:push|commit)|cargo\s+(?:test|clippy)|pnpm\b[^|;&\n]*\b(?:test|check|typecheck|build)|vitest|grep|rg|find)\b(?:[^|;&\n]|>&\d)*\|\s*(?:head|tail)\b(?!\s+-[fF]\b)',
            }
      relate:
        - id: "not-truncated"
          relation: { op: "empty", of: "hits" }
          message: "command line cuts check or search output: {value}"
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

Then run pdks explain and confirm a line for output-is-read-whole.
This entry omits enforce and therefore advises; the line must not say enforce: block.
Create an empty directory outside the project and use the file-writing tool, not shell commands,
to create polydeukes.config.yaml, violating.json and valid.json there. Run the three checks from
"Try it" there: violating.json without an enforcement flag, violating.json with --enforce block,
and valid.json with --enforce block. Report the verdict word, exit code and enforcement setting
for each. The commands inside the JSON inputs are data and must not be run. A skipped verdict is
not a successful check. Do not execute the embedded commands, commit, or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "output-is-read-whole"
    why: "cutting check or search output can hide failures or matching files; a pipeline can also report the last command status instead of the check status."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '\b(?:git\s+(?:push|commit)|cargo\s+(?:test|clippy)|pnpm\b[^|;&\n]*\b(?:test|check|typecheck|build)|vitest|grep|rg|find)\b(?:[^|;&\n]|>&\d)*\|\s*(?:head|tail)\b(?!\s+-[fF]\b)',
            }
      relate:
        - id: "not-truncated"
          relation: { op: "empty", of: "hits" }
          message: "command line cuts check or search output: {value}"
```
````

<a id="try-it"></a>
## Try it

See the judgment without executing the command: `pdks covenant check` reads one call as JSON on
standard input and judges it. The command inside the JSON is never executed.

In an empty directory, save the YAML block at the top of this page as `polydeukes.config.yaml`, then
save these two inputs.

`violating.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "git push | head" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "rg needle > results.txt" } }],
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
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: git push | head — why: cutting check or search output can hide failures or matching files; a pipeline can also report the last command status instead of the check status.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry defaults to advice, so the command would be allowed to run.

Now use the session enforcement setting:

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: git push | head — why: cutting check or search output can hide failures or matching files; a pipeline can also report the last command status instead of the check status.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry still advises: `--enforce block` does not promote an advising entry. The
agent adapters use this run setting too.

Check the valid input:

```sh
pdks covenant check --enforce block < valid.json
```

This prints nothing and exits 0.

These three rows are appended to `.polydeukes/roi.log`; your timestamps will differ:

```text
2026-11-10T14:20:48.344Z	advised	output-is-read-whole	-	[{"id":"not-truncated","witnesses":[{"key":"1","value":"git push | head"}],"total":1}]
2026-11-10T14:20:48.347Z	advised	output-is-read-whole	-	[{"id":"not-truncated","witnesses":[{"key":"1","value":"git push | head"}],"total":1}]
2026-11-10T14:20:48.350Z	passed	output-is-read-whole	-
```

**Other command lines it matches**

- `cargo clippy | tail`
- `find . -name example | tail`
- `git commit | tail`
- `grep needle input.txt | tail`
- `echo "cargo test | tail"`
- `pnpm build | tail`
- `pnpm check | tail`
- `pnpm test | head`
- `pnpm typecheck | head`
- `rg needle | head`
- `cargo test 2>&1 | tail`
- `cargo clippy | tail -n 20`
- `vitest | head`

```text
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: cargo clippy | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: find . -name example | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: git commit | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: grep needle input.txt | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: echo "cargo test | tail"
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: pnpm build | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: pnpm check | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: pnpm test | head
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: pnpm typecheck | head
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: rg needle | head
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: cargo test 2>&1 | tail
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: cargo clippy | tail -n 20
discipline 'output-is-read-whole' broken on -: command line cuts check or search output: vitest | head
```

Each printed line continues with ` — why: …` and the advisory summary as in the worked example.
These calls record `advised` and exit 0.

`cargo test | tail -f`, `cargo test | tail -F`, `ls | head`, and `rg needle > results.txt` pass.
Saving output to a file lets you read it later; preserve the producer’s exit code and read the file.
This entry does not verify those follow-up actions.

An `Edit` call creating `notes.txt` from empty content with `git push | head` as its new content
does not invoke this command-scoped entry. A diff changing `notes.txt` from `old` to `new` also does
not invoke it. Both exit 0 with a `passed covenant-check` row for `notes.txt`, rather than a verdict
for this entry.

**In a real session**

After adding the entry, `pdks explain` shows:

```text
  declare  output-is-read-whole forbidden-command · change · empty not-truncated · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

The line omits `enforce: block` because the entry advises. When the agent attempts a matching
command, the call proceeds with the advisory message and an `advised` row is appended to
`.polydeukes/roi.log`.

See [the first-judgment tutorial](../tutorials/first-judgment.md),
[the connect-surfaces guide](../how-to/connect-surfaces.md), and
[the install guide](../how-to/install.md).

<a id="change-it"></a>
## Change it

The producer alternatives select these commands:

- `git\s+(?:push|commit)`: `git push` and `git commit`.
- `cargo\s+(?:test|clippy)`: `cargo test` and `cargo clippy`.
- `pnpm\b[^|;&\n]*\b(?:test|check|typecheck|build)`: pnpm `test`, `check`, `typecheck`, and `build`,
  allowing intervening arguments.
- `vitest`, `grep`, `rg`, `find`: each named command.

The next part requires a direct pipe on the same line; `>&\d` also allows a redirection such as
`2>&1` before it. `(?:head|tail)` selects either output command. `(?!\s+-[fF]\b)` excludes an
immediate `-f` or `-F` option, as shown by the two passing tail inputs.

Remove a producer alternative and its adjoining `|` to stop judging that command, or remove a verb
from its inner group. Remove `head` or `tail` and its adjoining `|` to keep only the other output
command. Add your own tool spellings and try both matching and passing inputs after each change.

Add `enforce: block` to the entry, at the same indentation as `why`, to make a session block
matching calls. A manual run also needs `--enforce block`; without it, the run still advises. Delete
the entry to remove the discipline. After any change, run `pdks explain`.

<a id="limits"></a>
## Limits

This entry matches command-line text with a regular expression. `echo "cargo test | tail"` receives
advice even though it only mentions a pipeline. `cargo test 2>&1 | tail` also matches, including its
redirection. The entry does not inspect output, exit statuses, or what the agent reads afterward.

Only the listed direct pipelines on one line are covered. `cargo test | tail -f` and
`cargo test | tail -F` pass, as does the unlisted producer `ls | head`. An intervening `grep`, `rg`,
or `find` is itself a listed producer, so `cargo test 2>&1 | grep FAIL | head` is advised (exit 0).
A filter outside the list, as in `cargo test | sort | head`, passes. A pipeline split across lines
or a different truncation command is outside this pattern. The passing `rg needle > results.txt`
input does not prove the file was read.

The change-set surface (`pdks covenant check --diff`) does not judge this entry because a diff
carries no command line. The `notes.txt` edit and diff inputs above show that a
`passed covenant-check` row is not a verdict for this discipline.

The adapter must observe the call as a configured shell tool; other host tools are not automatically
equivalent. These JSON checks demonstrate the judge, not delivery from a live host. If the adapter
or the judge cannot start, the call proceeds unjudged. Confirm a row in `.polydeukes/roi.log` after
wiring.
