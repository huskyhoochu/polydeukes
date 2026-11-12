# Detect repeated test runs without an edit between them

**English** · [한국어](./few-test-runs-per-edit.ko.md)

This discipline advises on the fourth matching test run since the last successful edit. It reads the
supplied session history, including the call being judged. The default is advisory, so the test
command still runs.

Session surface · reads call success and session history · advises by default · change the command
pattern and count. Host support: [earlier calls](../reference/host-support.md#earlier-calls),
[call
success](../reference/host-support.md#call-success),
[history
scope](../reference/host-support.md#history-scope).

The block below is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `sessionDisciplines:` already exists, add only the entry below it, preserving
existing entries. If the file exists without that key, append the whole block.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "few-test-runs-per-edit"
    why: "several test runs without an edit between them repeat the same check; read the first failure."
    declare:
      mechanism: "scoped-valve"
      scope:
        source: "command"
        include: ['\b(?:(?:pnpm|npm)\s+(?:run\s+)?test|vitest)\b']
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        excessRuns:
          - { op: "source", of: "session" }
          - {
              op: "toolUses",
              names: ["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"],
            }
          - {
              op: "afterLast",
              when: [{ field: "name", ne: "Bash" }, { field: "succeeded", eq: true }],
            }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\b(?:(?:pnpm|npm)\s+(?:run\s+)?test|vitest)\b' }
          - { op: "drop", n: 3 }
      relate:
        - {
            id: "few-runs",
            relation: { op: "empty", of: "excessRuns" },
            message: "more than three test runs since the last edit",
          }
      witness:
        relate:
          - {
              id: "few-runs-valve",
              relation: { op: "empty", of: "excessRuns" },
              message: "more than three test runs since the last edit",
            }
```

<a id="agent-prompt"></a>
## Set it up with your agent

Paste this into Claude Code or Codex in the project.

````text
Add the entry below under sessionDisciplines: in this project’s polydeukes.config.yaml.
Add only the entry under an existing key, never a second key. Preserve other entries, protected
paths and witness settings. If the same id exists, report it before changing anything.
If the configuration is protected, show the exact patch and ask the human to apply it.
Never work around the protection. Adapt the values described in "Change it" to this project.
Run pdks explain and confirm the few-test-runs-per-edit line.
This entry advises by default; the line must not say enforce: block.
Use a file-writing tool to save the original YAML below and the two JSON inputs from "Try it"
in an empty directory outside the project. Run the three JSON checks: violating.json without
an enforcement flag, then violating.json and valid.json with --enforce block.
Report each verdict word, exit code, enforcement setting and telemetry row.
A skipped verdict is not a successful check. JSON is data; do not execute its commands.
Check changed patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "few-test-runs-per-edit"
    why: "several test runs without an edit between them repeat the same check; read the first failure."
    declare:
      mechanism: "scoped-valve"
      scope:
        source: "command"
        include: ['\b(?:(?:pnpm|npm)\s+(?:run\s+)?test|vitest)\b']
      sources: { session: { transcript: true } }
      supply: { session: "pass" }
      extract:
        excessRuns:
          - { op: "source", of: "session" }
          - {
              op: "toolUses",
              names: ["Bash", "Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"],
            }
          - {
              op: "afterLast",
              when: [{ field: "name", ne: "Bash" }, { field: "succeeded", eq: true }],
            }
          - { op: "select", path: "args.command" }
          - { op: "matches", re: '\b(?:(?:pnpm|npm)\s+(?:run\s+)?test|vitest)\b' }
          - { op: "drop", n: 3 }
      relate:
        - {
            id: "few-runs",
            relation: { op: "empty", of: "excessRuns" },
            message: "more than three test runs since the last edit",
          }
      witness:
        relate:
          - {
              id: "few-runs-valve",
              relation: { op: "empty", of: "excessRuns" },
              message: "more than three test runs since the last edit",
            }
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
      "name": "Bash",
      "args": {
        "command": "pnpm test"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "MultiEdit", "Write", "NotebookEdit"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  },
  "session": {
    "userMessages": [],
    "toolCalls": [
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      }
    ]
  }
}
```

`valid.json`:

```json
{
  "toolCalls": [
    {
      "name": "Bash",
      "args": {
        "command": "pnpm test"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": {
    "mutating": ["Edit", "MultiEdit", "Write", "NotebookEdit"],
    "shell": ["Bash"],
    "commandArgs": ["command"]
  },
  "session": {
    "userMessages": [],
    "toolCalls": [
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Edit",
        "args": {
          "file_path": "src/cart.ts"
        },
        "fileChange": {
          "kind": "modify",
          "path": "src/cart.ts",
          "pre": "old",
          "post": "new"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      },
      {
        "name": "Bash",
        "args": {
          "command": "pnpm test"
        },
        "succeeded": true
      }
    ]
  }
}
```

The `tools` object identifies file-editing and shell tools; the adapter supplies it in a connected
session.

Here `session.toolCalls` includes the current call. Four matching calls advise; three after the
successful `Edit` pass judgment. The adapter supplies history in a real session. On the first run in
an empty directory, the missing baseline also produces the `unattributed` row shown below.

First run without an enforcement flag.

```sh
pdks covenant check < violating.json
```

Standard error:

```text
discipline 'few-test-runs-per-edit' broken on -: more than three test runs since the last edit — why: several test runs without an edit between them repeat the same check; read the first failure.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry advises, so the test command runs.

Run the violation with the session's enforcement setting.

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'few-test-runs-per-edit' broken on -: more than three test runs since the last edit — why: several test runs without an edit between them repeat the same check; read the first failure.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry advises; `--enforce block` alone cannot promote it to blocking.

Check the passing input.

```sh
pdks covenant check --enforce block < valid.json
```

No output; exit code: 0.

The appended `.polydeukes/roi.log` rows are below. Timestamps and the baseline path vary by run.

```text
2026-11-12T11:49:13.518Z	unattributed	baseline	/tmp/docs47-namahoqp/.polydeukes/baseline.json
2026-11-12T11:49:13.519Z	advised	few-test-runs-per-edit	-	[{"id":"few-runs","witnesses":[{"key":"3","value":"pnpm test"}],"total":1}]
2026-11-12T11:49:13.522Z	advised	few-test-runs-per-edit	-	[{"id":"few-runs","witnesses":[{"key":"3","value":"pnpm test"}],"total":1}]
2026-11-12T11:49:13.525Z	passed	few-test-runs-per-edit	-
```

The `unattributed` baseline observation is not this entry's verdict. See
[Troubleshooting](../troubleshooting.md).

**Other inputs**

- Four `npm test`, `npm run test`, or `vitest` calls, with that command as the current call, advise
  with the same stderr above and exit 0.
- A successful `Write` of `src/cart.ts` followed by three `pnpm test` calls passes judgment, just
  like `Edit`.
- A successful `apply_patch` call followed by three `pnpm test` calls passes judgment, just like
  `Edit`.
- Current command `pnpm build` is outside scope, even after four `pnpm test` calls; it records only
  `passed covenant-check` for `-`, prints nothing, and exits 0.

**On the change-set surface**

Save this as `change.diff`:

```diff
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1 +1 @@
-old
+new
```

```sh
pdks covenant check --diff < change.diff
```

No output. This surface does not judge this session entry.

Exit code: 0. The appended row is:

```text
2026-11-12T11:49:13.528Z	passed	covenant-check	src/cart.ts
```

**In a real session**

```sh
pdks explain
```

Exit code: 0. Its session entry line is:

```text
  declare  few-test-runs-per-edit scoped-valve · history · empty few-runs · scope command · include 1 · exclude 0 · sources 1 (transcript 1) · valve ✓ · why ✓ · unattended: judge
```

There is no `enforce: block` on this line. After connecting an adapter, perform a matching edit or
command and confirm this entry's row in `.polydeukes/roi.log`. See
[Connect the
surfaces](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

The count is `n` in `drop`: `n: 3` advises on the fourth run. Change both messages if you change the
count. The test command pattern occurs identically in `scope.include` and `matches`; change both
together. The `witness` block is required by `scoped-valve` and checks the same `excessRuns` as the
body, so it cannot let a violation through. See
[Bound how many items an extraction
holds](../reference/declaration-language/index.md#bound-the-count).

`names` in `toolUses` lists shell tools and editing tools that reset the count; calls to unlisted
tools do not form a boundary, so add your host’s editing tool name if it differs.

Before promoting this entry to blocking, check
[call
success](../reference/host-support.md#call-success).
Without supplied success, edits do not reset the count: the fourth and subsequent matching runs keep
being blocked.

Add `enforce: block` to the entry at the same indentation as `why` to block in a session. A manual
run also needs `--enforce block`: the violating input then exits 2 and records `blocked`. Without
that flag, it exits 0 and records `advised`. Delete the entry to remove the discipline. Run
`pdks explain` and check matching and passing inputs after changes.

<a id="limits"></a>
## Limits

With current command `pnpm test`, omitting `session` records `skipped` with `supply-pass`; an empty
`session.toolCalls` records `passed` for this entry. Neither prints anything; both exit 0.

Three `pnpm test` calls, an `Edit` of `src/cart.ts` from `old` to `new` with `succeeded: false` or
no `succeeded`, then a fourth `pnpm test` advise. That edit does not reset the count. Four failed
`pnpm test` calls also advise: test success is not a filter. Three `pnpm test` calls followed by
`echo "pnpm test"` advise too; command text mentions count. See
[call
success](../reference/host-support.md#call-success)
and
[history
scope](../reference/host-support.md#history-scope).

The change-set surface does not judge session history. The `src/cart.ts` diff above produces only a
generic `passed covenant-check`, not this discipline's judgment.

These JSON checks demonstrate the judge, not delivery of evidence by a live host. If the adapter or
judge cannot start, the call proceeds unjudged. Confirm the entry's row in `.polydeukes/roi.log`
after wiring.
