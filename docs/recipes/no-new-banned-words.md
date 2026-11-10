# Detect new uses of banned words without fixing every old one

**English** · [한국어](./no-new-banned-words.ko.md)

This applies when your project has selected words to avoid in its source and tests. This discipline
advises when a file's matching-line count increases for a first-match word. Existing matching lines
may remain in that file; only the first listed word matched on each line is its key.

Session and change-set surfaces · advises by default · replace the source paths and word list.

The block below is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `disciplines:` already exists, add only the entry below it, preserving existing
entries. If the file exists without that key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "no-new-banned-words"
    why: "new uses of the selected words make project terminology inconsistent; existing matching lines may remain."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ["^(src|tests)/"]
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '\b(blacklist|whitelist)\b' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '\b(blacklist|whitelist)\b' }
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
Add the entry below under disciplines: in this project's polydeukes.config.yaml.
In an existing configuration, add only the entry under the existing key, never a second key.
Preserve every other entry, protected path and witness setting. If the same id exists, report it
and stop. If the configuration is protected, show the exact patch and ask the human to apply it.
Never work around the protection.
Adapt the values described in "Change it" to this project.
Ask the human for the word list and folders if they are not given.

Run pdks explain and confirm a line for no-new-banned-words.
This entry advises by default; the line must not say enforce: block.
Create an empty directory outside the project. Use a file-writing tool to save this configuration
and the violating.json and valid.json inputs from "Try it" there. Run its three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report each verdict word, exit code, enforcement setting and telemetry row for this entry.
A skipped verdict is not a successful check. JSON is input data; do not execute its shell commands.
Do not commit or push in the project.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "no-new-banned-words"
    why: "new uses of the selected words make project terminology inconsistent; existing matching lines may remain."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ["^(src|tests)/"]
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '\b(blacklist|whitelist)\b' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '\b(blacklist|whitelist)\b' }
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

In an empty directory, save the YAML above as `polydeukes.config.yaml` and these two inputs.
`pdks covenant check` judges the JSON; it does not perform the edit.

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
        "pre": "",
        "post": "blacklist\n"
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
        "file_path": "src/example.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/example.ts",
        "pre": "blacklist\nold\n",
        "post": "blacklist\nnew\n"
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

`fileChange` is the edit the adapter observed: `kind` identifies the operation, `path` names the
file, and `pre` and `post` hold its before and after contents. The `tools` object identifies edit
and shell tools and the shell command argument; adapters supply it in a real session.

First, run without an enforcement flag:

```sh
pdks covenant check < violating.json
```

Standard error:

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds blacklist: blacklist — why: new uses of the selected words make project terminology inconsistent; existing matching lines may remain.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The edit receives advice.

Now use the session enforcement setting:

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds blacklist: blacklist — why: new uses of the selected words make project terminology inconsistent; existing matching lines may remain.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. `--enforce block` does not promote an advising entry; the adapters use this run
setting too.

Check the valid input:

```sh
pdks covenant check --enforce block < valid.json
```

This prints nothing and exits 0. These three rows are appended to `.polydeukes/roi.log`; your
timestamps will differ:

```text
2026-11-10T15:39:12.996Z	advised	no-new-banned-words	src/example.ts	[{"id":"nothing-added","witnesses":[{"key":"blacklist","value":"blacklist"}],"total":1}]
2026-11-10T15:39:12.999Z	advised	no-new-banned-words	src/example.ts	[{"id":"nothing-added","witnesses":[{"key":"blacklist","value":"blacklist"}],"total":1}]
2026-11-10T15:39:13.002Z	passed	no-new-banned-words	src/example.ts
```

Other inputs that advise: create `src/example.ts` containing `blacklist` or `whitelist`; change one
`blacklist` line into two separate `blacklist` lines; add `blacklist` to an empty
`tests/example.ts`; or replace `ok` with `blacklist` in `src/a/b/example.ts`. Each exits 0. The
first diagnostic lines begin:

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds blacklist: blacklist
discipline 'no-new-banned-words' broken on src/example.ts: adds whitelist: whitelist
discipline 'no-new-banned-words' broken on tests/example.ts: adds blacklist: blacklist
discipline 'no-new-banned-words' broken on src/a/b/example.ts: adds blacklist: blacklist
```

Each line continues with the same ` — why: …` and advisory summary as above. These edits to
`src/example.ts` pass with no output and exit 0: keep `blacklist` while changing the following `old`
line to `new`; change `ok` to `Blacklist`; change `old` to `blacklisted`; change `blacklist` to
`blacklist blacklist` or `blacklist whitelist`; delete the file containing `blacklist`. Adding
`blacklist` to empty `notes.txt` is outside scope and records `passed covenant-check`, not a verdict
for this entry.

Change `deny = blacklist + whitelist` to `deny = whitelist` in `src/example.ts`. This records
`advised` and exits 0, although no listed word was added. The first diagnostic line begins as
follows and continues with the same ` — why: …` as above.

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds whitelist: deny = whitelist
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Replacing `ok` in `src/example.ts` with these three lines passes with no output and exit 0:

```text
const ip_blacklist = 1;
const ipBlacklist = 2;
BLACKLIST
```

A Bash call containing `echo blacklist > src/example.ts`, without `fileChange`, prints nothing and
exits 0 but records `skipped` for this entry with `no-observation`. It supplies no observed file
contents.

**On the change-set surface**

Continue in the same scratch directory, using Bash. Create a local Git baseline, then change the
tracked file:

```sh
git init -q
git config user.name 'Recipe Reader'
git config user.email reader@example.com
mkdir -p src
printf 'old\n' > src/example.ts
git add src/example.ts
git commit -qm baseline
printf 'blacklist\n' > src/example.ts
```

Judge the working tree against `HEAD` with the pinned diff flags:

```sh
set -o pipefail
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD |
  pdks covenant check --diff
