---
paths:
  - "packages/**"
  - "docs/**"
---

# Polydeukes Ubiquitous Language

The shared vocabulary contract for developers and AI agents. Use these terms consistently
in code, package names, CLI, comments, and commit messages.

## Core terms

| Concept | Package / code | Verb | CLI | Definition |
|---------|----------------|------|-----|------------|
| **Covenant** | `@polydeukes/covenant` | uphold / break | `pdks covenant check` | Deterministic block on edits/pushes — a mutual promise that binds the human and the AI equally. |
| **Discipline** | — (category + unit term) | — | `pdks` (root) | Two levels, one word. The category: "Polydeukes is a development *discipline* framework." The countable unit: **a discipline** is one practice a team imposes on itself — registered as prose (with an enforcement tag) and promotable into a covenant. Self-discipline made into tooling. |
| **Gain** | — (cross-cutting) | gain | `pdks gain` | ROI telemetry aggregation across all areas (covenant/ledger/memory). A root verb, not an area subcommand — it reads measurements every area writes. |
| **Ledger** | `@polydeukes/ledger` | record / verify | `pdks ledger {start,verify,finish}` | Work tracking; completion authority moves from "I'm done" to "the actions passed." |
| **Memory** | `@polydeukes/memory` | recall / ingest | `pdks memory search` | Searchable record of decisions and dead ends. Local SQLite + FTS5. |
| **Verify** | `@polydeukes/verify` | refute / attest | `pdks verify` | Multi-agent adversarial verification — judgments check each other rather than self-report. |
| **Witness** | `ttlWitness` / config `witness:` | witness | — | The human valve on a blocked judgment, sudo-style: the check computes "is an accountable human present, right now", and the human supplies that pass condition in person (session: the token typed first-line-alone; commit: the TTY answer). Consulted only AFTER a verdict blocked — recorded as `witnessed`, would-block only, never silent. |

`core` and `adapter-*` packages keep their plain names.

## Judgment vocabulary

These six words are the telemetry contract. A row in `.polydeukes/roi.log` carries exactly
one of them, and tests, docs, and CLI output must use the same word for the same event.

| Verdict | Means |
|---------|-------|
| `passed` | The call was judged and upheld the covenant. |
| `blocked` | The call was judged and broke it. |
| `witnessed` | A **blocked** verdict a human opened in person. Never silent, never a clean call — the valve is consulted only after a block. |
| `advised` | A break recorded without stopping the call — the surface at `enforce: advise`, or an entry whose own `enforce` is `advise` or absent (CONFIG-11; absence is advise since POSTURE-01), on either surface. The default disposition of every user discipline. |
| `skipped` | The call reached a registration that could not judge it (no evidence channel, or a shell line whose target is not computable). **Not a pass** — it is the recorded absence of a judgment. |
| `unattributed` | A protected entry's on-disk state moved with no judgment row explaining it (COVENANT-14). An observation, not a verdict — it blocks nothing and passes nothing, and it is written by the baseline comparison rather than by a judge. Where `skipped` is an inability the assembly knows up front, this is an attribution failure found after the fact. |

Rows written before `COVENANT-17` say `bypassed`; the reader folds them into `witnessed`,
one-way. Never write `bypassed` in new code.

