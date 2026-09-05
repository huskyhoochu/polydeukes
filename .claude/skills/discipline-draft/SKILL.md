---
name: discipline-draft
description: Turn a described discipline problem into a registered entry in polydeukes.config — a
judged entry when the declaration grammar can express it, a draft entry otherwise. Use when the user
describes a recurring problem they want promised away ("I keep...", "stop X from happening", "we
should never...", "how do I enforce Y").
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

Choose a mechanism by the evidence and relation it admits, not by a short list of examples.
Extracted axes and body relations must be subsets of the admitted sets. Scope filtering is
separate from extracted axes. Read `pdks docs show write-disciplines` for a complete pairing
walkthrough and `pdks docs show configuration --section disciplines` for the grammar.

| Mechanism | Admitted axes | Body relations | Evidence or structural condition |
| --- | --- | --- | --- |
| `pairing` | `world` | `equal` | Supplied files or channels; extract keys when translations may differ. |
| `companion` | `change`, `world` | `implies` | Presence by key; multi-file promises need the observed change set. |
| `monotonic-order` | `change`, `world` | `ordered` | Extract the comparison sequence; ordering does not require presence. |
| `fingerprint-sync` | `world` | `equal` | Compare supplied stamps, without running a generator during judgment. |
| `producer-owned` | `actor` | `empty`, `nonEmpty` | Requires actor evidence supplied by the host. |
| `self-absolution-ban` | `change` | `unchanged`, `empty` | Protect extracted fields or paths; choose supply for creation/deletion. |
| `actor-scope` | `actor` | `empty`, `nonEmpty` | A missing actor is not proof of the main session. |
| `precedent` | `history`, `world` | `nonEmpty` | Earlier observed calls in a transcript or supplied channel. |
| `phase-order` | `history` | `ordered` | Call ordinals; missing phases require a separate presence promise. |
| `turn-locality` | `history` | `nonEmpty` | Observed turn boundaries, times, or ordinals. |
| `stated-ground` | `history` | `nonEmpty` | Recorded text, not proof that the reasoning is sound. |
| `controlled-vocabulary` | `change`, `world` | `subset` | Extracted values and an explicit allowed set. |
| `naming` | `change` | `empty`, `nonEmpty` | Scope must read `target.path`. |
| `added-only` | `change` | `empty` | Only matches added between pre and post. |
| `one-way-marker` | `change` | `subset` | Previously present markers remain after the change. |
| `delegated-scope` | — | — | Reserved for a definition-time evaluator; not accepted in declarations. |
| `scoped-valve` | `change`, `actor`, `world`, `history` | `empty`, `nonEmpty`, `equal`, `subset`, `implies`, `ordered`, `unchanged` | Requires an explicit `witness` block. |
| `forbidden-command` | `change` | `empty` | Scope must read `command`; patterns inspect syntax, not shell semantics. |

Locale key parity is `pairing`; an allowed status list is `controlled-vocabulary`; a prior
successful package lookup is `precedent` when history is observed. A fresh benchmark that must
execute during judgment is a draft: comparing an old report is a different promise.

Existing occurrences are forgiven by an added-only declaration — only new additions break the
promise.
That is usually what you want: a discipline adopted today should not indict yesterday's code.

A path nobody may touch can belong in the top-level `protectedPaths:` list — its own config
block, never an entry key. A creation-only promise needs its own extraction and supply policy;
the frozen-path example below deliberately permits creation and is not that promise.

### 3. Check the observation boundary

- **Files outside the repository** — file-change protection observes the project root. Use
  the host's permission policy outside it; a command-text pattern is not comprehensive protection.
- **Writes by child processes** — arbitrary script writes are not individually observed as
  session tool calls. A commit comparison may see their results in its selected diff, not their
  originating history.
- **Unavailable history or actor evidence** — choose supply explicitly. A commit has no session
  transcript; `supply: pass` records a skip, not a successful judgment.
- **Fresh execution and semantic proof** — judgment compares supplied evidence. It does not run
  a benchmark or prove a written explanation true. Record the unmet capability as a draft.

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

The frozen-path shape is the same block with `mechanism: 'self-absolution-ban'`
and `extract` = `prior` (source `pre`) · `here` (source `target.path`) · `after` (source
`post`) · `deleted` (`onlyIn` of `here` notIn `after`) · `touched` (`union` of `prior`,
`deleted`), related by `empty` over `touched`. The `keyByPattern` regex must carry one
capture group — group 1 is the key — so wrap the whole pattern in parentheses.

The command-line shape reads the fixed source `command` and scopes on it, so
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
        hits: [{ op: 'source', of: 'command' }, { op: 'lines' }, { op: 'matches', re: 'git push\b.*--force(?![\w-])' }]
      relate:
        - { id: 'no-force', relation: { op: 'empty', of: 'hits' }, message: '{value}' }
    enforce: advise
```

The precedent shape binds the session's transcript, keeps the tool calls that
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
      scope: { source: 'target.path', include: ['^(packages/[^/]+/)?package[.]json$'] }
      sources: { session: { transcript: true } }
      supply: { session: 'pass' }
      extract:
        npmView:
          - { op: 'source', of: 'session' }
          - { op: 'toolUses', names: ['Bash'] }
          - { op: 'filter', when: [{ field: 'succeeded', eq: true }] }
          - { op: 'select', path: 'args.command' }
          - { op: 'matches', re: '^npm view ' }
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
Record the intended promise and the missing capability inside `why`. Check the current
catalogue, extraction steps, and observation channel before choosing a draft. Key pairing and
vocabulary checks are expressible today. `delegated-scope` is reserved, not a usable declaration.

```yaml
languages:
  placeholder:
    productionGlob: 'src/**'
    testCmd: 'echo "set a verification command for {scope}"'
disciplines:
  - id: 'benchmark-supports-performance-claim'
    why: 'a performance claim needs a fresh benchmark run during judgment; the engine cannot execute it'
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

Then undo the scratch break, repeat the observation, and confirm a passing row for the valid
case. Silence alone can mean a scope miss, unchanged files, or unavailable evidence. Inspect
`pdks explain` and telemetry for `config-fault`, `no-observation`, and `supply-pass`. Close by
telling the user which rung the entry landed on and
that `enforce: block` is theirs to add later if the advise record earns it.

## Updating without losing local edits

Rerunning the installer skips an existing skill. Generate a comparison copy in a disposable
project, keep a backup, and merge selected changes into this file. Do not remove the working
project's skill to force regeneration. Preserve local additions such as the frozen-path example.

## Reading the advise record

An `advised` row means a promise was broken and the call went through anyway. Rows land in
the telemetry log at the path configured by `telemetry.logPath` (default
`.polydeukes/roi.log`). The hook's stderr note is not shown to you, so consult the log at
task boundaries: before committing, or after a batch of edits, read the tail and act on any
`advised` row — fix the break, or tell the user why it should stand. An advisory nobody
reads measures nothing.
