---
paths:
  - "packages/**"
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
| `advised` | A break recorded without stopping the call — the surface at `enforce: advise`, or the entry's own `enforce: advise` (CONFIG-11), on either surface. |
| `skipped` | The call reached a registration that could not judge it (no evidence channel, or a shell line whose target is not computable). **Not a pass** — it is the recorded absence of a judgment. |
| `unattributed` | A protected entry's on-disk state moved with no judgment row explaining it (COVENANT-14). An observation, not a verdict — it blocks nothing and passes nothing, and it is written by the baseline comparison rather than by a judge. Where `skipped` is an inability the assembly knows up front, this is an attribution failure found after the fact. |

Rows written before `COVENANT-17` say `bypassed`; the reader folds them into `witnessed`,
one-way. Never write `bypassed` in new code.

## Discipline families

A `disciplines:` entry belongs to exactly one family, decided by which predicate key it
carries. The family determines what evidence the judgment needs.

| Family | Key | Judges |
|--------|-----|--------|
| **delta** | `forbid` | Added-direction content of a file change. Existing debt is forgiven; only new occurrences break. |
| **command** | `forbidCommand` | The command line itself. No file evidence needed. |
| **context** | `requirePrecedent` | Session history — was a qualifying call actually executed *before* this one. Needs a transcript channel; without one the entry records `skipped`. |
| **path** | (protected paths) | Whole-path mention or mutation target. |

`when` is a trigger, not a family — it narrows a `requirePrecedent` entry and combines with
nothing else.

## Surfaces, axes, meta-covenants

Naming only; how each one judges is in `dogfooding-axes.md`.

- **Surfaces** — **session** (PreToolUse hook, judges a declared call before it runs) and
  **commit** (`pdks covenant check` under lefthook, re-observes the same change as a staged
  diff). A surface's `enforce` belongs to the observer; an entry's `enforce` is the author's
  rung on the promotion ladder, and the lenient side of the two wins. Neither is part of the
  judgment vocabulary above.
- **Axes** — **tool** (Edit/Write/…), **shell** (Bash), and **transcript**.
- **Meta-covenants** — **self-mod**, **shell-mod**, **transcript-mod**: the registrations that
  protect the judging chain itself. Covenants like any other; the vocabulary above applies
  unchanged.
- **Declared limit vs defect** — a declared limit leaves a `skipped` row and passes; a defect
  passes with NO row, or is recorded `passed` while never judged. They look alike in a diff
  and are opposite in meaning. The telemetry row is what separates them.

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