A row has four fields (timestamp · event · label · subject) and an optional fifth whose
meaning the event decides: on a break it is the witness list as a JSON array; on `skipped` it
is a **skip reason** from the closed tuple `no-observation` (the surface has no channel for
what the entry reads) · `config-fault` (assembly could not compile the entry) · `supply-pass`
(the declaration's own `supply: pass` let an absent source through). A `skipped` row without
a fifth field is a family runtime skip and reads back with no reason.

## Discipline families

A `disciplines:` entry belongs to exactly one family, decided by which predicate key it
carries. The family determines what evidence the judgment needs.

| Family | Key | Judges |
|--------|-----|--------|
| **delta** | `forbid` | Added-direction content of a file change. Existing debt is forgiven; only new occurrences break. |
| **command** | `forbidCommand` | The command line itself. No file evidence needed. |
| **context** | `requirePrecedent` | Session history — was a qualifying call actually executed *before* this one. Needs a transcript channel; without one the entry records `skipped`. |
| **path** | `immutable` | Whole-path mention or mutation target; the key's own glob is the scope. Distinct from the meta-covenants' protected-path matching, which judges the chain itself and is not a `disciplines:` entry. |
| **declaration** | `declare` | One algebra declaration (below) over each file change as a world. Its `scope` block is its scope; the entry takes no `in`/`except`/`when`. |

`when` is a trigger, not a family — it narrows a `requirePrecedent` entry and combines with
nothing else.

## Surfaces, axes, meta-covenants

Naming only; how each one judges is in `dogfooding-axes.md`.

- **Surfaces** — **session** (PreToolUse hook, judges a declared call before it runs) and
  **commit** (`pdks covenant check` under lefthook, re-observes the same change as a staged
  diff). A surface's `enforce` belongs to the observer; an entry's `enforce` is the author's
  rung on the promotion ladder — absent means `advise`, `block` is the promotion — and the
  lenient side of the two wins. Meta-covenants carry no entry rung, so they alone block on
  the session surface. Neither setting is part of the judgment vocabulary above.
- **Axes** — **tool** (Edit/Write/…), **shell** (Bash), and **transcript**.
- **Meta-covenants** — **self-mod**, **shell-mod**, **transcript-mod**: the registrations that
  protect the judging chain itself. Covenants like any other; the vocabulary above applies
  unchanged.
- **Declared limit vs defect** — a declared limit leaves a `skipped` row and passes; a defect
  passes with NO row, or is recorded `passed` while never judged. They look alike in a diff
  and are opposite in meaning. The telemetry row is what separates them.

## Algebra vocabulary

The declaration grammar `ALGEBRA-01` fixed in the core (`packages/core/src/algebra.ts`). Every
list below is a closed enumeration whose single source is the `as const` tuple in that
module; a name outside a closed list is rejected by validation, never coerced.

- **Declaration** — one judgment written as data: `judge = relate ∘ extract`. Six blocks:
  **`scope`** (does this declaration apply — a source name plus constant regex lists),
  **`sources`** (what a name outside the fixed five stands for — `{ name: { file: '<repo-relative
  path>' } }`, `{ name: { sidecar: true } }` or `{ name: { transcript: true } }`, the kind
  position closed to `file` · `sidecar` · `transcript`; a sidecar binding names a channel the
  surface supplies and a transcript binding the session's conversation history, so the value
  of either is the marker `true`, never a path), **`supply`** keys must name one of the fixed
  five or one of the declaration's own `sources` — the universe is closed, so a misspelled key
  is refused rather than left as a policy nothing applies to; **`supply`** (what a missing source does:
  `error` refuses, `pass` leaves the call unjudged),
  **`extract`** (named pipelines producing values), **`relate`** (entries pairing an extract
  name with a relation), **`witness`** (the valve that stands *after* the verdict — its own
  `extract` + `relate`, same grammar; it sees the body's extract names, the body never sees
  its). `mechanism` is required and names a catalogue entry (below); there is no `axis` key —
  the axes are derived from the sources a declaration reads: a fixed name is `change`, a
  `file` or `sidecar` binding is `world`, a `transcript` binding is `history`; `actor` has no
  source yet.
- **World axis** — the values a judgment sees that no payload carries. Five fixed source names
  come with every world (`target.path` · `pre` · `post` · `state` · `changes` — the observation
  unit's change set); a declaration's `sources` bindings add its own. The **supply layer**
  (`planSources` · `supplySources` in the covenant package) fills the IR's `world` field —
  `files` read through the surface's injected reader, `channels` through its channel reader
  (`sidecar` is the spawn-record list as JSON text; `'[]'` says the channel observed no spawn,
  an absent key says there is no channel), `changes` when the surface observes more
  than it dispatches at once — and the judge merges them: a named file this input changes is
  read from the change's `post` (absent on a deletion), any other from `world.files`, a
  channel binding from `world.channels` (a channel has no path, so the change set never
  overlaps it), a transcript binding from the `CanonicalTranscript` the composition root
  injects, flattened once into a plain **session snapshot** (`observedAtMs` · `userMessages` ·
  `toolCalls`, each observation carrying its ordinal `index` within its own list) — the
  engine judges data, never a query interface, and the history steps (`toolUses` ·
  `userTexts` · `agentType` · `first` · `ageMs`) read that snapshot. core and covenant open
  no file; the readers are the **supply bodies'** — each
  adapter implements its surface's reading (`sessionSourceReader` · `sessionChannelReader`
  on the session side, `observationSourceReader` on the commit side) and the composition
  root only injects them.
- **Relation** — the closed position where the last comparison happens. Seven names:
  `empty` · `nonEmpty` · `equal` · `subset` · `implies` · `ordered` · `unchanged`. `empty` and
  `subset` are the primitives; the rest expand to them (`nonEmpty ≡ ¬empty`,
  `equal ≡ subset` both ways, `implies ≡ subset` of key projections, `unchanged ≡ equal` over
  shared keys) — the expansion is engine-internal and lives in comments here. A constant
  bound is compared in extraction (`filter`), never in the relation position. The names are
  camelCase like every other position in the grammar; the capitalised spelling was the
  redesign research's constructor notation and is refused as a name outside the list.
- **Mechanism catalogue** — the seventeen judgment-mechanism names (`packages/core/src/catalogue.ts`),
  closed: `pairing` · `companion` · `monotonic-order` · `fingerprint-sync` · `producer-owned` ·
  `self-absolution-ban` · `actor-scope` · `precedent` · `phase-order` · `turn-locality` ·
  `stated-ground` · `controlled-vocabulary` · `naming` · `added-only` · `one-way-marker` ·
  `delegated-scope` · `scoped-valve`. Each name carries a **shape spec** — the axes it may
  read, the relations it may relate, and a structural marker (`scoped-valve` needs a
  `witness` block, `naming` scopes on `target.path`, `delegated-scope` is reserved for the
  definition-time milestone). A declaration's **derived shape** is read from its syntax
  alone — every `source` step's name gives an axis, every relate entry's `op` a relation — and
  must fall inside the spec (subset, not equality). A `source` name that is neither fixed nor
  bound in `sources` is refused, so the empty shape can never satisfy an axis-restricted name.
- **Axis (of a declaration)** — the closed tuple `change` · `actor` · `world` · `history`.
  Today the fixed five source names derive `change` and a `sources` binding derives `world`;
  `actor` and `history` gain a deriving source when their sources are registered.
- **Extract step** — unary (open vocabulary, registered per `ALGEBRA-02`'s procedure, arguments
  pass through) or **binary combinator** (closed: `union` · `onlyIn` · `intersect`, only as a
  pipeline's first step). A combinator name is read as a combinator whatever its shape; a
  name outside the three that references two extractions is refused.
- **Witness (value)** — one element for which a relation does not hold. A relation returns a
  **witness list**, never a boolean; an empty list means it holds, and the order preserves
  the extraction's input order (the premise on which two surfaces reach the same verdict).
  Same word, two senses: the *witness valve* (above, the human's pass condition) and the
  *witness element* — the valve is named after what it supplies.
- **Relate entry** — `{ id, relation, message | messageBySide }`. Never `rule` in any name —
  the closed-vocabulary jargon rule above applies; `relate` is the primitive's own verb.
- **Item / items** — the engine's value model (`ALGEBRA-02`, `packages/covenant/src/declaration-engine.ts`):
  every extract step maps `Items → Items`, where an item is `{ key, value }`. `key` is the unit
  of combination and of keyed comparison (`onlyIn`, `intersect`, `implies`, `unchanged`);
  `value` is what a relation compares, by structural equality. A scalar source is one item
  under key `'0'`; a list without an index keys its elements by position. A key comes from
  one of three places — an element's position, a field of an object value, or a capture over
  the value's own text — and the last is what lets two different values meet under one key.
- **Paired source** — `source: state` reads `World.state = { pre, post }` and runs the same
  pipeline over both, producing a pre/post pair. Only `unchanged` accepts a pair; a pair in any
  other relation, or a single extraction under `unchanged`, is a config fault at compile time.
- **World source names** — the four names `worldsFromInput` supplies per file change:
  `target.path` (repo-relative path), `pre`, `post` (the side the change carries), `state`
  (`{ pre, post }`, modifications only). A side the change lacks is an absent key — the
  declaration's `supply` policy, never the host, says what that means.
- **Config fault** — the value `compileDeclaration` returns instead of a compiled declaration:
  a step name outside the registry, an argument outside a step's closed key set, an
  uncompilable regex, or a paired/single shape mismatch. It names a `location` and is never a
  throw; the surface turns it into a skip registration that tells the author.

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

## Discipline vs `rule` — the precise boundary

- **Discipline** is the user-facing concept: a practice one imposes on oneself. A discipline
  is born as prose and promoted into a covenant; what users register, list, and read are
  disciplines — never "rules".
- **`rule` survives only as internal jargon for detection primitives** inside judge
  implementations (the `MutationRule` family — pattern detectors over shell commands).
  A detector is a machine part, not a practice; renaming it `discipline` would merge two
  different concepts into one word. Keep the jargon internal: never exported into a
  user-facing name, folder, config key, or doc.
- Surfaces owned by other tools (an agent's own rules directory) and the npm `keywords`
  array keep their native vocabulary — same exception axis as `keywords`.
- **Dated posts keep the vocabulary they shipped with.** A rename sweeps every living
  surface, but `docs/build-in-public/<date>-*` is a record of what we believed and measured
  on that date, so a term that was correct when published stays (`waiver` throughout the
  v0.1 post) and gains an editor's note instead. The line runs *through* a dated post, not
  around it: a term already banned when the post was written is still a violation and gets
  corrected. Reference docs are the opposite — they speak only the present.

## Package contract

The shape every package's outer boundary takes. The full skeleton and the test that keeps it
are the archived `foundation.prd.package-contract-skeleton.md` §2 and `package-contract.md`; this table
is the vocabulary only.

| Term | Meaning | Not |
|---|---|---|
| **contract** | Everything a package promises its consumers: the `exports` subpath set plus the symbols each entry-point barrel re-exports. README-named symbols are part of it. | Not a *surface* — surfaces are session and commit. Never "export surface". |
| **executor skeleton** | The contract shape of covenant, adapter-*, polydeukes: every runtime export is a **verb**, and a verb takes **one spec object** and returns **one result**. Other exports are the types a spec needs and spec ingredients. | A verb with two or more positional parameters, or an anonymous return literal, breaks it. |
| **vocabulary skeleton** | core's contract shape: types, `as const` tuples, positional pure functions and protocol primitives. **No function in core takes a spec** — that is the one discriminator between the two skeletons. | There is no third skeleton. |
| **spec** | A verb's only input, typed `<Verb>Spec`. | Not `Options`, not `Params`. |
| **Verdict / Outcome** | A verb's result type: `<Verb>Verdict` when it carries the judgment vocabulary above, `<Verb>Outcome` otherwise. Or a core-named type. | Never an anonymous literal. |
| **spec ingredient** | The only constant a contract may carry: a value used to fill a field of an exported spec type. | A constant no spec consumes is implementation. |
| **entry point** | An `exports` subpath. Three kinds: `.`, a `.json` data file (`./schema.json`), `./<surface>` (umbrella only, closed list). Condition keys (`types` / `import` / `default`) are not entry points. | Sibling packages have `.` alone. |
| **barrel** | The `src/index.ts` behind an entry point. Re-exports only; the consumer contract, not the test surface — a package's own tests import `../src/<module>.ts`. | No definitions, no `export *`, no second barrel. |
