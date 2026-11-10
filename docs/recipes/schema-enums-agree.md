# Keep the same enum values in two JSON schemas

**English** · [한국어](./schema-enums-agree.ko.md)

This applies when your project has two valid JSON schemas whose selected enum arrays should contain
the same values. This discipline compares those values when either file changes.

Session and change-set surfaces · advises by default; inputs it cannot judge are blocked · change
both file paths, the scope pattern, and both selectors.

The block below is a complete `polydeukes.config.yaml`. Save it at the project root if no
configuration exists. If `disciplines:` already exists, add only the entry below that key and
preserve the existing entries. If the file exists without that key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "schema-enums-agree"
    why: "two schemas describing the same property must accept the same enum values."
    declare:
      mechanism: "pairing"
      scope: { source: "target.path", include: ['^schemas/(request|response)\.json$'] }
      sources:
        left: { file: "schemas/request.json" }
        right: { file: "schemas/response.json" }
      extract:
        leftValues:
          - { op: "source", of: "left" }
          - { op: "json" }
          - { op: "select", path: "properties.status.enum" }
        rightValues:
          - { op: "source", of: "right" }
          - { op: "json" }
          - { op: "select", path: "properties.status.enum" }
      relate:
        - id: "same-names"
          relation: { op: "equal", of: ["leftValues", "rightValues"] }
          message: "schema enum differs: {value}"
```

<a id="agent-prompt"></a>
## Set it up with your agent

Paste this into Claude Code or Codex in the project.

````text
Add the entry below under disciplines: in this project’s polydeukes.config.yaml.
Use the existing list key, never a second key. Preserve every other entry, protected path and
witness setting. If the same id exists, report it and stop.
If the configuration is protected in this session, show the exact patch and ask the human
to apply it. Never work around the protection.
Adapt the values described in "Change it" to this project. Then run pdks explain and confirm
a line for schema-enums-agree. The entry advises; the line must not say enforce: block.
In an empty scratch directory, reproduce "Try it" with the unchanged example configuration.
Create the two schema files and the two JSON inputs with the file-writing tool. Run the three
JSON checks and report each verdict, exit code and enforcement setting. JSON describes an edit;
the check does not apply it. A skipped verdict is not a successful check. Do not commit or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "schema-enums-agree"
    why: "two schemas describing the same property must accept the same enum values."
    declare:
      mechanism: "pairing"
      scope: { source: "target.path", include: ['^schemas/(request|response)\.json$'] }
      sources:
        left: { file: "schemas/request.json" }
        right: { file: "schemas/response.json" }
      extract:
        leftValues:
          - { op: "source", of: "left" }
          - { op: "json" }
          - { op: "select", path: "properties.status.enum" }
        rightValues:
          - { op: "source", of: "right" }
          - { op: "json" }
          - { op: "select", path: "properties.status.enum" }
      relate:
        - id: "same-names"
          relation: { op: "equal", of: ["leftValues", "rightValues"] }
          message: "schema enum differs: {value}"
```
````

<a id="try-it"></a>
## Try it

In an empty scratch directory, save the YAML above as `polydeukes.config.yaml`.

Create `schemas/request.json` and `schemas/response.json`, by running:

