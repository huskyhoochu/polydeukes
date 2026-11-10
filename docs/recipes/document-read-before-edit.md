# Check that the design document was read before source files are edited

**English** · [한국어](./document-read-before-edit.ko.md)

This applies when your project has a design document relevant to the selected source files. This
discipline checks for a successful earlier read in the session history before an edit. By default it
advises, so the edit still happens when that read is missing.

Session surface · reads earlier tool calls recorded as successful · default advice · change the
edited paths (`^src/`) and the document path in both patterns. Host support:
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
  - id: "document-read-before-edit"
    why: "reading the design document before editing the selected paths makes the recorded constraints available during the change."
    declare:
      mechanism: "precedent"
      scope: { source: "target.path", include: ["^src/"] }
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        shellReads:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - {
              op: "matches",
              re: '(?:^|[;&|\n]\s*)cat\s+(?:\S*/)?design/architecture\.md(?:[\s;&|]|$)',
            }
        fileReads:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Read"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.file_path" }
          - { op: "matches", re: '(?:^|/)design/architecture\.md$' }
        reads:
          - { op: "union", of: ["shellReads", "fileReads"] }
      relate:
        - id: "read-first"
          relation: { op: "nonEmpty", of: "reads" }
          message: "no successful read of the selected design document precedes this edit"
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

Adapt the edited paths and document path to the project. Change the document path in both the
shell-read and file-read patterns.
Then run pdks explain and confirm a line for document-read-before-edit.
This entry omits enforce and therefore advises; the line must not say enforce: block.
In an empty directory outside the project, use the file-writing tool to create this page’s original
YAML, violating.json and valid.json. Run the three checks from "Try it":
violating.json without an enforcement flag, violating.json with --enforce block,
and valid.json with --enforce block. Report the verdict word, exit code and enforcement setting.
Commands inside the JSON are history data and must not be run. A skipped verdict is not a successful
check. Check adapted patterns with separate inputs too. Do not commit or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "document-read-before-edit"
    why: "reading the design document before editing the selected paths makes the recorded constraints available during the change."
    declare:
      mechanism: "precedent"
      scope: { source: "target.path", include: ["^src/"] }
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        shellReads:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Bash"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.command" }
          - {
              op: "matches",
              re: '(?:^|[;&|\n]\s*)cat\s+(?:\S*/)?design/architecture\.md(?:[\s;&|]|$)',
            }
        fileReads:
          - { op: "source", of: "session" }
          - { op: "toolUses", names: ["Read"] }
          - { op: "filter", when: [{ field: "succeeded", eq: true }] }
          - { op: "select", path: "args.file_path" }
          - { op: "matches", re: '(?:^|/)design/architecture\.md$' }
        reads:
          - { op: "union", of: ["shellReads", "fileReads"] }
      relate:
        - id: "read-first"
          relation: { op: "nonEmpty", of: "reads" }
          message: "no successful read of the selected design document precedes this edit"
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
        "file_path": "src/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/example.ts",
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
        "file_path": "src/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/example.ts",
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
          "command": "cat design/architecture.md"
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
discipline 'document-read-before-edit' broken on src/example.ts: no successful read of the selected design document precedes this edit — why: reading the design document before editing the selected paths makes the recorded constraints available during the change.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The default is advice, so the edit still happens.

