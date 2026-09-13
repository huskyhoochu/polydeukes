# Write disciplines

**English** · [한국어](../how-to/write-disciplines.ko.md)

A discipline describes a practice you want checked. Choose the observed files or session evidence,
write an extraction and relation, then exercise both a violation and a valid case. Leave enforcement
at `advise` until you decide that the observed results justify blocking.

<a id="locale-key-pairing"></a>
## Locale key pairing

This declaration compares the key sets of two JSON translation files, including nested keys.
Save the complete YAML below as `polydeukes.config.yaml` in an **example project**, not over an
existing project's configuration. In an existing project, copy only the discipline entry.
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

<a id="which-list"></a>
## Which list does it go in

There are three discipline lists, and the source axis decides which one an entry belongs to.
The mechanism does not decide it and the relation does not decide it: the same `companion`
mechanism sits in `disciplines` when it stands over `file` sources, and in
`changeSetDisciplines` when it stands over `changes`. Read the declaration's sources and the
list follows.

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

An entry can also read nothing a surface has to supply and still be surface-bound in practice:
a valve (`witness`) that reads the transcript makes its entry a session entry, because the
valve's own `extract` binds the transcript.

<a id="posture"></a>
## Posture on an unattended real-time surface

An unattended real-time surface is an adapter hook or an SDK caller with no human at the
terminal. Two rules apply there that do not apply where a person is watching.

**Promote an entry to `enforce: block` when the loop cannot fix it inside the turn.** The
criterion is not "is this irreversible". A real-time block costs seconds: the model reads the
reason on stderr and retries, so the violation is corrected within the turn. Left at `advise`,
the same violation travels to a later check — a test run, CI, a reviewer — and costs a whole
turn, up to 45 minutes. This is not "block everything because nobody is watching": blocking
produces avoidance, and avoidance leaves no telemetry row, so an entry the loop cannot act on
belongs at `advise` where its break is at least recorded. The criterion is the config author's.

**The reason comes back as a value, because there is no valve.** A real-time unattended
surface has no witness valve: there is no TTY and no human turn, and the SDK takes no witness
argument and invents no session. What stands in its place is the reason travelling as data.
`checkCovenant` returns `{ verdict: 'blocked', reason }` where `reason` is the judge's own
stderr, and `{ verdict: 'upheld', advisories }` carries the advisory lines of an exit-0 run.
The consumer writes that text where a person reads it later — an issue, a log — and stops.
Whether the model sees the advisory text is the consumer's decision too: an unattended loop has
no reader for a stderr line, so advise is only consumed if the caller passes it on. The
[`@polydeukes/sdk-ts` reference](../reference/packages/sdk-ts.md) has the verdict shapes.

The SDK's own default is `enforce: 'block'` for the run, which is the surface's level, not an
entry's: protected paths and `enforce: block` entries stop the call, and every other break is
recorded as `advised`. Both adapters spawn the judge the same way.

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
`pdks explain` and the telemetry log for `config-fault`, `no-observation`, or `supply-pass`.
Do not treat a missing diagnostic as proof that the declaration works.

The draft above is deliberately different from key pairing. The current engine does not run a
new benchmark during judgment. It can compare supplied evidence, but that is not the same promise.
See [declarations and their limits](../concepts/judgment.md#declarations).
