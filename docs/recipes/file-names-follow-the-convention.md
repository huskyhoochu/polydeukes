# Detect source file names with uppercase letters or underscores

**English** · [한국어](./file-names-follow-the-convention.ko.md)

This discipline advises when the last path component of a file under `src/` contains an uppercase
letter or underscore. Editing an existing file with such a name also advises; this is not limited to
file creation.

Session and change-set surfaces · advises by default · change the paths and patterns. Host support:
[file edits](../reference/host-support.md#file-edits).

The block below is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `disciplines:` already exists, add only the entry below it, preserving existing
entries. If the file exists without that key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "file-names-follow-the-convention"
    why: "consistent file names make source paths easier to read and find."
    declare:
      mechanism: "naming"
      scope: { source: "target.path", include: ["^src/"] }
      extract:
        invalidNames:
          - { op: "source", of: "target.path" }
          - { op: "matches", re: "[^/]*[A-Z_][^/]*$" }
      relate:
        - id: "file-name"
          relation: { op: "empty", of: "invalidNames" }
          message: "use a file name without uppercase letters or underscores: {value}"
```

<a id="agent-prompt"></a>
## Set it up with your agent

Paste this into Claude Code or Codex in the project.

````text
Add the entry below under disciplines: in this project’s polydeukes.config.yaml.
Add only the entry under an existing key, never a second key. Preserve other entries, protected
paths and witness settings. If the same id exists, report it before changing anything.
If the configuration is protected, show the exact patch and ask the human to apply it.
Never work around the protection. Adapt the values described in "Change it" to this project.
Run pdks explain and confirm the file-names-follow-the-convention line.
This entry advises by default; the line must not say enforce: block.
Use a file-writing tool to save the original YAML below and the two JSON inputs from "Try it"
in an empty directory outside the project. Run the three JSON checks: violating.json without
an enforcement flag, then violating.json and valid.json with --enforce block.
Report each verdict word, exit code, enforcement setting and telemetry row.
A skipped verdict is not a successful check. JSON is data; do not execute its commands.
Check changed patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "file-names-follow-the-convention"
    why: "consistent file names make source paths easier to read and find."
    declare:
      mechanism: "naming"
      scope: { source: "target.path", include: ["^src/"] }
      extract:
        invalidNames:
          - { op: "source", of: "target.path" }
          - { op: "matches", re: "[^/]*[A-Z_][^/]*$" }
      relate:
        - id: "file-name"
          relation: { op: "empty", of: "invalidNames" }
          message: "use a file name without uppercase letters or underscores: {value}"
```
````

<a id="try-it"></a>
## Try it

In an empty directory, save the YAML above as `polydeukes.config.yaml` and these two inputs. The
judge reads the JSON; it does not execute the commands or edits.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "src/Cart.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/Cart.ts",
        "pre": "old\n",
        "post": "new\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "MultiEdit", "Write", "NotebookEdit"],
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
        "file_path": "src/cart-item.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/cart-item.ts",
        "pre": "old\n",
        "post": "new\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "MultiEdit", "Write", "NotebookEdit"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  }
}
```

The `tools` object identifies file-editing and shell tools; the adapter supplies it in a connected
session.

First run without an enforcement flag.

```sh
pdks covenant check < violating.json
```

Standard error:

```text
discipline 'file-names-follow-the-convention' broken on src/Cart.ts: use a file name without uppercase letters or underscores: src/Cart.ts — why: consistent file names make source paths easier to read and find.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry advises, so the edit proceeds.

Run the violation with the session's enforcement setting.

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'file-names-follow-the-convention' broken on src/Cart.ts: use a file name without uppercase letters or underscores: src/Cart.ts — why: consistent file names make source paths easier to read and find.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry advises; `--enforce block` alone cannot promote it to blocking.

Check the passing input.

```sh
pdks covenant check --enforce block < valid.json
```

No output; exit code: 0.

