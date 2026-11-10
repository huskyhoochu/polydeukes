# Detect when an implementer subagent edits tests

**English** · [한국어](./tests-are-the-writers.ko.md)

This applies when your project assigns test writing and implementation to separate subagents, and
the implementing subagent has a fixed agent type name. This discipline advises when `implementer`
makes an observed file change under `tests/`. With the default, the edit still happens.

Session surface · reads the actor · advises by default · values to change: the test path pattern and
the subagent name. Host support: [file edits](../reference/host-support.md#file-edits) and
[actor](../reference/host-support.md#actor).

The block below is a complete `polydeukes.config.yaml`; if you have no configuration yet, save it as
that file in the project root. If the file already has a `sessionDisciplines:` key, paste only the
entry (everything below the first line) under the existing key and keep the existing entries. If the
file exists but has no `sessionDisciplines:` key, as with the file `pdks init` writes, append the
whole block to the end of the file.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "tests-are-the-writers"
    why: "the implementer should satisfy the existing tests without changing those tests."
    declare:
      mechanism: "producer-owned"
      scope: { source: "target.path", include: ["^tests/"] }
      supply: { actor: "pass" }
      extract:
        implementer:
          - { op: "source", of: "actor" }
          - { op: "select", path: "agentType" }
          - { op: "matches", re: "^implementer$" }
      relate:
        - id: "not-the-implementer"
          relation: { op: "empty", of: "implementer" }
          message: "the implementer subagent wrote a test file"
```

<a id="agent-prompt"></a>
## Set it up with your agent

Paste this into Claude Code or Codex in the project.

````text
Add the entry below under sessionDisciplines: in this project's polydeukes.config.yaml.
The block shows the entry under its list key. In an existing configuration, add only the entry
under the existing key, never a second key. Preserve every other entry, protected path and witness
setting. If an entry with the same id exists, report it and wait.

Adapt the test path pattern and exact implementer agentType name to this project.
Use the name supplied by the host, not a role written in a prompt.
If the configuration file is protected in this session, show the exact patch and ask the human
to apply it. Never work around the protection.

Run pdks explain and confirm a line for tests-are-the-writers.
This entry omits enforce and therefore advises; the line must not say enforce: block.
Create an empty directory outside the project and use the file-writing tool to save the unchanged
example YAML, violating.json and valid.json there. Run the three checks from "Try it":
violating.json without an enforcement flag, violating.json with --enforce block, and valid.json
with --enforce block. Report the verdict word, exit code and enforcement setting for each.
A skipped verdict is not a successful check. These inputs demonstrate judgment, not host-observed
actor identity. Do not execute embedded commands, edit real tests, commit, or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  - id: "tests-are-the-writers"
    why: "the implementer should satisfy the existing tests without changing those tests."
    declare:
      mechanism: "producer-owned"
      scope: { source: "target.path", include: ["^tests/"] }
      supply: { actor: "pass" }
      extract:
        implementer:
          - { op: "source", of: "actor" }
          - { op: "select", path: "agentType" }
          - { op: "matches", re: "^implementer$" }
      relate:
        - id: "not-the-implementer"
          relation: { op: "empty", of: "implementer" }
          message: "the implementer subagent wrote a test file"
```
````

<a id="try-it"></a>
## Try it

In an empty directory, save the YAML above as `polydeukes.config.yaml` and save these two inputs.
`pdks covenant check` judges the JSON; it does not perform the file edit described inside it.

`violating.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": {
        "file_path": "tests/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "tests/example.ts",
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
  "actor": {
    "agentType": "implementer"
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
        "file_path": "tests/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "tests/example.ts",
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
  "actor": {
    "agentType": "test-writer"
  }
}
```

`actor` is evidence of who makes the edit, supplied by the adapter in a real session. A hand-written
input shows how the entry judges, not that a host observed that actor.

The `tools` object identifies file-changing tools, shell tools and command arguments for the judge.
The adapter supplies it in a real session too.

First, run without an enforcement flag:

```sh
pdks covenant check < violating.json
```

Standard error:

```text
discipline 'tests-are-the-writers' broken on tests/example.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. It records `advised`, and the edit still happens.

Now use the session enforcement setting:

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'tests-are-the-writers' broken on tests/example.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. `--enforce block` does not promote an advising entry.

Check the valid input:

```sh
pdks covenant check --enforce block < valid.json
```

This prints nothing and exits 0.

These three rows are appended to `.polydeukes/roi.log`; your timestamps will differ:

```text
2026-11-10T17:20:12.534Z	advised	tests-are-the-writers	tests/example.ts	[{"id":"not-the-implementer","witnesses":[{"key":"0","value":"implementer"}],"total":1}]
2026-11-10T17:20:12.538Z	advised	tests-are-the-writers	tests/example.ts	[{"id":"not-the-implementer","witnesses":[{"key":"0","value":"implementer"}],"total":1}]
2026-11-10T17:20:12.540Z	passed	tests-are-the-writers	tests/example.ts
```

**Other actors and file changes**

For the same edit from `old` to `new` in `tests/example.ts`, the main session with `actor: {}` and
actors whose `agentType` is `test-writer`, `tdd-implementer`, `Implementer`, `implementer2` or an
empty string all record `passed`. Each prints nothing and exits 0.

An `implementer` edit from `old` to `new` in `tests/unit/a.test.ts`, creation of `tests/new.test.ts`
with `new` content, and deletion of `tests/old.test.ts` containing `old` each advise. Their
respective standard error outputs are:

```text
discipline 'tests-are-the-writers' broken on tests/unit/a.test.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

```text
discipline 'tests-are-the-writers' broken on tests/new.test.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

```text
discipline 'tests-are-the-writers' broken on tests/old.test.ts: the implementer subagent wrote a test file — why: the implementer should satisfy the existing tests without changing those tests.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Each input records `advised` and exits 0. The deletion input is a file change with `kind: delete`,
as reported by an adapter; it is not a shell deletion.

Removing the entire `actor` field from `violating.json` prints nothing and exits 0, recording
`skipped tests-are-the-writers` on `tests/example.ts` with reason `supply-pass`. See
[actor](../reference/host-support.md#actor). This is not `passed`; do not substitute `{}` for
missing evidence.

An `implementer` edit from `old` to `new` in `src/example.ts`, `packages/a/tests/x.ts` or
`src/a.test.ts` is out of scope. Each prints nothing, exits 0 and records `passed covenant-check` on
its path, which is not a verdict for this entry.

For the shell write `sed -i 's/old/new/' tests/example.ts`, save this input as `shell.json`:

```json
{
  "toolCalls": [
    {
      "name": "Bash",
      "args": {
        "command": "sed -i 's/old/new/' tests/example.ts"
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
  "actor": {
    "agentType": "implementer"
  }
}
```

```sh
pdks covenant check < shell.json
```

The `implementer` call `sed -i 's/old/new/' tests/example.ts` prints nothing and exits 0. The
command itself is not executed. The appended row is:

```text
2026-11-10T17:20:12.576Z	skipped	tests-are-the-writers	tests/example.ts	no-observation
```

In `shell.json`, replace the command with `rm tests/example.ts` and run the same check. This
`implementer` shell deletion prints nothing, exits 0 and records only `passed covenant-check` with
`-` as the path. It leaves no row for this entry, unlike the measured `sed -i` input above.

Save this as `change.diff`:

```diff
--- a/tests/example.ts
+++ b/tests/example.ts
@@ -1 +1 @@
-old
+new
```

```sh
pdks covenant check --diff < change.diff
```

This prints nothing and exits 0. The change-set surface does not judge this session-only entry; it
records:

```text
2026-11-10T17:20:12.569Z	passed	covenant-check	tests/example.ts
```

**In a real session**

After adding the entry, run:

```sh
pdks explain
```

The line for this entry is:

```text
  declare  tests-are-the-writers producer-owned · actor · empty not-the-implementer · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

The line omits `enforce: block` because the entry advises. Take the implementing subagent name from
the host's own subagent definition and use it in the name pattern. After connecting the session,
have that subagent change a scratch file under the test path and find an `advised` row for this
entry in `.polydeukes/roi.log`. A `passed` row does not show the actor and cannot reveal a wrong
name: `tdd-implementer` passes in the measured inputs.

See the [Claude Code adapter](../reference/packages/adapter-claude-code.md),
[Codex adapter](../reference/packages/adapter-codex.md), and
[connect-surfaces guide](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Adapt both patterns to your project:

- `^tests/` in `scope.include` selects paths starting at the root `tests/` directory, including
  nested paths. Change this pattern when your tests live elsewhere.
- `^implementer$` in `extract.implementer` matches the whole `agentType`, case-sensitively. Keep `^`
  and `$` and replace the name with the implementing subagent name supplied by your host. Use
  neither a model name nor a role written in a prompt. Update `why` and `message` to describe the
  new name too.

Add `enforce: block` to the entry, at the indentation of `why`, to make a session block the edit. A
manual run then also needs `--enforce block`; without it, the run still advises. Delete the entry to
remove the discipline. After changes, run `pdks explain` and check matching and passing inputs with
your new paths and names.

<a id="limits"></a>
## Limits

The entry selects the edited path and reads `actor.agentType`. It does not read the command line or
file content of the judged edit. Modifying `tests/unit/a.test.ts`, creating `tests/new.test.ts` and
deleting `tests/old.test.ts` all advise for `implementer` when reported as file changes by the
adapter. The deletion input has `kind: delete`. A shell deletion with `rm tests/example.ts` prints
nothing, exits 0 and records only `passed covenant-check` with `-` as the path; it leaves no row for
this entry.

It names one subagent to keep out; it does not reserve tests for one writer. Editing
`tests/example.ts` passes for the main session (`actor: {}`), `test-writer`, `tdd-implementer`,
`Implementer`, `implementer2` and an empty `agentType`.

Without an `actor` the entry is `skipped` with `supply-pass`, which is not a pass; see
[actor](../reference/host-support.md#actor). A role written in a prompt is not actor evidence.

With the shown pattern, edits to `packages/a/tests/x.ts`, `src/a.test.ts` and `src/example.ts` are
out of scope. The implementer's shell write `sed -i 's/old/new/' tests/example.ts` records `skipped`
with `no-observation` because it has no observed file change. A diff of `tests/example.ts` on the
change-set surface does not judge this entry. A `passed covenant-check` row is not a verdict for
this discipline.

Hand-written JSON does not establish host delivery. If the adapter or judge cannot start, the call
proceeds unjudged. Confirm records for actual calls after connecting.
