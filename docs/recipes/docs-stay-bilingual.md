# Check that English and Korean documents change together

**English** · [한국어](./docs-stay-bilingual.ko.md)

This applies when your project keeps English and Korean Markdown documents in pairs, such as
`manual/start.md` and `manual/start.ko.md`. This discipline checks that both paths occur in the same
change set.

Change-set surface only · advises by default · change the folder and language suffix. Host support:
[file edits](../reference/host-support.md#file-edits).

The block below is a complete `polydeukes.config.yaml`. Save it at the project root if no
configuration exists. If `disciplines:` already exists, add only the entry below that key and
preserve the existing entries. If the file exists without that key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "docs-stay-bilingual"
    why: "paired documents should be updated together; this checks only that both paths occur in the change set."
    declare:
      mechanism: "companion"
      scope: { source: "target.path", include: ['^manual/.*\.md$'] }
      extract:
        en:
          - { op: "source", of: "target.path" }
          - { op: "keyByPattern", re: '^(.+?)(?<!\.ko)\.md$' }
        ko:
          - { op: "source", of: "target.path" }
          - { op: "keyByPattern", re: '^(.+)\.ko\.md$' }
        enChanged:
          - { op: "source", of: "changes" }
          - { op: "items" }
          - { op: "keyByPattern", re: '^(.+?)(?<!\.ko)\.md$' }
        koChanged:
          - { op: "source", of: "changes" }
          - { op: "items" }
          - { op: "keyByPattern", re: '^(.+)\.ko\.md$' }
      relate:
        - id: "ko-follows"
          relation: { op: "implies", of: "en", requires: "koChanged" }
          message: "{value} changed without {key}.ko.md"
        - id: "en-follows"
          relation: { op: "implies", of: "ko", requires: "enChanged" }
          message: "{value} changed without {key}.md"
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
a line for docs-stay-bilingual. The entry advises; the line must not say enforce: block.
In an empty scratch directory outside the project, reproduce the Git walkthrough in "Try it"
with the unchanged example configuration. Commit only the scratch baseline there. Report the
verdicts, exit codes and enforcement settings. A skipped verdict is not a successful check.
Do not commit in the project or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "docs-stay-bilingual"
    why: "paired documents should be updated together; this checks only that both paths occur in the change set."
    declare:
      mechanism: "companion"
      scope: { source: "target.path", include: ['^manual/.*\.md$'] }
      extract:
        en:
          - { op: "source", of: "target.path" }
          - { op: "keyByPattern", re: '^(.+?)(?<!\.ko)\.md$' }
        ko:
          - { op: "source", of: "target.path" }
          - { op: "keyByPattern", re: '^(.+)\.ko\.md$' }
        enChanged:
          - { op: "source", of: "changes" }
          - { op: "items" }
          - { op: "keyByPattern", re: '^(.+?)(?<!\.ko)\.md$' }
        koChanged:
          - { op: "source", of: "changes" }
          - { op: "items" }
          - { op: "keyByPattern", re: '^(.+)\.ko\.md$' }
      relate:
        - id: "ko-follows"
          relation: { op: "implies", of: "en", requires: "koChanged" }
          message: "{value} changed without {key}.ko.md"
        - id: "en-follows"
          relation: { op: "implies", of: "ko", requires: "enChanged" }
          message: "{value} changed without {key}.md"
```
````

<a id="try-it"></a>
## Try it

In an empty scratch directory, save the YAML above as `polydeukes.config.yaml`.

Create a scratch Git repository, commit the two baseline documents, then edit only English:

```sh
git init -q
git config user.name Recipe
git config user.email recipe@example.invalid
mkdir -p manual
printf 'old\n' > manual/start.md
printf 'old\n' > manual/start.ko.md
git add manual/start.md manual/start.ko.md
git commit -qm baseline
printf 'new\n' > manual/start.md
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff
```

```text
discipline 'docs-stay-bilingual' broken on manual/start.md: manual/start.md changed without manual/start.ko.md — why: paired documents should be updated together; this checks only that both paths occur in the change set.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The missing partner records `advised`.

```sh
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff --enforce block
```

```text
discipline 'docs-stay-bilingual' broken on manual/start.md: manual/start.md changed without manual/start.ko.md — why: paired documents should be updated together; this checks only that both paths occur in the change set.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. `--enforce block` does not promote an advising entry. Now change the partner:

```sh
printf 'new\n' > manual/start.ko.md
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff
```

This prints nothing and exits 0. These rows are appended to `.polydeukes/roi.log`; your timestamps
will differ:

```text
2026-11-10T15:38:55.948Z	advised	docs-stay-bilingual	manual/start.md	[{"id":"ko-follows","witnesses":[{"key":"manual/start","value":"manual/start.md"}],"total":1}]
2026-11-10T15:38:55.953Z	advised	docs-stay-bilingual	manual/start.md	[{"id":"ko-follows","witnesses":[{"key":"manual/start","value":"manual/start.md"}],"total":1}]
2026-11-10T15:38:55.960Z	passed	docs-stay-bilingual	manual/start.ko.md
2026-11-10T15:38:55.960Z	passed	docs-stay-bilingual	manual/start.md
```

**Other change sets**

For each input below, the named documents change from `old` to `new`. Each advises and exits 0. The
first lines are:

Only `manual/start.ko.md` changes.

```text
discipline 'docs-stay-bilingual' broken on manual/start.ko.md: manual/start.ko.md changed without manual/start.md
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Only `manual/README.md` changes, with no Korean partner.

```text
discipline 'docs-stay-bilingual' broken on manual/README.md: manual/README.md changed without manual/README.ko.md
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

`manual/start.md` and `manual/other.ko.md` change together.

```text
discipline 'docs-stay-bilingual' broken on manual/start.md: manual/start.md changed without manual/start.ko.md
discipline 'docs-stay-bilingual' broken on manual/other.ko.md: manual/other.ko.md changed without manual/other.md
covenant advisory: 2 verdict(s) recorded as advised, not blocked
```

The diagnostic lines continue with ` — why: …`, as above.

Changing both `manual/guide/intro.md` and `manual/guide/intro.ko.md` from `old` to `new` passes.
Adding `manual/new.md` and `manual/new.ko.md`, each containing `new`, also passes when both
additions appear in the diff. New untracked files do not appear in `git diff` until added to the
index. A diff changing `notes.md` from `old` to `new` is outside scope and records
`passed covenant-check`. These inputs exit 0 with no stderr.

An `Edit` of `manual/start.md`, with `kind: "modify"`, `pre: "old\n"` and `post: "new\n"`, exits 0
without stderr and records `skipped docs-stay-bilingual` with `no-observation`: one session edit
carries no finished change set.

A `Bash` call containing `echo changed > manual/start.md` prints nothing and exits 0 when submitted
as JSON with the same `tools` object. It records:

```text
2026-11-10T15:38:55.964Z	skipped	docs-stay-bilingual	manual/start.md	no-observation
```

**Check the registration**

Run `pdks explain` (exit 0). The entry line is:

```text
  declare  docs-stay-bilingual companion · change · implies ko-follows, en-follows · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓
```

The session section instead shows:

```text
  skip     docs-stay-bilingual reads changes — judged on the change-set surface
```

The line omits `enforce: block` because the entry advises. For the diff producer and pipeline
failure handling, see [Git checks](../how-to/git-hooks.md#without-a-hook).

<a id="change-it"></a>
## Change it

Change `manual/` in `scope.include` (`^manual/.*\.md$`) to the folder where every document has a
partner. To use a suffix such as `.ja` instead of `.ko`, change all four `keyByPattern.re` values:

- `en` and `enChanged`: change the negative lookbehind `(?<!\.ko)` to `(?<!\.ja)` in both copies.
- `ko` and `koChanged`: change `\.ko\.md$` to `\.ja\.md$` in both copies.

Review both messages: `ko-follows.message` must name the new partner suffix (`{key}.ja.md`);
`en-follows.message` must still name the unsuffixed partner (`{key}.md`). If the unsuffixed filename
convention changes too, update that message and both unsuffixed patterns together. Keep `{value}`
and `{key}` as substitutions.

For an unpaired file such as `manual/README.md`, choose a narrower paired folder or add
`exclude: ['^manual/README\.md$']` inside `scope` beside `include`.

Add `enforce: block` to the entry at the indentation of `why`. For the unpaired `manual/start.md`
change above, a `--diff` run with `--enforce block` then exits 2 and records `blocked`; without that
flag, it still advises. Session edits record `skipped` with `no-observation` either way because this
entry reads a finished change set. Delete the entry to remove the discipline. Run `pdks explain`
after changes.

<a id="limits"></a>
## Limits

Only presence in the same change set is checked. Changing both `manual/start.md` and
`manual/start.ko.md` from `old` to `new` passes without establishing translation quality or
equivalent meaning. Changing `manual/other.ko.md` instead advises for both unmatched paths.

An unpaired `manual/README.md` advises every time it changes. Scope a folder where every document is
paired or add `exclude` patterns. Nested pairs such as `manual/guide/intro.md` and
`manual/guide/intro.ko.md`, and new pairs such as `manual/new.md` and `manual/new.ko.md`, pass when
both paths occur. Untracked new files are absent from `git diff` until added to the index.

A session `Edit` of `manual/start.md` from `old` to `new` records `skipped` with `no-observation`,
because it supplies no finished change set.

A shell write such as `echo changed > manual/start.md` records `skipped` with `no-observation` on
the session surface. The change-set surface judges the result when the diff is produced.

These checks demonstrate the judge, not delivery from a live host. If the adapter or judge cannot
start, the call proceeds unjudged. Confirm the expected row in `.polydeukes/roi.log` after
connecting a session.