```

Standard error:

```text
discipline 'no-new-banned-words' broken on src/example.ts: adds blacklist: blacklist — why: new uses of the selected words make project terminology inconsistent; existing matching lines may remain.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The appended row is:

```text
2026-11-10T15:39:13.064Z	advised	no-new-banned-words	src/example.ts	[{"id":"nothing-added","witnesses":[{"key":"blacklist","value":"blacklist"}],"total":1}]
```

New untracked files do not appear in `git diff` until added to the index. The change-set surface
judges the resulting diff even when a shell write had no content observation in the session.

**In a real session**

Run `pdks explain`; its session entry line is:

```text
  declare  no-new-banned-words added-only · change · empty nothing-added · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

There is no `enforce: block` on this line. Confirm an `advised` or `passed` row for this entry after
connecting the adapter.

See [Connect the surfaces](../how-to/connect-surfaces.md) and
[Without a
hook](../how-to/git-hooks.md#without-a-hook).

<a id="change-it"></a>
## Change it

Replace `src` and `tests` in `scope.include` (`^(src|tests)/`) with your source folders. The prefix
includes nested directories too. Replace `blacklist|whitelist` in both `before` and `after`, keeping
the two patterns identical. Keep the capture group, the word boundaries `\b`, and `count: true`;
escape any regular-expression punctuation in your chosen words. Matching is case-sensitive. To match
identifier forms, drop the `\b` boundaries for embedded words and/or add `(?i)` for case-insensitive
matching in both patterns. Then try matching and passing inputs again.

Add `enforce: block` to the entry, at the same indentation as `why`, to make a session block the
edit. A manual run then also needs `--enforce block`; otherwise it still advises. Delete the entry
to remove the discipline. Run `pdks explain` after changes.

<a id="limits"></a>
## Limits

Only the first match on each line is counted. Changing `blacklist` to `blacklist blacklist` or
`blacklist whitelist` passes, while adding another separate `blacklist` line advises. This counts
matching lines per first-match word, not every occurrence; surrounding text may change without
increasing that count. Changing `deny = blacklist + whitelist` to `deny = whitelist` changes the key
from `blacklist` to `whitelist` and advises with `adds whitelist: deny = whitelist`, although no
listed word was added.

Comparison is per file. Existing matching lines may remain only while they stay in their file.
Moving a `blacklist` line into another file in scope, including a new file, advises for the
receiving file. The new-file input above advises for the same reason.

The words are case-sensitive: `ok` to `Blacklist` passes. Word boundaries let `old` to `blacklisted`
pass. Underscores and letters are word characters. Adding `const ip_blacklist = 1;`,
`const ipBlacklist = 2;` and `BLACKLIST` passes because of the boundaries and case sensitivity.
`src/a/b/example.ts` is in scope just like `src/example.ts`, and the same prefix behavior applies
under `tests/`; `notes.txt` is outside scope. Creating a file supplies an empty before side, so a
new `blacklist` line advises; deleting that file supplies an empty after side and passes.

Session inputs compare the supplied whole-file snapshots. Diff inputs compare removed and added
lines: the `old` to `blacklist` diff above advises. They do not reconstruct the whole file, and
moving text can depend on which lines the diff pairs.

The shell write `echo blacklist > src/example.ts` records `skipped` with `no-observation` on the
session surface. The change-set surface judges its result when the diff is produced. Neither actor
identity nor a transcript is required.

The adapter must actually observe file content through a supported edit tool; arbitrary host tools
are not automatically equivalent. These JSON checks demonstrate the judge, not live host delivery.
If the adapter or judge cannot start, the call proceeds unjudged. Confirm the entry’s row in
`.polydeukes/roi.log` after wiring.