The appended `.polydeukes/roi.log` rows are below. Timestamps vary by run.

```text
2026-11-12T11:49:13.542Z	advised	file-names-follow-the-convention	src/Cart.ts	[{"id":"file-name","witnesses":[{"key":"0","value":"src/Cart.ts"}],"total":1}]
2026-11-12T11:49:13.545Z	advised	file-names-follow-the-convention	src/Cart.ts	[{"id":"file-name","witnesses":[{"key":"0","value":"src/Cart.ts"}],"total":1}]
2026-11-12T11:49:13.547Z	passed	file-names-follow-the-convention	src/cart-item.ts
```

**Other inputs**

In `violating.json`, keep `post` as `new\n` and change both `fileChange.path` and `args.file_path`
to the path below. Keep the other fields and run the check again. This input records `advised` and
exits 0.

- Underscore in the file name, `src/cart_item.ts`: `new`

The complete diagnostic line:

```text
discipline 'file-names-follow-the-convention' broken on src/cart_item.ts: use a file name without uppercase letters or underscores: src/cart_item.ts — why: consistent file names make source paths easier to read and find.
```

This is the complete diagnostic line, and each run prints the same advisory summary line
(`covenant advisory: …`) shown above after it.

- Keep the valid input's file content and path: it records `passed` for this entry.
- Put the violating edit at `tests/Cart.ts`: it is outside scope and records
  `passed covenant-check`, with no output and exit 0.

**On the change-set surface**

Save this as `change.diff`:

```diff
--- a/src/Cart.ts
+++ b/src/Cart.ts
@@ -1 +1 @@
-old
+new
```

```sh
pdks covenant check --diff < change.diff
```

Standard error:

```text
discipline 'file-names-follow-the-convention' broken on src/Cart.ts: use a file name without uppercase letters or underscores: src/Cart.ts — why: consistent file names make source paths easier to read and find.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The appended row is:

```text
2026-11-12T11:49:13.550Z	advised	file-names-follow-the-convention	src/Cart.ts	[{"id":"file-name","witnesses":[{"key":"0","value":"src/Cart.ts"}],"total":1}]
```

**In a real session**

```sh
pdks explain
```

Exit code: 0. Its session entry line is:

```text
  declare  file-names-follow-the-convention naming · change · empty file-name · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

There is no `enforce: block` on this line. After connecting an adapter, perform a matching edit or
command and confirm this entry's row in `.polydeukes/roi.log`. See
[Connect the
surfaces](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Change `scope.include` for the folders to check and `matches.re` for the invalid file-name pattern.
`[^/]*[A-Z_][^/]*$` checks only the last path component. If existing files use other names, add
their paths to `scope.exclude`. For example, add `exclude: ['^src/Cart\.ts$']` inside `scope`. The
`src/Cart.ts` edit above then prints nothing, exits 0, and records only `passed covenant-check` for
`src/Cart.ts`; this discipline does not judge the excluded file.

Add `enforce: block` to the entry at the same indentation as `why` to block in a session. A manual
run also needs `--enforce block`: the violating input then exits 2 and records `blocked`. Without
that flag, it exits 0 and records `advised`. Delete the entry to remove the discipline. Run
`pdks explain` and check matching and passing inputs after changes.

<a id="limits"></a>
## Limits

Only the last path component is checked: editing `src/MyDir/file.ts` passes judgment. Editing or
deleting existing `src/Cart.ts` advises. A rename diff from `src/Cart.ts` to `src/cart.ts` advises
on the old path and records `passed` on the new path. A rename in the opposite direction advises on
`src/Cart.ts` too.

The shell command `echo content > src/Cart.ts` records `skipped` with `no-observation`, prints
nothing, and exits 0. A diff of its resulting file can be judged on the change-set surface.

These JSON checks demonstrate the judge, not delivery of evidence by a live host. If the adapter or
judge cannot start, the call proceeds unjudged. Confirm the entry's row in `.polydeukes/roi.log`
after wiring.
