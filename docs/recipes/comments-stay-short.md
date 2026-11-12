# Detect added runs of four or more comment lines

**English** · [한국어](./comments-stay-short.ko.md)

This discipline advises when one edit adds a run of four or more consecutive `//` lines under
`src/`. It compares matching runs before and after the edit, so existing comment runs can remain.

Session and change-set surfaces · advises by default · reads before and after file content · change
source paths and both run-length patterns. Evidence:
[file edits](../reference/host-support.md#file-edits).

The block is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `disciplines:` exists, add only the entry below that key and preserve existing
entries. If the file lacks the key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "comments-stay-short"
    why: "A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^src/.+\.(ts|tsx|js|mjs)$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "allMatches", re: '(?:\n[ \t]*//[^\n]*){4,}' }
        after:
          - { op: "source", of: "post" }
          - { op: "allMatches", re: '(?:\n[ \t]*//[^\n]*){4,}' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-comment-paragraph"
          relation: { op: "empty", of: "added" }
          message: "adds a run of four or more comment lines: {value}"
```

<a id="agent-prompt"></a>
## Set it up with your agent

Paste this into Claude Code or Codex in the project.

````text
Add the entry below under disciplines: in this project's polydeukes.config.yaml.
Add only the entry under an existing key, never a second key. Preserve every other entry,
protected path and witness setting. If the same id exists, report it and stop.
If the configuration is protected, show the exact patch and ask the human to apply it.
Never work around the protection. Adapt the values described in "Change it" to this project.
Run pdks explain and confirm the line for comments-stay-short.
This entry advises; the line must not say enforce: block.
Use a file-writing tool to save the original YAML and the violating.json and valid.json
inputs from "Try it" in an empty directory outside the project. Run the three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report the verdict word, exit code, enforcement setting and telemetry row for each run.
A skipped verdict is not a successful check. JSON is data; do not execute its commands or edits.
Check adapted patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "comments-stay-short"
    why: "A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines."
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^src/.+\.(ts|tsx|js|mjs)$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "allMatches", re: '(?:\n[ \t]*//[^\n]*){4,}' }
        after:
          - { op: "source", of: "post" }
          - { op: "allMatches", re: '(?:\n[ \t]*//[^\n]*){4,}' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-comment-paragraph"
          relation: { op: "empty", of: "added" }
          message: "adds a run of four or more comment lines: {value}"
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
      "args": { "file_path": "src/service.ts" },
      "fileChange": {
        "kind": "modify",
        "path": "src/service.ts",
        "pre": "export function total(a: number, b: number): number {\n  return a + b;\n}\n",
        "post": "export function total(a: number, b: number): number {\n  return a + b;\n}\n\n// note 1\n// note 2\n// note 3\n// note 4\n"
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
      "args": { "file_path": "src/service.ts" },
      "fileChange": {
        "kind": "modify",
        "path": "src/service.ts",
        "pre": "export function total(a: number, b: number): number {\n  return a + b;\n}\n",
        "post": "export function total(a: number, b: number): number {\n  return a + b;\n}\n\n// note 1\n// note 2\n// note 3\n"
      }
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
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
// note 1
// note 2
// note 3
// note 4 — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0.

Check the violation with the session enforcement setting.

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
// note 1
// note 2
// note 3
// note 4 — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0.

Check the valid input.

```sh
pdks covenant check --enforce block < valid.json
```

No output.

Exit code: 0.

The less restrictive of the entry and run enforcement settings applies. This entry advises even with
the flag.

These rows are appended to `.polydeukes/roi.log`. Timestamps and the temporary directory path vary
by run.

```text
2026-11-12T15:15:47.076Z	advised	comments-stay-short	src/service.ts	[{"id":"no-comment-paragraph","witnesses":[{"key":"\n// note 1\n// note 2\n// note 3\n// note 4","value":"\n// note 1\n// note 2\n// note 3\n// note 4"}],"total":1}]
2026-11-12T15:15:47.079Z	advised	comments-stay-short	src/service.ts	[{"id":"no-comment-paragraph","witnesses":[{"key":"\n// note 1\n// note 2\n// note 3\n// note 4","value":"\n// note 1\n// note 2\n// note 3\n// note 4"}],"total":1}]
2026-11-12T15:15:47.083Z	passed	comments-stay-short	src/service.ts
```

**Other inputs**

Use these replacements in `violating.json`. The `pre` and `post` values use JSON string notation,
where `\n` is a newline. Change both `args.file_path` and `fileChange.path` for a different path.
Apply any stated tool name, `kind` or history change too. Run inputs separately; the output block
collects their distinct diagnostics.

- `src/service.ts`: `Edit`, `kind: modify`; `pre`:
  `"export function total(a: number, b: number): number {\n  return a + b;\n}\n\n// note 1\n// note 2\n// note 3\n// note 4\n"`;
  `post`:
  `"export function total(a: number, b: number): number {\n  return a + b;\n}\n\n// note 1\n// note 2\n// note 3\n// note 4\n// note 5\n"`.
  `advised`; exit 0 (no flag).
- `src/service.ts`: `Edit`, `kind: modify`; `pre`:
  `"export function total(a: number, b: number): number {\n  return a + b;\n}\n"`; `post`:
  `"export function total(a: number, b: number): number {\n  // note 1\n  // note 2\n  // note 3\n  // note 4\n  return a + b;\n}\n"`.
  `advised`; exit 0 (no flag).
- `src/cart/applyDiscount.ts`: `Edit`, `kind: modify`; `pre`:
  `"export function applyDiscount(cart: Cart, code: string): Cart {\n  const rate = rateFor(code);\n  return { ...cart, total: cart.total * (1 - rate) };\n}\n"`;
  `post`:
  `"export function applyDiscount(cart: Cart, code: string): Cart {\n  // First we look up the rate for the code.\n  // Then we apply it to the cart total.\n  // Note: this used to round per line item,\n  // but the rounding moved to checkout.\n  const rate = rateFor(code);\n  return { ...cart, total: cart.total * (1 - rate) };\n}\n"`.
  `advised`; exit 0 (no flag).

The first diagnostic from each input follows. Comment diagnostics span several lines. Advising runs
also append the `covenant advisory: …` summary shown above.

```text
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
// note 1
// note 2
// note 3
// note 4
// note 5 — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
  // note 1
  // note 2
  // note 3
  // note 4 — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
discipline 'comments-stay-short' broken on src/cart/applyDiscount.ts: adds a run of four or more comment lines: 
  // First we look up the rate for the code.
  // Then we apply it to the cart total.
  // Note: this used to round per line item,
  // but the rounding moved to checkout. — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
```

**On the change-set surface**

Save this as `change.diff`.

```diff
--- a/src/service.ts
+++ b/src/service.ts
@@ -1,3 +1,8 @@
 export function total(a: number, b: number): number {
   return a + b;
 }
+
+// one
+// two
+// three
+// four
```

```sh
pdks covenant check --diff < change.diff
```

Standard error:

```text
discipline 'comments-stay-short' broken on src/service.ts: adds a run of four or more comment lines: 
// one
// two
// three
// four — why: A comment is one line placed between code, never a paragraph. A run of four or more // lines is narration, a restated diff or a design note that belongs in the pull request or a design document. TSDoc blocks on exported symbols are not // lines.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. Appended row:

```text
2026-11-12T15:15:47.086Z	advised	comments-stay-short	src/service.ts	[{"id":"no-comment-paragraph","witnesses":[{"key":"\n// one\n// two\n// three\n// four","value":"\n// one\n// two\n// three\n// four"}],"total":1}]
```

**In a real session**

```sh
pdks explain
```

Exit code: 0. The session entry line:

```text
  declare  comments-stay-short added-only · change · empty no-comment-paragraph · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

Connect an adapter, perform an edit in scope, and confirm this entry's row in `.polydeukes/roi.log`.
See [Connect the surfaces](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Change `scope.include` for your source folders and extensions. To change “four lines”, replace
`{4,}` in both `before` and `after` with the same minimum, and update `why` and `message` to
describe it.

Add `enforce: block` beside `why`. With that change,
`pdks covenant check --enforce block < violating.json` exits 2 and records `blocked`; without the
flag, it exits 0 and records `advised`. The original configuration still advises with the flag.

For a limit of twenty added `//` lines per file instead of consecutive runs, replace each
`allMatches` step with `lines` followed by `keyByPattern` using `re: '^(//.*)$'`. After `onlyIn` in
`added`, append `{ op: "drop", n: 20 }`; retain `count: true` and the empty relation. Update the
explanation and message. Twenty added lines pass; twenty-one advise. Existing lines do not count,
reworded lines do, and indented lines count because `lines` trims them. This counts individual
lines, including repeated identical lines.

Delete the entry to remove it. Run `pdks explain` and check both inputs after changes.

<a id="limits"></a>
## Limits

The pattern needs a newline before each `//` line. These four lines at the very beginning of
`src/service.ts`, followed by the function from `violating.json`, pass:

```text
// note 1
// note 2
// note 3
// note 4
```

A blank line splits a run: `// note 1`, `// note 2`, `// note 3`, a blank line, then `// a`, `// b`,
`// c` pass. Indented consecutive lines count. A `/* */` block containing ` * one`, ` * two`,
` * three`, ` * four`, or a `/** */` block containing ` * Adds two numbers.`, ` * @param a first`,
` * @param b second`, ` * @returns the sum`, passes; neither is a `//` run.

The comparison uses the entire matching run as text. Keeping or moving the same four-line
`// note 1` through `// note 4` run within the file passes. Extending it with `// note 5` advises
because the five-line run is new. Existing comments need no cleanup, but changing a matching run
changes the text being compared.

Adding the same run in `packages/core/src/service.ts`, `scripts/build.mjs` or `src/notes.md` is
outside scope and records only `passed covenant-check`. A Bash call with
`printf '// a\n// b\n// c\n// d\n' >> src/service.ts` and no `fileChange` records `skipped` with
`no-observation`.

Session inputs compare whole-file snapshots. With `--diff`, removed lines are joined for `before`
and added lines for `after`; context lines are excluded. Four comments `// one` through `// four`
added immediately after the context line `export function total(a: number, b: number): number {` in
`src/service.ts` record `passed` when they start at the hunk's first added line. The first comment
has no preceding newline in the joined text. The “Try it” diff advises because it adds a blank line
before the four comments. Removing `+// four` and changing that hunk header to `@@ -1,3 +1,7 @@`
passes.

Added lines from separate hunks in the same file are also joined. Adding `// note 1` through
`// note 5` in five separate hunks in `src/service.ts`, each after a different code line, records
`advised` even though code separates the comments in the file.

The two surfaces can give different verdicts for the same edit. In `src/service.ts`, put `// one`,
`// two`, `// three`, `// four` directly after the function's opening line and change only `// two`
to `// revised`. The session input records `advised` because the whole matching run changes; the
same edit with `--diff` records `passed` because its only added line is `// revised`. All these
checks exit 0 with the original entry. `--enforce block` alone still advises on a violation with
that entry on either surface.

These JSON inputs exercise the judge, not evidence delivery by a live host. If the adapter or judge
cannot start, the call proceeds unjudged. Confirm telemetry rows after connecting it.
