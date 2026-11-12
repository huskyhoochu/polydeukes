# Write disciplines

**English** · [한국어](../how-to/write-disciplines.ko.md)

A discipline describes a practice you want checked. Choose the observed files or session evidence,
write an extraction and relation, then exercise both a violation and a valid case. Leave enforcement
at `advise` until you decide that the observed results justify blocking.

Before learning the grammar, copy the
[recipe that stops an agent from discarding work](../recipes/work-stays-recoverable.md).

For the complete syntax of relations and extraction steps, see the
[Declaration language
reference](../reference/declaration-language/index.md).

<a id="design-a-discipline"></a>
## Start with the promise you can check

Write one valid case and one violating case before writing the declaration. Narrow “write good code”
to an observable comparison such as “An edit must not add direct requests outside the request
wrapper.”

| Question                         | Decision                                                            |
| -------------------------------- | ------------------------------------------------------------------- |
| Which changes should trigger it? | Scope the paths or commands                                         |
| What evidence should it compare? | Before/after content, named files, commands, actor, or history      |
| What is the comparison unit?     | Extract lines, JSON keys, names, hashes, or another supported value |
| What relation should hold?       | Choose empty, equal, subset, or another declared relation           |
| What if evidence is missing?     | Choose error, pass, or empty according to its actual meaning        |
| When should it stop work?        | Exercise advice on valid and violating cases before choosing block  |

