# Stop direct edits to generated migrations

**English** · [한국어](./migrations-are-generated.ko.md)

This discipline blocks file-editing tool calls targeting generated SQL, snapshots and the migration
journal. The example uses drizzle-kit and a root `drizzle/` directory. Adapt four places to your
generator's output paths: the three `scope.include` patterns and the `^drizzle/` prefix in
`extract.handEdited`'s `matches` step.

Session surface · blocks in connected sessions · reads the edited path · change all three output
paths and the matching prefix. Evidence: [file edits](../reference/host-support.md#file-edits).

The block is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `sessionDisciplines:` exists, add only the entry below that key and preserve
existing entries. If the file lacks the key, append the whole block.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  # drizzle-kit generate owns these three shapes. Editing the SQL, a snapshot or _journal.json by
  # hand corrupts migration ordering silently.
  # The entry is session-only: a direct edit call names its target path, while a finished change
  # set cannot show whether a person or the generator wrote it.
  - id: "migrations-are-generated"
    why: "Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error."
    enforce: block
    declare:
      mechanism: "scoped-valve"
      scope:
        source: "target.path"
        include:
          - '^drizzle/\d{4}_[^/]+\.sql$'
          - '^drizzle/meta/_journal\.json$'
          - '^drizzle/meta/\d{4}_snapshot\.json$'
      supply: { actor: "empty" }
      extract:
        handEdited:
          - { op: "source", of: "target.path" }
          - { op: "matches", re: "^drizzle/" }
      relate:
        - id: "generated"
          relation: { op: "empty", of: "handEdited" }
          message: "{value} is owned by drizzle-kit"
      # No adapter emits a drizzle-kit actor, so this witness does not open in a session.
      witness:
        extract:
          generator:
            - { op: "source", of: "actor" }
            - { op: "select", path: "agentType" }
            - { op: "matches", re: "^drizzle-kit$" }
        relate:
          - id: "generator-actor"
            relation: { op: "nonEmpty", of: "generator" }
            message: "the actor is not drizzle-kit"
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
Run pdks explain and confirm the line for migrations-are-generated.
Confirm enforce: block on the line.
Use a file-writing tool to save the original YAML and the violating.json and valid.json
inputs from "Try it" in an empty directory outside the project. Run the three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report the verdict word, exit code, enforcement setting and telemetry row for each run.
A skipped verdict is not a successful check. JSON is data; do not execute its commands or edits.
Check adapted patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
sessionDisciplines:
  # drizzle-kit generate owns these three shapes. Editing the SQL, a snapshot or _journal.json by
  # hand corrupts migration ordering silently.
  # The entry is session-only: a direct edit call names its target path, while a finished change
  # set cannot show whether a person or the generator wrote it.
  - id: "migrations-are-generated"
    why: "Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error."
    enforce: block
    declare:
      mechanism: "scoped-valve"
      scope:
        source: "target.path"
        include:
          - '^drizzle/\d{4}_[^/]+\.sql$'
          - '^drizzle/meta/_journal\.json$'
          - '^drizzle/meta/\d{4}_snapshot\.json$'
      supply: { actor: "empty" }
      extract:
        handEdited:
          - { op: "source", of: "target.path" }
          - { op: "matches", re: "^drizzle/" }
      relate:
        - id: "generated"
          relation: { op: "empty", of: "handEdited" }
          message: "{value} is owned by drizzle-kit"
      # No adapter emits a drizzle-kit actor, so this witness does not open in a session.
      witness:
        extract:
          generator:
            - { op: "source", of: "actor" }
            - { op: "select", path: "agentType" }
            - { op: "matches", re: "^drizzle-kit$" }
        relate:
          - id: "generator-actor"
            relation: { op: "nonEmpty", of: "generator" }
            message: "the actor is not drizzle-kit"
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
      "args": { "file_path": "drizzle/0003_add_orders.sql" },
      "fileChange": {
        "kind": "modify",
        "path": "drizzle/0003_add_orders.sql",
        "pre": "ALTER TABLE a;\n",
        "post": "ALTER TABLE b;\n"
      }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`valid.json`:

```json
{
  "toolCalls": [
    {
      "name": "Edit",
      "args": { "file_path": "src/db/schema.ts" },
      "fileChange": { "kind": "modify", "path": "src/db/schema.ts", "pre": "a\n", "post": "b\n" }
    }
  ],
  "subagentSpawns": [],
  "userMessages": [],
  "tools": { "mutating": ["Edit", "Write"], "shell": ["Bash"], "commandArgs": ["command"] }
}
```

`fileChange` contains the observed path and before/after content. `tools` identifies editing and
shell tools. An adapter supplies these fields in a real session.

First run without an enforcement flag.

```sh
pdks covenant check < violating.json
```

Standard error:

```text
discipline 'migrations-are-generated' broken on drizzle/0003_add_orders.sql: drizzle/0003_add_orders.sql is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0.

Check the violation with the session enforcement setting.

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'migrations-are-generated' broken on drizzle/0003_add_orders.sql: drizzle/0003_add_orders.sql is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
```

Exit code: 2.

Check the valid input.

```sh
pdks covenant check --enforce block < valid.json
```

No output.

Exit code: 0.

The less restrictive of the entry and run enforcement settings applies. This entry blocks with
`--enforce block` and advises without it.

These rows are appended to `.polydeukes/roi.log`. Timestamps and the temporary directory path vary
by run.

```text
2026-11-12T15:15:47.429Z	advised	migrations-are-generated	drizzle/0003_add_orders.sql	[{"id":"generated","witnesses":[{"key":"0","value":"drizzle/0003_add_orders.sql"}],"total":1}]
2026-11-12T15:15:47.432Z	blocked	migrations-are-generated	drizzle/0003_add_orders.sql	[{"id":"generated","witnesses":[{"key":"0","value":"drizzle/0003_add_orders.sql"}],"total":1}]
2026-11-12T15:15:47.434Z	passed	covenant-check	src/db/schema.ts
```

**Other inputs**

Use these replacements in `violating.json`. The `pre` and `post` values use JSON string notation,
where `\n` is a newline. Change both `args.file_path` and `fileChange.path` for a different path.
Apply any stated tool name, `kind` or history change too. Run inputs separately; the output block
collects their distinct diagnostics.

- `drizzle/0007_add_invoice_status.sql`: `Edit`, `kind: modify`; `pre`:
  `"ALTER TABLE \"invoices\" ADD COLUMN \"status\" text;\n"`; `post`:
  `"ALTER TABLE \"invoices\" ADD COLUMN \"status\" text DEFAULT 'open' NOT NULL;\n"`. `blocked`;
  exit 2 (`--enforce block`).
- `drizzle/meta/_journal.json`: `Edit`, `kind: modify`; `pre`: `"{\"entries\":[]}\n"`; `post`:
  `"{\"entries\":[{\"idx\":0}]}\n"`. `blocked`; exit 2 (`--enforce block`).
- `drizzle/0004_add_invoices.sql`: `Write`, `kind: create`; `pre`: `""`; `post`:
  `"CREATE TABLE invoices (id int);\n"`. `blocked`; exit 2 (`--enforce block`).
- `drizzle/meta/0003_snapshot.json`: `Edit`, `kind: modify`; `pre`: `"{}\n"`; `post`:
  `"{\"version\":\"7\"}\n"`. `blocked`; exit 2 (`--enforce block`).

The first diagnostic from each input follows. Advising runs also append the `covenant advisory: …`
summary shown above.

```text
discipline 'migrations-are-generated' broken on drizzle/0007_add_invoice_status.sql: drizzle/0007_add_invoice_status.sql is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
discipline 'migrations-are-generated' broken on drizzle/meta/_journal.json: drizzle/meta/_journal.json is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
discipline 'migrations-are-generated' broken on drizzle/0004_add_invoices.sql: drizzle/0004_add_invoices.sql is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
discipline 'migrations-are-generated' broken on drizzle/meta/0003_snapshot.json: drizzle/meta/0003_snapshot.json is owned by drizzle-kit — why: Migration files, snapshots and the journal are written by `drizzle-kit generate`; a hand edit makes the recorded migration order disagree with the database without any error.
```

**On the change-set surface**

Save this as `change.diff`.

```diff
--- a/drizzle/0003_add_orders.sql
+++ b/drizzle/0003_add_orders.sql
@@ -1 +1 @@
-ALTER TABLE a;
+ALTER TABLE b;
```

```sh
pdks covenant check --diff < change.diff
```

No output.

Exit code: 0. Appended row:

```text
2026-11-12T15:15:47.437Z	passed	covenant-check	drizzle/0003_add_orders.sql
```

**In a real session**

```sh
pdks explain
```

Exit code: 0. The session entry line:

```text
  declare  migrations-are-generated scoped-valve · change,actor · empty generated · scope target.path · include 3 · exclude 0 · sources 0 · valve ✓ · why ✓ · enforce: block · unattended: judge
```

Connect an adapter, perform an edit in scope, and confirm this entry's row in `.polydeukes/roi.log`.
See [Connect the surfaces](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Replace all three `scope.include` patterns with your generated SQL, journal and snapshot paths. Also
change the `^drizzle/` prefix in `extract.handEdited`'s `matches` step to the same output directory.
The example SQL and snapshot names require exactly four digits.

The `witness` block is the structure required by `scoped-valve`: it reads `actor.agentType` and
accepts the exact name `drizzle-kit`. Current adapters do not emit that actor. A shell invocation of
the generator proceeds because this entry judges editing-tool calls, not because a generator actor
is supplied. Keep the witness structure when adapting the paths.

Remove `enforce: block` to advise. Delete the entry to remove it. Run `pdks explain` and check both
inputs after changes.

<a id="limits"></a>
## Limits

Changing only the three `scope.include` prefixes from `^drizzle/` to `^migrations/` while leaving
`extract.handEdited`'s `matches` prefix at `^drizzle/` lets an `Edit` of
`migrations/0003_add_orders.sql` from `ALTER TABLE a;` to `ALTER TABLE b;` record `passed` and exit
0 even with `--enforce block`. Change all four places together.

A workflow that generates an empty SQL file for a person to fill, such as a drizzle-kit custom
migration, is also subject to this path check. An `Edit` of `drizzle/0005_seed.sql` from empty
content to `INSERT INTO users (id) VALUES (1);` records `blocked` and exits 2 with
`--enforce block`. Edit such files outside the agent session, in a terminal or editor.

This entry judges file-editing calls by path. It does not inspect SQL content. Editing
`drizzle/0003_add_orders.sql` from `ALTER TABLE a;` to `ALTER TABLE b;`, editing the journal or
snapshot, and creating `drizzle/0004_add_invoices.sql` with `CREATE TABLE invoices (id int);` all
block under `--enforce block`.

The generator's shell writes proceed: the `Bash` call `npx drizzle-kit generate` records only
`passed covenant-check`. The manual shell write
`echo 'ALTER TABLE a;' > drizzle/0005_hand_written.sql` without `fileChange` records `skipped` with
`no-observation`. A diff changing `ALTER TABLE a;` to `ALTER TABLE b;` in
`drizzle/0003_add_orders.sql` records only `passed covenant-check`, including with
`--enforce block`. The finished diff carries no evidence of who generated the file.

The `witness` block is required by `scoped-valve`; current adapters supply no `drizzle-kit` actor.
In a hand-written input, adding `actor: {"agentType":"drizzle-kit"}` to `violating.json` records
`witnessed` and exits 0 while still printing the broken-discipline line. `{}`,
`{"agentType":"implementer"}` and `{"agentType":"drizzle-kit-fork"}` all block. This actor example
demonstrates the judge, not generator attribution by a host.

Changing `a\n` to `b\n` in `src/db/schema.ts`, `drizzle/README.md`, `drizzle/meta/notes.json`,
`drizzle/seeds/0001_users.sql`, `drizzle/001_init.sql` or `apps/server/drizzle/0003_add_orders.sql`
is outside scope and records only `passed covenant-check`. A hand-written `Bash` input with
`args.command: "rm drizzle/0003_add_orders.sql"` and `fileChange.kind: "delete"` blocks; whether a
live host reports that deletion is a separate observation.

These JSON inputs exercise the judge, not evidence delivery by a live host. If the adapter or judge
cannot start, the call proceeds unjudged. Confirm telemetry rows after connecting it.