```sh
mkdir -p schemas
printf '%s\n' '{"properties": {"status": {"enum": ["open"]}}}' > schemas/request.json
printf '%s\n' '{"properties": {"status": {"enum": ["open"]}}}' > schemas/response.json
```

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "schemas/request.json"
      },
      "fileChange": {
        "kind": "modify",
        "path": "schemas/request.json",
        "pre": "{\"properties\": {\"status\": {\"enum\": [\"open\"]}}}\n",
        "post": "{\"properties\": {\"status\": {\"enum\": [\"open\", \"closed\"]}}}\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
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
        "file_path": "schemas/request.json"
      },
      "fileChange": {
        "kind": "modify",
        "path": "schemas/request.json",
        "pre": "{\"properties\": {\"status\": {\"enum\": [\"open\"]}}}\n",
        "post": "{\"properties\": {\"status\": {\"enum\": [\"open\"]}}}\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "Write"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  }
}
```

`fileChange` is the edit the adapter observed: its kind, path, and content before and after the
edit. The judge uses `post` for the edited schema and reads the other schema from disk; these checks
do not write the proposed content. The `tools` object identifies edit and shell tools and the
command argument, as supplied by adapters.

```sh
pdks covenant check < violating.json
```

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: closed — why: two schemas describing the same property must accept the same enum values.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The mismatch records `advised`.

```sh
pdks covenant check --enforce block < violating.json
```

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: closed — why: two schemas describing the same property must accept the same enum values.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The mismatch records `advised`.

`--enforce block` alone does not promote this advising entry.

```sh
pdks covenant check --enforce block < valid.json
```

This prints nothing and exits 0. The three rows appended to `.polydeukes/roi.log` are below; your
timestamps will differ.

```text
2026-11-10T15:38:55.855Z	advised	schema-enums-agree	schemas/request.json	[{"id":"same-names","witnesses":[{"key":"1","value":"closed","side":"left"}],"total":1}]
2026-11-10T15:38:55.859Z	advised	schema-enums-agree	schemas/request.json	[{"id":"same-names","witnesses":[{"key":"1","value":"closed","side":"left"}],"total":1}]
2026-11-10T15:38:55.862Z	passed	schema-enums-agree	schemas/request.json
```

**Other inputs**

Keep the original two files with `["open"]` unless a different content is stated. In each JSON edit,
keep the original `pre` and replace `post` as described. Enum arrays below are at
`properties.status.enum`.

Edit `schemas/response.json` to `["open", "closed"]` while request stays `["open"]`.

```text
discipline 'schema-enums-agree' broken on schemas/response.json: schema enum differs: closed — why: two schemas describing the same property must accept the same enum values.
```

Exit code: 0.

Edit request to `[1]` while response stays `["open"]`.

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: 1 (+1) — why: two schemas describing the same property must accept the same enum values.
```

Exit code: 0.

