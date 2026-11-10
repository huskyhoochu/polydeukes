# Check for a registry lookup before package.json is edited

**English** · [한국어](./manifest-needs-evidence.ko.md)

This applies when your project gets its dependencies from the npm registry and its manifest is the
root `package.json`. This discipline checks for a successful earlier `npm view` call in the session
history before an edit. By default it advises, so the edit still happens when that lookup is
missing.

Session surface · reads earlier tool calls recorded as successful · default advice · change the
manifest path only when it is not at the root. Host support:
[file edits](../reference/host-support.md#file-edits),
[earlier calls](../reference/host-support.md#earlier-calls),
[call success](../reference/host-support.md#call-success) and
[history scope](../reference/host-support.md#history-scope).

The block below is a complete `polydeukes.config.yaml`; if you have no configuration yet, save it as
that file in the project root. If the file already has a `sessionDisciplines:` key, paste only the
entry (everything below the first line) under the existing key and keep the existing entries. If the
file exists but has no `sessionDisciplines:` key, as with the file `pdks init` writes, append the
whole block to the end of the file.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "manifest-needs-evidence"
    why: "a dependency edit should follow a registry lookup rather than rely on remembered versions."
    declare:
      mechanism: "precedent"
      scope: { source: "target.path", include: ['^package\.json$'] }
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        npmView:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\bnpm view ' }
      relate:
        - id: "npm-view"
          relation: { op: "nonEmpty", of: "npmView" }
          message: "no successful npm view precedes this manifest edit"
```

<a id="agent-prompt"></a>
## Set it up with your agent

Paste this into Claude Code or Codex in the project.

````text
Add the entry below under sessionDisciplines: in this project's polydeukes.config.yaml.
In an existing configuration, add only the entry under the existing key, never a second key.
Preserve every other entry, protected path and witness setting. If the same id already exists,
report it before making changes.

If the configuration file is protected in this session, show the exact patch and ask the human
to apply it. Never work around the protection.

Keep the path for a root package.json; adapt it if the manifest is elsewhere.
Then run pdks explain and confirm a line for manifest-needs-evidence.
This entry omits enforce and therefore advises; the line must not say enforce: block.
In an empty directory outside the project, use the file-writing tool to create this page’s original
YAML, violating.json and valid.json. Run the three checks from "Try it":
violating.json without an enforcement flag, violating.json with --enforce block,
and valid.json with --enforce block. Report the verdict word, exit code and enforcement setting.
Commands inside the JSON are history data and must not be run. A skipped verdict is not a successful
check. Check adapted patterns with separate inputs too. Do not commit or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "manifest-needs-evidence"
    why: "a dependency edit should follow a registry lookup rather than rely on remembered versions."
    declare:
      mechanism: "precedent"
      scope: { source: "target.path", include: ['^package\.json$'] }
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        npmView:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\bnpm view ' }
      relate:
        - id: "npm-view"
          relation: { op: "nonEmpty", of: "npmView" }
          message: "no successful npm view precedes this manifest edit"
```
````

<a id="try-it"></a>
## Try it

In an empty directory, save the YAML above as `polydeukes.config.yaml` and save these two inputs.
`pdks covenant check` judges the input; it does not execute the commands or edits inside the JSON.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "package.json"
      },
      "fileChange": {
        "kind": "modify",
        "path": "package.json",
        "pre": "old\n",
        "post": "new\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  },
  "session": {
    "userMessages": [],
    "toolCalls": []
  }
}
```

`valid.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "package.json"
      },
      "fileChange": {
        "kind": "modify",
        "path": "package.json",
        "pre": "old\n",
        "post": "new\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  },
  "session": {
    "userMessages": [],
    "toolCalls": [
      {
        "name": "Bash",
        "args": {
          "command": "npm view example version"
        },
        "succeeded": true
      }
    ]
  }
}
```

The `session.toolCalls` field holds tool calls earlier than the current edit; in a real session the
adapter, not the reader, fills it in. A hand-written input shows how the entry judges, not that a
host observed a read or lookup.

The `tools` object tells the judge which tools mutate files and which carry shell commands; adapters
supply it in a real session. The current edit is in top-level `toolCalls`, and earlier calls are
inside `session`.

In an empty directory, the first input carrying `session` makes the run append an extra row before
its verdict because no baseline exists yet; later runs do not repeat it.

First, run without an enforcement flag:

```sh
pdks covenant check < violating.json
```

Standard error:

```text
discipline 'manifest-needs-evidence' broken on package.json: no successful npm view precedes this manifest edit — why: a dependency edit should follow a registry lookup rather than rely on remembered versions.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The default is advice, so the edit still happens.

Now use the session enforcement setting:

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'manifest-needs-evidence' broken on package.json: no successful npm view precedes this manifest edit — why: a dependency edit should follow a registry lookup rather than rely on remembered versions.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. `--enforce block` does not promote an advising entry.

Check the valid input:

```sh
pdks covenant check --enforce block < valid.json
```

This prints nothing and exits 0.

These four rows are appended to `.polydeukes/roi.log`; your path and timestamps will differ:

```text
2026-11-10T17:27:39.038Z	unattributed	baseline	/tmp/recipe/.polydeukes/baseline.json
2026-11-10T17:27:39.038Z	advised	manifest-needs-evidence	package.json	[{"id":"npm-view","witnesses":[{"key":"npmView","value":null}],"total":1}]
2026-11-10T17:27:39.043Z	advised	manifest-needs-evidence	package.json	[{"id":"npm-view","witnesses":[{"key":"npmView","value":null}],"total":1}]
2026-11-10T17:27:39.047Z	passed	manifest-needs-evidence	package.json
```

The `unattributed` row observes the missing baseline and is not a verdict for this entry; see
[troubleshooting](../troubleshooting.md).

**Earlier calls that count**

For an edit of `package.json`, each earlier `Bash` call below with `succeeded: true` records
`passed`, prints nothing and exits 0:

- `npm view example version`.
- `npx npm view left-pad version`.
- `echo 'npm view x'`, which only mentions a lookup.
- `npm view no-such-package-xyz version || true`, whose whole command succeeded even though the
  lookup failed.

A successful `npm view is-odd version` followed by a `package.json` edit changing `left-pad` from
`1.2.0` to `1.3.0` also passes. The entry does not compare the package names. One successful
`npm view example version` passes two later edits of `package.json` by the same agent in its
session.

**Earlier calls that do not count**

For the same `package.json` edit, each input below records `advised`, prints the same error and
advisory summary as the first run, and exits 0:

- Successful `Bash` calls with `pnpm view example version`, `npm info example version`,
  `npm show example version`, or `npm v left-pad version`.
- A successful `Bash` call with `npm view`, with nothing after `view`.
- A successful `Bash` call with `npm  view left-pad version`, with two spaces between `npm` and
  `view`.
- `Bash` with `npm view example version` when `succeeded` is `false` or absent.
- A successful `Task` call carrying `args.command: "npm view example version"`, rather than a `Bash`
  call.

With an empty history, an edit changing only the `test` script from `node a.js` to `node b.js` also
advises with the same output and exit code 0. So does creating `package.json` with
`{"dependencies":{"left-pad":"1.3.0"}}`.

Edits of `settings.json`, `packages/a/package.json`, and `pnpm-lock.yaml` from `old\n` to `new\n`
with an empty history are outside scope. Each prints nothing, exits 0, and records
`passed covenant-check` for its path, not a verdict for this entry.

Copy `violating.json` to `missing.json` and remove the entire `session` field.

```sh
pdks covenant check < missing.json
```

This prints nothing and exits 0, recording `skipped` with `supply-pass`. This differs from the empty
history’s `advised` and is not a successful check.

```text
2026-11-10T17:27:39.053Z	skipped	manifest-needs-evidence	package.json	supply-pass
```

Copy `violating.json` to `shell.json` and replace its top-level call with this object. Include no
`fileChange`; keep the empty `session` and the other fields.

```json
{
  "name": "Bash",
  "args": {
    "command": "sed -i 's/1.2.0/1.3.0/' package.json"
  }
}
```

```sh
pdks covenant check < shell.json
```

The `sed -i 's/1.2.0/1.3.0/' package.json` input prints nothing and exits 0. It records `skipped`
with `no-observation`.

```text
2026-11-10T17:27:39.056Z	skipped	manifest-needs-evidence	package.json	no-observation
```

In `shell.json`, replace the command with `npm install left-pad@1.3.0` or `pnpm add left-pad` and
run the same check. Each prints nothing, exits 0 and records only `passed covenant-check` with `-`
as the path. These package-manager writes leave no row for this entry, unlike the measured `sed -i`
input above.

Save this as `change.diff`.

```diff
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{}
+{"name":"example"}
```

```sh
pdks covenant check --diff < change.diff
```

This prints nothing and exits 0. The change-set surface does not judge this entry. The generic
`passed covenant-check` row is not a verdict for this discipline.

```text
2026-11-10T17:27:39.060Z	passed	covenant-check	package.json
```

**In a real session**

Run:

```sh
pdks explain
```

It exits 0 and includes this line for the entry:

```text
  declare  manifest-needs-evidence precedent · history · nonEmpty npm-view · scope target.path · include 1 · exclude 0 · sources 1 (transcript 1) · valve — · why ✓ · unattended: judge
```

The line omits `enforce: block` because the entry advises. In a connected session, perform the
actual read or lookup, then edit a selected file and inspect the verdict in `.polydeukes/roi.log`.

See the [Claude Code adapter](../reference/packages/adapter-claude-code.md),
[Codex adapter](../reference/packages/adapter-codex.md), and
[connect-surfaces guide](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

For the root manifest, keep `scope.include: ['^package\.json$']` unchanged. If your manifest is
elsewhere, replace this one pattern with its project-relative path, keeping the start and end
anchors and escaping dots. The path occurs only in `scope.include`; there is no second manifest path
to update.

The `npmView` extraction selects successful `Bash` calls, reads `args.command`, and matches
`\bnpm view `. It has a word boundary before `npm` and one literal space between `npm` and `view`
and after `view`. It checks for matching command text, not the package or returned version. A
different registry or client needs a different declaration and its own measured inputs.

The related [pnpm recipe](./pnpm-only.md) checks which tool changes dependencies.

Add `enforce: block` to the entry, at the same indentation as `why`, to make a session block the
edit. A manual run then also needs `--enforce block`; without it, the run still advises. Delete the
entry to remove the discipline. After changes, run `pdks explain` and check both matching and
non-matching inputs for the new patterns.

<a id="limits"></a>
## Limits

This entry judges edits made with file tools. A package-manager command that rewrites the manifest
is not judged by this entry: `npm install left-pad@1.3.0` and `pnpm add left-pad` each print
nothing, exit 0 and record only `passed covenant-check` with `-` as the path, leaving no row for
this entry.

This entry counts only earlier calls recorded as successful. With a host that does not record
success, every edit in scope advises. The measured earlier `npm view example version` call with no
`succeeded` field also advises. See [call success](../reference/host-support.md#call-success).

Earlier calls are the ones the host supplies for the agent making the edit; see
[history scope](../reference/host-support.md#history-scope).

One lookup satisfies every later manifest edit by the same agent for the rest of its session: one
successful `npm view example version` passes two later `package.json` edits. It does not check
freshness, returned versions, or package availability. `npm view is-odd version` followed by a
`left-pad` version change passes because the looked-up package is not compared with the edited one.

The pattern matches text. `echo 'npm view x'` passes without a registry lookup.
`npm view no-such-package-xyz version || true` passes with `succeeded: true` because the command as
a whole succeeded. A failed `npm view example version`, or one with no recorded success, advises.

The entry does not read the command line or file content of the judged edit. Changing only the
`test` script from `node a.js` to `node b.js` advises with an empty history, as does creating
`package.json` with a `left-pad` dependency. `packages/a/package.json` and `pnpm-lock.yaml` are
outside the root-manifest scope.

The `package.json` edit with no `session` records `skipped` with `supply-pass`; with an empty
`session.toolCalls` it advises. The shell write `sed -i 's/1.2.0/1.3.0/' package.json` records
`skipped` with `no-observation`. The diff changing `{}` to `{"name":"example"}` in `package.json`
receives only a generic pass: the change-set surface does not judge this entry.

These JSON checks do not prove delivery of evidence by a live host. If the adapter or judge cannot
start, the call proceeds unjudged. Confirm rows in `.polydeukes/roi.log` after wiring.
