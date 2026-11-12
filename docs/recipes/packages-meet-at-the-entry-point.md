# Stop imports that go past a package entry point

**English** · [한국어](./packages-meet-at-the-entry-point.ko.md)

This discipline blocks added import, export and dynamic import references below `@acme/<package>` or
beginning with `../../` in `packages/<name>/src/`.
[The internal-module recipe](./internal-modules-stay-internal.md) checks an internal directory name;
this recipe checks paths below a package entry point. Mentions on comment lines pass.

Session and change-set surfaces · blocks in connected sessions · reads added matching text · change
the source scope and both import patterns. Evidence:
[file edits](../reference/host-support.md#file-edits).

The block is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `disciplines:` exists, add only the entry below that key and preserve existing
entries. If the file lacks the key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "packages-meet-at-the-entry-point"
    why: "A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../."
    enforce: block
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^packages/[^/]+/src/.+\.tsx?$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "matches", re: '^(?!\s*(?://|/\*|\*))' }
          - {
              op: "allMatches",
              re: '((?:\bfrom|\bimport|\bimport\s*\()\s*[''"](?:@acme/[^/''"]+/[^''"]+|\.\./\.\./[^''"]*)[''"])',
            }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "matches", re: '^(?!\s*(?://|/\*|\*))' }
          - {
              op: "allMatches",
              re: '((?:\bfrom|\bimport|\bimport\s*\()\s*[''"](?:@acme/[^/''"]+/[^''"]+|\.\./\.\./[^''"]*)[''"])',
            }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-deep-import"
          relation: { op: "empty", of: "added" }
          message: "imports past a package entry point: {key}"
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
Run pdks explain and confirm the line for packages-meet-at-the-entry-point.
Confirm enforce: block on the line.
Use a file-writing tool to save the original YAML and the violating.json and valid.json
inputs from "Try it" in an empty directory outside the project. Run the three JSON checks:
violating.json without an enforcement flag, then violating.json and valid.json with --enforce block.
Report the verdict word, exit code, enforcement setting and telemetry row for each run.
A skipped verdict is not a successful check. JSON is data; do not execute its commands or edits.
Check adapted patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "packages-meet-at-the-entry-point"
    why: "A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../."
    enforce: block
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^packages/[^/]+/src/.+\.tsx?$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "matches", re: '^(?!\s*(?://|/\*|\*))' }
          - {
              op: "allMatches",
              re: '((?:\bfrom|\bimport|\bimport\s*\()\s*[''"](?:@acme/[^/''"]+/[^''"]+|\.\./\.\./[^''"]*)[''"])',
            }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "matches", re: '^(?!\s*(?://|/\*|\*))' }
          - {
              op: "allMatches",
              re: '((?:\bfrom|\bimport|\bimport\s*\()\s*[''"](?:@acme/[^/''"]+/[^''"]+|\.\./\.\./[^''"]*)[''"])',
            }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-deep-import"
          relation: { op: "empty", of: "added" }
          message: "imports past a package entry point: {key}"
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
      "args": { "file_path": "packages/web/src/page.ts" },
      "fileChange": {
        "kind": "modify",
        "path": "packages/web/src/page.ts",
        "pre": "",
        "post": "import { price } from \"@acme/billing/src/price\";\n"
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
      "args": { "file_path": "packages/web/src/page.ts" },
      "fileChange": {
        "kind": "modify",
        "path": "packages/web/src/page.ts",
        "pre": "",
        "post": "import { price } from \"@acme/billing\";\n"
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
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0.

Check the violation with the session enforcement setting.

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
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
2026-11-12T15:15:47.779Z	advised	packages-meet-at-the-entry-point	packages/web/src/page.ts	[{"id":"no-deep-import","witnesses":[{"key":"from \"@acme/billing/src/price\"","value":"from \"@acme/billing/src/price\""}],"total":1}]
2026-11-12T15:15:47.782Z	blocked	packages-meet-at-the-entry-point	packages/web/src/page.ts	[{"id":"no-deep-import","witnesses":[{"key":"from \"@acme/billing/src/price\"","value":"from \"@acme/billing/src/price\""}],"total":1}]
2026-11-12T15:15:47.785Z	passed	packages-meet-at-the-entry-point	packages/web/src/page.ts
```

**Other inputs**

Use these replacements in `violating.json`. The `pre` and `post` values use JSON string notation,
where `\n` is a newline. Change both `args.file_path` and `fileChange.path` for a different path.
Apply any stated tool name, `kind` or history change too. Run inputs separately; the output block
collects their distinct diagnostics.

- `packages/web/src/new.ts`: `Write`, `kind: create`; `pre`: `""`; `post`:
  `"import { price } from \"@acme/billing/src/price\";\n"`. `blocked`; exit 2 (`--enforce block`).
- `packages/checkout/src/cart.ts`: `Edit`, `kind: modify`; `pre`:
  `"import { formatPrice } from \"@acme/billing\";\n"`; `post`:
  `"import { formatPrice } from \"@acme/billing\";\nimport { roundCents } from \"@acme/billing/src/money/round\";\n"`.
  `blocked`; exit 2 (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { fake } from \"@acme/billing/testing\";\n"`. `blocked`; exit 2 (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"const mod = await import(\"@acme/billing/src/price\");\n"`. `blocked`; exit 2
  (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { a } from \"@acme/web/src/a\";\n"`. `blocked`; exit 2 (`--enforce block`).
- `packages/web/src/pages/home/view.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { a } from \"../../util/a\";\n"`. `blocked`; exit 2 (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { price } from \"../../billing/src/price\";\n"`. `blocked`; exit 2 (`--enforce block`).
- `packages/web/src/page.ts`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import \"@acme/billing/src/register\";\n"`. `blocked`; exit 2 (`--enforce block`).
- `packages/web/src/Page.tsx`: `Edit`, `kind: modify`; `pre`: `""`; `post`:
  `"import { price } from \"@acme/billing/src/price\";\n"`. `blocked`; exit 2 (`--enforce block`).

The first diagnostic from each input follows. Advising runs also append the `covenant advisory: …`
summary shown above.

```text
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/new.ts: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/checkout/src/cart.ts: imports past a package entry point: from "@acme/billing/src/money/round" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/billing/testing" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: import("@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/web/src/a" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/pages/home/view.ts: imports past a package entry point: from "../../util/a" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "../../billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: import "@acme/billing/src/register" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/Page.tsx: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
```

**On the change-set surface**

Save this as `change.diff`.

```diff
--- a/packages/web/src/page.ts
+++ b/packages/web/src/page.ts
@@ -1 +1,2 @@
 import { a } from "./a";
+import { price } from "@acme/billing/src/price";
```

```sh
pdks covenant check --diff < change.diff
```

Standard error:

```text
discipline 'packages-meet-at-the-entry-point' broken on packages/web/src/page.ts: imports past a package entry point: from "@acme/billing/src/price" — why: A package reaches another package only through its entry point, so each package can move its own files without breaking the others. The pattern reads an import, export or dynamic import whose specifier goes past another package's entry point (@acme/<package>/<anything>) or climbs out of the package with ../../.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. Appended row:

```text
2026-11-12T15:15:47.789Z	advised	packages-meet-at-the-entry-point	packages/web/src/page.ts	[{"id":"no-deep-import","witnesses":[{"key":"from \"@acme/billing/src/price\"","value":"from \"@acme/billing/src/price\""}],"total":1}]
```

The same diff with `--diff --enforce block` exits 2 and records `blocked`.

**In a real session**

```sh
pdks explain
```

Exit code: 0. The session entry line:

```text
  declare  packages-meet-at-the-entry-point added-only · change · empty no-deep-import · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · enforce: block · unattended: judge
```

Connect an adapter, perform an edit in scope, and confirm this entry's row in `.polydeukes/roi.log`.
See [Connect the surfaces](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Replace the `scope.include` regular expression for `packages/<name>/src/` with your source layout.
Replace `@acme/` in both `before` and `after` import patterns with your package scope, keeping the
two patterns identical. Keep or change the `../../` alternative according to the relative paths you
allow.

The example treats every subpath below `@acme/<package>` alike. If a package exposes a documented
subpath, adapt both patterns to allow that specific path and check it separately. The line filter
ignores lines beginning with `//`, `/*` or `*` after whitespace.

Remove `enforce: block` to advise. Delete the entry to remove it. Run `pdks explain` and check both
inputs after changes.

<a id="limits"></a>
## Limits

This is a line-text pattern, not a module resolver. In `packages/web/src/page.ts`, adding
`const { price } = require("@acme/billing/src/price");` passes. The `require()` form is not matched.
Adding `import { fake } from "@acme/billing/testing";` blocks even if `testing` is a documented
public subpath.

Adding `import { a } from "../../util/a";` in `packages/web/src/pages/home/view.ts` blocks even
though the resolved file stays inside the package. Adding `import { a } from "@acme/web/src/a";` in
`packages/web/src/page.ts` also blocks. The pattern does not compare source and destination
packages.

Adding `// import { price } from "@acme/billing/src/price";` passes. A `/* */` block whose content
line is ` * import { price } from "@acme/billing/src/price";` passes too. A real import followed by
`// temporary` still blocks. The filter examines line prefixes; it does not parse comment syntax.

An unchanged deep import, or the same import moved elsewhere in the file, passes. Entry-point
imports, `./a`, `../b`, `@other/lib/src/x` and `lodash/fp/get` pass. The added-only comparison
counts matching fragments, not every existing dependency.

The same deep import under `apps/site/src/page.ts`, `packages/web/tests/page.test.ts` or
`packages/web/src/page.js` is outside scope and records only `passed covenant-check`.
`packages/web/src/Page.tsx` is in scope. The Bash command
`echo 'import x from "@acme/billing/src/x";' >> packages/web/src/page.ts` without `fileChange`
records `skipped` with `no-observation`. Its resulting diff can be judged. Diff inputs compare the
supplied removed and added lines; session inputs compare whole-file snapshots.

These JSON inputs exercise the judge, not evidence delivery by a live host. If the adapter or judge
cannot start, the call proceeds unjudged. Confirm telemetry rows after connecting it.
