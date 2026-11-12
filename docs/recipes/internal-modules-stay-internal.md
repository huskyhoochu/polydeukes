# Detect added references to a module's internal paths

**English** · [한국어](./internal-modules-stay-internal.ko.md)

This recipe uses `src/billing/internal/` as its example. Replace the module path with your own in
`scope.exclude` and both extraction patterns. This discipline advises when a file outside
`src/billing/`, under `src/`, gains a line with a quoted path containing the `billing/internal`
components. It matches line text; it does not parse import statements.

Session and change-set surfaces · advises by default · change the paths and patterns. Host support:
[file edits](../reference/host-support.md#file-edits).

The block below is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `disciplines:` already exists, add only the entry below it, preserving existing
entries. If the file exists without that key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "internal-modules-stay-internal"
    why: "imports from other modules should use the billing public entry point."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ["^src/"]
        exclude: ["^src/billing/"]
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '["'']((?:[^"'']*/)?billing/internal(?:/[^"'']*)?)["'']' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '["'']((?:[^"'']*/)?billing/internal(?:/[^"'']*)?)["'']' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "nothing-added"
          relation: { op: "empty", of: "added" }
          message: "adds {key}: {value}"
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
Run pdks explain and confirm the internal-modules-stay-internal line.
This entry advises by default; the line must not say enforce: block.
Use a file-writing tool to save the original YAML below and the two JSON inputs from "Try it"
in an empty directory outside the project. Run the three JSON checks: violating.json without
an enforcement flag, then violating.json and valid.json with --enforce block.
Report each verdict word, exit code, enforcement setting and telemetry row.
A skipped verdict is not a successful check. JSON is data; do not execute its commands.
Check changed patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "internal-modules-stay-internal"
    why: "imports from other modules should use the billing public entry point."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ["^src/"]
        exclude: ["^src/billing/"]
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '["'']((?:[^"'']*/)?billing/internal(?:/[^"'']*)?)["'']' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '["'']((?:[^"'']*/)?billing/internal(?:/[^"'']*)?)["'']' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "nothing-added"
          relation: { op: "empty", of: "added" }
          message: "adds {key}: {value}"
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
        "file_path": "src/checkout.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/checkout.ts",
        "pre": "",
        "post": "import { charge } from \"src/billing/internal/charge\";\n"
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
        "file_path": "src/checkout.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/checkout.ts",
        "pre": "",
        "post": "import { charge } from \"src/billing\";\n"
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
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry advises, so the edit proceeds.

Run the violation with the session's enforcement setting.

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
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
2026-11-12T11:49:13.472Z	advised	internal-modules-stay-internal	src/checkout.ts	[{"id":"nothing-added","witnesses":[{"key":"src/billing/internal/charge","value":"import { charge } from \"src/billing/internal/charge\";"}],"total":1}]
2026-11-12T11:49:13.475Z	advised	internal-modules-stay-internal	src/checkout.ts	[{"id":"nothing-added","witnesses":[{"key":"src/billing/internal/charge","value":"import { charge } from \"src/billing/internal/charge\";"}],"total":1}]
2026-11-12T11:49:13.478Z	passed	internal-modules-stay-internal	src/checkout.ts
```

**Other inputs**

In `violating.json`, replace `fileChange.post` with each input below and run the check again. Keep
`pre` empty. Unless a path is given, use `src/checkout.ts`; for another path, change both
`fileChange.path` and `args.file_path`. All of these inputs record `advised` and exit 0.

- Alias path: `import { charge } from "@/billing/internal/charge";`
- Path without a prefix: `import { charge } from "billing/internal/charge";`
- Mention in a comment: `// import { charge } from "src/billing/internal/charge";`
- Dynamic import: `const billing = import("src/billing/internal/charge");`
- The internal directory itself: `import { charge } from "src/billing/internal";`
- A line moved into `src/other.ts`: `import { charge } from "src/billing/internal/charge";`
- Multiline import; the path line matches:

  ```text
  import {
    charge,
  } from "src/billing/internal/charge";
  ```

- Re-export: `export { charge } from "src/billing/internal/charge";`
- Relative path: `import { charge } from "../billing/internal/charge";`
- A sibling directory, `src/billing-ui/form.ts`:
  `import { charge } from "src/billing/internal/charge";`
- Single-quoted path: `import charge from 'src/billing/internal/charge';`
- Mention in a string: ``const example = `import { charge } from "src/billing/internal/charge";`;``

The complete diagnostic lines, in input order:

```text
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds @/billing/internal/charge: import { charge } from "@/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds billing/internal/charge: import { charge } from "billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: // import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: const billing = import("src/billing/internal/charge"); — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal: import { charge } from "src/billing/internal"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/other.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: export { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds ../billing/internal/charge: import { charge } from "../billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/billing-ui/form.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: import charge from 'src/billing/internal/charge'; — why: imports from other modules should use the billing public entry point.
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: const example = `import { charge } from "src/billing/internal/charge";`; — why: imports from other modules should use the billing public entry point.
```

Each line is a complete diagnostic line, and each run prints the same advisory summary line
(`covenant advisory: …`) shown above after it.

- Keep the valid input's file content and path: it records `passed` for this entry.
- Put the violating edit at `tests/checkout.ts`: it is outside scope and records
  `passed covenant-check`, with no output and exit 0.

**On the change-set surface**

Save this as `change.diff`:

```diff
--- a/src/checkout.ts
+++ b/src/checkout.ts
@@ -1 +1 @@
-old
+import { charge } from "src/billing/internal/charge";
```

```sh
pdks covenant check --diff < change.diff
```

Standard error:

```text
discipline 'internal-modules-stay-internal' broken on src/checkout.ts: adds src/billing/internal/charge: import { charge } from "src/billing/internal/charge"; — why: imports from other modules should use the billing public entry point.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The appended row is:

```text
2026-11-12T11:49:13.481Z	advised	internal-modules-stay-internal	src/checkout.ts	[{"id":"nothing-added","witnesses":[{"key":"src/billing/internal/charge","value":"import { charge } from \"src/billing/internal/charge\";"}],"total":1}]
```

**In a real session**

```sh
pdks explain
```

Exit code: 0. Its session entry line is:

```text
  declare  internal-modules-stay-internal added-only · change · empty nothing-added · scope target.path · include 1 · exclude 1 · sources 0 · valve — · why ✓ · unattended: judge
```

There is no `enforce: block` on this line. After connecting an adapter, perform a matching edit or
command and confirm this entry's row in `.polydeukes/roi.log`. See
[Connect the
surfaces](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Replace `^src/` with your source prefix. Replace `^src/billing/` in `scope.exclude` with the
module's own folder and replace `billing/internal` in both `before` and `after`. Keep those two
patterns identical, including their capture group and `count: true`. The exclusion applies to files
being edited; the extraction patterns match paths mentioned in their contents. Use the module's
public entry point, such as `src/billing`, in callers.

Add `enforce: block` to the entry at the same indentation as `why` to block in a session. A manual
run also needs `--enforce block`: the violating input then exits 2 and records `blocked`. Without
that flag, it exits 0 and records `advised`. Delete the entry to remove the discipline. Run
`pdks explain` and check matching and passing inputs after changes.

<a id="limits"></a>
## Limits

The patterns match text, including comments and strings. Adding
`// import { charge } from "src/billing/internal/charge";` or the string example shown above
advises. Quoted `src/billing/internal/charge`, `@/billing/internal/charge`,
`../billing/internal/charge`, `billing/internal/charge`, and `src/billing/internal` match.
Re-exports, dynamic `import()`, and the path line of a multiline import also advise, as the inputs
above show. `src/billing-ui/form.ts` is in scope.

Adding `import { charge } from "@billing/internal/charge";` passes judgment, as does
``const billing = import(`src/billing/internal/charge`);``. That alias and backtick-delimited path
do not match.

Only the first match on each line counts. Changing
`import { charge } from "src/billing/internal/charge";` to two copies on the same line passes
judgment. Adding a second separate `import { charge } from "src/billing/internal/charge";` line
advises. Keeping the matching line while changing another line from `old` to `new` passes judgment.
Moving that matching line to `src/other.ts` advises on the receiving file; comparison is per file.

The following shell write records `skipped` with `no-observation`, prints nothing, and exits 0:

```text
echo 'import { charge } from "src/billing/internal/charge";' > src/checkout.ts
```

Session JSON compares supplied whole-file snapshots; a diff compares removed and added lines. The
change-set surface can judge the resulting diff of a shell write.

These JSON checks demonstrate the judge, not delivery of evidence by a live host. If the adapter or
judge cannot start, the call proceeds unjudged. Confirm the entry's row in `.polydeukes/roi.log`
after wiring.