Now use the session enforcement setting:

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'document-read-before-edit' broken on src/example.ts: no successful read of the selected design document precedes this edit — why: reading the design document before editing the selected paths makes the recorded constraints available during the change.
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
2026-11-10T17:27:39.008Z	unattributed	baseline	/tmp/recipe/.polydeukes/baseline.json
2026-11-10T17:27:39.009Z	advised	document-read-before-edit	src/example.ts	[{"id":"read-first","witnesses":[{"key":"reads","value":null}],"total":1}]
2026-11-10T17:27:39.013Z	advised	document-read-before-edit	src/example.ts	[{"id":"read-first","witnesses":[{"key":"reads","value":null}],"total":1}]
2026-11-10T17:27:39.018Z	passed	document-read-before-edit	src/example.ts
```

The `unattributed` row observes the missing baseline and is not a verdict for this entry; see
[troubleshooting](../troubleshooting.md).

**Earlier calls that count**

For an edit of `src/example.ts`, each of these earlier calls with `succeeded: true` records
`passed`, prints nothing and exits 0:

- `Read` with `args.file_path` equal to `design/architecture.md` or
  `/project/design/architecture.md`.
- `Bash` with `args.command` equal to `cat design/architecture.md`, `cat ./design/architecture.md`,
  or `cat /project/design/architecture.md`.
- `Bash` with `true; cat design/architecture.md`, `true && cat design/architecture.md`, or
  `true | cat design/architecture.md`.
- `Bash` with `cd .\ncat design/architecture.md`, where `\n` is a newline in the command.
- `Bash` with `cat design/architecture.md;echo done` or `cat design/architecture.md | head -n 5`.
- `Bash` with `echo "x; cat design/architecture.md y"`. This only mentions the read, but its text
  matches.

One successful `Read` of `design/architecture.md` also passes both later edits of `src/a.ts` and
`src/b.ts` by the same agent in its session.

**Earlier calls that do not count**

For the same edit of `src/example.ts`, each input below records `advised`, prints the same error and
advisory summary as the first run, and exits 0:

- Successful `Bash` calls with `cat -n design/architecture.md`, `cat "design/architecture.md"`, or
  `cat design/other.md design/architecture.md`.
- Successful `Bash` calls with `head design/architecture.md` or `echo cat design/architecture.md`.
- Successful `Bash` calls with `cat design/other.md` or `cat design/architecture.md.bak`.
- Successful `Read` calls for `design/other.md`, `xdesign/architecture.md`, or
  `design/architecture.md.bak`.
- `Read` of `design/architecture.md` or `Bash` with `cat design/architecture.md` when `succeeded` is
  `false` or absent.
- A successful `Edit` of `design/architecture.md` as the only earlier call.

With an empty history, modifying `src/x/y.ts` from `old\n` to `new\n` and creating `src/new.ts` with
`new\n` also advise and exit 0. Their respective stderr is:

```text
discipline 'document-read-before-edit' broken on src/x/y.ts: no successful read of the selected design document precedes this edit — why: reading the design document before editing the selected paths makes the recorded constraints available during the change.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

```text
discipline 'document-read-before-edit' broken on src/new.ts: no successful read of the selected design document precedes this edit — why: reading the design document before editing the selected paths makes the recorded constraints available during the change.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

An edit of `notes.txt` from `old\n` to `new\n` with an empty history is outside scope. It prints
nothing, exits 0, and records `passed covenant-check` for `notes.txt`, not a verdict for this entry.

Copy `violating.json` to `missing.json` and remove the entire `session` field.

```sh
pdks covenant check < missing.json
```

This prints nothing and exits 0, recording `skipped` with `supply-pass`. This differs from the empty
history’s `advised` and is not a successful check.

```text
2026-11-10T17:27:39.022Z	skipped	document-read-before-edit	src/example.ts	supply-pass
```

Copy `violating.json` to `shell.json` and replace its top-level call with this object. Include no
`fileChange`; keep the empty `session` and the other fields.

```json
{
  "name": "Bash",
  "args": {
    "command": "sed -i 's/old/new/' src/example.ts"
  }
}
```

```sh
pdks covenant check < shell.json
```

The `sed -i 's/old/new/' src/example.ts` input prints nothing and exits 0. It records `skipped` with
`no-observation`.

```text
2026-11-10T17:27:39.027Z	skipped	document-read-before-edit	src/example.ts	no-observation
```

Save this as `change.diff`.

```diff
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-old
+new
```

```sh
pdks covenant check --diff < change.diff
```

This prints nothing and exits 0. The change-set surface does not judge this entry. The generic
`passed covenant-check` row is not a verdict for this discipline.

```text
2026-11-10T17:27:39.032Z	passed	covenant-check	src/example.ts
```

**In a real session**

Run:

```sh
pdks explain
```

It exits 0 and includes this line for the entry:

```text
  declare  document-read-before-edit precedent · history · nonEmpty read-first · scope target.path · include 1 · exclude 0 · sources 1 (transcript 1) · valve — · why ✓ · unattended: judge
