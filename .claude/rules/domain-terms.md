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

`core` and `adapter-*` packages keep their plain names.

## Term usage rules

1. **Code / package names:** English concept word. `@polydeukes/covenant`, `upholdCovenant()`.
2. **Docs / narrative:** concept word, with context where helpful — "a covenant (a promise both agree to share)".
3. **CLI:** the subcommands in the table above are canonical. `pdks` aliases `polydeukes`. Most verbs are area subcommands (`pdks <area> <verb>`); `gain` is the exception — a root verb (`pdks gain`) because it aggregates across every area.
4. **Never use these words** in any code, doc, or user-facing surface — use the concept term instead:
   - ❌ `guard` → ✅ `covenant`
   - ❌ `harness` → ✅ `discipline framework`
   - ❌ `kb` → ✅ `memory`
   - ❌ `rule` → ✅ `discipline` (user-facing surfaces: folder names, config keys, CLI, docs)

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
