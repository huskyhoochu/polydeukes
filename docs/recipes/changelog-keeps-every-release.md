# Keep every release heading in your changelog

**English** · [한국어](./changelog-keeps-every-release.ko.md)

This applies when your project uses CHANGELOG.md with `## 1.2.3` or `## [1.2.3]` release headings.
This discipline advises when a matching heading line disappears or changes.

Session and change-set surfaces · advises by default · change the changelog path and both heading
patterns if your layout differs.

The block below is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `disciplines:` already exists, add only the entry below it, preserving existing
entries. If the file exists without that key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "changelog-keeps-every-release"
    why: "published release headings must remain available when a changelog is edited."
    declare:
      mechanism: "one-way-marker"
      scope: { source: "target.path", include: ['^CHANGELOG\.md$'] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '^(## \[?\d+\.\d+\.\d+)' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '^(## \[?\d+\.\d+\.\d+)' }
      relate:
        - id: "release-kept"
          relation: { op: "subset", of: "before", in: "after" }
          message: "release heading removed: {value}"
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
If the project's changelog differs from the stated forms, adapt the path and heading pattern
as "Change it" describes.

Run pdks explain and confirm a line for changelog-keeps-every-release.
This entry advises by default; the line must not say enforce: block.
Create an empty directory outside the project. Use a file-writing tool to save this configuration
and the violating.json and valid.json inputs from "Try it" there. Run its three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report each verdict word, exit code, enforcement setting and telemetry row for this entry.
A skipped verdict is not a successful check. JSON is input data; do not execute its shell commands.
Do not commit or push in the project.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "changelog-keeps-every-release"
    why: "published release headings must remain available when a changelog is edited."
    declare:
      mechanism: "one-way-marker"
      scope: { source: "target.path", include: ['^CHANGELOG\.md$'] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '^(## \[?\d+\.\d+\.\d+)' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '^(## \[?\d+\.\d+\.\d+)' }
      relate:
        - id: "release-kept"
          relation: { op: "subset", of: "before", in: "after" }
          message: "release heading removed: {value}"
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
        "file_path": "CHANGELOG.md"
      },
      "fileChange": {
        "kind": "modify",
        "path": "CHANGELOG.md",
        "pre": "## 1.2.3\n",
        "post": ""
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
        "file_path": "CHANGELOG.md"
      },
      "fileChange": {
        "kind": "modify",
        "path": "CHANGELOG.md",
        "pre": "## 1.2.3\nold\n",
        "post": "## 1.2.3\nnew\n"
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
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3 — why: published release headings must remain available when a changelog is edited.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The edit receives advice.

Now use the session enforcement setting:

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3 — why: published release headings must remain available when a changelog is edited.
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
2026-11-10T15:39:13.068Z	advised	changelog-keeps-every-release	CHANGELOG.md	[{"id":"release-kept","witnesses":[{"key":"## 1.2.3","value":"## 1.2.3"}],"total":1}]
2026-11-10T15:39:13.071Z	advised	changelog-keeps-every-release	CHANGELOG.md	[{"id":"release-kept","witnesses":[{"key":"## 1.2.3","value":"## 1.2.3"}],"total":1}]
2026-11-10T15:39:13.074Z	passed	changelog-keeps-every-release	CHANGELOG.md
```

Deleting `CHANGELOG.md` containing `## 1.2.3` also advises. With the following two-heading content,
keeping only the first heading and its body names only the removed `## 1.2.3`:

```text
## 1.2.4

- b

## 1.2.3

- a
```

Removing the linked heading or the pre-release heading below advises too. A heading date edit also
advises; use these exact before and after values in `fileChange`:

```json
{
  "pre": "## 1.2.3 (2025-01-01)\n",
  "post": "## 1.2.3 (2025-01-02)\n"
}
```

These inputs all exit 0. Their first diagnostic lines begin:

```text
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## [1.2.3](https://example.com/releases/1.2.3)
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3-rc.1
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3 (2025-01-01)
```

Each line continues with the same ` — why: …` and advisory summary as above. These inputs pass with
no output and exit 0: create `CHANGELOG.md` containing `## 1.2.3`; prepend `## 1.2.4` while keeping
`## 1.2.3`; change only the body from `old` to `new`; remove a trailing space from `## 1.2.3 `; or
remove `## Unreleased` or `## v1.2.3`. Removing `## 1.2.3` from `notes.md` is outside scope and
records `passed covenant-check`. A diff retaining `## 1.2.3` as context and replacing its body `old`
with `new` also passes.

A Bash call containing `echo example > CHANGELOG.md`, without `fileChange`, prints nothing and exits
0 but records `skipped` for this entry with `no-observation`. It supplies no observed file contents.

**On the change-set surface**

Continue in the same scratch directory, using Bash. Create a local Git baseline, then change the
tracked file:

```sh
git init -q
git config user.name 'Recipe Reader'
git config user.email reader@example.com
printf '## 1.2.3\n' > CHANGELOG.md
git add CHANGELOG.md
git commit -qm baseline
: > CHANGELOG.md
```

Judge the working tree against `HEAD` with the pinned diff flags:

```sh
set -o pipefail
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD |
  pdks covenant check --diff
```

Standard error:

```text
discipline 'changelog-keeps-every-release' broken on CHANGELOG.md: release heading removed: ## 1.2.3 — why: published release headings must remain available when a changelog is edited.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The appended row is:

```text
2026-11-10T15:39:13.138Z	advised	changelog-keeps-every-release	CHANGELOG.md	[{"id":"release-kept","witnesses":[{"key":"## 1.2.3","value":"## 1.2.3"}],"total":1}]
```

New untracked files do not appear in `git diff` until added to the index. The change-set surface
judges the resulting diff even when a shell write had no content observation in the session.

**In a real session**

Run `pdks explain`; its session entry line is:

```text
  declare  changelog-keeps-every-release one-way-marker · change · subset release-kept · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

There is no `enforce: block` on this line. Confirm an `advised` or `passed` row for this entry after
connecting the adapter.

See [Connect the surfaces](../how-to/connect-surfaces.md) and
[Without a
hook](../how-to/git-hooks.md#without-a-hook).

<a id="change-it"></a>
## Change it

For a different changelog location, replace `^CHANGELOG\.md$` in `scope.include`, preserving the
anchors and escaping the dot. If headings use another format, change `^(## \[?\d+\.\d+\.\d+)` in
both `before` and `after`. Keep these patterns identical. The first capture supplies the witness
key; the relation compares the full retained heading line, not just that key. The sample needs no
substitution for the stated path and heading forms.

Add `enforce: block` to the entry, at the same indentation as `why`, to make a session block the
edit. A manual run then also needs `--enforce block`; otherwise it still advises. Delete the entry
to remove the discipline. Run `pdks explain` after changes.

<a id="limits"></a>
## Limits

The whole heading line is compared. The date-only change shown in Try it advises even though the
version stays the same; changing a link or punctuation also changes the compared value. Lines are
compared trimmed, so removing trailing whitespace from `## 1.2.3 ` passes.

`## 1.2.3-rc.1` is selected and removing it advises. `## Unreleased` and `## v1.2.3` are not
selected, so removing them passes. With `## 1.2.4` and `## 1.2.3`, removing the latter names only
that heading. A body-only `old` to `new` edit passes: release order, version validity, body contents
and occurrence multiplicity are not checked.

Creating `CHANGELOG.md` with `## 1.2.3` passes because the before side is supplied empty; deleting
it advises. Removing that heading from `notes.md` is outside scope. Diff judgment compares selected
removed and added lines, not complete changelog history; the heading-removal diff advises and the
body-only diff passes.

The shell write `echo example > CHANGELOG.md` records `skipped` with `no-observation` on the session
surface. The change-set surface judges its result when the diff is produced. Neither actor identity
nor a transcript is required.

The adapter must actually observe file content through a supported edit tool; arbitrary host tools
are not automatically equivalent. These JSON checks demonstrate the judge, not live host delivery.
If the adapter or judge cannot start, the call proceeds unjudged. Confirm the entry’s row in
`.polydeukes/roi.log` after wiring.
