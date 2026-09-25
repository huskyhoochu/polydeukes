# Declaration language reference

**English** · [한국어](./index.ko.md)

Use this reference to write the `declare` block of a discipline. The tables list every supported
source, extraction step, combinator, relation, and mechanism. For installation and worked examples,
see [Write disciplines](../../how-to/write-disciplines.md). Project settings and enforcement are in
the [configuration reference](../configuration/index.md).

<a id="declaration-shape"></a>
## Declaration structure

A judged entry has `id`, `declare`, and optional `why` and `enforce` fields. Put it in the
[list that can observe its sources](../configuration/index.md#three-lists).

| Field inside `declare` | Required | Meaning |
|---|---|---|
| `mechanism` | Yes | A name from the mechanism table below; it restricts the allowed axes and relations. |
| `scope` | No | Select observations using regular expressions over one source. |
| `sources` | No | Bind names to files or session evidence. |
| `supply` | No | Choose what happens when a source is absent. Unspecified sources use `error`. |
| `extract` | Yes | A map from extraction names to non-empty lists of steps. |
| `relate` | Yes | A non-empty list of comparisons and their diagnostic messages. |
| `witness` | No | Additional comparisons that can allow a violation through. |

The outer `id` names the discipline; do not repeat it as `discipline` inside `declare`.
Names and keys are case-sensitive. Unknown declaration keys are rejected.

This complete entry reports `.db` paths outside `data/`:

```yaml
disciplines:
  - id: 'database-location'
    why: 'Keep database files under data/.'
    enforce: advise
    declare:
      mechanism: 'naming'
      scope: { source: 'target.path', include: ['\.db$'] }
      extract:
        outside:
          - { op: 'source', of: 'target.path' }
          - { op: 'matches', re: '^(?!data/)' }
      relate:
        - id: 'location'
          relation: { op: 'empty', of: 'outside' }
          message: '{value} must be under data/'
```

<a id="scope"></a>
## Scope

| Key | Meaning |
|---|---|
| `source` | Required. One of `target.path`, `pre`, `post`, `command`, or a named `file` source. |
| `include` | Regex strings. At least one must match. Omitted or empty accepts any string. |
| `exclude` | Regex strings. Any match excludes the observation. Omitted or empty excludes nothing. |
| `excludeIgnoreCase` | Optional boolean, default `false`. Applies only to `exclude`. |

Without `scope`, every observation is eligible. With `scope`, an absent source does not match.
These patterns are regular expressions, not path globs. `include` is always case-sensitive.

<a id="fixed-sources"></a>
## Fixed sources

Each observation supplies the sources it can prove. File changes are evaluated separately, so
`target.path`, `pre`, and `post` refer to the current change.

| Source | Value | Availability |
|---|---|---|
| `target.path` | Repository-relative path string | An observation with a file target. |
| `pre` | File text before the change | Modifications; deletions when the prior text is available. Absent on creation. |
| `post` | Proposed file text after the change | Creations and modifications. Absent on deletion. |
| `state` | Before/after pair `{ pre, post }` | Modifications. Its pipeline runs separately on each side. |
| `changes` | Array of paths in the observed change set | Read in `changeSetDisciplines`; use `items` to extract individual paths. |
| `command` | Shell command text | Session shell calls, including calls with no file target. Literal stdin data is excluded from this source. |
| `actor` | Object with optional `agentType` | A session host that proves the actor: `{}` for its main session. Absent when the host supplies no actor. |

An absent source differs from a present empty string or empty array. Use `supply` to handle absence.
`state` does not store workflow progress between calls. Only `unchanged` accepts its paired result.
The [command-source example](../configuration/index.md#disciplines) explains shell stdin handling.

<a id="source-kinds"></a>
## Additional source kinds

`sources` maps a new name to exactly one binding. A new name cannot replace a fixed source name.

| Kind | Binding example | Supplied value |
|---|---|---|
| `file` | `en: { file: 'locales/en.json' }` | File text. Paths are repository-relative, with no leading `/` or `..` segment. |
| `sidecar` | `spawns: { sidecar: true }` | JSON text containing the host's spawn records. Parse with `json` before `agentType` or `items`. |
| `transcript` | `session: { transcript: true }` | Session snapshot with `observedAtMs`, `toolCalls`, and `userMessages`. |

Read a binding with `{ op: 'source', of: 'en' }`. A changed file uses its proposed `post` text;
other named files use the surface's observation of the project. `sidecar` and `transcript` require
`sessionDisciplines` and a host that supplies those channels. Their marker is the literal `true`.

<a id="supply-policies"></a>
## Supply policies

| Policy | On an absent source |
|---|---|
| `error` | Default. The observation cannot be judged and is blocked, including at `advise`. |
| `pass` | Record `skipped` with reason `supply-pass`; do not judge this declaration. |
| `empty` | Continue with an empty item list. Valid for single sources, never `state`. |

Every `supply` key must name a fixed or bound source. For before/after comparisons that should skip
creations and deletions, use `supply: { state: 'pass' }`. For added-only content checks, use
`supply: { pre: 'empty', post: 'empty' }`. Invalid JSON is a supply error even with `pass` or
`empty`; those policies apply to absent sources.

<a id="items-and-pipelines"></a>
## Items and pipelines

An extraction produces ordered items shaped as `{ key, value }`. The key identifies an item for
combinators and key comparisons. The value is the data compared by value relations. Re-keying an
item does not change its value.

Each pipeline begins with `source` or a combinator. Combinators reference other extraction names
and can appear only first. References must exist and cannot form cycles. A combinator cannot
combine a paired extraction from `state`. Further steps transform the result in sequence.

<a id="extract-steps"></a>
## Extraction steps

The table lists all 17 unary steps. Example arguments show their exact keys; an unknown argument
causes a compilation error. Unless stated otherwise, steps preserve item order.

| Step | Arguments | Result |
|---|---|---|
| `source` | `of: 'post'` (required) | Start from the named source as one item with key `'0'`. `state` starts a paired extraction. |
| `json` | None | Parse each string value as JSON, keeping its key. Invalid JSON fails supply. |
| `select` | `path: 'args.command'` (required) | Follow a dot path through objects. Drop missing paths. An array result becomes items keyed by position; a scalar keeps its key. |
| `items` | None | Expand each array by one level into items keyed by zero-based position. Drop non-arrays. |
| `keyBy` | `field: 'id'` (required) | Set the key to the string form of an object's field. Drop non-objects and absent, null, or object-valued fields. Keep the original value. |
| `keyByPattern` | `re: '^(.+)\.ts$'` (required), `i: true` (optional, default `false`) | Set the key to capture group 1 of the first regex match. Drop non-matches and unbound captures. Keep the original value. |
| `field` | `name: 'version'` (required) | Keep the key and replace the value with that object property. An absent property yields `undefined`; a non-object is dropped. |
| `filter` | `when: [{ field: 'succeeded', eq: true }]` (required) | Keep items satisfying every predicate. `when: []` keeps all items. See the predicate table below. |
| `flattenKeys` | None | List nested leaf paths, such as `home.title`, as both keys and values. Translation text is discarded. |
| `sort` | None | Stable ascending sort by value: numeric if all values are numbers, otherwise by string comparison. |
| `lines` | None | Split stringified values on newline, trim each line, and drop empty lines. Keys are original one-based line numbers. |
| `matches` | `re: '^test:'` (required), `i: true` (optional, default `false`) | Keep items whose stringified value matches the regex; preserve keys and values. |
| `toolUses` | `names: ['Bash']`, `subagentType: 'reviewer'` (both optional) | Extract calls from a session snapshot, keyed by observation ordinal. Supplied filters must both match. Does not require success automatically. |
| `userTexts` | `re: '^approved$'` (required), `i: true` (optional, default `false`) | Extract matching user messages, keyed by ordinal. Each value also receives the snapshot's `observedAtMs`. |
| `agentType` | `is: 'reviewer'` (required) | Keep matching parsed sidecar records, keyed by position. Accepts a record array or a single object. |
| `first` | None | Keep the first item and its key. An empty input stays empty. Does not sort. |
| `ageMs` | None | Add `ageMs = observedAtMs - timestampMs` to object values. Drop missing/non-numeric timestamps and future observations. |

`items` and array-valued `select` number each array separately. If several arrays are expanded,
their keys can collide; use `keyBy` when a later comparison needs an object's identifier.
`flattenKeys` descends through plain objects. An array is a leaf at its property's path, so array
indices are not enumerated. Empty objects produce no paths, including when nested.

Regex steps use JavaScript regular expressions. `i` is the supported flag; there is no `g` or `m`
argument. A regex over whole file text anchors `^` at the start of that text. Put `lines` first to
match each trimmed line. `keyByPattern` requires a capturing group, and uses only its first match.

<a id="filter-predicates"></a>
## Filter predicates

Each predicate contains `field` and exactly one operator. `field` names a direct object property,
not a dot path. Non-object values fail a predicate. All predicates in `when` must pass.

| Operator | Example | Condition |
|---|---|---|
| `eq` | `{ field: 'succeeded', eq: true }` | Structural equality with the constant. |
| `ne` | `{ field: 'status', ne: 'draft' }` | Structural inequality with the constant. |
| `size` | `{ field: 'errors', size: 0 }` | The field is an array with exactly this many elements. |
| `notIn` | `{ field: 'status', notIn: ['draft', 'failed'] }` | The field value is unequal to every constant in the array. |
| `lte` | `{ field: 'ageMs', lte: 600000 }` | The field is a number less than or equal to the numeric bound. |
| `gte` | `{ field: 'count', gte: 1 }` | The field is a number greater than or equal to the numeric bound. |

`size`, `lte`, and `gte` take numbers; `notIn` takes an array. An absent property is `undefined`,
so it can satisfy `ne` or `notIn`. Neither operator establishes that the property exists.

<a id="combinators"></a>
## Combinators

The operands are two distinct extraction names. `onlyIn` and `intersect` compare **keys**;
`union` concatenates the lists. All three preserve item values and do not sort or deduplicate.

| Combinator | Syntax | Result |
|---|---|---|
| `union` | `{ op: 'union', of: ['a', 'b'] }` | All items from `a`, followed by all items from `b`, including duplicate keys. |
| `onlyIn` | `{ op: 'onlyIn', of: 'a', notIn: 'b' }` | Items from `a` whose keys do not occur in `b`. |
| `intersect` | `{ op: 'intersect', of: ['a', 'b'] }` | Items from `a` whose keys occur in `b`, with values from `a`. |

<a id="relations"></a>
## Relations

All seven relations return the items that violate the condition. No returned items means the
condition holds. `a` and `b` below name extractions, not source files.

| Relation | Syntax | Condition |
|---|---|---|
| `empty` | `{ op: 'empty', of: 'a' }` | `a` has no items. Every item is reported on failure. |
| `nonEmpty` | `{ op: 'nonEmpty', of: 'a' }` | `a` has at least one item. Failure reports the extraction name with value `null`. |
| `equal` | `{ op: 'equal', of: ['a', 'b'] }` | The sets of values are equal in both directions. Reports left-only items, then right-only items. |
| `subset` | `{ op: 'subset', of: 'a', in: 'b' }` | Every value in `a` occurs in `b`. Reports unmatched items from `a`. |
| `implies` | `{ op: 'implies', of: 'a', requires: 'b' }` | Every key in `a` occurs in `b`. Reports items from `a` with missing required keys. |
| `ordered` | `{ op: 'ordered', of: 'a', strict: false }` | Values are ascending. `strict` defaults to `false`; `true` also rejects equal neighbours. Reports the later item in each failing pair. |
| `unchanged` | `{ op: 'unchanged', of: 'a' }` | For a paired extraction from `state`, values at shared keys agree before and after. Added and removed keys do not violate this relation. |

`equal` and `subset` compare values structurally, ignoring item keys, collection order, and
duplicate counts. Arrays *inside* values remain ordered. `implies` compares keys and ignores
values. For example, `{ key: 'en', value: 'home' }` and `{ key: 'ko', value: 'home' }` satisfy
`equal`, but the first does not imply the second because their keys differ.

`ordered` compares numerically when every value is a number; otherwise it compares string forms.
It does not sort. Empty and single-item inputs satisfy it. Sorting immediately before `ordered`
cannot establish that the original input was ordered.

Only `unchanged` accepts a pair; all other relations take single extractions. `equal`, `subset`,
and `implies` require two distinct extraction names.

<a id="messages-and-witness"></a>
## Messages and declaration witnesses

Each `relate` entry requires a unique `id`, a `relation`, and exactly one message form:

| Field | Use |
|---|---|
| `message` | One diagnostic template for any relation. |
| `messageBySide` | `{ left: '…', right: '…' }`, allowed only for `equal`. |

Templates substitute `{key}` and `{value}` from the first violating item. `{before}` is its
previous value for `unchanged`, or an empty string when absent. Multiple violations add a count
suffix. Object values use their JavaScript string form; extract the field you want to display.

The optional declaration `witness` has its own optional `extract` and required `relate`. It can
reference the body's extractions; the body cannot reference witness extractions, and witness
extraction names cannot shadow body names. If the body fails and every witness comparison holds,
the declaration is witnessed. A witness supply failure does not release the violation.
The top-level [human witness setting](../configuration/index.md#witness) is configured separately.

<a id="mechanisms"></a>
## Mechanisms

Every declaration names one mechanism. The compiler derives axes from `source` steps: fixed
sources except `actor` give `change`; `actor` gives `actor`; file and sidecar bindings give
`world`; transcript bindings give `history`. A scope alone does not add an axis. Body relation
names and derived axes must fit the selected mechanism. Witness extraction sources also contribute
axes. The mechanism does not supply a predicate; write the extraction and comparison yourself.

| Mechanism | Allowed axes | Allowed body relations | Purpose or required structure |
|---|---|---|---|
| `pairing` | `world` | `equal`, `subset` | Compare corresponding data from supplied files. |
| `companion` | `change`, `world` | `implies` | Require matching keys in another extraction. |
| `monotonic-order` | `change`, `world` | `ordered` | Check a sequence's order. |
| `fingerprint-sync` | `world` | `equal` | Compare extracted fingerprint values. |
| `producer-owned` | `actor` | `empty`, `nonEmpty` | Check the observed actor. |
| `self-absolution-ban` | `change` | `unchanged`, `empty` | Check changes to the file's own contents. |
| `actor-scope` | `actor` | `empty`, `nonEmpty` | Restrict work by the observed actor. |
| `precedent` | `history`, `world` | `nonEmpty` | Require prior evidence. |
| `phase-order` | `history` | `ordered` | Compare extracted observation ordinals. |
| `turn-locality` | `history` | `nonEmpty` | Require evidence within a declared time window. |
| `stated-ground` | `history` | `nonEmpty` | Require a matching user statement. |
| `controlled-vocabulary` | `change`, `world` | `subset` | Compare extracted values with an allowed set. |
| `naming` | `change` | `empty`, `nonEmpty` | `scope.source` must be `target.path`. |
| `added-only` | `change` | `empty` | Usually compares the `post`/`pre` difference. |
| `one-way-marker` | `change` | `subset` | Require selected values to remain present. |
| `delegated-scope` | — | — | Reserved; rejected at load time. |
| `scoped-valve` | `change`, `actor`, `world`, `history` | All seven | A declaration `witness` block is required. |
| `forbidden-command` | `change` | `empty` | `scope.source` must be `command`. |

The 18 names include one reserved name, so 17 can be used. Mechanism constraints and
[discipline-list placement](../configuration/index.md#placement-rule) are separate checks.

<a id="validation"></a>
## Validate a declaration

Run `pnpm exec pdks explain` and confirm the entry is a `declare` registration on the intended
surface. A declaration that cannot compile, such as an unregistered step, a wrong step argument,
or a paired/single mismatch, fails configuration loading with its location and reason, as
unknown keys and invalid source/list combinations do.

Then exercise a violating input and a valid input through the matching surface. See
[the worked locale example](../../how-to/write-disciplines.md#locale-key-pairing).
An exit code of 0 alone is insufficient: `advised` and `skipped` can both exit 0.
