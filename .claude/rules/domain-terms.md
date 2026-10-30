---
paths:
  - "packages/**"
  - "docs/**"
---

# Polydeukes Ubiquitous Language — implementation mapping

Concepts are defined in the root `CONTEXT.md`. This file maps each one to packages and symbols and
enforces the words in code, CLI, comments, and commit messages. The declaration grammar's closed
lists are in `algebra-vocabulary.md`; the Korean renderings are in `korean-canon.md`; the package
contract vocabulary is in `package-contract.md`.

## Core terms

| Concept             | Package / code                                                                                                                                                                               | Verb            | CLI                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------- |
| **Covenant**        | `polydeukes`'s `src/covenant/` module                                                                                                                                                        | uphold / break  | `pdks covenant check` |
| **Discipline**      | one `disciplines:` entry (prose + enforcement tag)                                                                                                                                           | —               | `pdks` (root)         |
| **Memory**          | `@polydeukes/memory` (SQLite + FTS5)                                                                                                                                                         | recall / ingest | `pdks memory search`  |
| **Witness (valve)** | `ttlWitness` / config `witness:` (meta-covenant valve: the token typed first-line-alone, held `ttlMinutes`) · a declaration's `witness` block (discipline valve: its own `extract`·`relate`) | witness         | —                     |

`core` and `adapter-*` packages keep their plain names.

## Judgment vocabulary — the telemetry row

The six verdict words (`passed` · `blocked` · `witnessed` · `advised` · `skipped` · `unattributed`)
are the telemetry contract: a row in `.polydeukes/roi.log` carries exactly one, and tests, docs, and
CLI output use the same word for the same event. `advised` is the disposition of an entry whose own
`enforce` is `advise` or absent, or of a surface at `enforce: advise`. `unattributed` is written by
the baseline comparison, not by a judge. Older rows that say `bypassed` are folded into `witnessed`
by the reader; never write `bypassed` in new code.

A row has four fields (timestamp · event · label · subject) and an optional fifth whose meaning the
event decides: on a break it is the witness list as a JSON array; on `skipped` it is a
**skip
reason**
from the closed tuple `no-observation` (the surface has no channel for what the entry reads) ·
`config-fault` (no assembled registration carries it: the loader refuses a config with an entry it
cannot compile) · `supply-pass` (the declaration's own `supply: pass` let an absent source through).
A `skipped` row without a fifth field is a family runtime skip and reads back with no reason.

## Surfaces, axes, meta-covenants

Naming only; how each one judges is in `dogfooding-axes.md`.

- **Surfaces** — **session** (one call observed before it runs — an adapter hook or the SDK, IR on
  stdin) and **change-set** (`pdks covenant check --diff` over a finished change set from any
  producer). A surface's `enforce` belongs to the observer; an entry's `enforce` is the author's
  rung on the promotion ladder — absent means `advise`, `block` is the promotion — and the lenient
  side wins. Meta-covenants carry no entry rung, so they alone block on the session surface. Neither
  setting is a verdict word.
- **Axes** — **tool** (Edit/Write/…), **shell** (Bash), and **transcript**.
- **Meta-covenants** — **self-mod**, **shell-mod**, **transcript-mod**; registered directly by the
  session composition root. The verdict vocabulary applies unchanged.
- **Declared limit vs defect** — a declared limit leaves a `skipped` row; a defect leaves NO row, or
  a `passed` row with no judgment. The telemetry row is what separates them.

## Term usage rules

1. **Code / package names:** English concept word. `upholdCovenant()`, `dispatchCovenants()`.
2. **Docs / narrative:** concept word, with context where helpful — "a covenant (a promise both
   agree to share)".
3. **CLI:** the subcommands in the table above are canonical; `pdks` aliases `polydeukes`. Most
   verbs are area subcommands (`pdks <area> <verb>`); `docs` is a root verb (`pdks docs [topic]`)
   because it belongs to no area, and its topic names are a query vocabulary, not domain terms.
4. **Never use these words** in any code, doc, or user-facing surface — use the concept term:
   - ❌ `guard` → ✅ `covenant`
   - ❌ `harness` → ✅ `discipline framework`
   - ❌ `kb` → ✅ `memory`
   - ❌ `rule` → ✅ `discipline` (user-facing surfaces: folder names, config keys, CLI, docs)
   - ❌ `waive` / `waiver` → ✅ `witness` (what was built is sudo — the human supplies the pass
     condition — not an inspection given up; `waive` says the latter)

   If an internal compatibility alias is unavoidable, confine it to a comment — never an exported
   name.

## `rule` — where the jargon survives

- **`rule` survives only as internal jargon for detection primitives** inside judge implementations
  (the `MutationRule` family — pattern detectors over shell commands). A detector is a machine part,
  not a practice. Never export it into a user-facing name, folder, config key, or doc.
- Surfaces owned by other tools (an agent's own rules directory) and the npm `keywords` array keep
  their native vocabulary.
- **Reference docs describe current behavior and use the current vocabulary.**
