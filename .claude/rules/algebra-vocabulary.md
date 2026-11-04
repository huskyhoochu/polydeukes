---
paths:
  - "packages/pdks/src/core/declaration.rs"
  - "packages/pdks/src/core/validation.rs"
  - "schema/**"
  - "packages/pdks/src/covenant/**"
  - "packages/pdks/src/check.rs"
  - "polydeukes.config.yaml"
  - "docs/reference/declaration-language/**"
---

# The declaration grammar — closed lists and where they live

The lists below are closed enumerations. The judge defines its grammar and mechanism catalogue in
`packages/pdks/src/core/declaration.rs`. A name outside the judge's closed list is rejected by
validation, never coerced. Registering a new unary extract step is `extract-vocabulary.md`.

## Discipline families — what a declaration reads

A `disciplines:` entry is one `declare` block (or a `draft`). What its sources bind decides the
evidence the judgment needs: the fixed names read the change, the fixed name `command` reads the
shell call's command line (a shell call that changes no file is one world of its own, subject `-`),
the fixed name `actor` reads the observation's actor (`{ agentType? }` — `{}` is the main session,
absence is a host that proved none), and a `{ transcript: true }` binding reads the session history;
without a transcript channel such an entry records `skipped` by its own `supply: pass`.

## Blocks and sources

- **Declaration blocks** — six keys: **`scope`** (a source name plus constant regex lists),
  **`sources`** (bindings outside the fixed seven — `{ name: { file: '<repo-relative path>' } }`,
  `{ name: { sidecar: true } }` or `{ name: { transcript: true } }`; the kind position is closed to
  `file` · `sidecar` · `transcript`, and a sidecar or transcript binding's value is the marker
  `true`, never a path), **`supply`** (keys must name one of the fixed seven or one of the
  declaration's own `sources`; values `error` | `pass` | `empty` — `empty` reads an absent single
  source as an empty item list and never applies to `state`), **`extract`**, **`relate`**,
  **`witness`** (its own `extract` + `relate`, same grammar; it sees the body's extract names, the
  body never sees its). `mechanism` is required; there is no `axis` key.
- **Fixed source names** — seven per world: `target.path` · `pre` · `post` · `state`
  (`{ pre, post }`, modifications only) · `changes` (the observation unit's change set) · `command`
  (admitted only by a scope that does not name `target.path`) · `actor` (present where the host
  proved one). A side the change lacks is an absent key — the declaration's `supply` policy, never
  the host, says what that means.
- **Supply layer** — `packages/pdks/src/check.rs` reads named files and builds the session snapshot;
  `packages/pdks/src/covenant/discipline.rs` binds these values into the declaration's world. A
  named file on the session surface is read from the change's `post` when the call changes it
  (absent on a deletion). A change-set modification reads the file from the tree because its `post`
  contains only added diff lines. Other files come from the runner's reads. The session supplies
  sidecar text and the transcript snapshot (`observedAtMs` · `userMessages` · `toolCalls`, each
  observation carrying its ordinal `index`). `'[]'` says the sidecar observed no spawn; an absent
  key says there is no channel. The input cannot supply a `world` key. Covenant opens no file; core
  opens only the telemetry log.

## Relations, mechanisms, axes

- **Relations** — `empty` · `nonEmpty` · `equal` · `subset` · `implies` · `ordered` · `unchanged`.
  `empty` and `subset` are the primitives (`nonEmpty ≡ ¬empty`, `equal ≡ subset` both ways,
  `implies ≡ subset` of key projections, `unchanged ≡ equal` over shared keys); the expansion is
  engine-internal. camelCase like every other position.
- **Mechanism catalogue** — seventeen names in the Rust judge’s
  `packages/pdks/src/core/declaration.rs`: `pairing` · `companion` · `monotonic-order` ·
  `fingerprint-sync` · `producer-owned` · `self-absolution-ban` · `actor-scope` · `precedent` ·
  `phase-order` · `turn-locality` · `stated-ground` · `controlled-vocabulary` · `naming` ·
  `added-only` · `one-way-marker` · `scoped-valve` · `forbidden-command`. Structural markers:
  `scoped-valve` needs a `witness` block, `naming` scopes on `target.path`, `forbidden-command`
  scopes on `command`. The derived shape is read from syntax alone (each pipeline's first step gives
  its sources and axis, every relate entry's `op` a relation) and must be a subset of the spec; a
  `source` name neither fixed nor bound is refused. `source` may appear only as a pipeline's first
  step; elsewhere it is a config fault. Use `field` for a field lookup.
- **Axes of a declaration** — `change` · `actor` · `world` · `history`. A fixed source name derives
  `change` except `actor`, which derives `actor`; a `file` or `sidecar` binding derives `world`, a
  `transcript` binding `history`.

## Extraction values

- **Extract steps** — unary steps carry pass-through arguments; combinators are `union` · `onlyIn` ·
  `intersect`, only as a pipeline's first step, and a name outside the three that references two
  extractions is refused.
- **Items** — every extract step maps `Items → Items`, an item is `{ key, value }`. `key` drives
  `onlyIn` · `intersect` · `implies` · `unchanged`; `value` is compared by structural equality. A
  scalar source is one item under key `'0'`; a list without an index keys its elements by position.
- **Witness list** — a relation's return type; its order preserves the extraction's input order (the
  premise on which two surfaces reach the same verdict).
- **Relate entry** — `{ id, relation, message | messageBySide }`. Never `rule` in any name.
- **Paired source** — `source: state` runs the same pipeline over `pre` and `post`. A pair in any
  relation but `unchanged`, or a single extraction under `unchanged`, is a config fault.
- **Config fault** — the `Fault` returned by `compile_declaration` in
  `packages/pdks/src/core/declaration.rs` (a step name outside the registry, an argument outside a
  step's closed key set, an uncompilable regex, a paired/single mismatch). It names a `location` and
  is never a throw; the loader collects every entry's fault into one invalid-config error, so
  assembly never sees one.