Using empty for absent evidence changes “not observed” into “nothing there.” Use it only when that
is the intended meaning. Pass records a skipped observation, not an upheld promise. The default,
`error`, blocks an observation that cannot be judged because a source is absent, even at `advise`
(see [supply policies](../reference/declaration-language/index.md#supply-policies)). Choose the
appropriate [discipline list](../reference/configuration/index.md#discipline-lists) for the
evidence, then inspect assembly with `pdks explain`.

<a id="verification-loop"></a>
## Verify a discipline in order

1. Prepare a complete configuration and its source files in a temporary Git project.
2. Check that `pdks explain` loads and assembles the discipline.
3. Exercise a valid input and a violation; inspect the discipline ID, reason, and telemetry.
4. Try an out-of-scope input to confirm which files the discipline observes.
5. Repeat on the [surface](../concepts/judgment.md#terms) you will connect. Session edits supply
   whole-file before/after content as `pre` and `post`; modifications in diff input supply only the
   hunk’s `-` and `+` lines (see
   [diff translation](../reference/cli/covenant-check.md#diff-translation)).
6. Observe advice during ordinary work, then promote selected entries to blocking.

The [request wrapper example below](#added-line-check) runs a violation, a repaired change, and an
out-of-scope change.

<a id="added-line-check"></a>
## Keep requests in the request wrapper

This declaration reports when a file in scope has more lines containing `fetch(` after a change than
before it. It covers TypeScript files under `src/` except `src/http/client.ts`. Requests through
that wrapper use its timeout.

Install the [`pdks` executable](./install.md), then create an empty Git project for this example:

```sh
mkdir pdks-request-example
cd pdks-request-example
git init
```

Save the complete YAML below as `polydeukes.config.yaml` in this example project. Do not save it
over an existing project's configuration: this YAML carries no `protectedPaths` and no `witness`
block, so replacing a generated config removes the witness valve.

In an existing project, put only the discipline entry under the existing `disciplines:` key and do
not copy the `telemetry:` block. Adjust the `include` and `exclude` paths to that project's wrapper
file, and change both `re` values in `before` and `after` to the same pattern for its direct-call
syntax. Rewrite `id` and `why` in that project's terms too. The configuration is protected in agent
sessions, so make this edit yourself from your terminal, as described in the
[first-judgment tutorial](../tutorials/first-judgment.md).

```yaml
telemetry:
  logPath: ".polydeukes/roi.log"
disciplines:
  - id: "requests-go-through-the-client"
    why: "a request made outside src/http/client.ts skips the timeout that file applies"
    declare:
      mechanism: "added-only"
      scope:
        source: "target.path"
        include: ['^src/.+\.ts$']
        exclude: ['^src/http/client\.ts$']
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '(\bfetch\()' }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: '(\bfetch\()' }
        added:
          - { op: "onlyIn", of: "after", notIn: "before", count: true }
      relate:
        - id: "no-direct-request"
          relation: { op: "empty", of: "added" }
          message: "adds a direct request: {value}"
```

`mechanism: "added-only"` names the kind of check this declaration performs. The loader accepts only
sources and relations allowed for that kind (see
[mechanisms](../reference/declaration-language/index.md#mechanisms)). This entry omits `enforce`, so
violations are recorded as advice.

`include` selects TypeScript paths under `src/`; `exclude` leaves the wrapper itself out of scope.
`pre` and `post` supply the content before and after the change, and `lines` splits each into lines.
`keyByPattern` keeps matching lines, uses capture group 1 of the first match as the key (`fetch(`),
and retains the line as the value. It keeps only the first match on a line.

`onlyIn` selects items from `after` by comparing their keys with `before`. With `count: true`, it
keeps the excess number of items for a key: if `before` has one matching line and `after` has two,
one remains in `added`. The `empty` relation requires `added` to contain no items. Missing `pre` or
`post` becomes empty through `supply`, so creating a file can add matches and deleting one adds
none. In the message, `{value}` is the matching line retained as the value. See the
[declaration language reference](../reference/declaration-language/index.md) for these operations.

This walkthrough uses diff input; the same entry also applies to edit calls in agent sessions, as
the two blocks of `pdks explain` output below show. It compares the counts of matching lines before
and after the change, so for a diff that modifies a file, the hunk lines give the same result as the
whole file (see [diff translation](../reference/cli/covenant-check.md#diff-translation)).

Run `pdks explain` to check that the entry loads:

```text
pdks explain — polydeukes.config.yaml

input: call IR (one call, stdin) · disciplines 1 · sessionDisciplines 0 · disciplines: advise unless enforce: block · meta: block
  registrations 4 · declare 1 · skip 1 · meta 2 · draft 0
  meta     self-mod                       paths 1 (includes the config file itself)
  meta     transcript-mod                 content predicate · conditional: session.evidencePath
  declare  requests-go-through-the-client added-only · change · empty no-direct-request · scope target.path · include 1 · exclude 1 · sources 0 · valve — · why ✓ · unattended: judge
  skip     shell-unjudgeable              a shell command whose write target this layer cannot determine

input: --diff (change set, stdin) · disciplines 1 · disciplines: advise unless enforce: block
  registrations 3 · declare 1 · skip 1 · meta 1 · draft 0
  meta     self-mod                       paths 1 (includes the config file itself)
  declare  requests-go-through-the-client added-only · change · empty no-direct-request · scope target.path · include 1 · exclude 1 · sources 0 · valve — · why ✓
  skip     shell-unjudgeable              a shell command whose write target this layer cannot determine
```

The first block shows assembly for an agent session's call input; the second shows assembly for diff
input. This entry appears as `declare` in both. See the
[`pdks explain` reference](../reference/cli/explain.md) for the fields.

From the example project's root, prepare the tracked files. The commit requires your usual local git
identity and establishes the baseline for the comparison:

```sh
mkdir -p src/http
printf 'export const request = (url: string) => fetch(url, { signal: AbortSignal.timeout(5000) });\n' > src/http/client.ts
printf "import { request } from './http/client';\n\nexport const loadOrders = () => request('/orders');\n" > src/orders.ts
git add src
git commit -m 'docs: prepare request example'
```

Add a direct request and check the diff:

```sh
printf "\nexport const loadUsers = () => fetch('/users');\n" >> src/orders.ts
git diff HEAD | pdks covenant check --diff
```

The command exits 0 and writes these lines to standard error:

```text
discipline 'requests-go-through-the-client' broken on src/orders.ts: adds a direct request: export const loadUsers = () => fetch('/users'); — why: a request made outside src/http/client.ts skips the timeout that file applies
covenant advisory: 1 verdict(s) recorded as advised, not blocked
```

Repair the change by using the wrapper and check again:

```sh
git restore -- src/orders.ts
printf "\nexport const loadUsers = () => request('/users');\n" >> src/orders.ts
git diff HEAD | pdks covenant check --diff
```

The command prints nothing and exits 0. Now try an out-of-scope change in the wrapper itself:

```sh
git restore -- src/orders.ts
printf "export const ping = () => fetch('/ping');\n" >> src/http/client.ts
git diff HEAD | pdks covenant check --diff
```

The command prints nothing and exits 0. This discipline is not judged for that path. Restore the
wrapper when finished:

```sh
git restore -- src/http/client.ts
```

The three checks leave these rows in `.polydeukes/roi.log`, with the timestamp field omitted here
and tabs between fields:

```text
advised	requests-go-through-the-client	src/orders.ts	[{"id":"no-direct-request","witnesses":[{"key":"fetch(","value":"export const loadUsers = () => fetch('/users');"}],"total":1}]
passed	requests-go-through-the-client	src/orders.ts
passed	covenant-check	src/http/client.ts
```

The repaired change has a `passed` row for this discipline. The out-of-scope change has only a
general `covenant-check` row; it does not demonstrate that this discipline passed.

<a id="locale-key-pairing"></a>
## Locale key pairing

This example keeps content consistent across files by comparing the keys of two JSON translation
files, including nested keys.

The YAML below is a complete configuration file. Save it as `polydeukes.config.yaml` in an empty
example project, created by running `git init` in a new directory. The
[request wrapper example](#added-line-check) provides the project creation commands.

Do not save this YAML over an existing project's configuration. In an existing project, copy only
the discipline entry under the existing `disciplines:` key. This YAML carries no `protectedPaths`
and no `witness` block, so replacing a generated config removes the witness valve.

If you continue in the preceding section's example project, you can add this entry below that
section's entry.

```yaml
telemetry:
  logPath: ".polydeukes/roi.log"
disciplines:
  - id: "locale-key-parity"
    why: "the ko and en locales must carry the same keys"
    declare:
      mechanism: "pairing"
      sources:
        ko: { file: "locales/ko.json" }
        en: { file: "locales/en.json" }
      supply: { ko: "error", en: "error" }
      scope: { source: "target.path", include: ['^locales/(ko|en)\.json$'] }
      extract:
        koKeys:
          - { op: "source", of: "ko" }
          - { op: "json" }
          - { op: "flattenKeys" }
        enKeys:
          - { op: "source", of: "en" }
          - { op: "json" }
          - { op: "flattenKeys" }
      relate:
        - id: "parity"
          relation: { op: "equal", of: ["koKeys", "enKeys"] }
          messageBySide:
            left: "{key} is in ko only"
            right: "{key} is in en only"
```

`flattenKeys` extracts keys, not translation values. `equal` compares both directions and
`messageBySide` reports which file has an unmatched key. The default enforcement is `advise`. Both
source files must exist and contain valid JSON. The change-set surface reads them from the chosen
observation; a session edit uses that edit's proposed new contents for the file it changes.

From the example project's root, prepare matching tracked files. The commit below requires your
usual local git identity; it creates the baseline for the worktree comparison.

```sh
mkdir -p locales
printf '{"home":"Home"}\n' > locales/en.json
printf '{"home":"홈"}\n' > locales/ko.json
git add locales/en.json locales/ko.json
git commit -m 'docs: prepare locale example'
printf '{"home":"Home","settings":"Settings"}\n' > locales/en.json
git diff HEAD | pdks covenant check --diff
```

Expect an `advised` diagnostic for `locale-key-parity` naming `settings` as present only in English.
The command still exits 0. Fix the mismatch and run the same observation again:

```sh
printf '{"home":"홈","settings":"설정"}\n' > locales/ko.json
git diff HEAD | pdks covenant check --diff
```

The parity diagnostic should disappear. The values differ intentionally; the keys now match. Restore
the two example files to their committed baseline when finished:

```sh
git restore -- locales/en.json locales/ko.json
```

`git diff HEAD` reports changes against the last commit, so an untracked file needs `git add -N`
before it appears in the diff. This example commits a baseline to exercise modifications and make
cleanup predictable. A declaration does not run merely because its source exists: at least one
observed change must match its scope.

<a id="locale-key-pairing-many"></a>
### Three or more locale files

This example keeps content consistent across three or more files.

`equal` compares two extractions. For three or more files, build the union of every file's keys and
require each file to contain it: one `subset` per file. `onlyIn` adds only the keys the union does
not hold yet, so a key present in several files is still one witness per file that lacks it. The
recipe relies on `flattenKeys` giving each item its dot path as both key and value: `onlyIn`
compares keys and `subset` compares values. An extraction whose keys differ from its values, such as
`lines` (keyed by line number), cannot use it.

For `ko`, `en`, and `fr`, replace the `locale-key-parity` entry above with this one, and create
`locales/fr.json` with the same keys (`printf '{"home":"Accueil"}\n' > locales/fr.json`) before
running the walkthrough, since `supply: 'error'` refuses a missing file:

```yaml
- id: "locale-key-parity"
  why: "every locale file must carry the same keys"
  declare:
    mechanism: "pairing"
    sources:
      ko: { file: "locales/ko.json" }
      en: { file: "locales/en.json" }
      fr: { file: "locales/fr.json" }
    supply: { ko: "error", en: "error", fr: "error" }
    scope: { source: "target.path", include: ['^locales/(ko|en|fr)\.json$'] }
    extract:
      ko: [{ op: "source", of: "ko" }, { op: "json" }, { op: "flattenKeys" }]
      en: [{ op: "source", of: "en" }, { op: "json" }, { op: "flattenKeys" }]
      fr: [{ op: "source", of: "fr" }, { op: "json" }, { op: "flattenKeys" }]
      enNew: [{ op: "onlyIn", of: "en", notIn: "ko" }]
      koEn: [{ op: "union", of: ["ko", "enNew"] }]
      frNew: [{ op: "onlyIn", of: "fr", notIn: "koEn" }]
      all: [{ op: "union", of: ["koEn", "frNew"] }]
    relate:
      - {
          id: "ko-full",
          relation: { op: "subset", of: "all", in: "ko" },
          message: "{value} is missing from ko",
        }
      - {
          id: "en-full",
          relation: { op: "subset", of: "all", in: "en" },
          message: "{value} is missing from en",
        }
      - {
          id: "fr-full",
          relation: { op: "subset", of: "all", in: "fr" },
          message: "{value} is missing from fr",
        }
```

No file is the reference: a key only in `ko` breaks `en-full` and `fr-full`, and a key in `en` and
`fr` but not `ko` breaks `ko-full` alone. Each further file adds three extractions (its keys, its
`onlyIn`, the next `union`) and one relate entry, and every relate entry's `of` moves to that last
`union`.

<a id="which-list"></a>
## Which list does it go in

The two lists describe two purposes. `disciplines` verifies results: the change-set surface judges
its declarations before work is recorded in the repository. The session surface also judges entries
that read the changed file's own `pre`/`post`/`state`, `target.path`, and `file` sources at the
violating call. A `companion` declaration reading `file` sources and one reading `changes` both
belong in `disciplines`; the session surface skips the `changes` reader because one call carries no
change set. `sessionDisciplines` holds process and human evidence and is judged only on the session
surface. What the declaration reads determines its list.

| The declaration reads                    | List                 | Examples                                                                                                                                                                    |
| ---------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the changed file and `file` sources only | `disciplines`        | the file-shaped types — added-only, one-way markers, self-absolution bans, controlled vocabulary, naming, companion over a `file` source, fingerprint sync, monotonic order |
| the transcript                           | `sessionDisciplines` | the four history types — precedent, phase order, turn locality, stated ground                                                                                               |
| the actor                                | `sessionDisciplines` | producer-owned, actor scope                                                                                                                                                 |
| the command line                         | `sessionDisciplines` | forbidden command                                                                                                                                                           |
| the spawn-record channel (`sidecar`)     | `sessionDisciplines` | any declaration binding `{ sidecar: true }`                                                                                                                                 |
| `changes`                                | `disciplines`        | pairing over a change set — `implies` between two paths that must move together                                                                                             |

Write the entry in the list its sources point at. A misplaced entry is a load-time error that names
the entry, the channels it reads, and the list it belongs in, so the fix is to move the body
unchanged. The rule itself and the error shapes are in
[the configuration
reference](../reference/configuration/index.md#placement-rule).

Include the `witness` block's sources when choosing a list. If its `extract` reads the transcript,
the whole entry belongs in `sessionDisciplines`.

<a id="posture"></a>
## Posture on an unattended real-time surface

An unattended adapter hook or SDK caller needs an explicit response to blocked and advised
judgments.

**Use `enforce: block` when an advisory alone will not lead the loop to correct a violation.** The
caller must give the model the reason and a way to retry. Keep an entry at `advise` if the loop
cannot act on its diagnostic, and arrange for someone to review the recorded violations. Choose the
level based on observations from that loop.

**Return diagnostics to the caller.** `checkCovenant` returns `{ verdict: 'blocked', reason }` with
the judge's stderr, or `{ verdict: 'upheld', advisories }` with the advisory output of an exit-0
run. The SDK accepts no separate witness argument. The caller decides whether to send diagnostics to
the model, record them in an issue or log, and retry or stop. An advisory reaches the model only if
the caller forwards it. See the [SDK reference](../reference/packages/sdk-ts.md#verdicts) for the
return types.

The SDK defaults to `enforce: 'block'` for the whole run. At that level, protected paths and entries
with `enforce: block` can stop the call; other discipline violations remain `advised`. The three
agent adapters use the same setting.

<a id="when-to-draft"></a>
## When to draft instead of declaring

If the promise is real but the grammar cannot express it yet, write a draft.

```yaml
disciplines:
  - id: "benchmark-supports-performance-claim"
    why: "a performance claim must be supported by a fresh benchmark run during judgment."
    draft: true
```

Use `draft: true` only for a promise the current engine cannot judge. A draft does not produce a
verdict or telemetry. It is still part of the config, so the file remains loadable.

<a id="proof-runs"></a>
## Verify both outcomes

After you save the config, run the judgment path that can actually see it.

- In the request wrapper example, adding a direct request records advice; using the wrapper passes.
- `git diff HEAD | pdks covenant check --diff` checks the locale key pairing entry against the
  current tree.
- `pdks explain` shows the registration and whether it is a declare or a draft.
- A one-sided edit to `locales/en.json` or `locales/ko.json` is a good smoke test for the pairing
  example.

If no judgment appears, first check the observation: is the file included rather than ignored, did
it change in the selected comparison, does the scope match, and can the surface supply the evidence?
Inspect `pdks explain` and the telemetry log for `no-observation` or `supply-pass`. Do not treat a
missing diagnostic as proof that the declaration works.

The draft above requires a fresh benchmark during judgment; the request and locale examples compare
evidence supplied to the check. The current engine does not run a new benchmark during judgment. It
can compare supplied evidence, but that is not the same promise. See
[declarations and their limits](../concepts/judgment.md#declarations).
