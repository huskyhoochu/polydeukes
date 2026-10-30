# Polydeukes

`AGENTS.md` routes every coding agent working in this repository: it names where each kind of
knowledge lives and states almost nothing itself. Read the files it points to. If `AGENTS.local.md`
exists, read it after this file as additive machine-local context (this machine's Forgejo, release
chain, and mirror); it never replaces the shared files.

Polydeukes is a development discipline framework for building alongside an AI coding partner —
deterministic covenants, a verifiable ledger, local memory, and adversarial verification on one thin
core. It ships as a single `pdks` executable, npm packages, a Rust crate, and a Python SDK.

## Read before every task

These rules carry no `paths:` and apply to all work. Hosts that load `.claude/rules/` see them
automatically; every other agent reads them first.

| File | What it settles |
|---|---|
| `.claude/rules/conventions.md` | binding vocabulary, bilingual docs, build and test commands, tools that stay out |
| `.claude/rules/development-process.md` | the roadmap → PRD → TDD loop, retrofit and `ISSUE-<n>` tickets, Forgejo issues, the milestone gate |
| `.claude/rules/self-dogfooding.md` | how this repository judges itself, what is session-protected, recovery from a locked session |
| `.claude/rules/knowledge-reads.md` | knowledge is written under `_docs/` and read through `pdks memory` |
| `.claude/rules/model-tiers.md` | which model runs which role |

## Read before touching a path

Every other file in `.claude/rules/` carries a `paths:` list and states the constraints a file's own
source does not explain. Before editing, list the intended paths, match them against each rule's
`paths:`, and read every matching rule in full; repeat when the scope grows. Hosts without automatic
rule loading (Codex, Grok) do this routing by hand. The rules most often reached:

| To learn | Rule |
|---|---|
| package roles, dependency direction, the single executable | `workspace-structure.md` |
| adding a package, release and publishing registrations | `new-package-checklist.md` |
| a package's public contract and barrel shape | `package-contract.md` |
| the ubiquitous language and the banned words | `domain-terms.md` (concepts in the root `CONTEXT.md`) |
| the declaration grammar's closed lists | `algebra-vocabulary.md` |
| what the two surfaces and three axes compare, the witness valve | `dogfooding-axes.md` |
| how adapters build the input IR and what counts as evidence | `evidence-and-ir.md` |
| how an acceptance criterion or a measured number must be written | `claims-and-criteria.md` |
| what Rust in `packages/pdks` must reproduce from the TS judge | `rust.md` |

## Where knowledge lives

| Question | Source |
|---|---|
| why something was decided, what was measured, what a past ticket changed | the knowledge store: `pnpm exec pdks memory search <words>`, then `show <id>` (`_docs/knowledge/`) |
| current behaviour in detail | the code and the archived PRDs (`_docs/knowledge/*.prd.*`) |
| what is planned, open, or blocked | Forgejo issues on `b95labs/polydeukes`; a milestone's description holds its goal and Exit Criteria |
| how the plan changed over time | `_docs/roadmap.history.md`, read through `pdks memory show` |
| what a user installs, configures, and recovers | `docs/` (English and `*.ko.md`), `pdks docs <topic>`, <https://polydeukes.vercel.app> |
| why the project is built this way, in public language | `docs/why-polydeukes.md` |

## Workflows

Skills live in `.claude/skills/<name>/SKILL.md`; an agent without skill support reads the file and
follows it.

| Task | Skill |
|---|---|
| a roadmap or `ISSUE-<n>` ticket | `/ticket <ID>` (runs `/tdd` and `/post-task`) |
| production code under `packages/` | `/tdd` |
| closing a substantial non-ticket chore before it commits | `/post-task` |
| turning a recurring problem into a discipline entry | `/discipline-draft` |