Put `{}` in response and edit request to `["open", "closed"]`.

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: open (+1) — why: two schemas describing the same property must accept the same enum values.
```

Exit code: 0.

Put `{ invalid` in response and submit `valid.json`.

```text
discipline 'schema-enums-agree' cannot judge schemas/request.json: right — the value is not valid JSON
```

Exit code: 2.

Remove response in the scratch directory and submit `valid.json`.

```text
discipline 'schema-enums-agree' cannot judge schemas/request.json: right — the world carries no source named 'right'
```

Exit code: 2.

The first three advise; their first lines continue with ` — why: …` and the advisory summary above.
The last two record `blocked` because the judge cannot read the selected values.

The following inputs pass with exit 0 and no stderr: request `["closed", "open"]` against response
`["open", "closed"]`; request `["open", "open"]` against response `["open"]`; and both files
containing `{}`, with `{}` for both `pre` and `post`. An edit of `notes.txt` from `old\n` to `new\n`
is outside scope and records `passed covenant-check`, not a verdict for this entry.

**Change-set surface**

Restore both schema files to their original `["open"]` content. In the same scratch directory, run:

```sh
git init -q
git config user.name Recipe
git config user.email recipe@example.invalid
git add schemas/request.json schemas/response.json
git commit -qm baseline
printf '%s\n' '{"properties": {"status": {"enum": ["closed"]}}}' > schemas/request.json
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff
```

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: closed (+1) — why: two schemas describing the same property must accept the same enum values.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The appended row is:

```text
2026-11-10T15:38:55.881Z	advised	schema-enums-agree	schemas/request.json	[{"id":"same-names","witnesses":[{"key":"0","value":"closed","side":"left"},{"key":"0","value":"open","side":"right"}],"total":2}]
```

A supplied diff replacing request `["open"]` with `["closed"]` also passes if both files on disk
contain `["open"]`. The judge reads both named sources from the working tree, not from the diff.

A `Bash` call containing `echo changed > schemas/request.json` prints nothing and exits 0 when
submitted as JSON with the same `tools` object. It records:

```text
2026-11-10T15:38:55.889Z	skipped	schema-enums-agree	schemas/request.json	no-observation
```

With both schemas containing `["open"]`, submit a session edit deleting `schemas/response.json`: set
`kind` to `delete`, keep its content as `pre`, and omit `post`. This records `blocked` and exits 2.

```text
discipline 'schema-enums-agree' cannot judge schemas/response.json: right — the world carries no source named 'right'
```

With neither schema on disk, submit a session edit creating `schemas/request.json` with `["open"]`
at `properties.status.enum`: set `kind` to `create`, omit `pre`, and supply the JSON as `post`. This
records `blocked` and exits 2.

```text
discipline 'schema-enums-agree' cannot judge schemas/request.json: right — the world carries no source named 'right'
```

Keep request at `["open"]` and remove `schemas/response.json` from the working tree. Submit the diff
removing response with `pdks covenant check --diff`, without `--enforce block`. This records
`blocked` and exits 2.

```text
discipline 'schema-enums-agree' cannot judge schemas/response.json: right — the world carries no source named 'right'
```

Start both schemas at `["1"]`, then edit request to `[1]`. This records `advised` and exits 0. The
first diagnostic line begins as follows and continues with the same ` — why: …` as above.

```text
discipline 'schema-enums-agree' broken on schemas/request.json: schema enum differs: 1 (+1)
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

**Check the registration**

Run `pdks explain` (exit 0). The entry line is:

```text
  declare  schema-enums-agree pairing · world · equal same-names · scope target.path · include 1 · exclude 0 · sources 2 · valve — · why ✓ · unattended: judge
```

The line omits `enforce: block` because the entry advises. For the diff producer and pipeline
failure handling, see [Git checks](../how-to/git-hooks.md#without-a-hook).

<a id="change-it"></a>
## Change it

Change `sources.left.file` (`schemas/request.json`) and `sources.right.file`
(`schemas/response.json`) to your two files. Update `scope.include` as well:
`^schemas/(request|response)\.json$` must name exactly those same two paths, including any changed
folder, basenames and escaped dots. Changing only `sources` leaves edits to the new files outside
scope.

Change both `select.path` values: the one under `leftValues` and the one under `rightValues`. These
are dot paths such as `properties.status.enum`, not JSON Pointer paths such as
`/properties/status/enum`. The two schemas can use different layouts, so choose each selector
separately and confirm it reaches an enum array.

Add `enforce: block` to the entry at the indentation of `why` to make a session block a judged edit.
A manual run also needs `--enforce block`; without it, the run still advises. Delete the entry to
remove the discipline. Run `pdks explain` after changes.

<a id="limits"></a>
## Limits

Values are compared as sets. `["closed", "open"]` equals `["open", "closed"]`, and
`["open", "open"]` equals `["open"]`. Types still matter: request `[1]` and response `["1"]` advise
with exit 0. This is value equality, not JSON Schema validation.

A missing `schemas/response.json`, or that file containing `{ invalid`, cannot be judged: the result
is `blocked`, exit 2, even though this entry advises. If both files are `{}`, both selectors produce
empty sets and pass. If only response is `{}` and request selects `["open", "closed"]`, the entry
advises.

Deleting either schema or creating the first schema before the other exists also cannot be judged.
This includes a diff removing a schema from the working tree. On both surfaces, inputs that cannot
be judged record `blocked` and exit 2, with or without `--enforce block`. Remove or change the entry
in the same change when retiring a schema; add the entry only once both files exist.

Editing the files one after the other advises on the first edit: adding `closed` to request while
response still has only `open` temporarily makes them differ. A session compares the proposed
content with the other file on disk.

On the change-set surface, both schemas come from the working tree. A diff proposing `["closed"]`
passes when both files currently contain `["open"]`. Staged or branch diffs therefore need
working-tree contents that match the revision you intend to judge; use a clean checkout in CI.
Partial staging can produce a verdict about different content from the staged content.

A shell write such as `echo changed > schemas/request.json` records `skipped` with `no-observation`
on the session surface. The change-set surface judges the result when the diff is produced.

These checks demonstrate the judge, not delivery from a live host. If the adapter or judge cannot
start, the call proceeds unjudged. Confirm the expected row in `.polydeukes/roi.log` after
connecting a session.
