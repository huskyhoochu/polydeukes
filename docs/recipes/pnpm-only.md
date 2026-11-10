# Detect dependency changes made outside pnpm

**English** · [한국어](./pnpm-only.ko.md)

This applies when your project uses pnpm. This discipline judges an agent's shell command before it
runs and advises on the listed npm commands and recognised yarn invocations.

Session surface (Claude Code, Codex) · advises on matching calls · requires a project that uses pnpm
· nothing to customise for that project.

The block below is a complete `polydeukes.config.yaml`; if you have no configuration yet, save it as
that file in the project root. If the file already has a `sessionDisciplines:` key, paste only the
entry (everything below the first line) under the existing key and keep the existing entries. If the
file exists but has no `sessionDisciplines:` key, as with the file `pdks init` writes, append the
whole block to the end of the file.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "pnpm-only"
    why: "this project uses pnpm; another package manager can leave dependency files inconsistent."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '\bnpm (install|i|ci|add|uninstall|remove|rm|update|up|link|publish)\b|(^|[;&|(]\s*)yarn\b',
            }
      relate:
        - id: "no-npm-mutation"
          relation: { op: "empty", of: "hits" }
          message: "command line uses a package manager outside pnpm: {value}"
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

Then run pdks explain and confirm a line for pnpm-only.
This entry omits enforce and therefore advises; the line must not say enforce: block.
Create an empty directory outside the project and use the file-writing tool, not shell commands,
to create polydeukes.config.yaml, violating.json and valid.json there. Run the three checks from
"Try it" there: violating.json without an enforcement flag, violating.json with --enforce block,
and valid.json with --enforce block. Report the verdict word, exit code and enforcement setting
for each. The commands inside the JSON inputs are data and must not be run. A skipped verdict is
not a successful check. Do not execute the embedded commands, commit, or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "pnpm-only"
    why: "this project uses pnpm; another package manager can leave dependency files inconsistent."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: '\bnpm (install|i|ci|add|uninstall|remove|rm|update|up|link|publish)\b|(^|[;&|(]\s*)yarn\b',
            }
      relate:
        - id: "no-npm-mutation"
          relation: { op: "empty", of: "hits" }
          message: "command line uses a package manager outside pnpm: {value}"
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
  "toolCalls": [{ "name": "Bash", "args": { "command": "npm install example" } }],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [{ "name": "Bash", "args": { "command": "pnpm install" } }],
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
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm install example — why: this project uses pnpm; another package manager can leave dependency files inconsistent.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry defaults to advice, so the command would be allowed to run.

Now use the session enforcement setting:

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm install example — why: this project uses pnpm; another package manager can leave dependency files inconsistent.
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
2026-11-10T14:20:48.404Z	advised	pnpm-only	-	[{"id":"no-npm-mutation","witnesses":[{"key":"1","value":"npm install example"}],"total":1}]
2026-11-10T14:20:48.407Z	advised	pnpm-only	-	[{"id":"no-npm-mutation","witnesses":[{"key":"1","value":"npm install example"}],"total":1}]
2026-11-10T14:20:48.409Z	passed	pnpm-only	-
```

**Other command lines it matches**

- `echo "npm install example"`
- `npm ci example`
- `npm i example`
- `npm link example`
- `npm publish example`
- `npm uninstall example`
- `npm update example`
- `true && yarn install`
- `(yarn install)`
- `yarn info example`

```text
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: echo "npm install example"
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm ci example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm i example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm link example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm publish example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm uninstall example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: npm update example
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: true && yarn install
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: (yarn install)
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: yarn info example
```

Each printed line continues with ` — why: …` and the advisory summary as in the worked example.
These calls record `advised` and exit 0.

`pnpm install`, `npm view example version`, `npm info example`, and `echo yarn install` pass. To try
the registry lookup, copy `valid.json` to `lookup.json` and replace its command with
`npm view example version`:

```sh
pdks covenant check --enforce block < lookup.json
```

This prints nothing and exits 0. The appended row is:

```text
2026-11-10T14:20:48.412Z	passed	pnpm-only	-
```

For the parenthesised command, copy `violating.json` to `subshell.json` and replace its command with
`(yarn install)`:

```sh
pdks covenant check --enforce block < subshell.json
```

Standard error:

```text
discipline 'pnpm-only' broken on -: command line uses a package manager outside pnpm: (yarn install) — why: this project uses pnpm; another package manager can leave dependency files inconsistent.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. Two rows are appended:

