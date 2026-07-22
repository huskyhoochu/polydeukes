# Configuring Polydeukes

**English** · [한국어](./configuration.ko.md)

> Pre-alpha. This reference describes the config surface as shipped today (schema v2,
> loader, and the three built-in discipline predicates). Fields and predicates will grow;
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
  every level, so a typo (`protectedPath:` for `protectedPaths:`) can never silently
  disarm a protection.

## IDE support

The published JSON Schema (`@polydeukes/core/schema.json`) gives autocompletion and
validation in editors. Reference it from the first line:

```yaml
# yaml-language-server: $schema=node_modules/@polydeukes/core/schema/polydeukes.schema.json
```

For a JSON config, use the standard top-level key instead — it is accepted and ignored:

```json
{ "$schema": "node_modules/@polydeukes/core/schema/polydeukes.schema.json" }
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
```

#### `adapters.git` — the git commit adapter

| Key | Values | Default | Meaning |
|---|---|---|---|
| `enforce` | `block` \| `advise` | `block` | Enforcement level of the commit surface |

- **`block`** — a staged change that breaks a covenant blocks the commit (exit 2). The
  only way through is the waiver valve: a human answering the TTY prompt with the full
  token. An absent namespace, an absent `adapters` map, or an absent `enforce` key all
  mean `block` — not writing the key selects the strictest level.
- **`advise`** — the commit surface becomes a backstop without a block: a verdict on a
  staged change is recorded as an `advised` telemetry event and the commit proceeds
  (exit 0) with one advisory line on stderr. No TTY prompt fires. Only the verdict is
  relaxed — a run that cannot judge (missing or invalid config, an unresolvable judge
  body) still fails closed at exit 2, at either level.

The session surface (the editor-time hook) has no level setting here; it always blocks.

### `telemetry` (optional)

```yaml
telemetry:
  logPath: '.polydeukes/roi.log'   # default when omitted; keep it gitignored
```

Every judgment — passed, blocked, bypassed, or advised — appends one record. Telemetry
is fail-open by design: a logging failure never changes a verdict.

### `waiver` (optional)

```yaml
waiver:
  token: 'covenant waive'   # the phrase a human types in the conversation
  ttlMinutes: 10            # validity window, in minutes, from that message
```

The values of the time-boxed escape valve, consumed where the covenants are assembled.
When a covenant blocks a legitimate edit, a human types the agreed token into the
conversation; judgments are waived for `ttlMinutes` from that message's timestamp, then
blocking resumes automatically. Both keys are required when the section is present: the
token must be non-empty after trimming, the window a finite number greater than zero.

**The token must stand alone on the message's first line.** Invoking the waiver is
distinct from talking about it: a message that quotes, questions, or explains the token
mid-sentence — or wraps it in backticks — does not open the valve, while a first line
carrying the token alone does, with any following lines free for the work itself.

A message that invokes — the token alone on the first line, the rest free:

```
covenant waive

now fix the hook file
```

A message that merely mentions — the valve stays shut:

```
so when does `covenant waive` expire?
```

The token's value is free — any phrase works, and it is never checked for a prefix or a
command shape. Only its placement is constrained.

The token is not a secret — the defense is provenance, not secrecy. A waiver counts only
when the token arrives in a message positively identified as human-typed in the session
transcript, so an AI that knows the token still cannot forge one. Waived judgments are
recorded as `bypassed`, never silent.

### `disciplines` (optional)

Each entry is one discipline: a practice the team imposes on itself, declared as data.
An entry carries exactly **one** predicate (zero or two is rejected), an `id` (the
telemetry label), and optionally a `why` (the reason, kept next to the rule) plus, on a
`forbid` entry only, `in` (the file globs it judges) and `except` (globs carved out of
that scope).

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

Adding a discipline is a data edit — no code, no plumbing. Custom judge bodies remain the
escape layer for the few rules data cannot express.

## What enforcement looks like

A violating tool call or shell command is **blocked (exit 2)** before it runs, with the
discipline's `id` in the telemetry record. The sanctioned valve is an explicit bypass,
recorded as `bypassed` — never silent. On the commit surface under
`adapters.git.enforce: advise`, a verdict is recorded as `advised` and the commit
proceeds — a backstop that measures instead of blocking. A missing, ambiguous, or
invalid config blocks every call until it is fixed: the system fails closed, because a
dead gate that waves things through is the cheapest bypass of all.
