# Detect added test skips, snapshots, and timeout settings

**English** · [한국어](./tests-are-not-weakened.ko.md)

This discipline advises when a JavaScript or TypeScript test file gains a skip marker, snapshot
assertion, or timeout setting. It counts matching lines by their first matched spelling. A timeout
setting added on a line is checked; an increase in its numeric value is not.

Session and change-set surfaces · advises by default · change the paths and patterns. Host support:
[file edits](../reference/host-support.md#file-edits).

The block below is a complete `polydeukes.config.yaml`. Save it in the project root if you have no
configuration. If `disciplines:` already exists, add only the entry below it, preserving existing
entries. If the file exists without that key, append the whole block.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "tests-are-not-weakened"
    why: "new skipped tests, snapshot assertions, and timeout settings need review."
    declare:
      mechanism: "added-only"
      scope: { source: "target.path", include: ['\.(test|spec)\.[jt]sx?$'] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - {
              op: "keyByPattern",
              re: '(\.skip\s*\(|\b(?:xit|xdescribe|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\b(?:jest|vi)\.setTimeout\s*\(|\bthis\.timeout\s*\(|\b(?:testTimeout|hookTimeout|timeout)\s*:)',
            }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - {
              op: "keyByPattern",
              re: '(\.skip\s*\(|\b(?:xit|xdescribe|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\b(?:jest|vi)\.setTimeout\s*\(|\bthis\.timeout\s*\(|\b(?:testTimeout|hookTimeout|timeout)\s*:)',
            }
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
Run pdks explain and confirm the tests-are-not-weakened line.
This entry advises by default; the line must not say enforce: block.
Use a file-writing tool to save the original YAML below and the two JSON inputs from "Try it"
in an empty directory outside the project. Run the three JSON checks: violating.json without
an enforcement flag, then violating.json and valid.json with --enforce block.
Report each verdict word, exit code, enforcement setting and telemetry row.
A skipped verdict is not a successful check. JSON is data; do not execute its commands.
Check changed patterns with separate inputs. Do not commit or push.

```yaml title="polydeukes.config.yaml"
disciplines:
  - id: "tests-are-not-weakened"
    why: "new skipped tests, snapshot assertions, and timeout settings need review."
    declare:
      mechanism: "added-only"
      scope: { source: "target.path", include: ['\.(test|spec)\.[jt]sx?$'] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - {
              op: "keyByPattern",
              re: '(\.skip\s*\(|\b(?:xit|xdescribe|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\b(?:jest|vi)\.setTimeout\s*\(|\bthis\.timeout\s*\(|\b(?:testTimeout|hookTimeout|timeout)\s*:)',
            }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - {
              op: "keyByPattern",
              re: '(\.skip\s*\(|\b(?:xit|xdescribe|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\b(?:jest|vi)\.setTimeout\s*\(|\bthis\.timeout\s*\(|\b(?:testTimeout|hookTimeout|timeout)\s*:)',
            }
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
        "file_path": "src/cart.test.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/cart.test.ts",
        "pre": "",
        "post": "it.skip(\"works\", () => {});\n"
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
        "file_path": "src/cart.test.ts"
      },
      "fileChange": {
        "kind": "modify",
        "path": "src/cart.test.ts",
        "pre": "",
        "post": "it(\"works\", () => {});\n"
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
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The entry advises, so the edit proceeds.

Run the violation with the session's enforcement setting.

```sh
pdks covenant check --enforce block < violating.json
```

Standard error:

```text
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
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
2026-11-12T11:49:13.494Z	advised	tests-are-not-weakened	src/cart.test.ts	[{"id":"nothing-added","witnesses":[{"key":".skip(","value":"it.skip(\"works\", () => {});"}],"total":1}]
2026-11-12T11:49:13.497Z	advised	tests-are-not-weakened	src/cart.test.ts	[{"id":"nothing-added","witnesses":[{"key":".skip(","value":"it.skip(\"works\", () => {});"}],"total":1}]
2026-11-12T11:49:13.501Z	passed	tests-are-not-weakened	src/cart.test.ts
```

**Other inputs**

In `violating.json`, replace `fileChange.post` with each input below and run the check again. Keep
`pre` empty. Unless a path is given, use `src/cart.test.ts`; for another path, change both
`fileChange.path` and `args.file_path`. All of these inputs record `advised` and exit 0.

- Mention in a comment: `// it.skip("works", () => {});`
- Hook timeout option: `const options = { hookTimeout: 5000 };`
- Inline snapshot assertion: `expect(cart).toMatchInlineSnapshot();`
- Jest timeout call: `jest.setTimeout(5000);`
- A line moved into `src/other.test.ts`: `it.skip("works", () => {});`
- Snapshot assertion: `expect(cart).toMatchSnapshot();`
- A `.spec.ts` file, `tests/cart.spec.ts`: `it.skip("works", () => {});`
- Mention in a string: ``const example = `it.skip("works", () => {});`;``
- A `.test.jsx` file, `tests/cart.test.jsx`: `it.skip("works", () => {});`
- Test timeout option: `const options = { testTimeout: 5000 };`
- Timeout method: `this.timeout(5000);`
- Per-test timeout option: `test("works", { timeout: 5000 }, () => {});`
- Vitest timeout call: `vi.setTimeout(5000);`
- Skipped suite: `xdescribe("cart", () => {});`
- Skipped test: `xit("works", () => {});`

The complete diagnostic lines, in input order:

```text
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: // it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds hookTimeout:: const options = { hookTimeout: 5000 }; — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds toMatchInlineSnapshot(: expect(cart).toMatchInlineSnapshot(); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds jest.setTimeout(: jest.setTimeout(5000); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/other.test.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds toMatchSnapshot(: expect(cart).toMatchSnapshot(); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on tests/cart.spec.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: const example = `it.skip("works", () => {});`; — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on tests/cart.test.jsx: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds testTimeout:: const options = { testTimeout: 5000 }; — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds this.timeout(: this.timeout(5000); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds timeout:: test("works", { timeout: 5000 }, () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds vi.setTimeout(: vi.setTimeout(5000); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds xdescribe(: xdescribe("cart", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds xit(: xit("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
```

Each line is a complete diagnostic line, and each run prints the same advisory summary line
(`covenant advisory: …`) shown above after it.

- Keep the valid input's file content and path: it records `passed` for this entry.
- Put the violating edit at `src/cart.ts`: it is outside scope and records `passed covenant-check`,
  with no output and exit 0.

**On the change-set surface**

Save this as `change.diff`:

```diff
--- a/src/cart.test.ts
+++ b/src/cart.test.ts
@@ -1 +1 @@
-old
+it.skip("works", () => {});
```

```sh
pdks covenant check --diff < change.diff
```

Standard error:

```text
discipline 'tests-are-not-weakened' broken on src/cart.test.ts: adds .skip(: it.skip("works", () => {}); — why: new skipped tests, snapshot assertions, and timeout settings need review.
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Exit code: 0. The appended row is:

```text
2026-11-12T11:49:13.505Z	advised	tests-are-not-weakened	src/cart.test.ts	[{"id":"nothing-added","witnesses":[{"key":".skip(","value":"it.skip(\"works\", () => {});"}],"total":1}]
```

**In a real session**

```sh
pdks explain
```

Exit code: 0. Its session entry line is:

```text
  declare  tests-are-not-weakened added-only · change · empty nothing-added · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓ · unattended: judge
```

There is no `enforce: block` on this line. After connecting an adapter, perform a matching edit or
command and confirm this entry's row in `.polydeukes/roi.log`. See
[Connect the
surfaces](../how-to/connect-surfaces.md).

<a id="change-it"></a>
## Change it

Change `scope.include` to select your test files. To check timeouts in configuration files too, add
a pattern for their paths to `scope.include`. The pattern has three kinds of alternatives:

- Skip markers: `\.skip\s*\(` and `xit|xdescribe` in the grouped names.
- Snapshot assertions: `toMatchSnapshot|toMatchInlineSnapshot` in the grouped names.
- Timeout settings: `\b(?:jest|vi)\.setTimeout\s*\(`, `\bthis\.timeout\s*\(`, and
  `\b(?:testTimeout|hookTimeout|timeout)\s*:`.

To stop checking a spelling, remove its alternative and the adjacent `|` in both `before` and
`after`. For example, remove `|toMatchSnapshot|toMatchInlineSnapshot` from both patterns to allow
snapshot assertions. Keep the outer capture group and `count: true`. The message's `{key}` is the
added matched spelling, such as `.skip(` or `jest.setTimeout(`; `{value}` is its line.

Add `enforce: block` to the entry at the same indentation as `why` to block in a session. A manual
run also needs `--enforce block`: the violating input then exits 2 and records `blocked`. Without
that flag, it exits 0 and records `advised`. Delete the entry to remove the discipline. Run
`pdks explain` and check matching and passing inputs after changes.

<a id="limits"></a>
## Limits

The patterns use JavaScript and TypeScript test-runner spellings, not test semantics. Comments such
as `// it.skip("works", () => {});` and strings such as
``const example = `it.skip("works", () => {});`;`` advise.

Changing `jest.setTimeout(5000);` to `jest.setTimeout(30000);` passes judgment: the matched key and
its line count stay the same. Adding `it.only("works", () => {});` or
`const options = { timeoutMs: 5000 };` also passes judgment. The pattern checks added timeout
settings, not whether a timeout increased.

Only the first match on each line counts. Changing `it.skip("works", () => {});` to two copies on
the same line passes judgment. Adding a second separate `it.skip("works", () => {});` line advises.
Keeping the matching line while changing another line from `old` to `new` passes judgment. Moving
that matching line to `src/other.test.ts` advises on the receiving file; comparison is per file.

The matched spelling is the key, so an edit passes judgment when the number of lines with each
spelling stays the same within a file. For example, changing `it.skip("a", () => {});` followed by
`it("b", () => {});` on the next line to `it("a", () => {});` followed by `it.skip("b", () => {});`
on the next line records `passed`.

`scope.include` selects only test files. Adding `export default { test: { testTimeout: 60000 } };`
to `vitest.config.ts` is outside scope and records only `passed covenant-check`.

The following shell write records `skipped` with `no-observation`, prints nothing, and exits 0:

```text
echo 'it.skip("works", () => {});' > src/cart.test.ts
```

Session JSON compares supplied whole-file snapshots; a diff compares removed and added lines. The
change-set surface can judge the resulting diff of a shell write.

These JSON checks demonstrate the judge, not delivery of evidence by a live host. If the adapter or
judge cannot start, the call proceeds unjudged. Confirm the entry's row in `.polydeukes/roi.log`
after wiring.