```text
2026-11-10T14:20:48.414Z	advised	pnpm-only	-	[{"id":"no-npm-mutation","witnesses":[{"key":"1","value":"(yarn install)"}],"total":1}]
2026-11-10T14:20:48.414Z	skipped	shell-unjudgeable	-	no-observation
```

The command-text discipline advises, while the shell analysis also records
`skipped shell-unjudgeable` with `no-observation`. The skip does not cancel the advice and does not
establish that the whole shell command was judged.

An `Edit` call creating `notes.txt` from empty content with `npm install example` as its new content
does not invoke this command-scoped entry. A diff changing `notes.txt` from `old` to `new` also does
not invoke it. Both exit 0 with a `passed covenant-check` row for `notes.txt`, rather than a verdict
for this entry.

**In a real session**

After adding the entry, `pdks explain` shows:

```text
  declare  pnpm-only         forbidden-command · change · empty no-npm-mutation · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

The line omits `enforce: block` because the entry advises. When the agent attempts a matching
command, the call proceeds with the advisory message and an `advised` row is appended to
`.polydeukes/roi.log`.

See [the first-judgment tutorial](../tutorials/first-judgment.md),
[the connect-surfaces guide](../how-to/connect-surfaces.md), and
[the install guide](../how-to/install.md).

<a id="change-it"></a>
## Change it

The regular expression has two alternatives:

- `\bnpm (install|i|ci|add|uninstall|remove|rm|update|up|link|publish)\b`: npm `install`, `i`, `ci`,
  `add`, `uninstall`, `remove`, `rm`, `update`, `up`, `link`, and `publish`, with one literal space
  after `npm`.
- `(^|[;&|(]\s*)yarn\b`: `yarn` at the start of a line or after `;`, `&`, `|`, or `(`, allowing
  whitespace after the separator. Read-only subcommands also match.

Remove an npm verb and its adjoining `|` to allow that spelling. Remove the whole yarn alternative
and its separating `|` to stop judging yarn, or remove the whole npm alternative to judge only yarn.
This is a pnpm-specific configuration: for another package manager, change the id, why, message and
command alternatives together, then check the new inputs.

Add `enforce: block` to the entry, at the same indentation as `why`, to make a session block
matching calls. A manual run also needs `--enforce block`; without it, the run still advises. Delete
the entry to remove the discipline. After any change, run `pdks explain`.

<a id="limits"></a>
## Limits

This entry matches command-line text with a regular expression. `echo "npm install example"`
receives advice even though it only mentions an installation. `npm view example version` and
`npm info example` pass, while the read-only `yarn info example` receives advice: the yarn
alternative matches the manager name alone.

The selected yarn positions matter: `true && yarn install` and `(yarn install)` match, but
`echo yarn install` passes. `(yarn install)` records both `advised pnpm-only` and
`skipped shell-unjudgeable`; the command-text match does not mean every shell effect was judged.

The npm alternative requires the listed verbs and spacing; the yarn alternative requires the
selected positions. Other spellings and other package managers are outside its scope. This entry
does not inspect lockfiles, detect installed package managers, or check that dependencies actually
changed.

The change-set surface (`pdks covenant check --diff`) does not judge this entry because a diff
carries no command line. The `notes.txt` edit and diff above show that a `passed covenant-check` row
is not a verdict for this discipline.

The adapter must observe the call as a configured shell tool; other host tools are not automatically
equivalent. These JSON checks demonstrate the judge, not delivery from a live host. If the adapter
or the judge cannot start, the call proceeds unjudged. Confirm a row in `.polydeukes/roi.log` after
wiring.
