# Configuring Polydeukes

**English** · [한국어](./configuration.ko.md)

> Alpha. This reference describes the config surface as shipped today (schema v2,
> loader, and the four built-in discipline predicates). Fields and predicates will grow;
> what is written here is tested and enforced now.

`polydeukes.config.yaml` is the one file where a project declares its disciplines — the
promises the human and the AI partner both agree to be bound by. It is **data, not code**:
nothing in it can compute, so nothing in it can lie. The core validates it, the covenant
package enforces it, and every judgment it causes is measured.

## The file

Put exactly one of these at the project root:

| Filename | Note |
|---|---|
| `polydeukes.config.yaml` | canonical |
| `polydeukes.config.yml` | accepted variant |
| `polydeukes.config.json` | accepted variant (read by the same parser — YAML is a JSON superset) |

Discovery is deliberately strict, and every failure refuses loudly instead of guessing:

- **No config found** → error naming all three candidate filenames. A missing config never
  silently loads defaults — silent defaults would mean silently unprotected.
- **More than one found** → error naming the collisions. Ambiguity never picks a winner.
- **Parse error, or a custom YAML tag** → error naming the file. Custom tags are rejected
  even though the parser cannot execute them — config data stays uncomputable by contract.
- **Schema violation** → error naming the key and the file. Unknown keys are rejected at
  the level the core owns — the top level and every container the core defines — so a typo
  like `protectedPath:` for `protectedPaths:`, or `adaptors:` for `adapters:`, is caught
  here. Inside an adapter namespace the vocabulary belongs to that adapter: the core passes
  the contents through verbatim, and the adapter's own validator rejects what it does not
  recognise, naming the full field path (see
  [`adapters`](#adapters-optional)).

## IDE support

The published JSON Schema gives autocompletion and validation in editors. The schema file
ships inside `@polydeukes/core` — a *transitive* dependency of the umbrella — and under
pnpm's default strict layout transitive dependencies are not exposed at your project's
top-level `node_modules` (measured 2026-08-03: the file resolves only under
`node_modules/.pnpm/…`). A `node_modules`-relative `$schema` line therefore does not
resolve in a default pnpm install. `pdks init claude-code` writes no `$schema` line into
the generated config for the same reason: no single *file-path* spelling resolves in every
consumer layout, and a wrong line loses editor validation silently.

Two forms work. The version-pinned public URL is independent of any install layout
(verified against the `v0.2.0` tag and `main` — swap the tag for the release you
installed):

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/huskyhoochu/polydeukes/v0.2.0/packages/core/schema/polydeukes.schema.json
```

The relative path works only in a layout where `@polydeukes/core` is present at the top
level of `node_modules`. Whether yours is one is a one-look check — if
`node_modules/@polydeukes/core/schema/` exists in your project, the line resolves:

```yaml
# yaml-language-server: $schema=node_modules/@polydeukes/core/schema/polydeukes.schema.json
```

For a JSON config, use the standard top-level key instead — it is accepted and ignored by
the loader, with the same two values:

```json
{ "$schema": "https://raw.githubusercontent.com/huskyhoochu/polydeukes/v0.2.0/packages/core/schema/polydeukes.schema.json" }
```

## Reference

### `languages` (required)

The language axis, first-class. Keys are your values (`typescript`, `python`, …) — the
core ships no language names and never interprets the command string.

```yaml
languages:
  typescript:
    productionGlob: 'packages/*/src/**/*.ts'   # what counts as production source
    testCmd: 'pnpm --filter {scope} test'      # {scope} is substituted at resolve time
```

`testCmd` is a template string, not a function. Every `{scope}` occurrence is replaced;
all other braces (`${VAR}`, `{a,b}`, `awk '{print}'`) pass through untouched. A command
that ignores scope (`pnpm test`) is equally valid.

### `protectedPaths` (optional)

Raw path patterns whose files the covenants protect from modification — by editor tools
and by shell commands alike (`sed -i`, `tee`, redirects, heredocs, parent-directory
moves). Entries are normalized (trimmed, deduplicated) at resolve time.

```yaml
protectedPaths:
  - 'packages/core/src'
  - '.claude/hooks'
```

**The config file protects itself.** The discovered config file is automatically appended
to `protectedPaths` — an edit that would lower your own gates goes through the same judge
as everything else. If the file that declares the disciplines were not itself under the
disciplines, the whole chain would be decoration.

### `adapters` (optional)

Adapter namespaces. One config file, one namespace per adapter: each key names an
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

#### `adapters.git` — the git commit adapter

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

The session surface (the editor-time hook) has no level setting here; it always blocks.

**Context-family disciplines skip on the commit surface.** A commit has no session to look
at, so a `requirePrecedent` entry cannot be judged there — demanding evidence a commit
cannot carry would block every matching commit with no legitimate way through.

They are not filtered out, though. They assemble like any other discipline and become
*skip registrations*: routing intact, no judge body. When one matches a staged change it
records a `skipped` telemetry event and lets the commit proceed. The record carries the
entry's `id` and the change it would have judged, so a gate that did nothing says so in
the data — and it appears **only when the entry's scope actually matched**, so a commit
touching nothing the entry cares about records nothing at all.

This is the same disposition the session surface uses whenever it has no transcript to
read. One rule, both surfaces: evidence that cannot be evaluated is skipped and measured,
never blocked and never silent.

### `telemetry` (optional)

```yaml
telemetry:
  logPath: '.polydeukes/roi.log'   # default when omitted; keep it gitignored
```

Every judgment — passed, blocked, witnessed, advised, or skipped — appends one record.
Telemetry is fail-open by design: a logging failure never changes a verdict.

### `witness` (optional)

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

### `disciplines` (optional)

Each entry is one discipline: a practice the team imposes on itself, declared as data.
An entry carries exactly **one** predicate (zero or two is rejected), an `id` (the
telemetry label), and optionally a `why` (the reason, kept next to the rule) plus, on a
`forbid` or `requirePrecedent` entry, `in` (the file globs it judges) and `except` (globs
carved out of that scope).

**`forbid` — content delta.** Blocks an edit that *adds* a new match of the pattern.
Existing occurrences are forgiven: adopting a discipline never blocks a legacy codebase,
because the judgment direction is "what did this edit add", not "what does the file
contain".

```yaml
disciplines:
  - id: 'covenant-vocabulary'
    why: 'control-framing vocabulary is banned in package sources.'
    in:
      - 'packages/*/src/**'
    forbid: '\b(guard|harness|kb)\b'
```

**`immutable` — path family.** Blocks modification of existing files that match; creating
new files is allowed.

```yaml
  - id: 'archived-records-stay-frozen'
    why: 'an archive that can be edited is not an archive.'
    immutable: 'records/archive/**'
```

**`forbidCommand` — command family.** Blocks shell commands matching the pattern, even
when the command mentions no protected path. This is how gate-disarming commands are
caught.

```yaml
  - id: 'hooks-stay-armed'
    why: 'a command that disarms or reroutes the git gate is a gate bypass in itself.'
    forbidCommand: 'LEFTHOOK=(0|false|no|off)\b|core\.hooksPath'
```

**`requirePrecedent` — context family.** Blocks a change that arrives without a required
step having happened earlier in the session. The other three families all ask "is this
change itself bad"; this one asks something else. The change is legitimate — what is
missing is the procedure in front of it, so what gets judged is not the mutation but the
session history.

Evidence means an **execution**, not a request. A call the covenant blocked, one a human
refused, and one that simply failed all leave the same trace in a session, and none of
them is precedent — the transcript is read for what actually ran and reported success.
That is what keeps the cheapest way through the gate being the thing the discipline
asks for.

Two consequences are worth knowing before you write one. The outcome is read per command
LINE, so a chain where the required command ran but a later step failed does not count.
And the pattern is matched at the start of a simple command, so the same words in an
argument or a comment do not count either. **In both cases running the command on its own
opens the gate** — the block message says so.

```yaml
  - id: 'dependency-needs-npm-view'
    why: 'a dependency version must be measured before it is written.'
    in:
      - 'package.json'
      - 'packages/*/package.json'
    when: '(^|\n)\s*"[^"]+"\s*:\s*"[~^]?\d[^"]*"'
    requirePrecedent:
      command: 'npm view '
```

The evidence vocabulary is layered. `command` is the core's own key — a shell call is a surface
every agent shares — and the core validates it fully, rejecting an empty string or a pattern that
does not compile. It is matched **at the start of a simple command**, not anywhere in the command
line, so `echo "npm view yaml"` and a mention parked behind a `#` are not evidence while `cd pkg &&
npm view yaml` is. Every other key belongs to an adapter: the core checks the container only (a flat
object carrying exactly one evidence key) and passes the value through verbatim, and the adapter
that owns the word validates and judges it. The Claude Code adapter brings two: `subagent` (exact
match on a spawn kind) and `tool` (a regex over tool names) — so "query the docs tool before
touching this" is expressible today. Both follow the same execution rule as `command`. An evidence
key no assembled adapter recognizes fails closed at assembly, so a typo can never pass itself off as
adapter vocabulary.

`when` (optional) is the trigger: an added-direction delta regex, combinable with
`requirePrecedent` and with nothing else. When it is absent, every change inside `in`
scope triggers the discipline. The two keys divide the work — `in` says which files are
watched, `when` says which change in them demands the precedent.

**A caution on line anchors.** These patterns are matched against the file's whole content
as a single string, and the config schema takes a regex string with no flags. `^` therefore
anchors to the start of the *file*, not the start of a line, so a line-shaped pattern
written with `^` matches only the first line and the discipline silently stops firing —
the regex still compiles, the judgment still runs, and the verdict is `passed`. Write
`(^|\n)` when you mean the start of a line. This is why the example above carries
`(^|\n)\s*"[^"]+"…` rather than `^\s*"[^"]+"…`.

**And a caution on match length.** The delta keys on the matched *text*: a change is only
seen as added when the matched string itself differs between the file's before and after.
A pattern that stops mid-value — say at the first digit of a version — produces the same
match text for `4.0.5` and `4.0.6`, so a version bump adds nothing to the delta and the
discipline silently passes. Make the pattern span the whole value that can change; the
example above runs through the closing quote (`\d[^"]*"`) for exactly this reason. Both
failure shapes are the same class: the regex compiles, the verdict says `passed`, and
nothing tells you the discipline is inert — so when you add an entry, measure it against
a real file and a realistic edit, not a one-line snippet.

The kind of change matters at the trigger. With `when` present, a deletion never triggers
— deleting adds no content. With `when` absent, deletion triggers like any other change in
scope, since the declared scope is the whole mutation.

**The cheap way through is the honest one.** Unlike the witness, this evidence lives on the
AI's own surface, so it is not forgery-proof. It does not need to be: the least effortful
way to open this gate is to actually call the tool, and that is exactly the behaviour the
discipline exists to induce.

Adding a discipline is a data edit — no code, no plumbing. Custom judge bodies remain the
escape layer for the few rules data cannot express.

## What enforcement looks like

A violating tool call or shell command is **blocked (exit 2)** before it runs, with the
discipline's `id` in the telemetry record. The sanctioned valve is the witness — a human
supplying the pass condition on a judgment that actually blocked, recorded as
`witnessed` — never silent. On the commit surface under
`adapters.git.enforce: advise`, a verdict is recorded as `advised` and the commit
proceeds — a backstop that measures instead of blocking. A missing, ambiguous, or
invalid config blocks every call until it is fixed: the system fails closed, because a
dead gate that waves things through is the cheapest bypass of all.
