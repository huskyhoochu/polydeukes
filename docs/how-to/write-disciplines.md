# Write disciplines

**English** · [한국어](../how-to/write-disciplines.ko.md)

A discipline describes a practice you want checked. Choose the observed files or session evidence,
write an extraction and relation, then exercise both a violation and a valid case. Leave enforcement
at `advise` until you decide that the observed results justify blocking.

For the complete syntax of relations and extraction steps, see the [Declaration language reference](../reference/declaration-language/index.md).

<a id="locale-key-pairing"></a>
## Locale key pairing

This declaration compares the key sets of two JSON translation files, including nested keys.
Save the complete YAML below as `polydeukes.config.yaml` in an **example project**, not over an
existing project's configuration. In an existing project, copy only the discipline entry — the
YAML below carries no `protectedPaths` and no `witness` block, so saving it over a generated
config removes the witness valve.
The [first-judgment tutorial](../tutorials/first-judgment.md) supplies installation steps.

```yaml
languages:
  json:
    productionGlob: 'locales/**/*.json'
    testCmd: 'pnpm test'
telemetry:
  logPath: '.polydeukes/roi.log'
disciplines:
  - id: 'locale-key-parity'
    why: 'the ko and en locales must carry the same keys'
    declare:
      mechanism: 'pairing'
      sources:
        ko: { file: 'locales/ko.json' }
        en: { file: 'locales/en.json' }
      supply: { ko: 'error', en: 'error' }
      scope: { source: 'target.path', include: ['^locales/(ko|en)\.json$'] }
      extract:
        koKeys:
          - { op: 'source', of: 'ko' }
          - { op: 'json' }
          - { op: 'flattenKeys' }
        enKeys:
          - { op: 'source', of: 'en' }
          - { op: 'json' }
          - { op: 'flattenKeys' }
      relate:
        - id: 'parity'
          relation: { op: 'equal', of: ['koKeys', 'enKeys'] }
          messageBySide:
            left: '{key} is in ko only'
            right: '{key} is in en only'
```

`flattenKeys` extracts keys, not translation values. `equal` compares both directions and
`messageBySide` reports which file has an unmatched key. The default enforcement is `advise`.
Both source files must exist and contain valid JSON. The change-set surface reads them from the
chosen observation; a session edit uses that edit's proposed new contents for the file it changes.

From the example project's root, prepare matching tracked files. The commit below requires your
usual local git identity; it creates the baseline for the worktree comparison.

```sh
mkdir -p locales
printf '{"home":"Home"}\n' > locales/en.json
printf '{"home":"홈"}\n' > locales/ko.json
git add locales/en.json locales/ko.json
git commit -m 'docs: prepare locale example'
printf '{"home":"Home","settings":"Settings"}\n' > locales/en.json
git diff HEAD | pnpm exec pdks covenant check --diff
```

Expect an `advised` diagnostic for `locale-key-parity` naming `settings` as present only in English.
The command still exits 0. Fix the mismatch and run the same observation again:

```sh
printf '{"home":"홈","settings":"설정"}\n' > locales/ko.json
git diff HEAD | pnpm exec pdks covenant check --diff
```

The parity diagnostic should disappear. The values differ intentionally; the keys now match.
Restore the two example files to their committed baseline when finished:

```sh
git restore -- locales/en.json locales/ko.json
```

`git diff HEAD` reports changes against the last commit, so an untracked file needs `git add -N`
before it appears in the diff. This example commits a baseline to exercise modifications and make
cleanup predictable. A declaration does not run
merely because its source exists: at least one observed change must match its scope.

<a id="locale-key-pairing-many"></a>
### Three or more locale files

`equal` compares two extractions. For three or more files, build the union of every file's keys
and require each file to contain it: one `subset` per file. `onlyIn` adds only the keys the union
does not hold yet, so a key present in several files is still one witness per file that lacks it.
The recipe relies on `flattenKeys` giving each item its dot path as both key and value: `onlyIn`
compares keys and `subset` compares values. An extraction whose keys differ from its values, such
as `lines` (keyed by line number), cannot use it.

For `ko`, `en`, and `fr`, replace the `locale-key-parity` entry above with this one, and create
`locales/fr.json` with the same keys (`printf '{"home":"Accueil"}\n' > locales/fr.json`) before
running the walkthrough, since `supply: 'error'` refuses a missing file:

