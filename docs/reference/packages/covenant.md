# `@polydeukes/covenant`

**English** · [한국어](covenant.ko.md)

> **The judge** — the dispatcher, the discipline library, the meta-covenants, and the TTL
> witness valve.
>
> Alpha. A transitive dependency of the umbrella: you do not install it and you do not
> import it. What you reach is its behaviour, through the `disciplines:` block in your config
> and the rows it writes to `.polydeukes/roi.log`.

<a id="ownership"></a>
## What this package owns

The judge. Everything that turns a declared promise into a verdict lives here.

**This is the install unit for judgment.** An embedder that wants verdicts without the
umbrella's surfaces installs this package and provides `@polydeukes/core` alongside it — core
is a `peerDependency` here, so the vocabulary is shared rather than duplicated. The umbrella
is what satisfies that peer for an ordinary consumer.

| Unit | What it does |
|---|---|
| `runCovenant` wrapper | Runs a judge body, translates its non-blocking `1` into the blocking `2`, and logs every call. No covenant runs unmeasured |
| Path-routing dispatcher | Registers covenants against protected paths and runs *every* matching one — no short-circuit, so the telemetry never under-counts |
| Meta-covenants | Three registrations that protect the judging chain itself |
| TTL witness | The time-boxed human valve, consulted only after a verdict blocked |
| Delta layer | New-violation-only judgment over a file's before/after pair |
| Discipline library | Config `disciplines:` entries become enforcement without a line of code |

<a id="disciplines-and-meta-covenants"></a>
## Discipline families and meta-covenants

**A `disciplines:` entry is one declaration** — `judge = relate ∘ extract` over the
observation as a world. What the declaration's sources bind decides what evidence the
judgment needs, which is also what decides whether it can be judged on a given surface.

| Sources | Judges | Evidence needed |
|---|---|---|
| the fixed names `target.path` · `pre` · `post` · `state` · `changes` | The change itself | A file change |
| the fixed name `command` | The shell call's command line | A shell call — an Edit carries none |
| `{ transcript: true }` | Session history — was a qualifying call actually executed *before* this one | A session |
| `{ file: … }` · `{ sidecar: true }` | Another file, or the spawn-record channel | The surface's reader for it |

The writing guide for these entries is [the configuration reference's `disciplines`
section](../configuration/index.md#disciplines); the declaration grammar is the core's
`algebra-declaration.schema.json`.

**Three meta-covenants** protect the judging chain. They are covenants like any other; the
vocabulary below applies to them unchanged.

| Registration | Axis | Judges |
|---|---|---|
| self-mod | Tool | Mutations to protected paths through editing tools. Only the call's proven mutation target is compared — a protected path inside an edit's *content* is a mention and passes |
| shell-mod | Shell | The same, through a command line. A command mentioning a protected path passes only if its leading word proves it read-only |
| transcript-mod | Transcript | Writes to the live session transcript, judged by whole-path **equality** — never as a protected ancestor |

**Six words** are the telemetry contract — five verdicts and one observation. A row in
`.polydeukes/roi.log` carries exactly one of them, and the CLI, the docs, and the tests use
the same word for the same event. How to read a row is in
[troubleshooting](../../troubleshooting.md#reading-a-verdict).

| Verdict | Means |
|---|---|
| `passed` | The call was judged and upheld the covenant |
| `blocked` | The call was judged and broke it |
| `witnessed` | A **blocked** verdict a human opened in person. Never silent, never a clean call |
| `advised` | A break recorded without stopping the call — the default for every discipline entry on both surfaces, and the commit surface's outcome under `adapters.git.enforce: advise` |
| `skipped` | The call reached a registration that could not judge it. **Not a pass** — the recorded absence of a judgment |
| `unattributed` | A protected entry's on-disk state moved and no judgment row explains it. **Not a verdict** — no call is blocked or passed by it; the session surface writes it after comparing state against a stored baseline |

`unattributed` answers a question the other five cannot. They are all written by a judge
about a call it was handed, so a write that arrives without a declared call — through an
interpreter, a test runner's child process, a script that assembles the path from its own
arguments — leaves no row at all. The comparison observes the result rather than the
spelling, so it records that write after the fact. It never blocks: the write already
happened, and the comparison fails open on both sides of the verdict.

<a id="consumer-contract"></a>
## Where the consumer touches it

- **The `disciplines:` block** in your config. One entry compiles into one registration,
  carrying its own telemetry label.
- **`protectedPaths`**, which the path-routing dispatcher matches against.
- **The `witness` block**, which arms the TTL valve.
- **`.polydeukes/roi.log`**, where every judgment lands as one row.

No import. The umbrella assembles this package for both surfaces.

<a id="limits"></a>
## Declared limits

- **The shell axis leaves `skipped` rows, and that row is the contract.** Predicting a
  shell command's target from its text is undecidable, so the invariant this axis holds is
  not "nothing gets through" — it is that **no call passes unrecorded**. A new spelling
  landing in `skipped` is the declared limit showing itself. A pass with no row at all, or
  one recorded `passed` without a judgment, is the defect class.
- **A declaration that reads the session cannot be judged without one.** On the commit
  surface there is none. A matching `precedent` (or any other transcript-reading)
  declaration records `skipped` with the reason `supply-pass` only when that declaration's
  own `supply` is `pass`. With no policy the missing session is unjudgeable (exit 2), not
  an automatic skip. That skip-with-pass is a permanent condition of that surface.
- **A declaration scoped on `command` is absent from the commit surface, and absent without
  a row.** A staged diff carries no command line, so no world such a declaration observes is
  admitted there. This leaves nothing in `.polydeukes/roi.log`, so the log cannot separate a
  command discipline that never triggered from one whose surface never observed a command.
- **A declaration the compiler cannot resolve compiles to a skip registration** — routing
  intact, no body: a step outside the registry, an argument outside a step's keys, a pattern
  that does not compile, a paired/single mismatch. Assembly therefore never throws: one
  unresolvable entry cannot take down its siblings, the meta-covenants, and the valve, which
  would leave no way to fix the config that caused it. A reserved mechanism, or one whose
  axes and relations the catalogue refuses, is a different stage: `loadConfig` rejects the
  file (exit 2), and no skip row is written. A source the world lacks at judgment time is a
  third case — the declaration's own `supply` policy disposes of it, and with no policy the
  body answers unjudgeable (exit 2), never upheld.
- **Complete containment is a non-goal.** There are no blocklists here — enumerating bypass
  spellings is always one step behind, so the logic is inverted: a mention of a protected
  path blocks unless proven safe. Residual vectors such as indirect path computation are
  telemetry targets, not block targets. The two friction valves — the read-only allowlist
  and the TTL witness — both leave a measurable trace.
- **The valve stands after the verdict.** Only a judgment that actually blocked can be
  witnessed open, a mid-sentence mention of the token does not arm it, and an AI can never
  open the valve for itself.
