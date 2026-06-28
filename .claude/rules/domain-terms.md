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
| **Discipline** | — (category term) | — | `pdks` (root) | The framework itself: "Polydeukes is a development *discipline* framework." Self-discipline made into tooling. |
| **Ledger** | `@polydeukes/ledger` | record / verify | `pdks ledger {start,verify,finish}` | Work tracking; completion authority moves from "I'm done" to "the actions passed." |
| **Memory** | `@polydeukes/memory` | recall / ingest | `pdks memory search` | Searchable record of decisions and dead ends. Local SQLite + FTS5. |
| **Verify** | `@polydeukes/verify` | refute / attest | `pdks verify` | Multi-agent adversarial verification — judgments check each other rather than self-report. |

`core` and `adapter-*` packages keep their plain names.

## Term usage rules

1. **Code / package names:** English concept word. `@polydeukes/covenant`, `upholdCovenant()`.
2. **Docs / narrative:** concept word, with context where helpful — "a covenant (a promise both agree to share)".
3. **CLI:** the subcommands in the table above are canonical. `pdks` aliases `polydeukes`.
4. **Never use these words** in any code, doc, or user-facing surface — use the concept term instead:
   - ❌ `guard` → ✅ `covenant`
   - ❌ `harness` → ✅ `discipline framework`
   - ❌ `kb` → ✅ `memory`

   If an internal compatibility alias is unavoidable, confine it to a comment — never an exported name.
