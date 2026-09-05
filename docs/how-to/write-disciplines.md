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
Both source files must exist and contain valid JSON. The commit surface reads them from the
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
pnpm exec pdks covenant check --worktree
```

Expect an `advised` diagnostic for `locale-key-parity` naming `settings` as present only in English.
The command still exits 0. Fix the mismatch and run the same observation again:

```sh
printf '{"home":"홈","settings":"설정"}\n' > locales/ko.json
pnpm exec pdks covenant check --worktree
```

The parity diagnostic should disappear. The values differ intentionally; the keys now match.
Restore the two example files to their committed baseline when finished:

```sh
git restore -- locales/en.json locales/ko.json
```

`--worktree` also includes untracked, non-ignored files as additions. This example commits a
baseline to exercise modifications and make cleanup predictable. A declaration does not run
merely because its source exists: at least one observed change must match its scope.

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

- `pdks covenant check --worktree` shows the same entry against the current tree.
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
