---
name: post-task
description: "Pre-PR closing checks for any completed work session: TSDoc pass over the changed files, docs-drift check (did this change make CLAUDE.md / .claude/rules / README stale?), and the dev-log self-question (was there a non-obvious learning worth recording?). Invoke after the TDD cycle's VALIDATE passes and immediately before creating a PR — or standalone after substantial non-ticket chores, right before committing to main. Also triggers on 'post-task', '작업 마무리 점검', 'PR 내기 전에 점검'."
user_invocable: true
argument: "(none — operates on the current session's uncommitted changes)"
---

# Post-Task Skill

The closing discipline of a work session — run after VALIDATE, before the PR (or before the
final commit, for non-ticket chores). It is the manual precursor of the guidance the ledger
`finish` gate will print after self-dogfooding (roadmap LEDGER-06); until then, this checklist
is upheld by hand, exactly like the TDD skill's pre-flight.

Three checks, then one mandatory block. Every item must be grounded in tool output from **this
session** — an unverified "looks fine" is not an answer. Skipping the block is not an option;
"nothing to do" is recorded, not implied.

## 1. TSDoc pass (always)

Run the `/tsdoc` skill with no arguments — its default scope (uncommitted/untracked files) is
exactly this session's surface. Let it document exported symbols the session added or changed.
Record what it did (files touched, or "no exported symbols changed").

## 2. Docs-drift check (always ask, conditionally act)

Ask: **did this change make any written description stale?** Check the changed files against:

- `CLAUDE.md` — commands, structure, conventions it states (e.g. a renamed script or tsconfig
  invalidates its Commands section);
- `.claude/rules/*.md` — workspace structure, domain terms;
- `README.md` / `STORY.md` and their `*.ko.md` mirrors — **bilingual docs must move together**;
- the affected package's own README, if any.

Small drift: fix it directly in this session. Structural drift (new package, new convention,
reshaped workflow): run the `/codebase-docs` skill instead. Record the verdict either way, with
the specific stale sentence found — or "no drift" after actually checking.

## 3. Dev-log self-question (always answer)

Ask the three trigger questions (from the knowledge-store discipline — non-obvious learnings
only, not a diary):

1. **Looked-like ≠ was**: did something appear to be X but turn out to be Y?
2. **Approach pivot**: did the session abandon one approach for another, and why?
3. **Stale doc corrected by measurement**: did a document claim something reality contradicted?

If any answer is yes, write `_docs/knowledge/<scope>.dev-log.<name>.md` following the
`_docs/knowledge/README.md` contract: searchable one-line conclusion as the title, body as
symptom → wrong hypothesis → real cause → prescription, one `## H2 {#anchor}` per atomic topic.
If all three are no, record `dev-log: none` explicitly.

## The mandatory block

Emit this before proceeding to the PR (or the final commit):

```
### Post-task
- TSDoc: <files documented, or "no exported symbols changed">
- Docs drift: <stale sentence found + fix applied | "no drift" (checked: <files>)>
- Dev-log: <_docs/knowledge/<scope>.dev-log.<name>.md — one-line conclusion | "none">
```

The user may waive a run via the literal phrase `skip post-task` in their **most recent**
message. Self-waiving is forbidden.