```yaml
  - id: 'locale-key-parity'
    why: 'every locale file must carry the same keys'
    declare:
      mechanism: 'pairing'
      sources:
        ko: { file: 'locales/ko.json' }
        en: { file: 'locales/en.json' }
        fr: { file: 'locales/fr.json' }
      supply: { ko: 'error', en: 'error', fr: 'error' }
      scope: { source: 'target.path', include: ['^locales/(ko|en|fr)\.json$'] }
      extract:
        ko: [{ op: 'source', of: 'ko' }, { op: 'json' }, { op: 'flattenKeys' }]
        en: [{ op: 'source', of: 'en' }, { op: 'json' }, { op: 'flattenKeys' }]
        fr: [{ op: 'source', of: 'fr' }, { op: 'json' }, { op: 'flattenKeys' }]
        enNew: [{ op: 'onlyIn', of: 'en', notIn: 'ko' }]
        koEn: [{ op: 'union', of: ['ko', 'enNew'] }]
        frNew: [{ op: 'onlyIn', of: 'fr', notIn: 'koEn' }]
        all: [{ op: 'union', of: ['koEn', 'frNew'] }]
      relate:
        - { id: 'ko-full', relation: { op: 'subset', of: 'all', in: 'ko' }, message: '{value} is missing from ko' }
        - { id: 'en-full', relation: { op: 'subset', of: 'all', in: 'en' }, message: '{value} is missing from en' }
        - { id: 'fr-full', relation: { op: 'subset', of: 'all', in: 'fr' }, message: '{value} is missing from fr' }
```

No file is the reference: a key only in `ko` breaks `en-full` and `fr-full`, and a key in `en`
and `fr` but not `ko` breaks `ko-full` alone. Each further file adds three extractions (its
keys, its `onlyIn`, the next `union`) and one relate entry, and every relate entry's `of` moves
to that last `union`.

<a id="which-list"></a>
## Which list does it go in

Choose a discipline list by the sources the declaration reads. For example, a `companion`
declaration reading only `file` sources belongs in `disciplines`; one reading `changes`
belongs in `changeSetDisciplines`.

| The declaration reads | List | Examples |
|---|---|---|
| the changed file and `file` sources only | `disciplines` | the file-shaped types — added-only, one-way markers, self-absolution bans, controlled vocabulary, naming, companion over a `file` source, fingerprint sync, monotonic order |
| the transcript | `sessionDisciplines` | the four history types — precedent, phase order, turn locality, stated ground |
| the actor | `sessionDisciplines` | producer-owned, actor scope |
| the command line | `sessionDisciplines` | forbidden command |
| the spawn-record channel (`sidecar`) | `sessionDisciplines` | any declaration binding `{ sidecar: true }` |
| `changes` | `changeSetDisciplines` | pairing over a change set — `implies` between two paths that must move together |

Write the entry in the list its sources point at. A misplaced entry is a load-time error that
names the entry, the channels it reads, and the list it belongs in, so the fix is to move the
body unchanged. The rule itself and the error shapes are in [the configuration
reference](../reference/configuration/index.md#placement-rule).

Include the `witness` block's sources when choosing a list. If its `extract` reads the
transcript, the whole entry belongs in `sessionDisciplines`.

<a id="posture"></a>
## Posture on an unattended real-time surface

An unattended adapter hook or SDK caller needs an explicit response to blocked and advised
judgments.

**Use `enforce: block` when an advisory alone will not lead the loop to correct a violation.**
The caller must give the model the reason and a way to retry. Keep an entry at `advise` if the
loop cannot act on its diagnostic, and arrange for someone to review the recorded violations.
Choose the level based on observations from that loop.

**Return diagnostics to the caller.** `checkCovenant` returns
`{ verdict: 'blocked', reason }` with the judge's stderr, or `{ verdict: 'upheld', advisories }`
with the advisory output of an exit-0 run. The SDK accepts no separate witness argument.
The caller decides whether to send diagnostics to the model, record them in an issue or log,
and retry or stop. An advisory reaches the model only if the caller forwards it.
See the [SDK reference](../reference/packages/sdk-ts.md#verdicts) for the return types.

The SDK defaults to `enforce: 'block'` for the whole run. At that level, protected paths and
entries with `enforce: block` can stop the call; other discipline violations remain `advised`.
The three agent adapters use the same setting.

<a id="when-to-draft"></a>
## When to draft instead of declaring

If the promise is real but the grammar cannot express it yet, write a draft.

```yaml
languages:
  json:
    productionGlob: 'locales/**/*.json'
    testCmd: 'pnpm test'
disciplines:
  - id: 'benchmark-supports-performance-claim'
    why: 'a performance claim must be supported by a fresh benchmark run during judgment.'
    draft: true
```

Use `draft: true` only for a promise the current engine cannot judge. A draft does not produce a
verdict or telemetry. It is still part of the config, so the file remains loadable.

<a id="proof-runs"></a>
## Verify both outcomes

After you save the config, run the judgment path that can actually see it.

- `git diff HEAD | pdks covenant check --diff` shows the same entry against the current tree.
- `pdks explain` shows the registration and whether it is a declare or a draft.
- A one-sided edit to `locales/en.json` or `locales/ko.json` is a good smoke test for the pairing
example.

If no judgment appears, first check the observation: is the file included rather than ignored,
did it change in the selected comparison, does the scope match, and can the surface supply the
evidence? Inspect
`pdks explain` and the telemetry log for `no-observation` or `supply-pass`.
Do not treat a missing diagnostic as proof that the declaration works.

The draft above is deliberately different from key pairing. The current engine does not run a
new benchmark during judgment. It can compare supplied evidence, but that is not the same promise.
See [declarations and their limits](../concepts/judgment.md#declarations).
