---
paths:
  - "packages/**"
  - "docs/**"
---

# Polydeukes Ubiquitous Language — implementation mapping

Concepts are defined in the root `CONTEXT.md`. This file maps each one to packages, keys and
symbols, fixes the closed name lists, and enforces the words in code, CLI, comments, and
commit messages.

## Core terms

| Concept | Package / code | Verb | CLI |
|---------|----------------|------|-----|
| **Covenant** | `@polydeukes/covenant` | uphold / break | `pdks covenant check` |
| **Discipline** | one `disciplines:` entry (prose + enforcement tag) | — | `pdks` (root) |
| **Gain** | — (cross-cutting; reads every area's measurements) | gain | `pdks gain` |
| **Ledger** | `@polydeukes/ledger` | record / verify | `pdks ledger {start,verify,finish}` |
| **Memory** | `@polydeukes/memory` (SQLite + FTS5) | recall / ingest | `pdks memory search` |
| **Verify** | `@polydeukes/verify` | refute / attest | `pdks verify` |
| **Witness (valve)** | `ttlWitness` / config `witness:` (meta-covenant valve: the token typed first-line-alone, held `ttlMinutes`; commit, until `SURFACE-01`: the TTY answer) · a declaration's `witness` block (discipline valve: its own `extract`·`relate`) | witness | — |

`core` and `adapter-*` packages keep their plain names.

## Judgment vocabulary — the telemetry row

The six verdict words (`passed` · `blocked` · `witnessed` · `advised` · `skipped` ·
`unattributed`) are the telemetry contract: a row in `.polydeukes/roi.log` carries exactly one,
and tests, docs, and CLI output use the same word for the same event. `advised` is the
disposition of an entry whose own `enforce` is `advise` or absent (CONFIG-11; absence is advise
since POSTURE-01) or of a surface at `enforce: advise`. `unattributed` is written by the
baseline comparison (COVENANT-14), not by a judge.

Rows written before `COVENANT-17` say `bypassed`; the reader folds them into `witnessed`,
one-way. Never write `bypassed` in new code.

A row has four fields (timestamp · event · label · subject) and an optional fifth whose
meaning the event decides: on a break it is the witness list as a JSON array; on `skipped` it
is a **skip reason** from the closed tuple `no-observation` (the surface has no channel for
what the entry reads) · `config-fault` (assembly could not compile the entry) · `supply-pass`
(the declaration's own `supply: pass` let an absent source through). A `skipped` row without
a fifth field is a family runtime skip and reads back with no reason.

## Discipline families — key → family

A `disciplines:` entry is one `declare` block (or a `draft`). What its sources bind decides
the evidence the judgment needs: the fixed names read the change, the fixed name `command`
reads the shell call's command line (a shell call that changes no file is one world of its
own, subject `-`), and a `{ transcript: true }` binding reads the session history; without a
transcript channel such an entry records `skipped` by its own `supply: pass`.

## Surfaces, axes, meta-covenants

Naming only; how each one judges is in `dogfooding-axes.md`.

- **Surfaces** — **session** (PreToolUse hook) and **commit** (`pdks covenant check` under
  lefthook). A surface's `enforce` belongs to the observer; an entry's `enforce` is the
  author's rung on the promotion ladder — absent means `advise`, `block` is the promotion —
  and the lenient side wins. Meta-covenants carry no entry rung, so they alone block on the
  session surface. Neither setting is a verdict word.
- **Axes** — **tool** (Edit/Write/…), **shell** (Bash), and **transcript**.
- **Meta-covenants** — **self-mod**, **shell-mod**, **transcript-mod**; registered directly by
  the session composition root. The verdict vocabulary applies unchanged.
- **Declared limit vs defect** — a declared limit leaves a `skipped` row; a defect leaves NO
  row, or a `passed` row with no judgment. The telemetry row is what separates them.

## Algebra — closed lists and where they live

The declaration grammar `ALGEBRA-01` fixed in `packages/core/src/algebra.ts`. Every list below
is a closed enumeration whose single source is the `as const` tuple in that module; a name
outside a closed list is rejected by validation, never coerced.

- **Declaration blocks** — six keys: **`scope`** (a source name plus constant regex lists),
  **`sources`** (bindings outside the fixed six — `{ name: { file: '<repo-relative path>' } }`,
  `{ name: { sidecar: true } }` or `{ name: { transcript: true } }`; the kind position is closed
  to `file` · `sidecar` · `transcript`, and a sidecar or transcript binding's value is the marker
  `true`, never a path), **`supply`** (keys must name one of the fixed six or one of the
  declaration's own `sources`; values `error` | `pass` | `empty` — `empty` reads an absent single
  source as an empty item list and never applies to `state`), **`extract`**, **`relate`**,
  **`witness`** (its own `extract` + `relate`, same grammar; it sees the body's extract names,
  the body never sees its). `mechanism` is required; there is no `axis` key.
- **Fixed source names** — six per world: `target.path` · `pre` · `post` · `state`
  (`{ pre, post }`, modifications only) · `changes` (the observation unit's change set) ·
  `command` (the shell call's command line; a shell call that changes no file is one world of
  its own at subject `-`, admitted only by a scope that does not name `target.path`). A side
  the change lacks is an absent key — the declaration's `supply` policy, never the host, says
  what that means.
- **Supply layer** — `planSources` · `supplySources` in the covenant package fill the IR's
  `world` field: `files` through the surface's injected reader, `channels` through its channel
  reader (`sidecar` is the spawn-record list as JSON text; `'[]'` says the channel observed no
  spawn, an absent key says there is no channel), `changes` when the surface observes more than
  it dispatches at once. The judge merges them: a named file this input changes is read from
  the change's `post` (absent on a deletion), any other from `world.files`, a channel binding
  from `world.channels`, a transcript binding from the `CanonicalTranscript` the composition
  root injects, flattened once into a plain session snapshot (`observedAtMs` · `userMessages` ·
  `toolCalls`, each observation carrying its ordinal `index`) that the history steps
  (`toolUses` · `userTexts` · `agentType` · `first` · `ageMs`) read. core and covenant open no
  file; the readers are the supply bodies' (`sessionSourceReader` · `sessionChannelReader` on
  the session side, `observationSourceReader` on the commit side) and the composition root only
  injects them.
- **Relations** — `empty` · `nonEmpty` · `equal` · `subset` · `implies` · `ordered` ·
  `unchanged`. `empty` and `subset` are the primitives (`nonEmpty ≡ ¬empty`, `equal ≡ subset`
  both ways, `implies ≡ subset` of key projections, `unchanged ≡ equal` over shared keys); the
  expansion is engine-internal. camelCase like every other position; the capitalised research
  spelling is refused.
- **Mechanism catalogue** — eighteen names in `packages/core/src/catalogue.ts`: `pairing` ·
  `companion` · `monotonic-order` · `fingerprint-sync` · `producer-owned` · `self-absolution-ban`
  · `actor-scope` · `precedent` · `phase-order` · `turn-locality` · `stated-ground` ·
  `controlled-vocabulary` · `naming` · `added-only` · `one-way-marker` · `delegated-scope` ·
  `scoped-valve` · `forbidden-command`. Structural markers: `scoped-valve` needs a `witness`
  block, `naming` scopes on `target.path`, `forbidden-command` scopes on `command`,
  `delegated-scope` is reserved for the definition-time milestone. The derived
  shape is read from syntax alone (every `source` step's name gives an axis, every relate
  entry's `op` a relation) and must be a subset of the spec; a `source` name neither fixed nor
  bound is refused, so the empty shape never satisfies an axis-restricted name.
- **Axes of a declaration** — `change` · `actor` · `world` · `history`. A fixed source name
  derives `change`, a `file` or `sidecar` binding `world`, a `transcript` binding `history`;
  `actor` has no source yet.
- **Extract steps** — unary steps are registered per `ALGEBRA-02`'s procedure
  (`.claude/rules/extract-vocabulary.md`) with pass-through arguments; combinators are `union` ·
  `onlyIn` · `intersect`, only as a pipeline's first step, and a name outside the three that
  references two extractions is refused.
- **Witness list** — a relation's return type; its order preserves the extraction's input
  order (the premise on which two surfaces reach the same verdict).
- **Relate entry** — `{ id, relation, message | messageBySide }`. Never `rule` in any name.
- **Items** — `packages/covenant/src/declaration-engine.ts`: every extract step maps
  `Items → Items`, an item is `{ key, value }`. `key` drives `onlyIn` · `intersect` · `implies` ·
  `unchanged`; `value` is compared by structural equality. A scalar source is one item under
  key `'0'`; a list without an index keys its elements by position. A key comes from an
  element's position, a field of an object value, or a capture over the value's own text.
- **Paired source** — `source: state` runs the same pipeline over `pre` and `post`. A pair in
  any relation but `unchanged`, or a single extraction under `unchanged`, is a config fault.
- **Config fault** — the value `compileDeclaration` returns instead of a compiled declaration
  (a step name outside the registry, an argument outside a step's closed key set, an
  uncompilable regex, a paired/single mismatch). It names a `location`, is never a throw, and
  the surface turns it into a skip registration that tells the author.

## Term usage rules

1. **Code / package names:** English concept word. `@polydeukes/covenant`, `upholdCovenant()`.
2. **Docs / narrative:** concept word, with context where helpful — "a covenant (a promise both
   agree to share)".
3. **CLI:** the subcommands in the table above are canonical. `pdks` aliases `polydeukes`. Most
   verbs are area subcommands (`pdks <area> <verb>`); `gain` and `docs` are the exceptions — root
   verbs (`pdks gain`, `pdks docs [topic]`) because neither belongs to one area. `gain` aggregates
   measurements every area writes; `docs` reads the documentation bundled into the package, and
   its topic names are a query vocabulary rather than domain terms.
4. **Never use these words** in any code, doc, or user-facing surface — use the concept term instead:
   - ❌ `guard` → ✅ `covenant`
   - ❌ `harness` → ✅ `discipline framework`
   - ❌ `kb` → ✅ `memory`
   - ❌ `rule` → ✅ `discipline` (user-facing surfaces: folder names, config keys, CLI, docs)
   - ❌ `waive` / `waiver` → ✅ `witness` (COVENANT-17: what we built is sudo — the human
     supplies the pass condition — not an inspection given up; `waive` says the latter)

   If an internal compatibility alias is unavoidable, confine it to a comment — never an exported name.

## Korean canon — one fact, one word {#korean-canon}

The Korean mirrors are not free translations. Measured 2026-08-27 across the five Korean
docs: `judge` / `verdict` / `judgment` had all collapsed into 판정, `gate` was spelled three
ways (관문 · 게이트 · 문) across 32 occurrences, and `transcript` two ways. English polysemy
that context disambiguates becomes ambiguity Korean cannot resolve, so the mapping is fixed
here and the docs follow it.

| English | Korean | Note |
|---|---|---|
| covenant | 약속 | First mention per document may gloss as 약속(covenant). |
| discipline | 규율 | Same gloss rule. |
| witness (valve) | 증인 | The verb is 증언하다; the valve is 증인 밸브. |
| judge (the component) | 판정기 | The thing that decides. |
| judgment (the act) | 판정 | The act of deciding. |
| verdict (the result) | 판정 결과 | Never bare 판정 — that is the act. |
| gate | 관문 | Never 게이트, never bare 문. |
| surface | 표면 | Reserved for the session/commit surfaces. Never for "the public API of a document" — write 진입점 or 공개 면 there. |
| transcript | 대화 기록 | Never 전사, never 트랜스크립트. |
| family (discipline) | 계열 | Never 족 — a biological classifier that reads as jargon. |
| enforce level | 강제 수준 | Never 수위 — reads as a water level. |
| posture | 기본 자세 | Bare 자세 reads as a body posture. |
| assembly | 조립 | Keep, but always as 조립 단계 or 조립이 만드는 표 — bare 조립 reads mechanical. |
| head (of a shell line) | 첫 낱말 | 머리 is undefined in Korean; say what it is. |
| domain (of a check) | 관측 범위 | Never 정의역 — that is the mathematical sense. |

**Verbs carry facts, so one English verb maps to several Korean ones.** `close` and `pass`
each cover four distinct facts in this project; a single Korean verb for each makes the
prose say something the English never did.

| English use | Fact | Korean |
|---|---|---|
| fail-closed / the gate closes | The call is refused | 차단한다 |
| close a defect | The defect is fixed | 고친다 |
| close the ungoverned cases | They come under judgment | 판정 범위에 넣는다 |
| close a milestone | The milestone ends | 마감한다 |
| tests pass | The tests succeed | 통과한다 |
| a call passes | Judged and upheld | 판정을 받고 지나간다 |
| sailed through, never judged | No judgment happened | 판정에 이르지 못한다 |
| runs through the covenants | Every call is judged | 약속의 판정을 거친다 |

The last row is the one that misleads: "약속을 통과합니다" reads as "everything passes",
which contradicts the block counts in the same section.

**No clipped Sino-Korean compounds.** Write `실제 측정`, never `실측`. The short form reads
as jargon and its meaning has to be inferred; the long form says what happened. This
applies to living documents. Archived PRDs, dated build-in-public posts, and measurement
records keep the wording they shipped with.

## `rule` — where the jargon survives

- **`rule` survives only as internal jargon for detection primitives** inside judge
  implementations (the `MutationRule` family — pattern detectors over shell commands). A
  detector is a machine part, not a practice. Keep the jargon internal: never exported into a
  user-facing name, folder, config key, or doc.
- Surfaces owned by other tools (an agent's own rules directory) and the npm `keywords`
  array keep their native vocabulary — same exception axis as `keywords`.
- **Dated posts keep the vocabulary they shipped with.** A rename sweeps every living
  surface, but `docs/build-in-public/<date>-*` is a record of what we believed and measured
  on that date, so a term that was correct when published stays (`waiver` throughout the
  v0.1 post) and gains an editor's note instead. The line runs *through* a dated post, not
  around it: a term already banned when the post was written is still a violation and gets
  corrected. Reference docs are the opposite — they speak only the present.

## Package contract — where the shape is kept

The full skeleton and the test that keeps it are the archived
`foundation.prd.package-contract-skeleton.md` §2 and `package-contract.md`.

| Term | Implementation | Not |
|---|---|---|
| **contract** | The `exports` subpath set plus the symbols each entry-point barrel re-exports; README-named symbols included. | Never "export surface". |
| **executor skeleton** | covenant, adapter-*, polydeukes. | A verb with two or more positional parameters, or an anonymous return literal, breaks it. |
| **vocabulary skeleton** | core. | There is no third skeleton. |
| **spec** | Typed `<Verb>Spec`. | Not `Options`, not `Params`. |
| **Verdict / Outcome** | `<Verb>Verdict` when it carries a verdict word, `<Verb>Outcome` otherwise, or a core-named type. | Never an anonymous literal. |
| **spec ingredient** | A constant that fills a field of an exported spec type. | A constant no spec consumes is implementation. |
| **entry point** | Three kinds: `.`, a `.json` data file (`./schema.json`), `./<surface>` (umbrella only, closed list). Condition keys (`types` / `import` / `default`) are not entry points. | Sibling packages have `.` alone. |
| **barrel** | `src/index.ts`; a package's own tests import `../src/<module>.ts`. | No definitions, no `export *`, no second barrel. |
