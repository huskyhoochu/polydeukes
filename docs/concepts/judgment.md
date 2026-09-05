# How a judgment works

**English** · [한국어](./judgment.ko.md)

Polydeukes checks a declared practice against evidence a connected surface supplies. It does not
infer that a practice was followed merely because an agent says so. A passing result is bounded
by the files, calls, and history actually observed.

<a id="terms"></a>
## Covenant, discipline, and surface

A **covenant** is a shared promise about the work. A **discipline** is one practice registered
in the project's configuration. The **judge** evaluates evidence; a **verdict** records the result.

A **surface** determines when evidence is gathered:

- The session surface observes a supported host's tool call before it runs.
- The commit surface observes staged changes, working-tree changes, or a revision range.

Installing the package is not the same as connecting a surface. Instructions an agent reads are
not automatic interception of its tools. Use a supported integration and verify an actual call.
See [connect the surfaces](../how-to/connect-surfaces.md).

<a id="declarations"></a>
## Declarations and their limits

A judged discipline has an `id` and a `declare` block. Its scope selects observations; its sources
provide evidence; extraction steps transform that evidence; relations identify elements that
break the promise. `why` explains the practice but is not executable logic.

The fixed sources are `target.path`, `pre`, `post`, `state`, `changes`, `command`, and `actor`.
Additional bindings can read a named file, a sidecar channel, or session history. A declaration
can only use sources the surface supplies. The same declaration can therefore be judged on one
surface and skipped, or not match its scope, on another.

`state` pairs before and after values on a modification. It is not persistent state across runs,
an assertion that a workflow advanced, or proof that a command succeeded. The `unchanged`
relation consumes a paired extraction; other relations consume single extractions. Additions
and deletions do not carry that modification pair. Missing evidence follows the declaration's
`supply` policy, not a fabricated empty file.

A `draft: true` entry records a practice that has not been promoted into a declaration. It does
not judge or emit a telemetry row. Do not use a draft merely because a valid declaration needs
more testing. Conversely, do not invent a step or mechanism when the grammar lacks the evidence
or comparison you need. [Write disciplines](../how-to/write-disciplines.md) demonstrates a
working locale key comparison and a genuinely unsupported promise.

<a id="relations"></a>
## Seven relations

Relations return a list of elements for which the comparison fails. An empty list means the
relation holds; it is not the same as the `empty` relation's requirement.

| Relation | Requirement |
|---|---|
| `empty` | The extraction contains no items. |
| `nonEmpty` | The extraction contains at least one item. |
| `equal` | Both extracted collections agree. |
| `subset` | Every item on the left is present on the right. |
| `implies` | The left-hand key requirements have corresponding keys on the right. |
| `ordered` | The extracted sequence satisfies the declared ordering. |
| `unchanged` | Values at shared keys agree before and after a modification. |

Keys and values have different roles. Keys identify items for keyed comparisons and combination;
values are compared structurally. A comparison of translation keys does not compare translated
text. Extraction decides which distinction a relation can see.

<a id="mechanisms"></a>
## Eighteen mechanism names

A mechanism names the purpose and allowed shape of a declaration, not a new comparison operator.
The compiler derives the evidence axes and relations from the syntax and checks that they fit
the chosen mechanism.

`pairing`, `companion`, `monotonic-order`, `fingerprint-sync`, `producer-owned`,
`self-absolution-ban`, `actor-scope`, `precedent`, `phase-order`, `turn-locality`, `stated-ground`,
`controlled-vocabulary`, `naming`, `added-only`, `one-way-marker`, `delegated-scope`,
`scoped-valve`, and `forbidden-command` are the closed catalog.

`delegated-scope` is **reserved**, not a usable declaration in this release. `scoped-valve`
requires its own witness block; `naming` scopes on `target.path`; `forbidden-command` scopes on
`command`. See the [configuration reference](../reference/configuration/index.md#disciplines)
for syntax and extraction steps.

<a id="verdicts"></a>
## Interpret the result, not just the exit code

| Record | Meaning |
|---|---|
| `passed` | The observed input was judged and upheld the covenant. |
| `blocked` | The observed input broke the covenant and was refused. |
| `witnessed` | A blocking judgment was allowed through its witness valve. |
| `advised` | A violation was recorded without stopping the operation. |
| `skipped` | The absence of a judgment was recorded. It is not a pass. |
| `unattributed` | Baseline comparison found protected movement without an explaining judgment. |

The final record is a comparison finding, not a judge's verdict. Telemetry uses the same event
column to record it. An `advised` or `skipped` observation may exit 0; that does not establish
that the practice was followed. An empty observation set establishes nothing about other files.

<a id="enforcement-and-witness"></a>
## Enforcement and witness

Discipline entries default to `advise`. Promote an entry with `enforce: block` only after checking
both its violating and valid cases. The commit surface's level and an entry's level compose:
**the lenient side wins**. Setting only the surface to `block` does not promote every entry.
Protection of the judging chain is separate from ordinary discipline entries.

The witness valve is consulted after a blocking judgment, never instead of judgment. Session
and commit witnesses have different delivery mechanisms and evidence. A commit prompt cannot
approve a pending session call. See [witness and
recovery](../how-to/connect-surfaces.md#witness-and-recovery)
and [troubleshooting](../troubleshooting.md).
