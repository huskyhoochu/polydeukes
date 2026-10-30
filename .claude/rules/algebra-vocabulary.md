---
paths:
  - "packages/core/src/algebra.ts"
  - "packages/core/src/catalogue.ts"
  - "packages/core/src/validation.ts"
  - "packages/core/schema/**"
  - "packages/polydeukes/src/covenant/**"
  - "polydeukes.config.yaml"
  - "docs/reference/declaration-language/**"
---

# The declaration grammar — closed lists and where they live

Every list below is a closed enumeration whose single source is an `as const` tuple in
`packages/core/src/algebra.ts` (mechanisms in `catalogue.ts`); a name outside a closed list is
rejected by validation, never coerced. Registering a new unary extract step is
`extract-vocabulary.md`.

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
- **Supply layer** — `planSources` · `supplySources` in the umbrella's covenant module fill the IR's
  `world` field: `files` through the surface's injected reader, `channels` through its channel
  reader (`sidecar` is the spawn-record list as JSON text; `'[]'` says the channel observed no
  spawn, an absent key says there is no channel), `changes` when the surface observes more than it
  dispatches at once. The judge merges them: a named file this input changes is read from the
  change's `post` (absent on a deletion), any other from `world.files`, a channel binding from
  `world.channels`, a transcript binding from the injected `CanonicalTranscript`, flattened once
  into a plain session snapshot (`observedAtMs` · `userMessages` · `toolCalls`, each observation
  carrying its ordinal `index`) that the history steps read. core and covenant open no file.

## Relations, mechanisms, axes

- **Relations** — `empty` · `nonEmpty` · `equal` · `subset` · `implies` · `ordered` · `unchanged`.
  `empty` and `subset` are the primitives (`nonEmpty ≡ ¬empty`, `equal ≡ subset` both ways,
  `implies ≡ subset` of key projections, `unchanged ≡ equal` over shared keys); the expansion is
  engine-internal. camelCase like every other position.
- **Mechanism catalogue** — eighteen names in `catalogue.ts`: `pairing` · `companion` ·
  `monotonic-order` · `fingerprint-sync` · `producer-owned` · `self-absolution-ban` · `actor-scope`
  · `precedent` · `phase-order` · `turn-locality` · `stated-ground` · `controlled-vocabulary` ·
  `naming` · `added-only` · `one-way-marker` · `delegated-scope` · `scoped-valve` ·
  `forbidden-command`. Structural markers: `scoped-valve` needs a `witness` block, `naming` scopes
  on `target.path`, `forbidden-command` scopes on `command`, `delegated-scope` is reserved and
  absent from the declaration schema's enum. The derived shape is read from syntax alone (every
  `source` step's name gives an axis, every relate entry's `op` a relation) and must be a subset of
  the spec; a `source` name neither fixed nor bound is refused.
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
- **Config fault** — the value `compileDeclaration` returns instead of a compiled declaration (a
  step name outside the registry, an argument outside a step's closed key set, an uncompilable
  regex, a paired/single mismatch). It names a `location` and is never a throw; the loader collects
  every entry's fault into one invalid-config error, so assembly never sees one.
