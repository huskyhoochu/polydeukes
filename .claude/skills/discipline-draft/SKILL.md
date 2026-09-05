---
name: discipline-draft
description: Turn a described discipline problem into a registered entry in polydeukes.config — a judged entry when the declaration grammar can express it, a draft entry otherwise. Use when the user describes a recurring problem they want promised away ("I keep...", "stop X from happening", "we should never...", "how do I enforce Y").
---

# discipline-draft — from a problem description to a registered discipline

This project is judged by Polydeukes. A discipline starts as prose and climbs a ladder —
`draft` (registered, read, never judged) → `advise` (judged, recorded, never stops a call) →
`block` (stops the call; the user's explicit choice, never the default). This skill walks a
problem description down to the right first rung and registers it.

## Procedure

### 1. Restate the problem as a promise

Rewrite the description as one sentence of the form "X must not happen" or "when A happens,
B must also happen". If the sentence needs "unless" more than once, split it into two
promises and classify each separately.

### 2. Classify the shape

Ask these questions in order; the first yes decides.

| # | Question | Family | Entry key |
| --- | --- | --- | --- |
| 1 | Is the promise about content newly ADDED to a file (a pattern that must not appear in new lines)? | declaration | `declare` — mechanism `added-only` (step 4a) |
| 2 | Is it about a whole path that must not be modified or deleted (creating it once stays allowed)? | declaration | `declare` — the frozen-path shape (step 4a) |
| 3 | Is it about the shell command line itself, regardless of files? | declaration | `declare` — mechanism `forbidden-command` (step 4a) |
| 4 | Does it require that something else was already done earlier in the session (a tool call that must precede this one)? | declaration | `declare` — mechanism `precedent` (step 4a) |
| 5 | None of the above | — | `draft: true` (step 4b) |

Existing occurrences are forgiven by an added-only declaration — only new additions break the promise.
That is usually what you want: a discipline adopted today should not indict yesterday's code.

Two path-shaped promises take no `disciplines:` entry at all. A path nobody may touch
belongs in the top-level `protectedPaths:` list — its own config block, never an entry
key. And a path that must never be CREATED is not expressible today: the frozen-path shape
allows creation by design, so register that promise as a draft (step 4b).

### 3. Check the observation boundary

Two kinds of promise cannot be judged here, whatever their shape:

- **Destruction outside the repository** — judgment observes the project root only. Register
  nothing; use the agent's own permission deny policy for commands like `rm -rf ~`.
- **Writes by child processes** — a test runner or script writing files is invisible to the
  session surface, which judges declared tool calls only. Say so to the user; the commit
  surface will still see the result as a staged diff.

### 4a. Expressible now — register a judged entry

Add the entry to the `disciplines:` array in `polydeukes.config.yaml`. Advise is the default
landing — a break is recorded as `advised` and the call goes on — and the `enforce: advise`
line below only spells that default out. NEVER write `enforce: block` from this skill:
promotion to block is the user's own choice, made after the advise measurements have been
read.

The examples below are whole documents, so `languages:` — the schema's one required block —
appears alongside the entry; in a config that already has one, copy the entry only.

```yaml
languages:
  placeholder:
    productionGlob: 'src/**'
    testCmd: 'echo "set a verification command for {scope}"'
disciplines:
  - id: 'no-focused-tests'
    why: 'a committed .only silently shrinks the suite to one test'
    declare:
      mechanism: 'added-only'
      scope: { source: 'target.path', include: ['\.test\.[tj]s$'] }
      supply: { pre: 'empty', post: 'empty' }
      extract:
        before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: '(\.only\()' }]
        after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: '(\.only\()' }]
        added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }]
      relate:
        - { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}: {value}' }
    enforce: advise
```

The frozen-path shape (question 2) is the same block with `mechanism: 'self-absolution-ban'`
and `extract` = `prior` (source `pre`) · `here` (source `target.path`) · `after` (source
`post`) · `deleted` (`onlyIn` of `here` notIn `after`) · `touched` (`union` of `prior`,
`deleted`), related by `empty` over `touched`. The `keyByPattern` regex must carry one
capture group — group 1 is the key — so wrap the whole pattern in parentheses.

The command-line shape (question 3) reads the fixed source `command` and scopes on it, so
only shell calls are judged; `lines` splits the command line, `matches` keeps the banned
lines, and `empty` is the verdict:

```yaml
languages:
  placeholder:
    productionGlob: 'src/**'
    testCmd: 'echo "set a verification command for {scope}"'
disciplines:
  - id: 'no-force-push'
    why: 'a force push rewrites history nobody reviewed'
    declare:
      mechanism: 'forbidden-command'
      scope: { source: 'command' }
      extract:
        hits: [{ op: 'source', of: 'command' }, { op: 'lines' }, { op: 'matches', re: 'git push\\b.*--force(?![\\w-])' }]
      relate:
        - { id: 'no-force', relation: { op: 'empty', of: 'hits' }, message: '{value}' }
    enforce: advise
```

The precedent shape (question 4) binds the session's transcript, keeps the tool calls that
ran and succeeded, and requires one matching the precedent — `nonEmpty` is the verdict.
`supply: { session: 'pass' }` makes the commit surface, which has no session, record
`skipped` instead of blocking:

```yaml
languages:
  placeholder:
    productionGlob: 'src/**'
    testCmd: 'echo "set a verification command for {scope}"'
disciplines:
  - id: 'manifest-needs-npm-view'
    why: 'a dependency version must be measured before it is written'
    declare:
      mechanism: 'precedent'
      scope: { source: 'target.path', include: ['^(packages/[^/]+/)?package\\.json$'] }
      sources: { session: { transcript: true } }
      supply: { session: 'pass' }
      extract:
        npmView:
          - { op: 'source', of: 'session' }
          - { op: 'toolUses', names: ['Bash'] }
          - { op: 'filter', when: [{ field: 'succeeded', eq: true }] }
          - { op: 'select', path: 'args.command' }
          - { op: 'matches', re: '\\bnpm view ' }
      relate:
        - { id: 'npm-view', relation: { op: 'nonEmpty', of: 'npmView' }, message: 'no successful npm view precedes this edit' }
    enforce: advise
```

A precedent that is a tool call rather than a shell command drops `names`, then reads
`field name` and `matches` over it; a spawn of one agent kind is `toolUses` with
`subagentType`.

**Write the regex yourself — the user states the promise, you author the pattern.** The
pattern is the part users find hardest, so never hand the prose back and ask for one. Three
authoring traps, each measured on a live config:

- **A pattern answers a syntactic question only.** "Is this string a forbidden word" is
  syntax; "is this a new dependency version" is meaning, and a regex leaks both ways on a
  semantic question. When the question is semantic, narrow the declaration's `scope` block
  (regular expressions over the path) to the files where any match IS a break, or accept
  "editing this file at all" as the trigger.
- **`^` means a line start only after `lines`.** A declaration's `lines` step splits the
  content first, so `^` inside `keyByPattern` or `matches` after it is a line start; a
  pattern over an unsplit text anchors to the whole text, so write `(^|\n)` there.
- **Author both directions.** Before registering, write down one string the pattern must
  match and one nearby string it must not (`forbid` vs `forbidden`, a flag vs its
  substring). A pattern checked in only the breaking direction over-fires in review-proof
  ways.

### 4b. Not expressible yet — register a draft

A draft is prose with a handle: `id`, `why`, and the literal marker `draft: true` — no other
keys. It produces no judgment and no telemetry; `pdks explain` lists it as unpromoted.
Record the SHAPE of the promise inside `why`, so the promotion destination is already
written down when a later engine can express it. Name the shape in these terms:

| Shape | The promise reads like |
| --- | --- |
| pairing | every element of set A has a counterpart in set B (translation keys, i18n) |
| companion | if X appears in a unit, Y must appear with it |
| ordered | a sequence must keep its order (migration journals, version ladders) |
| fingerprint | a derived artifact must match the hash/stamp of its source |
| producer-owned | only a designated generator may write this artifact |
| self-absolution | the party being judged must not write its own verdict field |
| actor-scope | the same action is fine for one actor and a break for another |
| phase-order | several precedents, in a fixed order |
| turn-locality | the evidence must be in the same turn or time window |
| stated-ground | the reason must be written down before the action |
| controlled-vocabulary | only an enumerated set of words/values is allowed |
| naming-convention | names must match a pattern per kind |
| irreversible-marker | once present, a marker may never be removed |
| delegation-scope | a delegated task may touch only its granted scope |
| scope-valve | a defined exception valve, judged rather than ad hoc |
| claim-verification | the claim must be re-run/measured, not trusted |

```yaml
languages:
  placeholder:
    productionGlob: 'src/**'
    testCmd: 'echo "set a verification command for {scope}"'
disciplines:
  - id: 'locale-files-move-together'
    why: 'pairing — en.json and ko.json must change in the same commit; one side alone is a break'
    draft: true
```

### 5. Prove it fires, then close

Run `pdks explain` and confirm the new entry is listed (a judged entry with its mechanism
and surfaces; a draft as unpromoted).

For a judged entry, registration is not the finish — a pattern that never fires protects
nothing while looking installed. Fire it once for real, with the proof run its shape can
actually reach:

| Family | Break it once | The entry's id shows up in |
| --- | --- | --- |
| `declare` (added-only / frozen path) | one scratch edit matching the must-match direction | `pdks covenant check --worktree` output — the exit stays 0 at advise, the id is the proof |
| `declare` (forbidden-command) | run one harmless command matching the pattern | the telemetry log tail — at advise the call proceeds and its row records the id |
| `declare` (precedent) | one in-scope edit made without the required precedent | the telemetry log tail — a session-reading declaration judges on the session surface only (the commit surface records it `skipped`) |

Then undo the scratch break, repeat the same run, and confirm silence on the
must-NOT-match direction. Close by telling the user which rung the entry landed on and
that `enforce: block` is theirs to add later if the advise record earns it.

## Reading the advise record

An `advised` row means a promise was broken and the call went through anyway. Rows land in
the telemetry log at the path configured by `telemetry.logPath` (default
`.polydeukes/roi.log`). The hook's stderr note is not shown to you, so consult the log at
task boundaries: before committing, or after a batch of edits, read the tail and act on any
`advised` row — fix the break, or tell the user why it should stand. An advisory nobody
reads measures nothing.
