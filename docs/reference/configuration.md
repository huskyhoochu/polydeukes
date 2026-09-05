# Configuration reference

**English** · [한국어](./configuration.ko.md)

Every key of `polydeukes.config.yaml`, one section per key. The guide — what the file is,
how discovery fails, and the IDE wiring — is
[Configuring Polydeukes](../configuration.md), and what a verdict looks like when a
discipline fires is its
[What enforcement looks like](../configuration.md#what-enforcement-looks-like) section.

## `languages`

Required. The language axis, first-class. Keys are your values (`typescript`, `python`, …) —
the core ships no language names and never interprets the command string.

```yaml
languages:
  typescript:
    productionGlob: 'packages/*/src/**/*.ts'   # what counts as production source
    testCmd: 'pnpm --filter {scope} test'      # {scope} is substituted at resolve time
```

`testCmd` is a template string, not a function. Every `{scope}` occurrence is replaced;
all other braces (`${VAR}`, `{a,b}`, `awk '{print}'`) pass through untouched. A command
that ignores scope (`pnpm test`) is equally valid.

## `protectedPaths`

Optional. Raw path patterns whose files the covenants protect from modification — by
editor tools and by shell commands alike (`sed -i`, `tee`, redirects, heredocs,
parent-directory moves). Entries are normalized (trimmed, deduplicated) at resolve time.
An empty-string entry is rejected at load time — it carries no path meaning.

```yaml
protectedPaths:
  - 'packages/core/src'
  - '.claude/hooks'
```

**The config file protects itself.** The discovered config file is automatically appended
to `protectedPaths` — an edit that would lower your own gates goes through the same judge
as everything else. If the file that declares the disciplines were not itself under the
disciplines, the whole chain would be decoration.

## `adapters`

Optional. Adapter namespaces. One config file, one namespace per adapter: each key names an
adapter, and its value is that adapter's own settings object. The core validates the
container shape only — the keys and the contents belong to each adapter, which ships
its own validator for its own vocabulary. An unknown key *inside* a namespace is
rejected by that adapter's validator, with the full field path in the error.

```yaml
adapters:
  git:
    enforce: advise
    protectedPaths:
      - 'packages/core/src'
```

### `adapters.git` — the git commit adapter

| Key | Values | Default | Meaning |
|---|---|---|---|
| `enforce` | `block` \| `advise` | `block` | Enforcement level of the commit surface |
| `protectedPaths` | string array | `[]` | Additive protection scope judged by the commit surface only |

- **`block`** — a staged change that breaks a covenant blocks the commit (exit 2). The
  only way through is the witness valve: a human answering the TTY prompt with the full
  token. The prompt names what it asks the human to witness — the broken registration,
  the matched entry, and the fact that the one answer covers the whole commit. An absent
  namespace, an absent `adapters` map, or an absent `enforce` key all mean `block` — not
  writing the key selects the strictest level.
- **`advise`** — the commit surface becomes a backstop without a block: a verdict on a
  staged change is recorded as an `advised` telemetry event and the commit proceeds
  (exit 0) with one advisory line on stderr. No TTY prompt fires. Only the verdict is
  relaxed — a run that cannot judge (missing or invalid config, an unresolvable judge
  body) still fails closed at exit 2, at either level.

**`protectedPaths` here is an additive scope.** The commit surface judges the union of the
top-level `protectedPaths` and this list — concatenated (common first) and normalized as one,
so spelling and dedupe rules are identical for both. The session surface never reads it: the
list exists for paths whose edit is legitimate work during a session but must pass a judged
checkpoint when it is promoted into repository history — a judgment chain's own sources are
the canonical tenant. As the enforcement level is the observer's setting, so is the
additional scope. There is no subtractive vocabulary: a config line can widen a surface's
scope, never quietly strip one.

The session surface (the editor-time hook) has no level setting here. What it blocks is the
judging chain's own protection — `protectedPaths` mutations and mentions on the tool and
shell axes, the session transcript, an assembly that cannot judge (missing or invalid
config, unbuilt judge, unparseable payload, a routing that could not answer) — plus any
entry promoted with `enforce: block`. Every other discipline entry lands `advised` there.

**Declarations that read the session skip on the commit surface.** A commit has no session
to look at, so a declaration whose `sources` bind the transcript — a `precedent`,
`phase-order`, `turn-locality` or `stated-ground` entry — cannot be judged there; demanding
evidence a commit cannot carry would block every matching commit with no legitimate way
through. The declaration's own `supply: { session: 'pass' }` disposes of the absence: when
its scope matches a staged change it records a `skipped` telemetry event carrying the reason
token `supply-pass` and lets the commit proceed. The record carries the entry's `id` and the
change it would have judged, so a gate that did nothing says so in the data — and it appears
**only when the entry's scope actually matched**. A declaration scoped on the `command`
source records nothing at all there: a staged diff carries no command line, so no world it
observes is ever admitted.

This is the same disposition the session surface uses whenever it has no transcript to
read. One rule, both surfaces: evidence that cannot be evaluated is skipped and measured,
never blocked and never silent.

## `telemetry`

Optional.

```yaml
telemetry:
  logPath: '.polydeukes/roi.log'   # default when omitted; keep it gitignored
```

Every judgment — passed, blocked, witnessed, advised, or skipped — appends one record.
Telemetry is fail-open by design: a logging failure never changes a verdict. The path
itself is still validated at load time — an empty or whitespace-only `logPath` is
rejected.

## `witness`

Optional.

```yaml
witness:
  token: 'covenant witness'   # the phrase a human types in the conversation
  ttlMinutes: 10              # validity window, in minutes, from that message
```

The values of the time-boxed human valve, consumed where the covenants are assembled.
The valve is sudo, not an exemption: the one property a deterministic gate can compute
about a judgment chain is "is an accountable human present, right now", and the witness
is that human supplying the pass condition in person. When a covenant blocks a
legitimate edit, a human types the agreed token into the conversation; blocked judgments
can be witnessed open for `ttlMinutes` from that message's timestamp, then blocking
resumes automatically. Both keys are required when the section is present: the token
must be non-empty after trimming, the window a finite number greater than zero.

**The valve stands after the verdict, never instead of it.** The judge body always runs.
A call that would have passed anyway never consults the valve, so an open window changes
nothing about clean work — and a `witnessed` telemetry row therefore always names a real
block a human answered for, never a ritual. Only a judgment that actually blocked can be
witnessed open.

**The token must stand alone on the message's first line.** Invoking the witness is
distinct from talking about it: a message that quotes, questions, or explains the token
mid-sentence — or wraps it in backticks — does not open the valve, while a first line
carrying the token alone does, with any following lines free for the work itself.

A message that invokes — the token alone on the first line, the rest free:

```text
covenant witness

now fix the hook file
```

A message that merely mentions — the valve stays shut:

```text
so when does `covenant witness` expire?
```

The token's value is free — any phrase works, and it is never checked for a prefix or a
command shape. Only its placement is constrained.

The token is not a secret — the defense is provenance, not secrecy. A witness counts only
when the token arrives in a message positively identified as human-typed in the session
transcript, so an AI that knows the token still cannot forge one. Witnessed judgments are
recorded as `witnessed`, never silent.

## `disciplines`

Optional. Each entry is one discipline: a practice the team imposes on itself, declared as
data. A judged entry carries a `declare` block — the one judged form, a declaration whose
`scope` lives inside the block — an `id` (the telemetry label), and optionally a `why` (the
reason, which travels with the block message the agent reads) and an `enforce` level. The
closed key set is `id` · `why` · `enforce` · `declare`; any other key is refused.

**`draft` — an unpromoted entry.** The one shape that carries no predicate:
`{ id, why, draft: true }` and nothing else. A draft registers a practice as prose ahead of
its promotion — it makes no judgment and no telemetry record on either surface, and
`pdks explain` shows it as `unpromoted`. `why` is required here (the prose is the entry's
whole body), and the marker must be the literal `true` — a draft is declared, never
inferred, so an entry with neither a predicate nor `draft: true` is still a validation
error, and `draft: false` is rejected as dead data.

```yaml
disciplines:
  - id: 'bilingual-docs-sync'
    why: 'en and ko doc mirrors must move together.'
    draft: true
```

A `why` is never judged — it changes no verdict. It is appended to the break message once a
verdict has blocked, so whoever reads the block gets the rationale in the same line instead
of having to open this file. A `why` spanning several lines is folded to spaces: the message
is one line.

**`enforce` — the entry's own level.** Optional on any judged entry: `block` or `advise`.
**Absent means `advise`.** Under `advise` a break is recorded as an `advised` telemetry
event and the call proceeds (exit 0), with the break message still written to stderr;
`block` is the promotion — it pins the entry at block. The entry's level composes with the
surface's (`adapters.git.enforce` on the commit surface; the session surface has none) and
the lenient side wins — an `advise` on either axis makes the entry advise, and an explicit
`block` never raises a surface the observer set to advise. An unjudgeable body (never
built, or one that cannot be loaded) still blocks whatever the level. A draft carries no
`enforce`; any
other value is rejected at load time. `pdks explain` prints the level an entry declares
(`enforce: block` or `enforce: advise`) on both surfaces and leaves an absent one unmarked;
the session header states the default.

```yaml
  - id: 'hooks-stay-armed'
    why: 'a command that disarms or reroutes the git gate is a gate bypass in itself.'
    enforce: advise
    declare:
      mechanism: 'forbidden-command'
      scope: { source: 'command' }
      extract:
        hits:
          - { op: 'source', of: 'command' }
          - { op: 'lines' }
          - { op: 'matches', re: 'LEFTHOOK=(0|false|no|off)\b|core\.hooksPath' }
      relate:
        - { id: 'gates-armed', relation: { op: 'empty', of: 'hits' }, message: '{value}' }
```

**Added-direction content is a declaration.** A promise about what an edit *adds* — a
banned word, a stray `.only`, a citation that resolves nowhere — is written as an
`added-only` declaration: `pre` and `post` are each cut into lines and keyed by the match,
`onlyIn` keeps what `post` has and `pre` lacks, and `empty` over that difference is the
verdict. Existing occurrences are forgiven, so adopting the discipline never blocks a legacy
codebase. `supply: empty` is what lets a file creation (no `pre`) count as all-added and a
deletion (no `post`) as adding nothing; the `scope` block replaces `in`/`except` with
regular expressions over the path.

```yaml
disciplines:
  - id: 'covenant-vocabulary'
    why: 'control-framing vocabulary is banned in package sources.'
    declare:
      mechanism: 'added-only'
      scope: { source: 'target.path', include: ['^packages/[^/]+/src/'] }
      supply: { pre: 'empty', post: 'empty' }
      extract:
        before:
          - { op: 'source', of: 'pre' }
          - { op: 'lines' }
          - { op: 'keyByPattern', re: '\b(guard|harness|kb)\b' }
        after:
          - { op: 'source', of: 'post' }
          - { op: 'lines' }
          - { op: 'keyByPattern', re: '\b(guard|harness|kb)\b' }
        added:
          - { op: 'onlyIn', of: 'after', notIn: 'before' }
      relate:
        - id: 'nothing-added'
          relation: { op: 'empty', of: 'added' }
          message: 'adds {key}: {value}'
```

The key is the match text, so a line carrying a word the file already has anywhere is
forgiven, and a line carrying two new words surfaces the first one now and the second on the
next judgment.

**A frozen path is a declaration too.** A file that may be created once and never modified
or deleted: `pre` present means a modification, `post` absent means a deletion, and either
breaks.

```yaml
  - id: 'archived-records-stay-frozen'
    why: 'an archive that can be edited is not an archive.'
    declare:
      mechanism: 'self-absolution-ban'
      scope: { source: 'target.path', include: ['^records/archive/'] }
      supply: { pre: 'empty', post: 'empty' }
      extract:
        prior: [{ op: 'source', of: 'pre' }]
        here: [{ op: 'source', of: 'target.path' }]
        after: [{ op: 'source', of: 'post' }]
        deleted: [{ op: 'onlyIn', of: 'here', notIn: 'after' }]
        touched: [{ op: 'union', of: ['prior', 'deleted'] }]
      relate:
        - { id: 'frozen', relation: { op: 'empty', of: 'touched' }, message: '{value} is frozen' }
```

**A command line is a source.** On the session surface a shell call carries its command
line as the fixed source `command`, and a call that changes no file is still one
observation — it is judged as a world of its own, with subject `-`. A `forbidden-command`
declaration reads that source, cuts it into lines, keeps the lines a pattern matches, and
requires the result to be `empty`. It scopes on `command` so that only shell calls are
admitted: an Edit carries no command line, and a declaration reading a source its world
lacks is unjudgeable. A multi-line command is judged line by line, so `^` means the start
of a line; a pattern that would span a line boundary does not match.

```yaml
  - id: 'hooks-stay-armed'
    why: 'a command that disarms or reroutes the git gate is a gate bypass in itself.'
    declare:
      mechanism: 'forbidden-command'
      scope: { source: 'command' }
      extract:
        hits:
          - { op: 'source', of: 'command' }
          - { op: 'lines' }
          - { op: 'matches', re: 'LEFTHOOK=(0|false|no|off)\b|core\.hooksPath' }
      relate:
        - { id: 'gates-armed', relation: { op: 'empty', of: 'hits' }, message: '{value}' }
```

**A precedent is a declaration over the session.** Most declarations ask "is this change
itself bad"; a `precedent` asks whether a required step happened earlier in the session.
The change is legitimate — what is missing is the procedure in front of it, so what gets
judged is the session history: `sources: { session: { transcript: true } }` hands the
declaration the user turns and tool calls as one snapshot, `toolUses` picks the calls,
`filter` keeps the ones that ran and **succeeded**, `select` reaches the command line, and
`matches` finds the required one; `nonEmpty` is the verdict. A call the covenant blocked,
one a human refused, and one that simply failed are not precedent. The pattern is matched
anywhere in a command line — a line that merely mentions the command counts, a declared
limit. `supply: { session: 'pass' }` is what makes the commit surface record `skipped`
instead of blocking every matching commit.

```yaml
  - id: 'dependency-needs-npm-view'
    why: 'a dependency version must be measured before it is written.'
    declare:
      mechanism: 'precedent'
      scope: { source: 'target.path', include: ['^(packages/[^/]+/)?package\.json$'] }
      sources: { session: { transcript: true } }
      supply: { session: 'pass' }
      extract:
        npmView:
          - { op: 'source', of: 'session' }
          - { op: 'toolUses', names: ['Bash'] }
          - { op: 'filter', when: [{ field: 'succeeded', eq: true }] }
          - { op: 'select', path: 'args.command' }
          - { op: 'matches', re: '\bnpm view ' }
      relate:
        - { id: 'npm-view', relation: { op: 'nonEmpty', of: 'npmView' }, message: 'no successful npm view precedes this manifest edit' }
```

A tool call is evidence the same way: `toolUses` without `names`, then `field name` and
`matches` over the tool's name, or `toolUses` with `subagentType` for a spawn of one agent
kind. The other history mechanisms read the same snapshot — `phase-order` relates two
spawn ordinals with `ordered`, `turn-locality` keeps the user turns inside a time window
(`userTexts → ageMs → filter lte`), and `stated-ground` requires a user turn matching a
pattern; the last two are usually scoped on `command`, so that only the shell call they
apply to is judged.

**A caution on line anchors.** A declaration's `lines` step splits the text first, so `^`
inside `keyByPattern` or `matches` after it is the start of a line. A pattern that stops
mid-value — say at the first digit of a version — keys `4.0.5` and `4.0.6` alike, so a bump
adds nothing to an added-only difference and the discipline silently passes: make the
pattern span the whole value that can change. Both failure shapes compile, run, and answer
`passed`, so measure a new entry against a real file and a realistic edit.

**The cheap way through is the honest one.** Unlike the witness, session evidence lives on
the AI's own surface, so it is not forgery-proof. It does not need to be: the least
effortful way to open this gate is to actually run the command, and that is exactly the
behaviour the discipline exists to induce.

**`declare` — declaration family.** One judgment written as data, in the algebra grammar
the core publishes as `algebra-declaration.schema.json`: `judge = relate ∘ extract`. The
block carries the declaration's `scope`, `sources`, `supply`, `extract`, `relate`, and optional
`witness`; the entry's `id` is the declaration's name, so the block never carries a
`discipline` key, and `in`/`except`/`when` are refused — the `scope` block is the scope.

```yaml
  - id: 'db-only-under-knowledge'
    why: 'a *.db file may exist only under _docs/knowledge/'
    declare:
      mechanism: 'naming'
      scope: { source: 'target.path', include: ['\.db$'] }
      extract:
        outside:
          - { op: 'source', of: 'target.path' }
          - { op: 'matches', re: '^(?!_docs/knowledge/)' }
      relate:
        - id: 'placed'
          relation: { op: 'empty', of: 'outside' }
          message: '{value} is outside _docs/knowledge/'
```

This repository's live config carries the same declaration as `sqlite-only-under-knowledge`.

Each observation is judged as one **world** with six source names: `target.path` (the
repo-relative path), `pre` and `post` (the file's text on the side the change carries —
a creation has no `pre`, a deletion no `post`), `state` (`{ pre, post }`, present only
on a modification), and `changes` (every path the observation changes — the one call on the
session surface, the whole staged set on the commit surface), and `command` (the shell
call's command line — present on a shell call only, and a shell call that changes no file
is one world of its own, so a declaration scoped on `command` sees it while one scoped on
`target.path` does not). A declaration that reads
`changes` is judged only where the whole change set is observed: the session surface
records it `skipped`, the same disposition the commit surface gives a declaration that reads
the session,
because one call can never carry the other half of a pair. This repository's live config
carries one — `docs-stay-bilingual`, an `implies` over the `.md`/`.ko.md` pair, advised
on the commit surface when one side is staged without the other. A declaration that needs a
file outside the target names it in a `sources` block, `sources: { en: { file:
'locales/en.json' } }`, and reads it as `{ op: 'source', of: 'en' }`; the path is
repo-relative (no leading `/`, no `..` segment) and the name may not be one of the six. The
surface reads the file the way it observes the tree — the disk in a session, the index for a
staged commit, the `<to>` commit for a range — except that a named file the change itself
touches is read from the change's `post`, so both surfaces judge the same text. A second
kind, `sources: { spawns: { sidecar: true } }`, names the session's spawn-record channel
instead of a path — the subagent records the host keeps beside the transcript, supplied as
one JSON array; where the channel lives is the surface's fact, so the value is the marker
`true`, and on the commit surface (which has no session) the channel is always absent. A
third kind, `sources: { session: { transcript: true } }`, names the session's own
conversation history — the user turns and tool calls the surface reads, handed to the
declaration as one snapshot whose entries carry their
observation ordinal; the history steps (`toolUses`, `userTexts`, `first`, `ageMs`) read it, and
`agentType` reads the parsed sidecar. This repository's live config carries one —
`tests-before-implementation`, an `ordered` over the ordinals of two subagent spawns, which
the commit surface (no session) records `skipped`. A `supply` key must name one of the six
fixed sources or one of the declaration's own `sources`; any other key is refused. A
source the change does not carry is absent, and the declaration's
`supply` block says what that means: `error` (the default) makes the call unjudgeable —
recorded `blocked` at either enforce level — `pass` leaves it unjudged, and `empty` reads
the absent side as an empty item list and judges on. `empty` is what lets an added-only
declaration see a creation as all-added and a deletion as adding nothing; it does not apply
to `state`, the paired source. A declaration comparing before with after therefore needs
`supply: { state: pass }` to let a file creation through.

A break is recorded like any other family's, with one addition: the telemetry row carries a
fifth field naming the elements the relation failed on (at most eight per relate entry, with
the true count beside them). A `skipped` row uses the same field for a reason token instead —
`no-observation` (the surface has no channel for what the entry reads), `config-fault` (the
block could not be assembled), or `supply-pass` (the declaration's own `supply: pass` let an
absent source through). Every declaration also names its `mechanism` — one of eighteen
catalogue names such as `naming`, `companion`, or `pairing` — and the validator refuses a
name whose shape the declaration does not match: the axes its sources derive (`change` for
the fixed names, `world` for a `file` or `sidecar` source, `history` for a `transcript`
source) and the relations it relates must fall inside
what that name admits. A block the compiler cannot resolve — a step name outside the
registry, an argument outside a step's keys — becomes a skip registration that names its
location on stderr and routes nothing. A shell write into the declaration's scope whose
result the judge can compute (a redirect, a heredoc, an append) is judged as the file change
it makes; one it cannot compute (`sed -i`, an opaque command) records `skipped`. The
declaration's own `witness` block joins the
human's witness as a second way to open a blocked verdict.

Adding a discipline is a data edit — no code, no plumbing. Custom judge bodies remain the
escape layer for the few rules data cannot express.
