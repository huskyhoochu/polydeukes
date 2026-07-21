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

Adapter directories. They are automatically included in the protection surface, so a
registered adapter can never be left unprotected by omission.

```yaml
adapters:
  - 'packages/adapter-claude-code/src'
  - 'packages/adapter-claude-code/dist'
```

### `telemetry` (optional)

```yaml
telemetry:
  logPath: '.polydeukes/roi.log'   # default when omitted; keep it gitignored
```

Every judgment — passed, blocked, or bypassed — appends one record. Telemetry is
fail-open by design: a logging failure never changes a verdict.

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

The token is not a secret — the defense is provenance, not secrecy. A waiver counts only
when the token appears in a message positively identified as human-typed in the session
transcript, so an AI that knows the token still cannot forge one. Waived judgments are
recorded as `bypassed`, never silent.

### `disciplines` (optional)

Each entry is one discipline: a practice the team imposes on itself, declared as data.
An entry carries exactly **one** predicate (zero or two is rejected), an `id` (the
telemetry label), and optionally a `why` (the reason, kept next to the rule) and `in`
(the file globs it judges).

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
recorded as `bypassed` — never silent. A missing, ambiguous, or invalid config blocks
every call until it is fixed: the system fails closed, because a dead gate that waves
things through is the cheapest bypass of all.
