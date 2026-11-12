# Check for registry and documentation lookups before editing dependencies

**English** · [한국어](./dependency-edits-follow-lookups.ko.md)

This discipline advises before a root or workspace `package.json` edit unless both a successful
`npm view` and a successful documentation-tool call precede it. The documentation-tool name must
contain `context7`. Compared with [the registry-only recipe](./manifest-needs-evidence.md), this
recipe also requires a successful documentation lookup.

Session surface · advises by default · reads earlier calls and their success status · change
manifest paths and documentation-tool pattern. Evidence:
[file edits](../reference/host-support.md#file-edits),
[earlier calls](../reference/host-support.md#earlier-calls),
[call success](../reference/host-support.md#call-success),
[history scope](../reference/host-support.md#history-scope).

The block is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `sessionDisciplines:` exists, add only the entry below that key and preserve
existing entries. If the file lacks the key, append the whole block.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "dependency-edits-follow-lookups"
    why: "A dependency version is measured before it is written (training knowledge is not evidence of what npm resolves today), and the API a dependency exposes is read from its docs, not recalled."
    declare:
      mechanism: "precedent"
      scope:
        source: "target.path"
        include: ['^((apps|packages)/[^/]+/)?package\.json$']
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        npmView:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\bnpm view ' }
        context7:
          - { op: "source", of: "session" }
          - { op: "toolUses" }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "field", name: "name" }
          - { op: "matches", re: "context7" }
      relate:
        - id: "npm-view"
          relation: { op: "nonEmpty", of: "npmView" }
          message: "no successful npm view precedes this manifest edit"
        - id: "context7"
          relation: { op: "nonEmpty", of: "context7" }
          message: "no successful context7 call precedes this manifest edit"
```

<a id="agent-prompt"></a>
## Set it up with your agent

Paste this into Claude Code or Codex in the project.

````text
Add the entry below under sessionDisciplines: in this project's polydeukes.config.yaml.
Add only the entry under an existing key, never a second key. Preserve every other entry,
protected path and witness setting. If the same id exists, report it and stop.
If the configuration is protected, show the exact patch and ask the human to apply it.
Never work around the protection. Adapt the values described in "Change it" to this project.
Run pdks explain and confirm the line for dependency-edits-follow-lookups.
This entry advises; the line must not say enforce: block.
Use a file-writing tool to save the original YAML and the violating.json and valid.json
inputs from "Try it" in an empty directory outside the project. Run the three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report the verdict word, exit code, enforcement setting and telemetry row for each run.
A skipped verdict is not a successful check. JSON is data; do not execute its commands or edits.
Check adapted patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "dependency-edits-follow-lookups"
    why: "A dependency version is measured before it is written (training knowledge is not evidence of what npm resolves today), and the API a dependency exposes is read from its docs, not recalled."
    declare:
      mechanism: "precedent"
      scope:
        source: "target.path"
        include: ['^((apps|packages)/[^/]+/)?package\.json$']
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        npmView:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\bnpm view ' }
        context7:
          - { op: "source", of: "session" }
          - { op: "toolUses" }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "field", name: "name" }
          - { op: "matches", re: "context7" }
      relate:
        - id: "npm-view"
          relation: { op: "nonEmpty", of: "npmView" }
          message: "no successful npm view precedes this manifest edit"
        - id: "context7"
          relation: { op: "nonEmpty", of: "context7" }
          message: "no successful context7 call precedes this manifest edit"
```
````

<a id="try-it"></a>
## Try it

In an empty directory, save the YAML above as `polydeukes.config.yaml` and save these two inputs.
`pdks covenant check` judges JSON; it does not execute its commands or edits.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": { "file_path": "package.json" },
      "fileChange": {
        "kind": "modify",
        "path": "package.json",
        "pre": "{\n  \"dependencies\": {\n    \"left-pad\": \"1.2.0\"\n  }\n}\n",
        "post": "{\n  \"dependencies\": {\n    \"left-pad\": \"1.3.0\"\n  }\n}\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] },
  "session": { "userMessages": [], "toolCalls": [] }
}
```

`valid.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": { "file_path": "package.json" },
      "fileChange": {
        "kind": "modify",
        "path": "package.json",
        "pre": "{\n  \"dependencies\": {\n    \"left-pad\": \"1.2.0\"\n  }\n}\n",
        "post": "{\n  \"dependencies\": {\n    \"left-pad\": \"1.3.0\"\n  }\n}\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] },
  "session": {
    "userMessages": [],
    "toolCalls": [
      { "name": "Bash", "args": { "command": "npm view left-pad version" }, "succeeded": true },
      {
        "name": "mcp__plugin_context7_context7__query-docs",
        "args": { "libraryId": "/facebook/react", "query": "useEffect cleanup" },
        "succeeded": true
      }
    ]
  }
}
```

`fileChange` contains the observed path and before/after content. `tools` identifies editing and
shell tools. An adapter supplies these fields in a real session.

`session.toolCalls` contains calls earlier than the current edit. Both lookups must have
`succeeded: true`. The first run in an empty directory also records an `unattributed baseline` row
because no baseline exists.

First run without an enforcement flag.

```sh
pdks covenant check < violating.json
```

Standard error:

```text
discipline 'dependency-edits-follow-lookups' broken on package.json: no successful npm view precedes this manifest edit — why: A dependency version is measured before it is written (training knowledge is not evidence of what npm resolves today), and the API a dependency exposes is read from its docs, not recalled.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0.

Check the violation with the session enforcement setting.

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'dependency-edits-follow-lookups' broken on package.json: no successful npm view precedes this manifest edit — why: A dependency version is measured before it is written (training knowledge is not evidence of what npm resolves today), and the API a dependency exposes is read from its docs, not recalled.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0.

Check the valid input.

```sh
pdks covenant check --enforce block < valid.json
```

No output.

Exit code: 0.

The less restrictive of the entry and run enforcement settings applies. This entry advises even with
the flag.

The entry's rows appended to `.polydeukes/roi.log` are below. Timestamps vary by run; the baseline
row is described above.

```text
2026-11-12T15:15:46.731Z	advised	dependency-edits-follow-lookups	package.json	[{"id":"npm-view","witnesses":[{"key":"npmView","value":null}],"total":1},{"id":"context7","witnesses":[{"key":"context7","value":null}],"total":1}]
2026-11-12T15:15:46.735Z	advised	dependency-edits-follow-lookups	package.json	[{"id":"npm-view","witnesses":[{"key":"npmView","value":null}],"total":1},{"id":"context7","witnesses":[{"key":"context7","value":null}],"total":1}]
2026-11-12T15:15:46.739Z	passed	dependency-edits-follow-lookups	package.json
```

**Other inputs**

Use these replacements in `violating.json`. The `pre` and `post` values use JSON string notation,
where `\n` is a newline. Change both `args.file_path` and `fileChange.path` for a different path.
Apply any stated tool name, `kind` or history change too. Run inputs separately; the output block
collects their distinct diagnostics.

- `package.json`: `session.toolCalls`:
  `[{"name":"Bash","args":{"command":"npm view left-pad version"},"succeeded":true},{"name":"mcp__plugin_context7_context7__query-docs","args":{"libraryId":"/facebook/react","query":"useEffect cleanup"},"succeeded":false}]`.
  `advised`; exit 0 (no flag).
- `apps/api/package.json`: `session.toolCalls`: `[]`. `advised`; exit 0 (no flag).

The first diagnostic from each input follows. Advising runs also append the `covenant advisory: …`
summary shown above.

```text
discipline 'dependency-edits-follow-lookups' broken on package.json: no successful context7 call precedes this manifest edit — why: A dependency version is measured before it is written (training knowledge is not evidence of what npm resolves today), and the API a dependency exposes is read from its docs, not recalled.
discipline 'dependency-edits-follow-lookups' broken on apps/api/package.json: no successful npm view precedes this manifest edit — why: A dependency version is measured before it is written (training knowledge is not evidence of what npm resolves today), and the API a dependency exposes is read from its docs, not recalled.
```

**On the change-set surface**

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

No output.

Exit code: 0. Appended row:

```text
2026-11-12T15:15:46.742Z	passed	covenant-check	package.json
```

**In a real session**

```sh
pdks explain
```

Exit code: 0. The session entry line:

```text
  declare  dependency-edits-follow-lookups precedent · history · nonEmpty npm-view, context7 · scope target.path · include 1 · exclude 0 · sources 1 (transcript 1) · valve — · why ✓ · unattended: judge
```

Connect an adapter, perform an edit in scope, and confirm this entry's row in `.polydeukes/roi.log`.
See [Connect the surfaces](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Change `scope.include` for your manifest paths. The example covers `package.json`,
`apps/api/package.json` and `packages/ui/package.json`, one workspace level deep.

In `extract.context7`, change the `matches` regular expression `context7` to match your
documentation tool's name. Keep the `succeeded: true` filter. In `extract.npmView`, the successful
tool name is `Bash`, the command is `args.command`, and `\bnpm view ` includes a literal space after
`view`. Adapt these to the evidence your adapter supplies, then check matching and non-matching
calls.

Add `enforce: block` beside `why` to request blocking; a manual run also needs `--enforce block`.
Delete the entry to remove the discipline. Run `pdks explain` and check both inputs after changes.

<a id="limits"></a>
## Limits

With a host that supplies earlier calls without recording their success, both lookups are filtered
out and every edit in scope records `advised`. See
[call success](../reference/host-support.md#call-success).

Successful `Bash` calls with `pnpm view left-pad version` or `npm info left-pad version` do not
count as `npm view`. Even with a successful `context7` call, the following `package.json` edit
records `advised`, exits 0 and prints `no successful npm view precedes this manifest edit`.

The lookups are not tied to the package being edited. Successful `npm view is-odd version` and
`mcp__plugin_context7_context7__query-docs` calls pass an edit changing `left-pad` from `1.2.0` to
`1.3.0`. The documentation call in `valid.json` even asks about React's `useEffect cleanup`. Any
successful name containing `context7`, including
`mcp__plugin_context7_context7__resolve-library-id`, counts. A successful
`mcp__plugin_docs_docs__search` call does not count. Failed calls and calls without `succeeded` do
not count.

With `session.toolCalls: []`, the `package.json` edit prints only the `npm view` diagnostic. Its
telemetry row includes both `npm-view` and `context7`. With only `npm view`, the diagnostic names
`context7`; with only `context7`, it names `npm view`. Removing `session` entirely records `skipped`
with `supply-pass`.

Any edit to a matching manifest is judged, including creating `package.json` with
`{"dependencies":{"left-pad":"1.3.0"}}` or changing only `scripts.test` from `node a.js` to
`node b.js`. Edits of `packages/ui/button/package.json`, `pnpm-lock.yaml` and `src/index.ts` are
outside scope and record only `passed covenant-check`.

The Bash command `sed -i 's/1.2.0/1.3.0/' package.json` without `fileChange` records `skipped` with
`no-observation`. `npm install left-pad@1.3.0` records only `passed covenant-check`. On `--diff`,
changing `{}` to `{"name":"example"}` in `package.json` also records only `passed covenant-check`:
this session entry is not judged on that surface.

These JSON inputs exercise the judge, not evidence delivery by a live host. If the adapter or judge
cannot start, the call proceeds unjudged. Confirm telemetry rows after connecting it.