```

The line omits `enforce: block` because the entry advises. In a connected session, perform the
actual read or lookup, then edit a selected file and inspect the verdict in `.polydeukes/roi.log`.

See the [Claude Code adapter](../reference/packages/adapter-claude-code.md),
[Codex adapter](../reference/packages/adapter-codex.md), and
[connect-surfaces guide](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Change each project-specific value:

- `scope.include: ["^src/"]` selects edited paths starting with `src/`, including nested paths such
  as `src/x/y.ts`. Replace this pattern with your source directory pattern.
- In `shellReads`, replace `design/architecture\.md` inside
  `(?:^|[;&|\n]\s*)cat\s+(?:\S*/)?design/architecture\.md(?:[\s;&|]|$)` with your document path,
  escaping dots and other regular-expression characters. Keep the surrounding command and path
  boundaries if you want the same matching behavior.
- In `fileReads`, replace the same document path inside `(?:^|/)design/architecture\.md$`. Change
  both patterns together so shell and file-tool reads select the same document.

The shell pattern accepts `cat` at the start, on a later line, or after `;`, `&&` or `|`, with the
document as its first operand. The file-read pattern matches a relative path or an absolute path
ending in the selected document path. Both extractors select only calls with `succeeded: true`;
their union supplies the read evidence. These patterns do not resolve filesystem identity.

Add `enforce: block` to the entry, at the same indentation as `why`, to make a session block the
edit. A manual run then also needs `--enforce block`; without it, the run still advises. Delete the
entry to remove the discipline. After changes, run `pdks explain` and check both matching and
non-matching inputs for the new patterns.

<a id="limits"></a>
## Limits

One successful read satisfies every later edit in scope by the same agent for the rest of its
session. The successful `Read` of `design/architecture.md` followed by edits of `src/a.ts` and
`src/b.ts` passes both; it does not establish a fresh read before each edit or that the text was
understood.

The pattern matches text: `echo "x; cat design/architecture.md y"` passes without reading the file.
`cat design/architecture.md | head -n 5` also passes, so a pass does not establish that the whole
document was read. Conversely, `cat -n design/architecture.md`, `cat "design/architecture.md"`, and
`cat design/other.md design/architecture.md` advise despite naming the document.

A successful read of `design/other.md`, `xdesign/architecture.md`, or `design/architecture.md.bak`
does not satisfy the file-read pattern. A failed `Read` of `design/architecture.md`, or one with no
recorded success, advises. An `Edit` of that document is not a read.

The `src/example.ts` edit with no `session` records `skipped` with `supply-pass`; with an empty
`session.toolCalls` it advises. The shell write `sed -i 's/old/new/' src/example.ts` records
`skipped` with `no-observation`. The diff changing `src/example.ts` from `old` to `new` receives
only a generic pass: the change-set surface does not judge this entry.

This entry does not read the command line or file content of the judged edit. It reads earlier calls
supplied by the adapter.

This entry counts only earlier calls recorded as successful. With a host that does not record
success, every edit in scope advises. The measured earlier `Read` of `design/architecture.md` with
no `succeeded` field also advises. See [call success](../reference/host-support.md#call-success).

Earlier calls are the ones the host supplies for the agent making the edit; see
[history scope](../reference/host-support.md#history-scope).

These JSON checks do not prove delivery of evidence by a live host. If the adapter or judge cannot
start, the call proceeds unjudged. Confirm rows in `.polydeukes/roi.log` after wiring.
